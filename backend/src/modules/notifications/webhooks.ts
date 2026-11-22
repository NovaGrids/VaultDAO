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

export type WebhookUrlValidation = { ok: true } | { ok: false; reason: string };

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 ("this network")
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

/** Extract embedded IPv4 from IPv4-mapped IPv6 (`::ffff:a.b.c.d` or `::ffff:xxxx:xxxx`). */
function extractMappedIpv4(host: string): number[] | null {
  const lower = host.toLowerCase();
  if (!lower.startsWith("::ffff:")) return null;
  const rest = lower.slice("::ffff:".length);
  const dotted = parseIpv4(rest);
  if (dotted) return dotted;
  const hexParts = rest.split(":");
  if (hexParts.length !== 2) return null;
  if (!hexParts.every((p) => /^[0-9a-f]{1,4}$/.test(p))) return null;
  const high = parseInt(hexParts[0], 16);
  const low = parseInt(hexParts[1], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isPrivateIpv6(host: string): boolean {
  const lower = host.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = extractMappedIpv4(lower);
  if (mapped) return isPrivateIpv4(mapped);
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true; // loopback
  if (lower === "::" || lower === "0:0:0:0:0:0:0:0") return true; // unspecified
  // fe80::/10 link-local
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
  // fc00::/7 unique local
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  return false;
}

/**
 * Validate a webhook destination URL for SSRF safety.
 *
 * Requires HTTPS and rejects loopback, RFC-1918, link-local, and
 * IPv4-mapped IPv6 destinations as well as `localhost` hostnames.
 */
export function validateWebhookUrl(rawUrl: string): WebhookUrlValidation {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "webhook URL must use https" };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname.length === 0) {
    return { ok: false, reason: "webhook URL must include a host" };
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { ok: false, reason: "webhook URL must not target localhost" };
  }
  const bareHost = hostname.replace(/^\[|\]$/g, "");
  const ipv4 = parseIpv4(bareHost);
  if (ipv4) {
    if (isPrivateIpv4(ipv4)) {
      return { ok: false, reason: "webhook URL must not target private or link-local IPs" };
    }
    return { ok: true };
  }
  if (bareHost.includes(":")) {
    if (isPrivateIpv6(bareHost)) {
      return { ok: false, reason: "webhook URL must not target private or link-local IPs" };
    }
  }
  return { ok: true };
}

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
      const validation = validateWebhookUrl(url);
      if (!validation.ok) {
        logger.warn("webhook URL rejected by SSRF validation", {
          url,
          reason: validation.reason,
        });
        return;
      }
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
