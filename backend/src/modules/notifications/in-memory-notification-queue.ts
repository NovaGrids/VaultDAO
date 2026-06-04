import { createLogger } from "../../shared/logging/logger.js";
import type {
  NotificationConsumer,
  NotificationEvent,
  NotificationQueue,
  NotificationUnsubscribe,
  PublishOptions,
} from "./notification.types.js";
import { NotificationPriority } from "./notification.types.js";

interface QueuedItem {
  event: NotificationEvent;
  priority: NotificationPriority;
  seq: number; // insertion sequence for FIFO within same priority
}

export class InMemoryNotificationQueue implements NotificationQueue {
  private readonly logger = createLogger("notification-queue");
  private readonly consumers = new Set<NotificationConsumer>();
  // Four buckets indexed by NotificationPriority (0=LOW … 3=URGENT)
  private readonly buckets: QueuedItem[][] = [[], [], [], []];
  private seq = 0;

  public async publish(
    event: NotificationEvent,
    options?: PublishOptions,
  ): Promise<void> {
    const priority = options?.priority ?? NotificationPriority.NORMAL;
    this.buckets[priority].push({ event, priority, seq: this.seq++ });

    const deliveries = Array.from(this.consumers).map(async (consumer) => {
      try {
        await Promise.resolve(consumer(event));
      } catch (err) {
        this.logger.warn("notification consumer failed", {
          eventId: event.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    await Promise.all(deliveries);
  }

  public subscribe(handler: NotificationConsumer): NotificationUnsubscribe {
    this.consumers.add(handler);
    this.logger.info("notification consumer subscribed", {
      total: this.consumers.size,
    });

    return () => {
      this.consumers.delete(handler);
      this.logger.info("notification consumer unsubscribed", {
        total: this.consumers.size,
      });
    };
  }

  /**
   * Returns total queued events, or count for a specific priority level.
   */
  public size(priority?: NotificationPriority): number {
    if (priority !== undefined) {
      return this.buckets[priority].length;
    }
    return this.buckets.reduce((sum, b) => sum + b.length, 0);
  }

  /**
   * Returns the next event to be consumed (highest priority, FIFO within priority).
   * Does NOT remove it from the queue.
   */
  public peek(): NotificationEvent | undefined {
    for (
      let p = NotificationPriority.URGENT;
      p >= NotificationPriority.LOW;
      p--
    ) {
      if (this.buckets[p].length > 0) {
        return this.buckets[p][0]!.event;
      }
    }
    return undefined;
  }

  public shutdown(): void {
    this.consumers.clear();
    for (const b of this.buckets) b.length = 0;
    this.logger.info("notification queue shut down");
  }

  /**
   * Returns per-priority counts for the queue-stats endpoint.
   */
  public getStats(): Record<string, number> {
    return {
      URGENT: this.buckets[NotificationPriority.URGENT].length,
      HIGH: this.buckets[NotificationPriority.HIGH].length,
      NORMAL: this.buckets[NotificationPriority.NORMAL].length,
      LOW: this.buckets[NotificationPriority.LOW].length,
      total: this.size(),
    };
  }
}
