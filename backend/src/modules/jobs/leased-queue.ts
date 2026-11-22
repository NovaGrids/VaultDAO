import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createLogger } from "../../shared/logging/logger.js";
import type { MetricsRegistry } from "../health/metrics.registry.js";

const logger = createLogger("leased-job-queue");

export type DurableJobType =
  | "recurring-payment"
  | "snapshot-rebuild"
  | "webhook-delivery"
  | "cursor-cleanup";

export interface EnqueueJobInput {
  readonly jobType: DurableJobType;
  readonly vault: string;
  readonly businessId: string;
  readonly period: string | number;
  readonly payload: unknown;
  readonly maxAttempts?: number;
  readonly runAt?: number;
}

export interface LeasedJob {
  readonly id: string;
  readonly jobType: DurableJobType;
  readonly vault: string;
  readonly businessId: string;
  readonly period: string;
  readonly idempotencyKey: string;
  readonly payload: unknown;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly leaseOwner: string;
  readonly leaseUntil: number;
}

export interface DeadLetterJob {
  readonly id: string;
  readonly jobType: DurableJobType;
  readonly vault: string;
  readonly businessId: string;
  readonly period: string;
  readonly payload: unknown;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly updatedAt: number;
}

export const QUEUE_DEPTH_METRIC = "vaultdao_queue_depth";
export const QUEUE_LEASE_TIMEOUTS_METRIC = "vaultdao_queue_lease_timeouts_total";

export function createJobIdempotencyKey(
  jobType: DurableJobType,
  vault: string,
  businessId: string,
  period: string | number,
): string {
  return createHash("sha256")
    .update(JSON.stringify([jobType, vault, businessId, String(period)]))
    .digest("hex");
}

