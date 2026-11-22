import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
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
  /** Active signing key identifier. Defaults to "default" for legacy config. */
  readonly keyId?: string;
  /** Previous receiver keys remain valid until expiresAt (overlap rotation). */
  readonly previousKeys?: readonly { keyId: string; secret: string; expiresAt: number }[];
  /** Optional event allowlist; empty means all execution events. */
  readonly events?: string[];
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  /** Total retry budget in seconds across all attempts (default 24h). */
  readonly maxTotalRetrySeconds?: number;
  readonly circuitBreakerThreshold?: number;
  readonly circuitBreakerCooldownMs?: number;
}

export type WebhookHttpClient = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
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

/** HMAC-SHA256 signature bound to the timestamp, nonce, and exact payload. */
export function signWebhookPayload(
  payload: string,
  secret: string,
  timestamp?: string,
  nonce?: string,
): string {
  const message = timestamp !== undefined && nonce !== undefined
    ? `${timestamp}.${nonce}.${payload}`
    : payload;
  return `sha256=${createHmac("sha256", secret).update(message).digest("hex")}`;
}

export interface ExecutionWebhookVerificationKey {
  readonly keyId: string;
  readonly secret: string;
  /** Previous keys may verify only until this epoch-millisecond deadline. */
  readonly expiresAt?: number;
}

export interface WebhookNonceReplayStore {
  claim(nonce: string, now: number, maxAgeMs: number): boolean;
}

export class InMemoryWebhookNonceReplayStore implements WebhookNonceReplayStore {
  private readonly expiresAt = new Map<string, number>();

  claim(nonce: string, now: number, maxAgeMs: number): boolean {
    const expiresAt = this.expiresAt.get(nonce);
    if (expiresAt !== undefined && expiresAt > now) return false;
    this.expiresAt.set(nonce, now + maxAgeMs);
    for (const [storedNonce, expiry] of this.expiresAt) {
      if (expiry <= now) this.expiresAt.delete(storedNonce);
    }
    return true;
  }
}

