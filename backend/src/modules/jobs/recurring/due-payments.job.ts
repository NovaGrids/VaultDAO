import { createLogger } from "../../../shared/logging/logger.js";
import type { Job } from "../job.manager.js";
import type { RecurringIndexerService } from "../../recurring/recurring.service.js";
import type { NotificationQueue } from "../../notifications/notification.types.js";
import type { BackendEnv } from "../../../config/env.js";
import { randomUUID } from "node:crypto";
import { createRealtimeTopic } from "../../realtime/index.js";

/**
 * DuePaymentsJob
 * 
 * Periodically checks for due recurring payments and emits notifications.
 */
export class DuePaymentsJob implements Job {
  readonly name = "due-payments";
  private readonly logger = createLogger("due-payments-job");
  private intervalHandle: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly env: BackendEnv,
    private readonly recurringService: RecurringIndexerService,
    private readonly notificationQueue: NotificationQueue,
  ) {}

  /**
   * Start the due-payments job.
   */
  public async start(): Promise<void> {
    if (!this.env.duePaymentsJobEnabled) {
      this.logger.info("job disabled via config");
      return;
    }

    if (this.running) return;

    this.running = true;
    this.logger.info("starting due-payments job", {
      intervalMs: this.env.duePaymentsJobIntervalMs,
    });

    // Initial check on start
    await this.checkDuePayments();

    this.intervalHandle = setInterval(async () => {
      await this.checkDuePayments();
    }, this.env.duePaymentsJobIntervalMs);
  }

  /**
   * Stop the due-payments job gracefully.
   */
  public async stop(): Promise<void> {
    if (!this.running) return;

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    this.running = false;
    this.logger.info("stopped due-payments job");
  }

  /**
   * Check if job is running.
   */
  public isRunning(): boolean {
    return this.running;
  }

  /**
   * Perform the due-payments check cycle.
   */
  private async checkDuePayments(): Promise<void> {
    try {
      this.logger.info("due-payments check cycle started");
      const duePayments = await this.recurringService.getDuePayments();

      if (duePayments.length === 0) {
        this.logger.info("no due payments found");
        return;
      }

      this.logger.info(`found ${duePayments.length} due payments, emitting alerts`);

      const notificationTopic = createRealtimeTopic("notification", "events");

      for (const payment of duePayments) {
        await this.notificationQueue.publish({
          id: randomUUID(),
          topic: notificationTopic,
          source: `jobs.${this.name}`,
          createdAt: new Date().toISOString(),
          payload: {
            type: "DUE_PAYMENT_ALERT",
            paymentId: payment.paymentId,
            recipient: payment.recipient,
            amount: payment.amount,
            token: payment.token,
            message: `Recurring payment ${payment.paymentId} for ${payment.amount} ${payment.token} is currently due.`,
          },
        });
      }

      this.logger.info("due-payments check cycle completed");
    } catch (err) {
      this.logger.error("due-payments check cycle failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
