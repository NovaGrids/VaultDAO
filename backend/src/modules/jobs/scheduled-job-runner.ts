import { createLogger } from "../../shared/logging/logger.js";

export interface ScheduledJobContext {
  readonly now: () => Date;
}

export interface ScheduledJob {
  readonly name: string;
  readonly intervalMs: number;
  readonly runOnStart?: boolean;
  run(context: ScheduledJobContext): Promise<void> | void;
}

export class ScheduledJobRunner {
  private readonly logger = createLogger("scheduled-job-runner");
  private readonly jobs = new Map<string, ScheduledJob>();
  private readonly handles = new Map<string, NodeJS.Timeout>();
  private started = false;

  public register(job: ScheduledJob): void {
    if (job.intervalMs < 1) {
      throw new Error(`Job ${job.name} intervalMs must be >= 1`);
    }

    if (this.jobs.has(job.name)) {
      this.logger.warn("scheduled job already registered", { job: job.name });
      return;
    }

    this.jobs.set(job.name, job);
    this.logger.info("scheduled job registered", {
      job: job.name,
      intervalMs: job.intervalMs,
    });

    if (this.started) {
      this.startJob(job);
    }
  }

  public start(): void {
    if (this.started) {
      this.logger.warn("scheduled job runner already started");
      return;
    }

    this.started = true;
    for (const job of this.jobs.values()) {
      this.startJob(job);
    }

    this.logger.info("scheduled job runner started", {
      jobCount: this.jobs.size,
    });
  }

  public stop(): void {
    for (const handle of this.handles.values()) {
      clearInterval(handle);
    }

    this.handles.clear();
    this.started = false;
    this.logger.info("scheduled job runner stopped");
  }

  public isRunning(): boolean {
    return this.started;
  }

  public getRegisteredJobNames(): string[] {
    return Array.from(this.jobs.keys());
  }

  private startJob(job: ScheduledJob): void {
    if (job.runOnStart ?? true) {
      void this.runJobSafely(job);
    }

    const handle = setInterval(() => {
      void this.runJobSafely(job);
    }, job.intervalMs);

    this.handles.set(job.name, handle);
  }

  private async runJobSafely(job: ScheduledJob): Promise<void> {
    const startedAt = Date.now();

    try {
      await Promise.resolve(job.run({ now: () => new Date() }));
      this.logger.info("scheduled job completed", {
        job: job.name,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      this.logger.warn("scheduled job failed", {
        job: job.name,
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
