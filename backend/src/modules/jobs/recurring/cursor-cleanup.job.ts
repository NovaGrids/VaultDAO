import { createLogger } from "../../../shared/logging/logger.js";
import type { Job } from "../job.manager.js";
import type { ProposalActivityAggregator } from "../../proposals/aggregator.js";
import type { BackendEnv } from "../../../config/env.js";

/**
 * CursorCleanupJob
 * 
 * Periodically prunes old proposal activity records and cursor history.
 * Helps manage memory usage and disk space by removing stale data.
 */
export class CursorCleanupJob implements Job {
  readonly name = "cursor-cleanup";
  private readonly logger = createLogger("cursor-cleanup-job");
  private intervalHandle: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly env: BackendEnv,
    private readonly aggregator: ProposalActivityAggregator,
  ) {}

  /**
   * Start the cursor-cleanup job.
   */
  public async start(): Promise<void> {
    if (!this.env.cursorCleanupJobEnabled) {
      this.logger.info("job disabled via config");
      return;
    }

    if (this.running) return;

    this.running = true;
    this.logger.info("starting cursor-cleanup job", {
      intervalMs: this.env.cursorCleanupJobIntervalMs,
      retentionDays: this.env.cursorRetentionDays,
    });

    // Initial run on start
    await this.prune();

    this.intervalHandle = setInterval(async () => {
      await this.prune();
    }, this.env.cursorCleanupJobIntervalMs);
  }

  /**
   * Stop the cursor-cleanup job gracefully.
   */
  public async stop(): Promise<void> {
    if (!this.running) return;

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    this.running = false;
    this.logger.info("stopped cursor-cleanup job");
  }

  /**
   * Check if job is running.
   */
  public isRunning(): boolean {
    return this.running;
  }

  /**
   * Perform the pruning cycle.
   */
  private async prune(): Promise<void> {
    try {
      this.logger.info("pruning cycle started");
      
      const retentionDate = new Date();
      retentionDate.setDate(retentionDate.getDate() - this.env.cursorRetentionDays);
      
      this.logger.info(`pruning records older than ${retentionDate.toISOString()}`);
      
      const prunedCount = this.aggregator.pruneRecords(retentionDate);
      
      this.logger.info("pruning cycle completed", {
        prunedCount,
      });
    } catch (err) {
      this.logger.error("pruning cycle failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
