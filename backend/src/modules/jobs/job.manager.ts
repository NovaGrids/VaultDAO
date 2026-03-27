import { createLogger } from "../../shared/logging/logger.js";

export interface Job {
  readonly name: string;
  /** Start the job (should return a cleanup function or promise) */
  start(): Promise<void> | void;
  /** Stop the job gracefully */
  stop(): Promise<void> | void;
  /** Check if job is running */
  isRunning(): boolean;
}

/**
 * Job manager for coordinating background jobs.
 * Provides centralized lifecycle management.
 */
export class JobManager {
  private readonly logger = createLogger("job-manager");
  private jobs = new Map<string, Job>();

  /**
   * Register a job for management.
   */
  public registerJob(job: Job): void {
    if (this.jobs.has(job.name)) {
      this.logger.warn("job already registered", { job: job.name });
      return;
    }
    this.jobs.set(job.name, job);
    this.logger.info("job registered", { job: job.name });
  }

  /**
   * Start all registered jobs.
   */
  public async startAll(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.jobs.values()).map((job) =>
        Promise.resolve(job.start()).then(
          () => {
            this.logger.info("job started", { job: job.name });
          },
          (err: unknown) => {
            this.logger.error("job start failed", {
              job: job.name,
              error: err instanceof Error ? err.message : String(err),
            });
            throw err;
          }
        )
      )
    );

    const rejected = results.filter((r) => r.status === "rejected");
    if (rejected.length > 0) {
      throw new Error(`${rejected.length} jobs failed to start`);
    }
  }

  /**
   * Stop all registered jobs gracefully.
   * Jobs are stopped in reverse registration order (LIFO).
   */
  public async stopAll(): Promise<void> {
    const jobs = Array.from(this.jobs.values()).reverse();
    const errors: Array<{ job: string; error: string }> = [];

    for (const job of jobs) {
      try {
        await Promise.resolve(job.stop());
        this.logger.info("job stopped", { job: job.name });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.logger.warn("job stop error", {
          job: job.name,
          error: errorMessage,
        });
        errors.push({ job: job.name, error: errorMessage });
      }
    }

    if (errors.length > 0) {
      this.logger.warn("some jobs failed to stop gracefully", {
        count: errors.length,
        errors,
      });
    }
  }

  /**
   * Get job status.
   */
  public getJob(name: string): Job | undefined {
    return this.jobs.get(name);
  }

  /**
   * Get all registered jobs.
   */
  public getAllJobs(): Job[] {
    return Array.from(this.jobs.values());
  }
}
