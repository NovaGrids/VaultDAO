import { createHmac, randomUUID } from "node:crypto";
import { createLogger } from "../../shared/logging/logger.js";
import { REQUEST_ID_HEADER, requestIdStorage } from "../../shared/http/requestId.js";

const logger = createLogger("execution-webhooks");

/** Default total retry budget for a single delivery: 24 hours. */
export const DEFAULT_MAX_TOTAL_RETRY_SECONDS = 24 * 60 * 60;

/** A delivery that exhausted its total retry budget and was dead-lettered. */
export interface WebhookDeadLetter {
  readonly webhookId: string;
  readonly event: ExecutionWebhookEvent;
  readonly url: string;
  readonly attempts: number;
  readonly lastError: string;
  readonly deadLetteredAt: string;
}

/** Per-webhook in-memory dead-letter queue. */
const deadLetterStore = new Map<string, WebhookDeadLetter[]>();

/** Read dead-lettered deliveries for a webhook id (empty array if none). */
export function getWebhookDlq(webhookId: string): readonly WebhookDeadLetter[] {
  return deadLetterStore.get(webhookId) ?? [];
}

function pushToDlq(record: WebhookDeadLetter): void {
  const existing = deadLetterStore.get(record.webhookId) ?? [];
  existing.push(record);
  deadLetterStore.set(record.webhookId, existing);
}

/** Execution-related event delivered to configured webhook URLs. */
export interface ExecutionWebhookEvent {
  readonly type: string;
  readonly id: string;
  readonly occurredAt: string;
  readonly payload: Record<string, unknown>;
}

export interface ExecutionWebhookConfig {
  /** Destination URL(s). */
  readonly urls: string[];
  /** Optional secret — sent as `X-VaultDAO-Signature: sha256=<hmac>`. */
  readonly secret?: string;
  /** Optional event allowlist; empty means all execution events. */
  readonly events?: string[];
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  /** Total retry budget in seconds across all attempts (default 24h). */
  readonly maxTotalRetrySeconds?: number;
}

export type WebhookHttpClient = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** HMAC-SHA256 signature for a payload (`sha256=<hex>`). Documented header: `X-VaultDAO-Signature`. */
export function signWebhookPayload(payload: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

export function isExecutionEventAllowed(
  event: ExecutionWebhookEvent,
  config: ExecutionWebhookConfig,
): boolean {
  if (!config.events || config.events.length === 0) return true;
  return config.events.includes(event.type);
}

async function postWithRetries(
  client: WebhookHttpClient,
  webhookId: string,
  event: ExecutionWebhookEvent,
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
  maxRetries: number,
  maxTotalRetryMs: number,
): Promise<void> {
  void timeoutMs;
  const startedAt = Date.now();
  let attempt = 0;
  for (;;) {
    try {
      const res = await client(url, {
        method: "POST",
        headers,
        body,
      });
      if (res.ok) return;
      throw new Error(`webhook delivery failed with status ${res.status}`);
    } catch (err) {
      const lastError = err instanceof Error ? err.message : String(err);
      const elapsedMs = Date.now() - startedAt;
      const budgetExhausted = elapsedMs >= maxTotalRetryMs;
      if (attempt >= maxRetries || budgetExhausted) {
        // Dead-letter: log exhaustively, never throw into the indexer path.
        const record: WebhookDeadLetter = {
          webhookId,
          event,
          url,
          attempts: attempt + 1,
          lastError,
          deadLetteredAt: new Date().toISOString(),
        };
        pushToDlq(record);
        logger.error("webhook delivery exhausted retries (dead-letter)", {
          url,
          attempts: record.attempts,
          elapsedMs,
          budgetExhausted,
          error: lastError,
        });
        logger.info("webhook.dead_lettered", {
          webhookId,
          url,
          type: event.type,
          eventId: event.id,
          attempts: record.attempts,
          deadLetteredAt: record.deadLetteredAt,
        });
        return;
      }
      const backoffMs = 2 ** attempt * 100;
      if (elapsedMs + backoffMs >= maxTotalRetryMs) {
        // Next backoff would exceed the budget; dead-letter now.
        const record: WebhookDeadLetter = {
          webhookId,
          event,
          url,
          attempts: attempt + 1,
          lastError,
          deadLetteredAt: new Date().toISOString(),
        };
        pushToDlq(record);
        logger.error("webhook delivery exhausted retry budget (dead-letter)", {
          url,
          attempts: record.attempts,
          elapsedMs,
          error: lastError,
        });
        logger.info("webhook.dead_lettered", {
          webhookId,
          url,
          type: event.type,
          eventId: event.id,
          attempts: record.attempts,
          deadLetteredAt: record.deadLetteredAt,
        });
        return;
      }
      await sleep(backoffMs);
      attempt += 1;
    }
  }
}

/**
 * Emit an execution-related event to all configured webhook URLs.
 *
 * Never throws: invalid/unreachable URLs are logged and do not take down
 * the indexer. Uses the global `fetch` by default; pass a mocked client in tests.
 */
export async function emitExecutionWebhook(
  event: ExecutionWebhookEvent,
  config: ExecutionWebhookConfig,
  client?: WebhookHttpClient,
): Promise<void> {
  if (!isExecutionEventAllowed(event, config)) {
    logger.info("webhook event skipped by allowlist", { type: event.type });
    return;
  }
  const body = JSON.stringify(event);
  const requestId = requestIdStorage.getStore() ?? randomUUID();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [REQUEST_ID_HEADER]: requestId,
  };
  if (config.secret) {
    headers["X-VaultDAO-Signature"] = signWebhookPayload(body, config.secret);
  }
  const maxTotalRetryMs =
    (config.maxTotalRetrySeconds ?? DEFAULT_MAX_TOTAL_RETRY_SECONDS) * 1000;
  const http: WebhookHttpClient =
    client ??
    (async (url, init) => {
      const res = await fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
      });
      return { ok: res.ok, status: res.status };
    });
  await Promise.all(
    config.urls.map(async (url) => {
      try {
        await postWithRetries(
          http,
          event.id,
          event,
          url,
          body,
          headers,
          config.timeoutMs ?? 5_000,
          config.maxRetries ?? 3,
          maxTotalRetryMs,
        );
        logger.info("webhook delivered", { url, type: event.type });
      } catch (err) {
        logger.error("webhook delivery error contained", {
          url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
}