/** Persistent replay protection for receiver instances sharing a SQLite file. */
export class SqliteWebhookNonceReplayStore implements WebhookNonceReplayStore {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS execution_webhook_nonces (
        nonce TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS execution_webhook_nonces_expiry
        ON execution_webhook_nonces(expires_at);
    `);
  }

  claim(nonce: string, now: number, maxAgeMs: number): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM execution_webhook_nonces WHERE expires_at <= ?").run(now);
      const result = this.db.prepare(`
        INSERT OR IGNORE INTO execution_webhook_nonces(nonce, expires_at) VALUES (?, ?)
      `).run(nonce, now + maxAgeMs);
      this.db.exec("COMMIT");
      return Number(result.changes) === 1;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function getExecutionWebhookVerificationKeys(
  config: ExecutionWebhookConfig,
  now = Date.now(),
): ExecutionWebhookVerificationKey[] {
  const keys: ExecutionWebhookVerificationKey[] = [];
  if (config.secret) {
    keys.push({ keyId: config.keyId ?? "default", secret: config.secret });
  }
  for (const key of config.previousKeys ?? []) {
    if (key.expiresAt >= now) keys.push(key);
  }
  return keys;
}

/** Receiver-side replay guard; use one shared instance for all requests. */
export class WebhookNonceReplayGuard {
  constructor(
    private readonly maxAgeMs = 300_000,
    private readonly replayStore: WebhookNonceReplayStore = new InMemoryWebhookNonceReplayStore(),
  ) {
    if (!Number.isInteger(maxAgeMs) || maxAgeMs <= 0) {
      throw new Error("Webhook replay window must be a positive integer");
    }
  }

  verify(input: {
    body: string;
    keyId: string;
    signature: string;
    timestamp: string;
    nonce: string;
    keys: readonly ExecutionWebhookVerificationKey[];
    now?: number;
  }): boolean {
    const now = input.now ?? Date.now();
    const timestamp = Number(input.timestamp);
    if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > this.maxAgeMs) return false;
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(input.nonce)) return false;
    const key = input.keys.find((candidate) =>
      candidate.keyId === input.keyId &&
      (candidate.expiresAt === undefined || candidate.expiresAt >= now),
    );
    if (!key) return false;
    const expected = signWebhookPayload(input.body, key.secret, input.timestamp, input.nonce);
    const a = Buffer.from(expected);
    const b = Buffer.from(input.signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    return this.replayStore.claim(input.nonce, now, this.maxAgeMs);
  }
}

export type ExecutionWebhookCircuitStatus = "closed" | "open" | "half-open";
export interface ExecutionWebhookCircuitState {
  status: ExecutionWebhookCircuitStatus;
  failures: number;
  openedAt: number | null;
}
const endpointCircuits = new Map<string, ExecutionWebhookCircuitState>();
const halfOpenProbes = new Set<string>();

export function getExecutionWebhookCircuitState(url: string): Readonly<ExecutionWebhookCircuitState> | undefined {
  const state = endpointCircuits.get(url);
  return state ? { ...state } : undefined;
}

export function resetExecutionWebhookCircuit(url: string): void {
  endpointCircuits.set(url, { status: "closed", failures: 0, openedAt: null });
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
  config: ExecutionWebhookConfig,
): Promise<void> {
  const startedAt = Date.now();
  let attempt = 0;
  const threshold = config.circuitBreakerThreshold ?? 5;
  const cooldown = config.circuitBreakerCooldownMs ?? 60_000;
  let circuit = endpointCircuits.get(url) ?? { status: "closed", failures: 0, openedAt: null };
  endpointCircuits.set(url, circuit);
  if (!Number.isInteger(threshold) || threshold < 1 || !Number.isFinite(cooldown) || cooldown < 1) {
    throw new Error("Webhook circuit breaker threshold and cooldown must be positive");
  }
  if (circuit.status === "open" && circuit.openedAt !== null) {
    if (Date.now() - circuit.openedAt < cooldown) {
      throw new Error("webhook endpoint circuit is open");
    }
    circuit.status = "half-open";
  }
  const halfOpenProbe = circuit.status === "half-open";
  if (halfOpenProbe && halfOpenProbes.has(url)) {
    throw new Error("webhook endpoint half-open probe is already in flight");
  }
  if (halfOpenProbe) halfOpenProbes.add(url);
  for (;;) {
    try {
      const timestamp = String(Date.now());
      const nonce = randomUUID();
      const keyId = config.keyId ?? "default";
      const signingSecret = config.secret;
      const attemptHeaders = { ...headers };
      if (signingSecret) {
        attemptHeaders["X-VaultDAO-Key-Id"] = keyId;
        attemptHeaders["X-VaultDAO-Timestamp"] = timestamp;
        attemptHeaders["X-VaultDAO-Nonce"] = nonce;
        attemptHeaders["X-VaultDAO-Signature"] =
          signWebhookPayload(body, signingSecret, timestamp, nonce);
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let res: { ok: boolean; status: number };
      try {
        res = await client(url, {
        method: "POST",
        headers: attemptHeaders,
        body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (res.ok) {
        circuit.status = "closed";
        circuit.failures = 0;
        circuit.openedAt = null;
        if (halfOpenProbe) halfOpenProbes.delete(url);
        return;
      }
      throw new Error(`webhook delivery failed with status ${res.status}`);
    } catch (err) {
      circuit.failures += 1;
      if (circuit.status === "half-open" || circuit.failures >= threshold) {
        circuit.status = "open";
        circuit.openedAt = Date.now();
      }
      if (halfOpenProbe) halfOpenProbes.delete(url);
      const lastError = err instanceof Error ? err.message : String(err);
      const elapsedMs = Date.now() - startedAt;
      const budgetExhausted = elapsedMs >= maxTotalRetryMs;
      if (circuit.status === "open" || halfOpenProbe) {
        attempt = maxRetries;
      }
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
  const maxTotalRetryMs =
    (config.maxTotalRetrySeconds ?? DEFAULT_MAX_TOTAL_RETRY_SECONDS) * 1000;
  const http: WebhookHttpClient =
    client ??
    (async (url, init) => {
      const res = await fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: init.signal,
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
          config,
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