export class SqliteLeasedJobQueue {
  constructor(
    private readonly db: DatabaseSync,
    private readonly metrics?: MetricsRegistry,
  ) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS leased_jobs (
        id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL,
        vault TEXT NOT NULL,
        business_id TEXT NOT NULL,
        period TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued', 'leased', 'done', 'dead')),
        attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        run_at INTEGER NOT NULL,
        lease_owner TEXT,
        lease_until INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS leased_jobs_claim
        ON leased_jobs(status, run_at, lease_until, created_at);
    `);
    metrics?.register(QUEUE_DEPTH_METRIC, "Queued and leased durable jobs", "gauge");
    metrics?.register(QUEUE_LEASE_TIMEOUTS_METRIC, "Leased jobs recovered after worker lease expiry", "counter");
    this.updateDepthMetric();
  }

  enqueue(input: EnqueueJobInput, now = Date.now()): { id: string; inserted: boolean } {
    if (!input.vault || !input.businessId) {
      throw new Error("Queued jobs require vault and businessId");
    }
    const maxAttempts = input.maxAttempts ?? 5;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error("maxAttempts must be a positive integer");
    }
    const idempotencyKey = createJobIdempotencyKey(
      input.jobType,
      input.vault,
      input.businessId,
      input.period,
    );
    const id = randomUUID();
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO leased_jobs
        (id, job_type, vault, business_id, period, idempotency_key, payload,
         status, attempts, max_attempts, run_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)
    `).run(
      id,
      input.jobType,
      input.vault,
      input.businessId,
      String(input.period),
      idempotencyKey,
      JSON.stringify(input.payload),
      maxAttempts,
      input.runAt ?? now,
      now,
      now,
    );
    const row = this.db.prepare(
      "SELECT id FROM leased_jobs WHERE idempotency_key = ?",
    ).get(idempotencyKey) as { id: string };
    this.updateDepthMetric();
    return { id: row.id, inserted: Number(result.changes) === 1 };
  }

  claim(workerId: string, leaseMs: number, now = Date.now()): LeasedJob | null {
    if (!workerId || !Number.isInteger(leaseMs) || leaseMs <= 0) {
      throw new Error("workerId and a positive lease duration are required");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const expired = this.db.prepare(`
        UPDATE leased_jobs SET status = 'dead', last_error = 'worker lease expired after final attempt',
          lease_owner = NULL, lease_until = NULL, updated_at = ?
        WHERE status = 'leased' AND lease_until <= ? AND attempts >= max_attempts
      `).run(now, now);
      const expiredCount = Number(expired.changes);
      if (expiredCount > 0) {
        this.metrics?.incrementCounter(QUEUE_LEASE_TIMEOUTS_METRIC);
      }

      const row = this.db.prepare(`
        SELECT * FROM leased_jobs
        WHERE attempts < max_attempts
          AND ((status = 'queued' AND run_at <= ?)
            OR (status = 'leased' AND lease_until <= ?))
        ORDER BY run_at, created_at
        LIMIT 1
      `).get(now, now) as QueueRow | undefined;
      if (!row) {
        this.db.exec("COMMIT");
        this.updateDepthMetric();
        return null;
      }

      if (row.status === "leased") {
        this.metrics?.incrementCounter(QUEUE_LEASE_TIMEOUTS_METRIC);
      }
      const leaseUntil = now + leaseMs;
      this.db.prepare(`
        UPDATE leased_jobs
        SET status = 'leased', attempts = attempts + 1, lease_owner = ?,
            lease_until = ?, updated_at = ?
        WHERE id = ?
      `).run(workerId, leaseUntil, now, row.id);
      this.db.exec("COMMIT");
      this.updateDepthMetric();
      return {
        id: row.id,
        jobType: row.job_type as DurableJobType,
        vault: row.vault,
        businessId: row.business_id,
        period: row.period,
        idempotencyKey: row.idempotency_key,
        payload: JSON.parse(row.payload) as unknown,
        attempts: row.attempts + 1,
        maxAttempts: row.max_attempts,
        leaseOwner: workerId,
        leaseUntil,
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  complete(jobId: string, workerId: string, now = Date.now()): boolean {
    const result = this.db.prepare(`
      UPDATE leased_jobs SET status = 'done', lease_owner = NULL, lease_until = NULL, updated_at = ?
      WHERE id = ? AND status = 'leased' AND lease_owner = ?
    `).run(now, jobId, workerId);
    this.updateDepthMetric();
    return Number(result.changes) === 1;
  }

  fail(
    jobId: string,
    workerId: string,
    error: unknown,
    options: { now?: number; backoffBaseMs?: number } = {},
  ): boolean {
    const now = options.now ?? Date.now();
    const row = this.db.prepare(
      "SELECT attempts, max_attempts FROM leased_jobs WHERE id = ? AND status = 'leased' AND lease_owner = ?",
    ).get(jobId, workerId) as { attempts: number; max_attempts: number } | undefined;
    if (!row) return false;
    const lastError = error instanceof Error ? error.message : String(error);
    const dead = row.attempts >= row.max_attempts;
    const delay = Math.min(
      (options.backoffBaseMs ?? 1_000) * 2 ** Math.max(0, row.attempts - 1),
      60 * 60 * 1_000,
    );
    this.db.prepare(`
      UPDATE leased_jobs
      SET status = ?, run_at = ?, lease_owner = NULL, lease_until = NULL,
          last_error = ?, updated_at = ?
      WHERE id = ? AND status = 'leased' AND lease_owner = ?
    `).run(dead ? "dead" : "queued", now + delay, lastError, now, jobId, workerId);
    this.updateDepthMetric();
    return true;
  }

  listDeadLetters(offset = 0, limit = 50): { items: DeadLetterJob[]; total: number } {
    this.validatePage(offset, limit);
    const total = (this.db.prepare(
      "SELECT COUNT(*) AS count FROM leased_jobs WHERE status = 'dead'",
    ).get() as { count: number }).count;
    const rows = this.db.prepare(`
      SELECT * FROM leased_jobs WHERE status = 'dead'
      ORDER BY updated_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset) as unknown as QueueRow[];
    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        jobType: row.job_type as DurableJobType,
        vault: row.vault,
        businessId: row.business_id,
        period: row.period,
        payload: JSON.parse(row.payload) as unknown,
        attempts: row.attempts,
        lastError: row.last_error,
        updatedAt: row.updated_at,
      })),
    };
  }

  redrive(deadLetterId: string, now = Date.now()): boolean {
    const result = this.db.prepare(`
      UPDATE leased_jobs SET status = 'queued', attempts = 0, run_at = ?,
        last_error = NULL, lease_owner = NULL, lease_until = NULL, updated_at = ?
      WHERE id = ? AND status = 'dead'
    `).run(now, now, deadLetterId);
    this.updateDepthMetric();
    return Number(result.changes) === 1;
  }

  getDepth(): { queued: number; leased: number; dead: number } {
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) AS count FROM leased_jobs GROUP BY status
    `).all() as Array<{ status: string; count: number }>;
    const counts = { queued: 0, leased: 0, dead: 0 };
    for (const row of rows) {
      if (row.status === "queued" || row.status === "leased" || row.status === "dead") {
        counts[row.status] = row.count;
      }
    }
    return counts;
  }

  private updateDepthMetric(): void {
    const depth = this.getDepth();
    this.metrics?.setGauge(QUEUE_DEPTH_METRIC, depth.queued + depth.leased);
  }

  private validatePage(offset: number, limit: number): void {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Invalid dead-letter pagination");
    }
  }
}

interface QueueRow {
  id: string;
  job_type: string;
  vault: string;
  business_id: string;
  period: string;
  idempotency_key: string;
  payload: string;
  status: string;
  attempts: number;
  max_attempts: number;
  run_at: number;
  lease_owner: string | null;
  lease_until: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export class LeasedJobWorker {
  private timer?: NodeJS.Timeout;
  private readonly workerId = randomUUID();

  constructor(
    private readonly queue: SqliteLeasedJobQueue,
    private readonly handlers: Partial<Record<DurableJobType, (payload: unknown, job: LeasedJob) => Promise<void>>>,
    private readonly options: { leaseMs?: number; pollMs?: number } = {},
  ) {}

  start(): void {
    if (this.timer) return;
    const pollMs = this.options.pollMs ?? 1_000;
    this.timer = setInterval(() => void this.runOnce(), pollMs);
    this.timer.unref?.();
    void this.runOnce();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  isRunning(): boolean {
    return this.timer !== undefined;
  }

  async runOnce(now = Date.now()): Promise<boolean> {
    const job = this.queue.claim(this.workerId, this.options.leaseMs ?? 30_000, now);
    if (!job) return false;
    const handler = this.handlers[job.jobType];
    try {
      if (!handler) throw new Error(`No worker registered for job type ${job.jobType}`);
      await handler(job.payload, job);
      if (!this.queue.complete(job.id, this.workerId)) {
        throw new Error(`Lease lost before completing job ${job.id}`);
      }
    } catch (error) {
      this.queue.fail(job.id, this.workerId, error);
      logger.error("leased job failed", {
        jobId: job.id,
        jobType: job.jobType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }
}
