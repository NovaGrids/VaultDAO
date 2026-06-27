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

export class JobDependencyCycle extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobDependencyCycle";
  }
}

/**
 * Job manager for coordinating background jobs.
 * Provides centralized lifecycle management.
 */
export class JobManager {
  private readonly logger = createLogger("job-manager");
  private jobs = new Map<string, Job>();
  // dependency graph: jobName -> set of dependency names
  private deps = new Map<string, Set<string>>();

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
  public registerJob(
    job: Job,
    options?: { replace?: boolean; dependencies?: string[] },
  ): void {
    if (this.jobs.has(job.name)) {
      if (options?.replace) {
        this.jobs.set(job.name, job);
        // update deps
        this.deps.set(job.name, new Set(options?.dependencies ?? []));
        return;
      }
      throw new Error(`job already registered: "${job.name}"`);
    }

    this.jobs.set(job.name, job);
    this.deps.set(job.name, new Set(options?.dependencies ?? []));

    // detect cycles now using Kahn's algorithm on the current graph
    const order = this.topologicalSort();
    if (order.length !== this.jobs.size) {
      throw new JobDependencyCycle(
        `job dependency cycle detected while registering "${job.name}"`,
      );
    }

    this.logger.info("job registered", {
      job: job.name,
      dependencies: Array.from(this.deps.get(job.name) ?? []),
    });
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
            },
          ),
      ),
    );

    const failures = results.flatMap((result, index) => {
      if (result.status !== "rejected") {
        return [];
      }

      return [
        {
          name: jobs[index].name,
          error: this.toErrorMessage(result.reason),
        },
      ];
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
    const hasRegisteredDeps = Array.from(this.deps.values()).some((deps) =>
      Array.from(deps).some((d) => this.jobs.has(d)),
    );

    const shutdownOrder = hasRegisteredDeps
      ? [...this.topologicalSort()].reverse()
      : [...this.jobs.keys()].reverse();

    const errors: Array<{ job: string; error: string }> = [];

    for (const name of shutdownOrder) {
      const job = this.jobs.get(name);
      if (!job) continue;

      try {
        await Promise.race([
          Promise.resolve(job.stop()),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Stop timeout after ${timeoutMs}ms`)),
              timeoutMs,
            ),
          ),
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
   * Returns a dependency graph mapping job -> dependencies array
   */
  public getDependencyGraph(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [k, s] of this.deps.entries()) {
      out[k] = Array.from(s);
    }
    return out;
  }

  /**
   * Topological sort (Kahn's algorithm). Returns array of job names where dependencies appear before dependents.
   */
  private topologicalSort(): string[] {
    // Build adjacency: dep -> set of dependents
    const adj = new Map<string, Set<string>>();
    const indegree = new Map<string, number>();

    for (const name of this.jobs.keys()) {
      indegree.set(name, 0);
      adj.set(name, new Set());
    }

    for (const [name, deps] of this.deps.entries()) {
      for (const d of deps) {
        if (!this.jobs.has(d)) continue;
        if (!adj.has(d)) adj.set(d, new Set());
        adj.get(d)!.add(name);
        indegree.set(name, (indegree.get(name) ?? 0) + 1);
      }
    }

    const q: string[] = [];
    for (const [name, deg] of indegree.entries()) {
      if (deg === 0) q.push(name);
    }

    const result: string[] = [];
    while (q.length > 0) {
      const n = q.shift()!;
      result.push(n);
      for (const m of adj.get(n) ?? []) {
        indegree.set(m, (indegree.get(m) ?? 1) - 1);
        if ((indegree.get(m) ?? 0) === 0) q.push(m);
      }
    }

    return result;
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
