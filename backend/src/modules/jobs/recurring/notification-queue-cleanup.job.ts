import { createLogger } from "../../../shared/logging/logger.js";
import type { ScheduledJob } from "../scheduled-job-runner.js";
import type { NotificationQueueStore } from "../../notifications/notification-queue.store.js";

/**
 * NotificationQueueCleanupJob
 *
 * Periodically purges delivered notifications older than `retentionDays`
 * from the persistent notification queue store, so the table doesn't grow
 * unbounded.
 */
export class NotificationQueueCleanupJob implements ScheduledJob {
  readonly name = "notification-queue-cleanup";
  private readonly logger = createLogger("notification-queue-cleanup-job");

  constructor(
    readonly intervalMs: number,
    readonly runOnStart: boolean,
    private readonly store: NotificationQueueStore,
    private readonly retentionDays: number,
  ) {}

  public run(): void {
    const deleted = this.store.purgeDelivered(this.retentionDays);
    this.logger.info("notification queue cleanup completed", {
      deleted,
      retentionDays: this.retentionDays,
    });
  }
}
