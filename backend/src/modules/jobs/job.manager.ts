import { createLogger } from "../../shared/logging/logger.js";
import type { MetricsRegistry } from "../health/metrics.registry.js";

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

  constructor(private readonly metrics?: MetricsRegistry) {}

  private toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Register a job for management.
   * @param job - The job to register.
   * @param options.replace - If true, silently replace an existing job with the same name.
   *   Defaults to false, which throws if a job with the same name is already registered.
   *   BREAKING CHANGE from previous behaviour (warn + return).
   */
  public registerJob(job: Job, options?: { replace?: boolean }): void {
    if (this.jobs.has(job.name)) {
      if (options?.replace) {
        this.jobs.set(job.name, job);
        return;
      }
      throw new Error(`job already registered: "${job.name}"`);
    }
    this.jobs.set(job.name, job);
    this.logger.info("job registered", { job: job.name });
  }

  /**
   * Start all registered jobs.
   */
  public async startAll(): Promise<void> {
    const jobs = Array.from(this.jobs.values());
    const results = await Promise.allSettled(
      jobs.map((job) =>
        Promise.resolve()
          .then(() => job.start())
          .then(
          () => {
            this.logger.info("job started", { job: job.name });
            if (this.metrics) {
              this.metrics.incrementCounter("vaultdao_job_executions_total", {
                job: job.name,
              });
            }
          },
          (err: unknown) => {
            this.logger.error("job start failed", {
              job: job.name,
              error: this.toErrorMessage(err),
            });
            throw err;
          }
          )
      )
    );

    const failures = results.flatMap((result, index) => {
      if (result.status !== "rejected") {
        return [];
      }

      return [{
        name: jobs[index].name,
        error: this.toErrorMessage(result.reason),
      }];
    });

    if (failures.length > 0) {
      const details = failures
        .map((failure) => `- ${failure.name}: ${failure.error}`)
        .join("\n");
      throw new Error(`${failures.length} jobs failed to start:\n${details}`);
    }
  }

  /**
   * Stop all registered jobs gracefully.
   * Jobs are stopped in reverse registration order (LIFO).
   * @param timeoutMs timeout for each job stop in milliseconds (default 5s)
   */
  public async stopAll(timeoutMs: number = 5000): Promise<void> {
    const jobs = Array.from(this.jobs.values()).reverse();
    const errors: Array<{ job: string; error: string }> = [];

    for (const job of jobs) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Stop timeout after ${timeoutMs}ms`));
          }, timeoutMs).unref();
        });

        await Promise.race([
          Promise.resolve(job.stop()),
          timeoutPromise
        ]);
        
        this.logger.info("job stopped", { job: job.name });
      } catch (err: unknown) {
        const errorMessage = this.toErrorMessage(err);
        this.logger.warn("job stop error or timeout", {
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
