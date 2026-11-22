import { createHash, randomInt } from "node:crypto";
import { createLogger } from "../logging/logger.js";
import type { StorageAdapter } from "./storage.adapter.js";

const logger = createLogger("dual-write-storage");

/**
 * Stable JSON serialisation (object keys sorted recursively) so a record
 * hashes the same whether it came back from SQLite TEXT or Postgres JSONB,
 * which reorders keys.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** SHA-256 of the canonical JSON form of a row (null for a missing row). */
export function rowHash(record: unknown): string | null {
  if (record === null || record === undefined) return null;
  return createHash("sha256").update(canonicalJson(record)).digest("hex");
}

export type DualWriteReadSource = "primary" | "secondary";

export interface DualWriteMismatch {
  readonly id: string;
  readonly primaryHash: string | null;
  readonly secondaryHash: string | null;
}

export interface DualWriteVerification {
  readonly table: string;
  readonly checked: number;
  readonly matched: number;
  readonly mismatches: DualWriteMismatch[];
}

export interface DualWriteStats {
  readonly secondaryWrites: number;
  readonly secondaryFailures: number;
  readonly verifiedOnWrite: number;
  readonly mismatchesOnWrite: number;
}

export interface DualWriteOptions {
  /** Logical table name, used in logs and verification reports. */
  readonly table: string;
  /**
   * Whether writes are mirrored to the secondary right now. Evaluated on
   * every write so the `postgres_dual_write` feature flag can be flipped at
   * runtime (e.g. as a kill-switch). Defaults to always on.
   */
  readonly isEnabled?: () => boolean;
  /** Which store serves reads. Default "primary" (SQLite stays the source of truth). */
  readonly readFrom?: DualWriteReadSource;
  /**
   * When true a failed secondary write fails the call. Default false: the
   * primary stays authoritative and the failure is logged, counted and left
   * for backfill / verification to repair.
   */
  readonly strict?: boolean;
  /** Fraction (0–1) of single-record writes re-read and hash-compared. Default 0. */
  readonly verifyOnWriteRate?: number;
  readonly onMismatch?: (table: string, mismatch: DualWriteMismatch) => void;
}

/**
 * Mirrors every write of a primary {@link StorageAdapter} (SQLite) into a
 * secondary one (Postgres) during the cutover window.
 *
 * Ledger-order invariant: writes are applied to the secondary strictly in
 * the order they were applied to the primary, through one FIFO queue per
 * adapter. A later cursor save can therefore never land on Postgres before
 * an earlier one, so the secondary never observes a cursor moving backwards
 * or a proposal state older than SQLite's.
 */
