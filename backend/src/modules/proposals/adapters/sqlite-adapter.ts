import Database from "better-sqlite3";
import type {
  ProposalActivityPersistence,
  ProposalActivity,
  ProposalActivitySummary,
} from "../types";

// ─── Schema ───────────────────────────────────────────────────────────────

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS proposal_activity (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id      TEXT    NOT NULL,
    contract_id      TEXT    NOT NULL,
    activity_type    TEXT    NOT NULL,
    actor            TEXT,
    data             TEXT,
    timestamp        INTEGER NOT NULL,
    ledger_sequence  INTEGER,
    tx_hash          TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_proposal_activity_proposal_id
    ON proposal_activity (proposal_id, timestamp ASC);

  CREATE INDEX IF NOT EXISTS idx_proposal_activity_contract_id
    ON proposal_activity (contract_id, timestamp ASC);
`;

// ─── Row type (raw from SQLite) ───────────────────────────────────────────

interface ActivityRow {
  id: number;
  proposal_id: string;
  contract_id: string;
  activity_type: string;
  actor: string | null;
  data: string | null;
  timestamp: number;
  ledger_sequence: number | null;
  tx_hash: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function rowToActivity(row: ActivityRow): ProposalActivity {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    contractId: row.contract_id,
    activityType: row.activity_type,
    actor: row.actor ?? undefined,
    data: row.data ? JSON.parse(row.data) : undefined,
    timestamp: row.timestamp,
    ledgerSequence: row.ledger_sequence ?? undefined,
    txHash: row.tx_hash ?? undefined,
  };
}

// ─── Adapter ──────────────────────────────────────────────────────────────

/**
 * SQLite-backed implementation of `ProposalActivityPersistence`.
 *
 * Uses `better-sqlite3` for synchronous, low-overhead access. All writes use
 * prepared statements and WAL journal mode for safe concurrent reads.
 *
 * @example
 * const adapter = new SqliteProposalActivityAdapter("/data/vault.db");
 */
export class SqliteProposalActivityAdapter
  implements ProposalActivityPersistence
{
  private readonly db: Database.Database;

  // Prepared statements — compiled once, reused on every call
  private readonly stmtInsert: Database.Statement;
  private readonly stmtGetByProposalId: Database.Statement;
  private readonly stmtGetByContractId: Database.Statement;
  private readonly stmtSummary: Database.Statement;

  constructor(databasePath: string) {
    this.db = new Database(databasePath);

    // Enable WAL for concurrent read access alongside writes
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    // Create table and indexes (idempotent)
    this.db.exec(CREATE_TABLE_SQL);

    // Prepare statements
    this.stmtInsert = this.db.prepare(`
      INSERT INTO proposal_activity
        (proposal_id, contract_id, activity_type, actor, data, timestamp, ledger_sequence, tx_hash)
      VALUES
        (@proposalId, @contractId, @activityType, @actor, @data, @timestamp, @ledgerSequence, @txHash)
    `);

    this.stmtGetByProposalId = this.db.prepare(`
      SELECT * FROM proposal_activity
      WHERE proposal_id = ?
      ORDER BY timestamp ASC
    `);

    this.stmtGetByContractId = this.db.prepare(`
      SELECT * FROM proposal_activity
      WHERE contract_id = ?
      ORDER BY timestamp ASC
    `);

    this.stmtSummary = this.db.prepare(`
      SELECT
        proposal_id                          AS proposalId,
        contract_id                          AS contractId,
        COUNT(*)                             AS totalEvents,
        MIN(timestamp)                       AS firstEventAt,
        MAX(timestamp)                       AS lastEventAt,
        SUM(CASE WHEN activity_type = 'vote_cast'     THEN 1 ELSE 0 END) AS voteCount,
        SUM(CASE WHEN activity_type = 'vote_approved' THEN 1 ELSE 0 END) AS approvalCount,
        SUM(CASE WHEN activity_type = 'vote_rejected' THEN 1 ELSE 0 END) AS rejectionCount,
        SUM(CASE WHEN activity_type = 'executed'      THEN 1 ELSE 0 END) AS executionCount,
        SUM(CASE WHEN activity_type = 'cancelled'     THEN 1 ELSE 0 END) AS cancellationCount
      FROM proposal_activity
      WHERE proposal_id = ?
      GROUP BY proposal_id, contract_id
    `);
  }

  // ── save ─────────────────────────────────────────────────────────────────

  /**
   * Persist a single proposal activity record.
   * Returns the inserted record with its auto-generated `id`.
   */
  save(activity: Omit<ProposalActivity, "id">): ProposalActivity {
    const info = this.stmtInsert.run({
      proposalId: activity.proposalId,
      contractId: activity.contractId,
      activityType: activity.activityType,
      actor: activity.actor ?? null,
      data: activity.data !== undefined ? JSON.stringify(activity.data) : null,
      timestamp: activity.timestamp,
      ledgerSequence: activity.ledgerSequence ?? null,
      txHash: activity.txHash ?? null,
    });

    return { ...activity, id: Number(info.lastInsertRowid) };
  }

  // ── saveBatch ────────────────────────────────────────────────────────────

  /**
   * Persist multiple activity records atomically inside a single transaction.
   * Significantly faster than calling `save` in a loop for large batches.
   */
  saveBatch(activities: Omit<ProposalActivity, "id">[]): ProposalActivity[] {
    if (activities.length === 0) return [];

    const insertMany = this.db.transaction(
      (items: Omit<ProposalActivity, "id">[]) =>
        items.map((activity) => this.save(activity))
    );

    return insertMany(activities);
  }

  // ── getByProposalId ──────────────────────────────────────────────────────

  /**
   * Retrieve all activity records for a proposal, ordered chronologically.
   */
  getByProposalId(proposalId: string): ProposalActivity[] {
    const rows = this.stmtGetByProposalId.all(proposalId) as ActivityRow[];
    return rows.map(rowToActivity);
  }

  // ── getByContractId ──────────────────────────────────────────────────────

  /**
   * Retrieve all activity records for a contract, ordered chronologically.
   */
  getByContractId(contractId: string): ProposalActivity[] {
    const rows = this.stmtGetByContractId.all(contractId) as ActivityRow[];
    return rows.map(rowToActivity);
  }

  // ── getSummary ───────────────────────────────────────────────────────────

  /**
   * Return an aggregated summary for a given proposal.
   * Returns `null` when no activity has been recorded for the proposal.
   */
  getSummary(proposalId: string): ProposalActivitySummary | null {
    const row = this.stmtSummary.get(proposalId) as
      | ProposalActivitySummary
      | undefined;
    return row ?? null;
  }

  // ── close ────────────────────────────────────────────────────────────────

  /**
   * Close the underlying database connection.
   * Call this during graceful shutdown to flush WAL frames.
   */
  close(): void {
    this.db.close();
  }
}