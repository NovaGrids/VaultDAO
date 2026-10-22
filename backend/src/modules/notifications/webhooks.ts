import { createHmac } from "node:crypto";
import { createLogger } from "../../shared/logging/logger.js";

const logger = createLogger("execution-webhooks");

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
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
  maxRetries: number,
): Promise<void> {
  void timeoutMs;
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
      if (attempt >= maxRetries) {
        // Dead-letter: log exhaustively, never throw into the indexer path.
        logger.error("webhook delivery exhausted retries (dead-letter)", {
          url,
          attempts: attempt + 1,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      const backoffMs = 2 ** attempt * 100;
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
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.secret) {
    headers["X-VaultDAO-Signature"] = signWebhookPayload(body, config.secret);
  }
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
          url,
          body,
          headers,
          config.timeoutMs ?? 5_000,
          config.maxRetries ?? 3,
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
