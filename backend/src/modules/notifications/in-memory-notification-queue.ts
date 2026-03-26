import { createLogger } from "../../shared/logging/logger.js";
import type {
  NotificationConsumer,
  NotificationEvent,
  NotificationQueue,
  NotificationUnsubscribe,
} from "./notification.types.js";

export class InMemoryNotificationQueue implements NotificationQueue {
  private readonly logger = createLogger("notification-queue");
  private readonly consumers = new Set<NotificationConsumer>();
  private readonly events: NotificationEvent[] = [];

  public async publish(event: NotificationEvent): Promise<void> {
    this.events.push(event);

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

  public size(): number {
    return this.events.length;
  }

  public shutdown(): void {
    this.consumers.clear();
    this.events.length = 0;
    this.logger.info("notification queue shut down");
  }
}
