import { createLogger } from "../../shared/logging/logger.js";
import { requestIdStorage } from "../../shared/http/requestId.js";
import { randomUUID } from "node:crypto";
import type { NotificationPublisher } from "../notifications/notification.types.js";

export interface ScheduledJobContext {
  readonly now: () => Date;
}

export interface ScheduledJob {
  readonly name: string;
  readonly intervalMs: number;
  readonly runOnStart?: boolean;
  run(context: ScheduledJobContext): Promise<void> | void;
}

export interface ScheduledJobStats {
  lastRunAt: string | null;
  lastRunDurationMs: number | null;
  lastRunError: string | null;
  runCount: number;
  failureCount: number;
}

export interface ScheduledJobStatus extends ScheduledJobStats {
  name: string;
  intervalMs: number;
  runOnStart: boolean;
}

interface ScheduledJobRunnerOptions {
  notificationPublisher?: NotificationPublisher;
}

export class ScheduledJobRunner {
  private readonly logger = createLogger("scheduled-job-runner");
  private readonly jobs = new Map<string, ScheduledJob>();
  private readonly stats = new Map<string, ScheduledJobStats>();
  private readonly handles = new Map<string, NodeJS.Timeout>();
  private heartbeatHandle?: NodeJS.Timeout;
  private started = false;

  constructor(private readonly options: ScheduledJobRunnerOptions = {}) {}

  public register(job: ScheduledJob): void {
    if (job.intervalMs < 1) {
      throw new Error(`Job ${job.name} intervalMs must be >= 1`);
    }

    if (this.jobs.has(job.name)) {
      this.logger.warn("scheduled job already registered", { job: job.name });
      return;
    }

    this.jobs.set(job.name, job);
    this.stats.set(job.name, {
      lastRunAt: null,
      lastRunDurationMs: null,
      lastRunError: null,
      runCount: 0,
      failureCount: 0,
    });
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

    this.heartbeatHandle = setInterval(() => {
      void this.publishHeartbeat();
    }, 300_000);
    this.heartbeatHandle.unref();

    this.logger.info("scheduled job runner started", {
      jobCount: this.jobs.size,
    });
  }

  public stop(): void {
    for (const handle of this.handles.values()) {
      clearInterval(handle);
    }

    if (this.heartbeatHandle) {
      clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = undefined;
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

  public getJobStatuses(): ScheduledJobStatus[] {
    return Array.from(this.jobs.values()).map((job) => {
      const stat = this.stats.get(job.name)!;
      return {
        name: job.name,
        intervalMs: job.intervalMs,
        runOnStart: job.runOnStart ?? true,
        lastRunAt: stat.lastRunAt,
        lastRunDurationMs: stat.lastRunDurationMs,
        lastRunError: stat.lastRunError,
        runCount: stat.runCount,
        failureCount: stat.failureCount,
      };
    });
  }

  public trigger(jobName: string): boolean {
    const job = this.jobs.get(jobName);
    if (!job) {
      return false;
    }

    void this.runJobSafely(job);
    return true;
  }

  private startJob(job: ScheduledJob): void {
    if (job.runOnStart ?? true) {
      void this.runJobSafely(job);
    }

    const handle = setInterval(() => {
      void this.runJobSafely(job);
    }, job.intervalMs);
    handle.unref();

    this.handles.set(job.name, handle);
  }

  private async runJobSafely(job: ScheduledJob): Promise<void> {
    const jobRunId = `job::${job.name}::${randomUUID()}`;
    const startedAt = Date.now();
    const stat = this.stats.get(job.name);

    if (stat) {
      stat.runCount += 1;
    }

    await requestIdStorage.run(jobRunId, async () => {
      try {
        await Promise.resolve(job.run({ now: () => new Date() }));
        if (stat) {
          stat.lastRunAt = new Date().toISOString();
          stat.lastRunDurationMs = Date.now() - startedAt;
          stat.lastRunError = null;
        }
        this.logger.info("scheduled job completed", {
          job: job.name,
          jobRunId,
          durationMs: Date.now() - startedAt,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (stat) {
          stat.lastRunAt = new Date().toISOString();
          stat.lastRunDurationMs = Date.now() - startedAt;
          stat.lastRunError = errorMessage;
          stat.failureCount += 1;
        }
        this.logger.warn("scheduled job failed", {
          job: job.name,
          jobRunId,
          durationMs: Date.now() - startedAt,
          error: errorMessage,
        });
        await this.publishNotification("job_failed", {
          jobName: job.name,
          error: errorMessage,
          at: new Date().toISOString(),
        });
      }
    });
  }

  private async publishHeartbeat(): Promise<void> {
    await this.publishNotification("job_heartbeat", {
      jobs: this.getJobStatuses(),
      at: new Date().toISOString(),
    });
  }

  private async publishNotification(
    topic: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.options.notificationPublisher) {
      return;
    }

    try {
      await this.options.notificationPublisher.publish({
        id: randomUUID(),
        topic,
        source: "scheduled-job-runner",
        createdAt: new Date().toISOString(),
        payload,
      });
    } catch (err) {
      this.logger.warn("failed to publish job notification", {
        topic,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
