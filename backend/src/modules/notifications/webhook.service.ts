/**
 * WebhookDeliveryService
 *
 * Handles webhook registration, HMAC-SHA256 signed delivery, exponential
 * backoff retry, circuit breaker, and delivery record persistence.
 *
 * Acceptance criteria:
 * - Webhook URL must be HTTPS; HTTP URLs are rejected with a validation error.
 * - webhook.secret is stored as a SHA-256 hash and never returned in API responses.
 * - Payload is signed with HMAC-SHA256 using the raw (unhashed) secret supplied
 *   at registration time; the signature is sent in X-VaultDAO-Signature.
 * - Failed deliveries are retried up to 5 times with exponential backoff:
 *   1s, 2s, 4s, 8s, 16s (6 total attempts).
 * - After 5 consecutive failures the circuit breaker opens and pauses delivery
 *   for CIRCUIT_BREAKER_RECOVERY_MS (default 5 minutes). After the cooldown
 *   the breaker enters half-open state and allows one probe attempt.
 * - Each delivery attempt is recorded in the webhook_deliveries store.
 * - Delivery timeout is 10 seconds per attempt.
 * - Per-attempt metrics (attempt, status, duration, webhookId) are collected and
 *   accessible via getMetrics().
 */

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createLogger } from "../../shared/logging/logger.js";
import type { NotificationEvent } from "./notification.types.js";
import type { DeliveryRecord, WebhookRegistration } from "./notification.types.js";
import { NotificationTarget } from "./notification.types.js";
import type { StorageAdapter } from "../../shared/storage/storage.adapter.js";
import { InMemoryStorageAdapter } from "../../shared/storage/storage.adapter.js";

const logger = createLogger("webhook-delivery");

/** Delivery timeout per attempt in milliseconds. */
const DELIVERY_TIMEOUT_MS = 10_000;

/** Maximum number of delivery attempts (initial + 5 retries = 6 total). */
const MAX_ATTEMPTS = 6;

/** Exponential backoff delays in milliseconds: 1s, 2s, 4s, 8s, 16s. */
const BACKOFF_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

/**
 * Number of consecutive failures required to open the circuit breaker
 * for a given webhook.
 */
const CIRCUIT_BREAKER_THRESHOLD = 5;

/**
 * How long the circuit breaker stays open (paused) before transitioning to
 * half-open for a recovery probe attempt (default 5 minutes).
 */
const CIRCUIT_BREAKER_RECOVERY_MS = 5 * 60 * 1_000;

// ── Internal storage types ────────────────────────────────────────────────────

/** Stored webhook registration — secret is SHA-256 hashed. */
export interface StoredWebhookRegistration {
  readonly id: string;
  readonly url: string;
  /** SHA-256 hash of the original secret. Never returned to callers. */
  readonly secretHash: string;
  /** Raw secret kept in memory only for signing; NOT persisted to disk. */
  readonly secretRaw: string;
  readonly topics: string[];
  readonly createdAt: string;
}

/** Stored delivery record. */
export interface StoredDeliveryRecord extends DeliveryRecord {
  readonly webhookId: string;
}

// ── Circuit breaker ───────────────────────────────────────────────────────────

/**
 * Circuit breaker states:
 * - `closed`   — normal operation; requests flow through.
 * - `open`     — circuit is tripped; deliveries are paused until the recovery
 *                window elapses.
 * - `half-open` — one probe attempt is allowed to test recovery.
 */
export type CircuitBreakerStatus = "closed" | "open" | "half-open";

export interface CircuitBreakerState {
  /** Current state of the breaker. */
  status: CircuitBreakerStatus;
  /** Number of consecutive failures since last success (or since creation). */
  consecutiveFailures: number;
  /** Epoch ms when the breaker was last opened. null when closed. */
  openedAt: number | null;
  /** Epoch ms of the last recorded state transition. */
  lastTransitionAt: number;
}

// ── Delivery metrics ──────────────────────────────────────────────────────────

