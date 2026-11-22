import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { SnapshotRootMismatchError } from "./errors.js";
import type { SnapshotRebuildLockManager } from "./rebuild-lock.manager.js";

export interface LedgerSnapshotState {
  readonly proposals: readonly unknown[];
  readonly balances: readonly unknown[];
  readonly cursors: Readonly<Record<string, unknown>>;
}

export interface AuditedLedgerSnapshot {
  readonly snapshotId: string;
  readonly contractId: string;
  readonly ledger: number;
  readonly capturedAt: string;
  readonly state: LedgerSnapshotState;
}

export interface LedgerSnapshotSource {
  readState(contractId: string, ledger: number): Promise<LedgerSnapshotState>;
}

export interface LedgerSnapshotTarget {
  /** Must atomically replace all projections and cursors from the verified state. */
  replaceState(contractId: string, state: LedgerSnapshotState): Promise<void>;
}

export interface LedgerSnapshotArchive {
  save(snapshot: AuditedLedgerSnapshot, root: string): Promise<void>;
  get(snapshotId: string): Promise<{ snapshot: AuditedLedgerSnapshot; root: string } | null>;
}

export class SnapshotRestoreLockedError extends Error {
  constructor(contractId: string) {
    super(`Snapshot restore is already in progress for ${contractId}`);
    this.name = "SnapshotRestoreLockedError";
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

export function computeLedgerSnapshotRoot(snapshot: AuditedLedgerSnapshot): string {
  const canonical = JSON.stringify(stableValue({
    snapshotId: snapshot.snapshotId,
    contractId: snapshot.contractId,
    ledger: snapshot.ledger,
    capturedAt: snapshot.capturedAt,
    state: snapshot.state,
  }));
  return createHash("sha256").update(canonical).digest("hex");
}

export class SqliteLedgerSnapshotArchive implements LedgerSnapshotArchive {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ledger_snapshot_blobs (
        snapshot_id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL,
        ledger INTEGER NOT NULL,
        blob TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        UNIQUE(contract_id, ledger)
      );
      CREATE TABLE IF NOT EXISTS ledger_snapshot_commitments (
        snapshot_id TEXT PRIMARY KEY,
        root TEXT NOT NULL,
        FOREIGN KEY(snapshot_id) REFERENCES ledger_snapshot_blobs(snapshot_id)
      );
      CREATE INDEX IF NOT EXISTS ledger_snapshots_by_contract
        ON ledger_snapshot_blobs(contract_id, ledger DESC);
    `);
  }

  async save(snapshot: AuditedLedgerSnapshot, root: string): Promise<void> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO ledger_snapshot_blobs
          (snapshot_id, contract_id, ledger, blob, captured_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        snapshot.snapshotId,
        snapshot.contractId,
        snapshot.ledger,
        JSON.stringify(snapshot),
        snapshot.capturedAt,
      );
      this.db.prepare(
        "INSERT INTO ledger_snapshot_commitments (snapshot_id, root) VALUES (?, ?)",
      ).run(snapshot.snapshotId, root);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async get(snapshotId: string): Promise<{ snapshot: AuditedLedgerSnapshot; root: string } | null> {
    const row = this.db.prepare(`
      SELECT b.blob, c.root
      FROM ledger_snapshot_blobs b
      JOIN ledger_snapshot_commitments c ON c.snapshot_id = b.snapshot_id
      WHERE b.snapshot_id = ?
    `).get(snapshotId) as { blob: string; root: string } | undefined;
    if (!row) return null;
    return {
      snapshot: JSON.parse(row.blob) as AuditedLedgerSnapshot,
      root: row.root,
    };
  }
}

/** Periodic, tamper-evident checkpoints with fail-closed restore. */
export class AuditedLedgerSnapshotService {
  constructor(
    private readonly archive: LedgerSnapshotArchive,
    private readonly locks: SnapshotRebuildLockManager,
    private readonly intervalLedgers: number,
  ) {
    if (!Number.isInteger(intervalLedgers) || intervalLedgers < 1) {
      throw new Error("Snapshot interval must be a positive number of ledgers");
    }
  }

  async snapshotIfDue(
    contractId: string,
    ledger: number,
    source: LedgerSnapshotSource,
  ): Promise<AuditedLedgerSnapshot | null> {
    if (!Number.isSafeInteger(ledger) || ledger < 0) {
      throw new Error("Snapshot ledger must be a non-negative safe integer");
    }
    if (ledger === 0 || ledger % this.intervalLedgers !== 0) return null;
    const lockId = await this.locks.acquireLock(`snapshot:${contractId}`);
    if (!lockId) throw new SnapshotRestoreLockedError(contractId);
    try {
      const snapshot: AuditedLedgerSnapshot = {
        snapshotId: `${contractId}:${ledger}:${randomUUID()}`,
        contractId,
        ledger,
        capturedAt: new Date().toISOString(),
        state: await source.readState(contractId, ledger),
      };
      await this.archive.save(snapshot, computeLedgerSnapshotRoot(snapshot));
      return snapshot;
    } finally {
      await this.locks.releaseLock(`snapshot:${contractId}`, lockId);
    }
  }

  async restore(
    contractId: string,
    snapshotId: string,
    target: LedgerSnapshotTarget,
  ): Promise<AuditedLedgerSnapshot> {
    const lockId = await this.locks.acquireLock(`snapshot:${contractId}`);
    if (!lockId) throw new SnapshotRestoreLockedError(contractId);
    try {
      const archived = await this.archive.get(snapshotId);
      if (!archived || archived.snapshot.contractId !== contractId) {
        throw new Error(`Snapshot ${snapshotId} not found for ${contractId}`);
      }
      if (computeLedgerSnapshotRoot(archived.snapshot) !== archived.root) {
        throw new SnapshotRootMismatchError(contractId, snapshotId);
      }
      await target.replaceState(contractId, archived.snapshot.state);
      return archived.snapshot;
    } finally {
      await this.locks.releaseLock(`snapshot:${contractId}`, lockId);
    }
  }
}
