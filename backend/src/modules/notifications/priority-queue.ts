import { createLogger } from "../../shared/logging/logger.js";
import type {
  NotificationConsumer,
  NotificationEvent,
  NotificationUnsubscribe,
  PublishOptions,
  DeliveryRecord,
  WebhookRegistration,
} from "./notification.types.js";
import { NotificationPriority, NotificationTarget, type DeliveryStatus } from "./notification.types.js";
import { randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";

const logger = createLogger("priority-notification-queue");

// ── In-memory delivery store ──────────────────────────────────────────────────

const deliveryHistory: DeliveryRecord[] = [];
const webhookRegistry: WebhookRegistration[] = [];

function recordDelivery(
  eventId: string,
  target: NotificationTarget,
  status: DeliveryStatus,
  attempts: number,
  error: string | null = null,
): void {
  deliveryHistory.push({
    id: randomUUID(),
    eventId,
    target,
    status,
    attempts,
    lastAttemptAt: new Date().toISOString(),
    error,
  });
}

// ── Webhook delivery ──────────────────────────────────────────────────────────

async function deliverWebhook(
  event: NotificationEvent,
  registration: WebhookRegistration,
  attempt = 1,
): Promise<void> {
  const body = JSON.stringify(event);
  const sig = createHmac("sha256", registration.secret).update(body).digest("hex");

  try {
    const res = await fetch(registration.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-VaultDAO-Signature": `sha256=${sig}`,
        "X-VaultDAO-Event": event.topic,
      },
      body,
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    recordDelivery(event.id, NotificationTarget.WEBHOOK, "delivered", attempt);
    logger.info("webhook delivered", { url: registration.url, eventId: event.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (attempt < 3) {
      const backoffMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s
      logger.warn("webhook delivery failed, retrying", { url: registration.url, attempt, backoffMs });
      await new Promise((r) => setTimeout(r, backoffMs));
      return deliverWebhook(event, registration, attempt + 1);
    }
    recordDelivery(event.id, NotificationTarget.WEBHOOK, "failed", attempt, msg);
    logger.error("webhook delivery exhausted", { url: registration.url, eventId: event.id, error: msg });
  }
}

// ── Email delivery (stub — wire to SendGrid/Resend via env) ───────────────────

async function deliverEmail(event: NotificationEvent): Promise<void> {
  // Stub: log and record. Replace with real provider call when EMAIL_API_KEY is set.
  logger.info("email delivery queued (stub)", { eventId: event.id, topic: event.topic });
  recordDelivery(event.id, NotificationTarget.EMAIL, "delivered", 1);
}

// ── Priority queue ────────────────────────────────────────────────────────────

interface QueuedItem {
  event: NotificationEvent;
  options: Required<PublishOptions>;
}

export class PriorityNotificationQueue {
  private readonly consumers = new Set<NotificationConsumer>();
  // Four buckets: index = priority level (URGENT=3 processed first)
  private readonly buckets: QueuedItem[][] = [[], [], [], []];
  private processing = false;

  /** Register a webhook endpoint. Returns the registration id. */
  public registerWebhook(url: string, secret: string, topics: string[]): WebhookRegistration {
    const reg: WebhookRegistration = {
      id: randomUUID(),
      url,
      secret,
      topics,
      createdAt: new Date().toISOString(),
    };
    webhookRegistry.push(reg);
    logger.info("webhook registered", { id: reg.id, url });
    return reg;
  }

  public getWebhooks(): WebhookRegistration[] {
    return [...webhookRegistry];
  }

  public getDeliveryHistory(): DeliveryRecord[] {
    return [...deliveryHistory];
  }

  /** Publish with priority and target routing. */
  public async publish(
    event: NotificationEvent,
    options: PublishOptions = {},
  ): Promise<void> {
    const priority = options.priority ?? NotificationPriority.NORMAL;
    const targets = options.targets ?? [NotificationTarget.WEBSOCKET];
    this.buckets[priority].push({ event, options: { priority, targets } });
    logger.debug("event queued", { eventId: event.id, priority, targets });
    void this.drain();
  }

  public subscribe(handler: NotificationConsumer): NotificationUnsubscribe {
    this.consumers.add(handler);
    return () => { this.consumers.delete(handler); };
  }

  public size(): number {
    return this.buckets.reduce((sum, b) => sum + b.length, 0);
  }

  public shutdown(): void {
    this.consumers.clear();
    for (const b of this.buckets) b.length = 0;
  }

  /** Drain highest-priority bucket first. */
  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.size() > 0) {
        // Pick highest non-empty bucket
        let item: QueuedItem | undefined;
        for (let p = NotificationPriority.URGENT; p >= NotificationPriority.LOW; p--) {
          if (this.buckets[p].length > 0) {
            item = this.buckets[p].shift()!;
            break;
          }
        }
        if (!item) break;

        await this.dispatch(item);
      }
    } finally {
      this.processing = false;
    }
  }

  private async dispatch({ event, options }: QueuedItem): Promise<void> {
    const tasks: Promise<void>[] = [];

    for (const target of options.targets) {
      switch (target) {
        case NotificationTarget.WEBSOCKET:
          // Deliver to in-process subscribers (e.g. WebSocket broadcaster)
          for (const consumer of this.consumers) {
            tasks.push(
              Promise.resolve(consumer(event)).catch((err) => {
                logger.warn("ws consumer error", { eventId: event.id, error: String(err) });
              }),
            );
          }
          recordDelivery(event.id, NotificationTarget.WEBSOCKET, "delivered", 1);
          break;

        case NotificationTarget.WEBHOOK:
          for (const reg of webhookRegistry) {
            if (reg.topics.length === 0 || reg.topics.includes(event.topic)) {
              tasks.push(deliverWebhook(event, reg));
            }
          }
          break;

        case NotificationTarget.EMAIL:
          tasks.push(deliverEmail(event));
          break;
      }
    }

    await Promise.allSettled(tasks);
  }
}