export interface DeliveryAttemptMetric {
  readonly webhookId: string;
  readonly eventId: string;
  /** 1-based attempt number within the current delivery run. */
  readonly attempt: number;
  /** `"success"` if the HTTP response was 2xx, `"failed"` otherwise. */
  readonly status: "success" | "failed";
  /** Wall-clock duration of the HTTP request in milliseconds. */
  readonly durationMs: number;
  /** ISO 8601 timestamp of the attempt. */
  readonly recordedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function signPayload(secret: string, body: string, timestamp: number): string {
  const message = `${timestamp}.${body}`;
  return `sha256=${createHmac("sha256", secret).update(message).digest("hex")}`;
}

/**
 * Verify an incoming webhook signature. Receivers call this to confirm
 * the payload originated from VaultDAO.
 * Rejects payloads older than `maxAgeMs` (default 5 minutes) to prevent replay attacks.
 */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  signature: string,
  timestamp: number,
  maxAgeMs: number = 300_000,
): boolean {
  const age = Math.abs(Date.now() - timestamp);
  if (age > maxAgeMs) return false;

  const expected = signPayload(secret, body, timestamp);
  if (expected.length !== signature.length) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeClosedBreaker(): CircuitBreakerState {
  return {
    status: "closed",
    consecutiveFailures: 0,
    openedAt: null,
    lastTransitionAt: Date.now(),
  };
}

// ── Dead-letter entry ─────────────────────────────────────────────────────────

export interface DeadLetterEntry {
  readonly id: string;
  readonly webhookId: string;
  readonly event: NotificationEvent;
  readonly lastError: string;
  readonly attempts: number;
  readonly failedAt: string;
  replayed: boolean;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class WebhookDeliveryService {
  private readonly webhooks = new Map<string, StoredWebhookRegistration>();
  private readonly deliveryStore: StorageAdapter<StoredDeliveryRecord & { id: string }>;
  private readonly deadLetters: Map<string, DeadLetterEntry> = new Map();

  /** Per-webhook circuit breaker state. Keyed by webhook ID. */
  private readonly circuitBreakers = new Map<string, CircuitBreakerState>();

  /** Collected metrics — one entry per delivery attempt. */
  private readonly metrics: DeliveryAttemptMetric[] = [];

  constructor(
    deliveryStore?: StorageAdapter<StoredDeliveryRecord & { id: string }>,
  ) {
    this.deliveryStore =
      deliveryStore ?? new InMemoryStorageAdapter<StoredDeliveryRecord & { id: string }>();
  }

  // ── Registration ──────────────────────────────────────────────────────────

  /**
   * Register a new webhook endpoint.
   *
   * @throws {Error} if the URL is not HTTPS.
   */
  public register(
    url: string,
    secret: string,
    topics: string[],
  ): Omit<WebhookRegistration, "secret"> {
    this.validateHttpsUrl(url);

    const id = randomUUID();
    const registration: StoredWebhookRegistration = {
      id,
      url,
      secretHash: hashSecret(secret),
      secretRaw: secret,
      topics,
      createdAt: new Date().toISOString(),
    };
    this.webhooks.set(id, registration);
    // Initialise circuit breaker in closed state for every new webhook.
    this.circuitBreakers.set(id, makeClosedBreaker());
    logger.info("webhook registered", { id, url, topics });

    // Return public shape — secret is never included
    return { id, url, topics, createdAt: registration.createdAt };
  }

  /**
   * Unregister a webhook by ID.
   * @returns true if found and removed, false if not found.
   */
  public unregister(id: string): boolean {
    const existed = this.webhooks.has(id);
    this.webhooks.delete(id);
    this.circuitBreakers.delete(id);
    if (existed) logger.info("webhook unregistered", { id });
    return existed;
  }

  /**
   * List all registered webhooks (secrets omitted).
   */
  public list(): Omit<WebhookRegistration, "secret">[] {
    return Array.from(this.webhooks.values()).map(({ id, url, topics, createdAt }) => ({
      id,
      url,
      topics,
      createdAt,
    }));
  }

  // ── Circuit breaker ───────────────────────────────────────────────────────

  /**
   * Return the current circuit breaker state for a webhook, or undefined if
   * no entry exists.
   */
  public getCircuitBreakerState(webhookId: string): CircuitBreakerState | undefined {
    return this.circuitBreakers.get(webhookId);
  }

  /**
   * Manually reset the circuit breaker for a webhook to closed state.
   * Useful for operator-driven recovery without waiting for the cooldown.
   */
  public resetCircuitBreaker(webhookId: string): void {
    if (!this.webhooks.has(webhookId)) {
      throw new Error(`Webhook not found: ${webhookId}`);
    }
    this.circuitBreakers.set(webhookId, makeClosedBreaker());
    logger.info("circuit breaker manually reset", { webhookId });
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  /**
   * Return a copy of all collected delivery attempt metrics.
   */
  public getMetrics(): DeliveryAttemptMetric[] {
    return [...this.metrics];
  }

  /**
   * Return metrics filtered by webhook ID.
   */
  public getMetricsForWebhook(webhookId: string): DeliveryAttemptMetric[] {
    return this.metrics.filter((m) => m.webhookId === webhookId);
  }

  /**
   * Clear all collected metrics.
   */
  public clearMetrics(): void {
    this.metrics.length = 0;
  }

  // ── Delivery ──────────────────────────────────────────────────────────────

  /**
   * Deliver a notification event to all matching registered webhooks.
   * Runs deliveries concurrently; each webhook gets its own retry loop.
   */
  public async deliver(event: NotificationEvent): Promise<void> {
    const matching = Array.from(this.webhooks.values()).filter(
      (w) => w.topics.length === 0 || w.topics.includes(event.topic),
    );

    if (matching.length === 0) return;

    await Promise.allSettled(
      matching.map((webhook) => this.deliverToWebhook(event, webhook)),
    );
  }

  /**
   * Get delivery history for a specific webhook.
   */
  public async getDeliveries(webhookId: string): Promise<StoredDeliveryRecord[]> {
    const all = await this.deliveryStore.getAll({ webhookId } as any);
    return all.sort((a, b) =>
      (b.lastAttemptAt ?? "").localeCompare(a.lastAttemptAt ?? ""),
    );
  }

  // ── Dead-letter queue ─────────────────────────────────────────────────────

  /**
   * Return all entries in the dead-letter queue.
   */
  public getDeadLetters(): DeadLetterEntry[] {
    return Array.from(this.deadLetters.values());
  }

  /**
   * Return dead-letter entries for a specific webhook.
   */
  public getDeadLettersForWebhook(webhookId: string): DeadLetterEntry[] {
    return Array.from(this.deadLetters.values()).filter(
      (dl) => dl.webhookId === webhookId,
    );
  }

  /**
   * Replay a dead-letter entry: re-deliver the original event to its webhook.
   * Marks the entry as replayed on success, or updates the error on failure.
   * @returns true if the replay delivery succeeded.
   */
  public async replayDeadLetter(deadLetterId: string): Promise<boolean> {
    const entry = this.deadLetters.get(deadLetterId);
    if (!entry) {
      throw new Error(`Dead-letter entry not found: ${deadLetterId}`);
    }

    const webhook = this.webhooks.get(entry.webhookId);
    if (!webhook) {
      throw new Error(`Webhook no longer registered: ${entry.webhookId}`);
    }

    logger.info("replaying dead-letter entry", {
      deadLetterId,
      webhookId: webhook.id,
      eventId: entry.event.id,
    });

    try {
      await this.deliverToWebhook(entry.event, webhook);
      entry.replayed = true;
      this.deadLetters.delete(deadLetterId);
      return true;
    } catch (err) {
      logger.warn("dead-letter replay failed", {
        deadLetterId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * Remove all entries from the dead-letter queue.
   * @returns the number of entries purged.
   */
  public purgeDeadLetters(): number {
    const count = this.deadLetters.size;
    this.deadLetters.clear();
    if (count > 0) logger.info("dead-letter queue purged", { count });
    return count;
  }

  /**
   * Remove a single dead-letter entry.
   * @returns true if found and removed.
   */
  public removeDeadLetter(deadLetterId: string): boolean {
    return this.deadLetters.delete(deadLetterId);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private validateHttpsUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid webhook URL: ${url}`);
    }
    if (parsed.protocol !== "https:") {
      throw new Error(
        `Webhook URL must use HTTPS. Received: ${url}`,
      );
    }
  }

  /**
   * Resolve the effective circuit breaker state for a webhook, advancing from
   * `open` → `half-open` once the recovery window has elapsed.
   */
  private resolveCircuitBreaker(webhookId: string): CircuitBreakerState {
    let breaker = this.circuitBreakers.get(webhookId);
    if (!breaker) {
      breaker = makeClosedBreaker();
      this.circuitBreakers.set(webhookId, breaker);
    }

    if (
      breaker.status === "open" &&
      breaker.openedAt !== null &&
      Date.now() - breaker.openedAt >= CIRCUIT_BREAKER_RECOVERY_MS
    ) {
      // Transition open → half-open to allow a probe attempt.
      breaker.status = "half-open";
      breaker.lastTransitionAt = Date.now();
      logger.info("circuit breaker transitioned to half-open", { webhookId });
    }

    return breaker;
  }

  /**
   * Record a successful delivery against the circuit breaker: reset consecutive
   * failure count and close the breaker if it was half-open.
   */
  private onDeliverySuccess(webhookId: string): void {
    const breaker = this.circuitBreakers.get(webhookId);
    if (!breaker) return;

    if (breaker.status !== "closed") {
      logger.info("circuit breaker closed after successful delivery", { webhookId });
    }
    breaker.status = "closed";
    breaker.consecutiveFailures = 0;
    breaker.openedAt = null;
    breaker.lastTransitionAt = Date.now();
  }

  /**
   * Record a delivery failure against the circuit breaker.  Opens the breaker
   * once the threshold of consecutive failures is reached; re-opens it from
   * half-open on a failed probe.
   */
  private onDeliveryFailure(webhookId: string): void {
    const breaker = this.circuitBreakers.get(webhookId);
    if (!breaker) return;

    breaker.consecutiveFailures += 1;
    breaker.lastTransitionAt = Date.now();

    const shouldOpen =
      breaker.status === "closed" &&
      breaker.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD;

    const shouldReopenFromHalfOpen = breaker.status === "half-open";

    if (shouldOpen || shouldReopenFromHalfOpen) {
      breaker.status = "open";
      breaker.openedAt = Date.now();
      logger.warn("circuit breaker opened", {
        webhookId,
        consecutiveFailures: breaker.consecutiveFailures,
      });
    }
  }

  private async deliverToWebhook(
    event: NotificationEvent,
    webhook: StoredWebhookRegistration,
  ): Promise<void> {
    // ── Circuit breaker gate ────────────────────────────────────────────────
    const breaker = this.resolveCircuitBreaker(webhook.id);
    if (breaker.status === "open") {
      logger.warn("circuit breaker is open — skipping delivery", {
        webhookId: webhook.id,
        url: webhook.url,
        eventId: event.id,
        openedAt: breaker.openedAt,
      });
      // Record as failed (0 attempts made — circuit was open).
      await this.recordDelivery(webhook.id, event.id, "failed", 0, "circuit breaker open");
      return;
    }

    // When half-open, limit to a single probe attempt (no retries).
    const maxAttempts = breaker.status === "half-open" ? 1 : MAX_ATTEMPTS;

    const body = JSON.stringify(event);
    const timestamp = Date.now();
    const signature = signPayload(webhook.secretRaw, body, timestamp);
    const deliveryId = randomUUID();

    let lastError: string | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        const backoff = BACKOFF_DELAYS_MS[attempt - 2] ?? BACKOFF_DELAYS_MS[BACKOFF_DELAYS_MS.length - 1];
        logger.warn("webhook delivery retry", {
          webhookId: webhook.id,
          url: webhook.url,
          attempt,
          backoffMs: backoff,
        });
        await sleep(backoff);
      }

      const attemptStart = Date.now();
      let attemptStatus: "success" | "failed" = "failed";

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

        let response: Response;
        try {
          response = await fetch(webhook.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-VaultDAO-Signature": signature,
              "X-VaultDAO-Timestamp": String(timestamp),
              "X-VaultDAO-Delivery-Id": deliveryId,
              "X-VaultDAO-Event": event.topic,
            },
            body,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        // ── Success ───────────────────────────────────────────────────────
        attemptStatus = "success";
        this.recordMetric(webhook.id, event.id, attempt, "success", Date.now() - attemptStart);
        this.onDeliverySuccess(webhook.id);

        await this.recordDelivery(webhook.id, event.id, "delivered", attempt, null);
        logger.info("webhook delivered", {
          webhookId: webhook.id,
          url: webhook.url,
          eventId: event.id,
          attempt,
        });
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        this.recordMetric(webhook.id, event.id, attempt, "failed", Date.now() - attemptStart);
        logger.warn("webhook delivery attempt failed", {
          webhookId: webhook.id,
          url: webhook.url,
          attempt,
          error: lastError,
        });
        // suppress lint warning — attemptStatus already "failed" by default
        void attemptStatus;
      }
    }

    // ── All attempts exhausted ────────────────────────────────────────────
    this.onDeliveryFailure(webhook.id);
    await this.recordDelivery(webhook.id, event.id, "failed", maxAttempts, lastError);

    const dlEntry: DeadLetterEntry = {
      id: randomUUID(),
      webhookId: webhook.id,
      event,
      lastError: lastError ?? "unknown error",
      attempts: maxAttempts,
      failedAt: new Date().toISOString(),
      replayed: false,
    };
    this.deadLetters.set(dlEntry.id, dlEntry);

    logger.error("webhook delivery exhausted, moved to dead-letter queue", {
      webhookId: webhook.id,
      deadLetterId: dlEntry.id,
      url: webhook.url,
      eventId: event.id,
      error: lastError,
    });
  }

  private recordMetric(
    webhookId: string,
    eventId: string,
    attempt: number,
    status: "success" | "failed",
    durationMs: number,
  ): void {
    this.metrics.push({
      webhookId,
      eventId,
      attempt,
      status,
      durationMs,
      recordedAt: new Date().toISOString(),
    });
  }

  private async recordDelivery(
    webhookId: string,
    eventId: string,
    status: "delivered" | "failed",
    attempts: number,
    errorMsg: string | null,
  ): Promise<void> {
    const record: StoredDeliveryRecord & { id: string } = {
      id: randomUUID(),
      webhookId,
      eventId,
      target: NotificationTarget.WEBHOOK,
      status,
      attempts,
      lastAttemptAt: new Date().toISOString(),
      error: errorMsg,
    };
    try {
      await this.deliveryStore.save(record);
    } catch (err) {
      logger.warn("failed to persist delivery record", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
