/**
 * WebhookDeliveryService
 *
 * Handles webhook registration, HMAC-SHA256 signed delivery, exponential
 * backoff retry, and delivery record persistence.
 *
 * Acceptance criteria:
 * - Webhook URL must be HTTPS; HTTP URLs are rejected with a validation error.
 * - webhook.secret is stored as a SHA-256 hash and never returned in API responses.
 * - Payload is signed with HMAC-SHA256 using the raw (unhashed) secret supplied
 *   at registration time; the signature is sent in X-VaultDAO-Signature.
 * - Failed deliveries are retried up to 3 times with exponential backoff: 1s, 2s, 4s.
 * - Each delivery attempt is recorded in the webhook_deliveries store.
 * - Delivery timeout is 10 seconds per attempt.
 */

import { createHash, createHmac, randomUUID } from "node:crypto";
import { createLogger } from "../../shared/logging/logger.js";
import type { NotificationEvent } from "./notification.types.js";
import type { DeliveryRecord, WebhookRegistration } from "./notification.types.js";
import { NotificationTarget } from "./notification.types.js";
import type { StorageAdapter } from "../../shared/storage/storage.adapter.js";
import { InMemoryStorageAdapter } from "../../shared/storage/storage.adapter.js";

const logger = createLogger("webhook-delivery");

/** Delivery timeout per attempt in milliseconds. */
const DELIVERY_TIMEOUT_MS = 10_000;

/** Maximum number of delivery attempts (initial + 2 retries = 3 total). */
const MAX_ATTEMPTS = 3;

/** Exponential backoff delays in milliseconds: 1s, 2s, 4s. */
const BACKOFF_DELAYS_MS = [1_000, 2_000, 4_000];

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function signPayload(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Service ───────────────────────────────────────────────────────────────────

export class WebhookDeliveryService {
  private readonly webhooks = new Map<string, StoredWebhookRegistration>();
  private readonly deliveryStore: StorageAdapter<StoredDeliveryRecord & { id: string }>;

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

  private async deliverToWebhook(
    event: NotificationEvent,
    webhook: StoredWebhookRegistration,
  ): Promise<void> {
    const body = JSON.stringify(event);
    const signature = signPayload(webhook.secretRaw, body);

    let lastError: string | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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

        // Success
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
        logger.warn("webhook delivery attempt failed", {
          webhookId: webhook.id,
          url: webhook.url,
          attempt,
          error: lastError,
        });
      }
    }

    // All attempts exhausted
    await this.recordDelivery(webhook.id, event.id, "failed", MAX_ATTEMPTS, lastError);
    logger.error("webhook delivery exhausted", {
      webhookId: webhook.id,
      url: webhook.url,
      eventId: event.id,
      error: lastError,
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