export class DualWriteStorageAdapter<T extends { id: string }>
  implements StorageAdapter<T>
{
  private queue: Promise<void> = Promise.resolve();
  private readFrom: DualWriteReadSource;
  private readonly stats = {
    secondaryWrites: 0,
    secondaryFailures: 0,
    verifiedOnWrite: 0,
    mismatchesOnWrite: 0,
  };

  constructor(
    private readonly primary: StorageAdapter<T>,
    private readonly secondary: StorageAdapter<T>,
    private readonly options: DualWriteOptions,
  ) {
    this.readFrom = options.readFrom ?? "primary";
  }

  private get reader(): StorageAdapter<T> {
    return this.readFrom === "secondary" ? this.secondary : this.primary;
  }

  private enabled(): boolean {
    return this.options.isEnabled ? this.options.isEnabled() : true;
  }

  /** Switches the read source (cutover, or rollback to SQLite). */
  public setReadSource(source: DualWriteReadSource): void {
    this.readFrom = source;
    logger.info("dual-write read source changed", { table: this.options.table, source });
  }

  public getReadSource(): DualWriteReadSource {
    return this.readFrom;
  }

  public getStats(): DualWriteStats {
    return { ...this.stats };
  }

  /** Resolves once every queued secondary write has settled. */
  public async flush(): Promise<void> {
    await this.queue;
  }

  /**
   * Applies `primaryOp`, then — in FIFO order behind every earlier write —
   * `secondaryOp`. The primary result is authoritative.
   */
  private async mirror(
    primaryOp: () => Promise<void>,
    secondaryOp: () => Promise<void>,
    verifyId?: string,
  ): Promise<void> {
    await primaryOp();
    if (!this.enabled()) return;

    const run = this.queue.then(async () => {
      try {
        await secondaryOp();
        this.stats.secondaryWrites += 1;
      } catch (error) {
        this.stats.secondaryFailures += 1;
        logger.error("secondary write failed", {
          table: this.options.table,
          error: error instanceof Error ? error.message : String(error),
        });
        if (this.options.strict) throw error;
        return;
      }
      if (verifyId !== undefined && this.shouldVerify()) {
        await this.verifyIds([verifyId], true);
      }
    });
    // Keep the chain alive even when a strict write rejects.
    this.queue = run.catch(() => undefined);
    if (this.options.strict) await run;
  }

  private shouldVerify(): boolean {
    const rate = this.options.verifyOnWriteRate ?? 0;
    return rate > 0 && Math.random() < rate;
  }

  // ── StorageAdapter ────────────────────────────────────────────────────────

  getAll(filter?: Record<string, any>): Promise<T[]> {
    return this.reader.getAll(filter);
  }

  getById(id: string): Promise<T | null> {
    return this.reader.getById(id);
  }

  exists(id: string): Promise<boolean> {
    return this.reader.exists(id);
  }

  count(filter?: Record<string, any>): Promise<number> {
    return this.reader.count(filter);
  }

  save(record: T): Promise<void> {
    return this.mirror(
      () => this.primary.save(record),
      () => this.secondary.save(record),
      record.id,
    );
  }

  saveMany(records: T[]): Promise<void> {
    return this.mirror(
      () => this.primary.saveMany(records),
      () => this.secondary.saveMany(records),
    );
  }

  delete(id: string): Promise<void> {
    return this.mirror(
      () => this.primary.delete(id),
      () => this.secondary.delete(id),
    );
  }

  clear(): Promise<void> {
    return this.mirror(
      () => this.primary.clear(),
      () => this.secondary.clear(),
    );
  }

  // ── Verification ──────────────────────────────────────────────────────────

  private async verifyIds(ids: readonly string[], onWrite: boolean): Promise<DualWriteMismatch[]> {
    const mismatches: DualWriteMismatch[] = [];
    for (const id of ids) {
      const [p, s] = await Promise.all([
        this.primary.getById(id),
        this.secondary.getById(id),
      ]);
      const primaryHash = rowHash(p);
      const secondaryHash = rowHash(s);
      if (onWrite) this.stats.verifiedOnWrite += 1;
      if (primaryHash !== secondaryHash) {
        const mismatch = { id, primaryHash, secondaryHash };
        mismatches.push(mismatch);
        if (onWrite) this.stats.mismatchesOnWrite += 1;
        logger.warn("dual-write row hash mismatch", { table: this.options.table, ...mismatch });
        this.options.onMismatch?.(this.options.table, mismatch);
      }
    }
    return mismatches;
  }

  /**
   * Hash-compares a random sample of keys between primary and secondary.
   * Waits for queued secondary writes first so in-flight mirrors are not
   * reported as mismatches.
   */
  public async verifySample(sampleSize = 100): Promise<DualWriteVerification> {
    await this.flush();
    const all = await this.primary.getAll();
    const ids = sampleIds(all.map((r) => r.id), sampleSize);
    const mismatches = await this.verifyIds(ids, false);
    return {
      table: this.options.table,
      checked: ids.length,
      matched: ids.length - mismatches.length,
      mismatches,
    };
  }
}

/** Uniform random sample (without replacement) of up to `size` ids. */
export function sampleIds(ids: readonly string[], size: number): string[] {
  const pool = [...ids];
  const n = Math.min(Math.max(0, Math.floor(size)), pool.length);
  for (let i = 0; i < n; i++) {
    const j = i + randomInt(pool.length - i);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, n);
}

export interface BackfillResult {
  readonly table: string;
  readonly copied: number;
  readonly verification: DualWriteVerification;
}

/**
 * One-off copy of every primary row into the secondary (used before
 * enabling dual-write reads), followed by a sampled hash verification.
 * Idempotent: rows are upserted by id.
 */
export async function backfillStorage<T extends { id: string }>(
  table: string,
  source: StorageAdapter<T>,
  target: StorageAdapter<T>,
  options: { batchSize?: number; verifySample?: number } = {},
): Promise<BackfillResult> {
  const batchSize = Math.max(1, options.batchSize ?? 500);
  const rows = await source.getAll();
  for (let i = 0; i < rows.length; i += batchSize) {
    await target.saveMany(rows.slice(i, i + batchSize));
  }
  const verifier = new DualWriteStorageAdapter(source, target, { table });
  const verification = await verifier.verifySample(options.verifySample ?? 100);
  logger.info("backfill complete", {
    table,
    copied: rows.length,
    checked: verification.checked,
    mismatches: verification.mismatches.length,
  });
  return { table, copied: rows.length, verification };
}
