import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { SnapshotRootMismatchError } from "../errors.js";
import type {
  ContractSnapshot,
  RoleSnapshot,
  SignerSnapshot,
  SnapshotFilter,
  SnapshotStats,
  SnapshotStorageAdapter,
} from "../types.js";
import { MemorySnapshotAdapter, computeSnapshotRoot } from "./memory.adapter.js";

interface StoredSnapshotRow {
  snapshot_id: string;
  blob: string;
  root: string;
}

/** Persistent SQLite snapshot storage with a separate root commitment column. */
export class SqliteSnapshotAdapter implements SnapshotStorageAdapter {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contract_snapshots (
        contract_id TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        ledger INTEGER NOT NULL,
        blob TEXT NOT NULL,
        root TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (contract_id, snapshot_id)
      );
      CREATE TABLE IF NOT EXISTS current_contract_snapshots (
        contract_id TEXT PRIMARY KEY,
        snapshot_id TEXT NOT NULL,
        blob TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS contract_snapshots_history
        ON contract_snapshots(contract_id, ledger DESC, created_at DESC);
    `);
  }

  async getSnapshot(contractId: string): Promise<ContractSnapshot | null> {
    const row = this.db.prepare(`
      SELECT c.snapshot_id, c.blob, h.root
      FROM current_contract_snapshots c
      JOIN contract_snapshots h
        ON h.contract_id = c.contract_id AND h.snapshot_id = c.snapshot_id
      WHERE c.contract_id = ?
    `).get(contractId) as StoredSnapshotRow | undefined;
    if (!row) return null;
    const snapshot = MemorySnapshotAdapter.deserialize(JSON.parse(row.blob));
    if (computeSnapshotRoot(snapshot) !== row.root) {
      throw new SnapshotRootMismatchError(contractId, row.snapshot_id);
    }
    return snapshot;
  }

  async saveSnapshot(snapshot: ContractSnapshot): Promise<void> {
    const snapshotId = snapshot.snapshotId ??
      `snap_${snapshot.lastProcessedLedger}_${snapshot.lastProcessedEventId || randomUUID()}`;
    const identified: ContractSnapshot = { ...snapshot, snapshotId };
    const root = computeSnapshotRoot(identified);
    const committed: ContractSnapshot = { ...identified, integrityRoot: root };
    const blob = JSON.stringify(MemorySnapshotAdapter.serialize(committed));
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO contract_snapshots
          (contract_id, snapshot_id, ledger, blob, root, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(contract_id, snapshot_id) DO UPDATE SET
          ledger = excluded.ledger, blob = excluded.blob, root = excluded.root,
          created_at = excluded.created_at
      `).run(snapshot.contractId, snapshotId, snapshot.lastProcessedLedger, blob, root, now);
      this.db.prepare(`
        INSERT INTO current_contract_snapshots (contract_id, snapshot_id, blob)
        VALUES (?, ?, ?)
        ON CONFLICT(contract_id) DO UPDATE SET snapshot_id = excluded.snapshot_id, blob = excluded.blob
      `).run(snapshot.contractId, snapshotId, blob);
      this.db.prepare(`
        DELETE FROM contract_snapshots
        WHERE contract_id = ? AND snapshot_id NOT IN (
          SELECT snapshot_id FROM contract_snapshots
          WHERE contract_id = ? ORDER BY created_at DESC LIMIT 5
        )
      `).run(snapshot.contractId, snapshot.contractId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async clearSnapshot(contractId: string): Promise<void> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM current_contract_snapshots WHERE contract_id = ?").run(contractId);
      this.db.prepare("DELETE FROM contract_snapshots WHERE contract_id = ?").run(contractId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async getSnapshotHistory(contractId: string): Promise<ContractSnapshot[]> {
    const rows = this.db.prepare(`
      SELECT snapshot_id, blob, root FROM contract_snapshots
      WHERE contract_id = ?
      ORDER BY created_at DESC LIMIT 5
    `).all(contractId) as unknown as StoredSnapshotRow[];
    return rows.reverse().map((row) => MemorySnapshotAdapter.deserialize(JSON.parse(row.blob)));
  }

  async getSnapshotById(
    contractId: string,
    snapshotId: string | number,
  ): Promise<ContractSnapshot | null> {
    let row = this.db.prepare(`
      SELECT snapshot_id, blob, root FROM contract_snapshots
      WHERE contract_id = ? AND snapshot_id = ?
    `).get(contractId, String(snapshotId)) as StoredSnapshotRow | undefined;
    if (!row) {
      const ledger = Number(snapshotId);
      if (Number.isSafeInteger(ledger)) {
        row = this.db.prepare(`
          SELECT snapshot_id, blob, root FROM contract_snapshots
          WHERE contract_id = ? AND ledger = ?
          ORDER BY created_at DESC LIMIT 1
        `).get(contractId, ledger) as StoredSnapshotRow | undefined;
      }
    }
    return row ? MemorySnapshotAdapter.deserialize(JSON.parse(row.blob)) : null;
  }

  async getSnapshotRoot(contractId: string, snapshotId: string): Promise<string | null> {
    const row = this.db.prepare(`
      SELECT root FROM contract_snapshots WHERE contract_id = ? AND snapshot_id = ?
    `).get(contractId, snapshotId) as { root: string } | undefined;
    return row?.root ?? null;
  }

  async restoreSnapshot(contractId: string, snapshotId: string | number): Promise<ContractSnapshot | null> {
    const snapshot = await this.getSnapshotById(contractId, snapshotId);
    if (!snapshot) return null;
    const id = snapshot.snapshotId ?? String(snapshotId);
    const committedRoot = await this.getSnapshotRoot(contractId, id);
    if (!committedRoot || computeSnapshotRoot(snapshot) !== committedRoot) {
      throw new SnapshotRootMismatchError(contractId, id);
    }
    await this.saveSnapshot(snapshot);
    return this.getSnapshot(contractId);
  }

  async getSigners(contractId: string, filter?: SnapshotFilter): Promise<SignerSnapshot[]> {
    const view = await this.memoryView(contractId);
    return view ? view.getSigners(contractId, filter) : [];
  }

  async getRoles(contractId: string, filter?: SnapshotFilter): Promise<RoleSnapshot[]> {
    const view = await this.memoryView(contractId);
    return view ? view.getRoles(contractId, filter) : [];
  }

  async getSigner(contractId: string, address: string): Promise<SignerSnapshot | null> {
    const view = await this.memoryView(contractId);
    return view ? view.getSigner(contractId, address) : null;
  }

  async getRole(contractId: string, address: string): Promise<RoleSnapshot | null> {
    const view = await this.memoryView(contractId);
    return view ? view.getRole(contractId, address) : null;
  }

  async getStats(contractId: string): Promise<SnapshotStats | null> {
    const view = await this.memoryView(contractId);
    return view ? view.getStats(contractId) : null;
  }

  private async memoryView(contractId: string): Promise<MemorySnapshotAdapter | null> {
    const snapshot = await this.getSnapshot(contractId);
    if (!snapshot) return null;
    const view = new MemorySnapshotAdapter();
    await view.saveSnapshot(snapshot);
    return view;
  }
}
