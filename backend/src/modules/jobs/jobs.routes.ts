import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { JobManager } from "./job.manager.js";
import type { ScheduledJobRunner } from "./scheduled-job-runner.js";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import type { SqliteLeasedJobQueue } from "./leased-queue.js";

export function createJobsRouter(
  jobManager: JobManager,
  scheduledJobRunner: ScheduledJobRunner,
  adminAuthMiddleware: (req: Request, res: Response, next: NextFunction) => void,
  leasedQueue?: SqliteLeasedJobQueue,
): Router {
  const router = Router();

  router.get("/dlq", adminAuthMiddleware, (req, res) => {
    if (!leasedQueue) {
      error(res, { message: "Durable job queue is not configured", status: 503, code: ErrorCode.BAD_REQUEST });
      return;
    }
    const offset = Number(req.query["offset"] ?? 0);
    const limit = Number(req.query["limit"] ?? 50);
    try {
      success(res, leasedQueue.listDeadLetters(offset, limit));
    } catch (err) {
      error(res, {
        message: err instanceof Error ? err.message : String(err),
        status: 400,
        code: ErrorCode.BAD_REQUEST,
      });
    }
  });

  router.post("/dlq/:id/redrive", adminAuthMiddleware, (req, res) => {
    if (!leasedQueue) {
      error(res, { message: "Durable job queue is not configured", status: 503, code: ErrorCode.BAD_REQUEST });
      return;
    }
    const id = String(req.params["id"] ?? "");
    if (!leasedQueue.redrive(id)) {
      error(res, { message: "Dead-letter job not found", status: 404, code: ErrorCode.NOT_FOUND });
      return;
    }
    success(res, { id, redriven: true });
  });

  /**
   * GET /api/v1/jobs
   * List all registered jobs with stats.
   */
  router.get("/", (_req, res) => {
    const scheduledStatuses = scheduledJobRunner.getJobStatuses();
    const managerJobs = jobManager.getAllJobs();

    // Merge: scheduled jobs have richer stats; job-manager jobs may be lifecycle-only
    const scheduledByName = new Map(scheduledStatuses.map((s) => [s.name, s]));
    const managerByName = new Map(managerJobs.map((j) => [j.name, j]));

    const allNames = new Set([...scheduledByName.keys(), ...managerByName.keys()]);

    const jobs = Array.from(allNames).map((name) => {
      const scheduled = scheduledByName.get(name);
      const managed = managerByName.get(name);
      const disabled = disabledJobs.has(name);

      return {
        name,
        schedule: scheduled ? `every ${scheduled.intervalMs}ms` : "lifecycle",
        intervalMs: scheduled?.intervalMs ?? null,
        runOnStart: scheduled?.runOnStart ?? null,
        isRunning: managed?.isRunning() ?? false,
        disabled,
        lastRunAt: scheduled?.lastRunAt ?? null,
        lastRunDurationMs: scheduled?.lastRunDurationMs ?? null,
        lastRunStatus: scheduled
          ? scheduled.lastRunError
            ? "failed"
            : scheduled.lastRunAt
            ? "success"
            : "never"
          : null,
        lastRunError: scheduled?.lastRunError ?? null,
        nextRunAt: scheduled && !disabled
          ? computeNextRun(scheduled.lastRunAt, scheduled.intervalMs)
          : null,
        runCount: scheduled?.runCount ?? null,
        failureCount: scheduled?.failureCount ?? null,
        history: runHistory.get(name) ?? [],
      };
    });

    success(res, jobs);
  });

  /**
   * POST /api/v1/jobs/:name/trigger
   * Manually trigger an immediate run. Auth required.
   */
  router.post("/:name/trigger", adminAuthMiddleware, async (req, res) => {
    const name = String(req.params["name"] ?? "");

    if (disabledJobs.has(name)) {
      error(res, { message: `Job "${name}" is disabled`, status: 409, code: ErrorCode.BAD_REQUEST });
      return;
    }

    const triggered = scheduledJobRunner.trigger(name);
    if (!triggered) {
      // Try job manager lifecycle jobs
      const job = jobManager.getJob(name);
      if (!job) {
        error(res, { message: `Job "${name}" not found`, status: 404, code: ErrorCode.NOT_FOUND });
        return;
      }
      // Lifecycle job: async trigger
      const runId = `manual::${name}::${Date.now()}`;
      void triggerLifecycleJob(job, name, runId);
      success(res, { triggered: true, runId, async: true });
      return;
    }

    success(res, { triggered: true, name, async: false });
  });

  /**
   * POST /api/v1/jobs/:name/disable
   * Prevent a job from running on schedule. Auth required.
   */
  router.post("/:name/disable", adminAuthMiddleware, (req, res) => {
    const name = String(req.params["name"] ?? "");
    const exists =
      scheduledJobRunner.getRegisteredJobNames().includes(name) ||
      jobManager.getJob(name) !== undefined;
    if (!exists) {
      error(res, { message: `Job "${name}" not found`, status: 404, code: ErrorCode.NOT_FOUND });
      return;
    }
    disabledJobs.add(name);
    success(res, { name, disabled: true });
  });

  /**
   * POST /api/v1/jobs/:name/enable
   * Re-enable a disabled job. Auth required.
   */
  router.post("/:name/enable", adminAuthMiddleware, (req, res) => {
    const name = String(req.params["name"] ?? "");
    const exists =
      scheduledJobRunner.getRegisteredJobNames().includes(name) ||
      jobManager.getJob(name) !== undefined;
    if (!exists) {
      error(res, { message: `Job "${name}" not found`, status: 404, code: ErrorCode.NOT_FOUND });
      return;
    }
    disabledJobs.delete(name);
    success(res, { name, disabled: false });
  });

  // ── Internal state ────────────────────────────────────────────────────────

  const disabledJobs = new Set<string>();
  const runHistory = new Map<string, RunRecord[]>();
  const MAX_HISTORY = 20;

  interface RunRecord {
    runId: string;
    startedAt: string;
    endedAt: string | null;
    status: "running" | "success" | "failed";
    error: string | null;
  }

  async function triggerLifecycleJob(
    job: { name: string; start(): Promise<void> | void },
    name: string,
    runId: string,
  ): Promise<void> {
    const record: RunRecord = {
      runId,
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: "running",
      error: null,
    };
    appendHistory(name, record);
    try {
      await Promise.resolve(job.start());
      record.status = "success";
    } catch (err) {
      record.status = "failed";
      record.error = err instanceof Error ? err.message : String(err);
    } finally {
      record.endedAt = new Date().toISOString();
    }
  }

  function appendHistory(name: string, record: RunRecord): void {
    const history = runHistory.get(name) ?? [];
    history.unshift(record);
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    runHistory.set(name, history);
  }

  return router;
}

function computeNextRun(lastRunAt: string | null, intervalMs: number): string | null {
  if (!lastRunAt) return null;
  const next = new Date(lastRunAt).getTime() + intervalMs;
  return new Date(next).toISOString();
}
