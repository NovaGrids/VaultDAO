import { createLogger } from "../../../shared/logging/logger.js";
import type { Job } from "../job.manager.js";

export interface DueCheckJobConfig {
  /** Interval in milliseconds between checks (default: 60000 = 1 min) */
  intervalMs?: number;
  /** Flag to enable/disable the job */
  enabled?: boolean;
}

/**
 * Recurring Payment Due-Check Job
 *
 * Periodically monitors indexed recurring payments and identifies those
 * that have reached their next payment ledger (due for execution).
 *
 * This is a monitoring/scaffold job. Actual transaction submission
 * and keeper integration will be implemented separately to maintain
 * separation of concerns.
 *
 * Future integration points:
 * - Hook into keeper service for transaction building
 * - Emit events for external systems to consume
 * - Delegate to specialized execution services
 */
export class RecurringDueCheckJob implements Job {
  readonly name = "recurring-due-check";
  private readonly logger = createLogger("recurring-due-check-job");
  private config: Required<DueCheckJobConfig>;
  private intervalHandle: NodeJS.Timeout | null = null;
  private running = false;

  // These will be injected or provided by the runtime
  // Placeholder for keeper/submission integration
  // Can be set via onDue() method for externally handling due payments
  private onDuePaymentHandler:
    | ((paymentId: string) => Promise<void> | void)
    | null = null;

  constructor(config: DueCheckJobConfig = {}) {
    this.config = {
      intervalMs: config.intervalMs ?? 60_000, // 1 minute default
      enabled: config.enabled ?? true,
    };
  }

  /**
   * Register a handler for when due payments are found.
   * This allows future keeper/submission logic to be plugged in.
   */
  public onDue(
    handler: (paymentId: string) => Promise<void> | void
  ): void {
    this.onDuePaymentHandler = handler;
  }

  /**
   * Start the due-check job.
   */
  public async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info("job disabled, skipping start");
      return;
    }

    if (this.running) {
      this.logger.warn("job already running");
      return;
    }

    this.running = true;
    this.logger.info("starting due-check job", {
      intervalMs: this.config.intervalMs,
    });

    // Run check immediately, then on interval
    await this.check();

    this.intervalHandle = setInterval(async () => {
      await this.check();
    }, this.config.intervalMs);
  }

  /**
   * Stop the due-check job gracefully.
   */
  public async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    this.running = false;
    this.logger.info("stopped due-check job");
  }

  /**
   * Check job running status.
   */
  public isRunning(): boolean {
    return this.running;
  }

  /**
   * Internal: Perform the due-check cycle.
   * This is the core monitoring logic.
   *
   * TODO: In a real implementation, this would:
   * 1. Load indexed recurring payments from storage
   * 2. Compare nextPaymentLedger against current ledger
   * 3. For each due payment, call the onDuePaymentHandler
   * 4. Update payment state (mark as notified/processing)
   * 5. Log results and any errors
   */
  private async check(): Promise<void> {
    try {
      this.logger.info("due-check cycle started");

      // Placeholder: In real implementation, query storage for due payments
      // Example pseudocode:
      // const duePayments = await storage.getAll({ status: 'DUE' });
      // for (const payment of duePayments) {
      //   if (this.onDuePaymentHandler) {
      //     await this.onDuePaymentHandler(payment.paymentId);
      //   }
      // }

      // Handler is available for integration via onDue() method
      if (this.onDuePaymentHandler) {
        // Placeholder: handler will be called when due payments are found
      }

      this.logger.info("due-check cycle completed");
    } catch (err) {
      this.logger.error("due-check cycle failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
