import { DatabaseSync } from "node:sqlite";
import { createLogger } from "../../shared/logging/logger.js";
import type { Job } from "./job.manager.js";

const DEFAULT_WINDOW_LEDGERS = 1000;
const DEFAULT_INTERVAL_LEDGERS = 100;

export interface GovernanceSnapshot {
  readonly id?: number;
  readonly computed_at: string;
  readonly ledger_height: number;
  readonly window_start_ledger: number;
  readonly window_end_ledger: number;
  readonly participation_rate: number;
  readonly compliance_score: number;
  readonly active_proposals: number;
  readonly avg_vote_time_ledgers: number;
}

export interface GovernanceSnapshotJobOptions {
  /** How many ledgers between snapshot computations. Default: 100 */
  intervalLedgers?: number;
  /** Lookback window in ledgers. Default: 1000 */
  windowLedgers?: number;
  /** Soroban RPC URL used to get current ledger height. */
  rpcUrl?: string;
}

/**
 * GovernanceSnapshotJob
 *
 * Runs every `intervalLedgers` ledgers. Computes governance metrics over the
 * last `windowLedgers` ledgers and stores them in the governance_snapshots table.
 * Supports missed-ledger catch-up: if the backend was down for multiple intervals
 * it back-fills each missed window.
 */
export class GovernanceSnapshotJob implements Job {
  readonly name = "governance-snapshot";
  private readonly logger = createLogger("governance-snapshot-job");
  private readonly intervalLedgers: number;
  private readonly windowLedgers: number;
  private running = false;
  private intervalHandle: NodeJS.Timeout | null = null;
  private lastSnapshotLedger = 0;

  constructor(
    private readonly db: DatabaseSync,
    private readonly options: GovernanceSnapshotJobOptions = {},
  ) {
    this.intervalLedgers = options.intervalLedgers ?? DEFAULT_INTERVAL_LEDGERS;
    this.windowLedgers = options.windowLedgers ?? DEFAULT_WINDOW_LEDGERS;
    this.ensureSchema();
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS governance_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        computed_at TEXT NOT NULL,
        ledger_height INTEGER NOT NULL,
        window_start_ledger INTEGER NOT NULL,
        window_end_ledger INTEGER NOT NULL,
        participation_rate REAL NOT NULL,
        compliance_score REAL NOT NULL,
        active_proposals INTEGER NOT NULL,
        avg_vote_time_ledgers REAL NOT NULL
      )
    `);
  }

  public async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Load last snapshot ledger from DB
    const last = this.db
      .prepare("SELECT ledger_height FROM governance_snapshots ORDER BY ledger_height DESC LIMIT 1")
      .get() as { ledger_height: number } | undefined;
    this.lastSnapshotLedger = last?.ledger_height ?? 0;

    this.logger.info("governance-snapshot job started", {
      intervalLedgers: this.intervalLedgers,
      windowLedgers: this.windowLedgers,
      lastSnapshotLedger: this.lastSnapshotLedger,
    });

    // Run immediately then on 5s polling interval
    await this.tick();
    this.intervalHandle = setInterval(() => void this.tick(), 5_000);
    this.intervalHandle.unref?.();
  }

  public async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.logger.info("governance-snapshot job stopped");
  }

  public isRunning(): boolean {
    return this.running;
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    try {
      const currentLedger = await this.getCurrentLedger();
      if (currentLedger === 0) return;

      if (this.lastSnapshotLedger === 0) {
        // Genesis: first snapshot covers [0, windowLedgers]
        const windowEnd = this.windowLedgers;
        await this.computeAndStore(0, windowEnd);
        this.lastSnapshotLedger = currentLedger; // advance to current so no catch-up on first tick
        return;
      }

      // Compute how many intervals have passed since last snapshot
      const missedIntervals = Math.floor(
        (currentLedger - this.lastSnapshotLedger) / this.intervalLedgers,
      );

      if (missedIntervals <= 0) return;

      // Back-fill missed windows (catch-up)
      for (let i = 1; i <= missedIntervals; i++) {
        const windowEnd = this.lastSnapshotLedger + i * this.intervalLedgers;
        const windowStart = Math.max(0, windowEnd - this.windowLedgers);
        await this.computeAndStore(windowStart, windowEnd);
        this.lastSnapshotLedger = windowEnd;
      }
    } catch (err) {
      this.logger.error("governance-snapshot tick failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async getCurrentLedger(): Promise<number> {
    if (!this.options.rpcUrl) {
      // Fallback for testing: advance by one interval from last known ledger
      return (this.lastSnapshotLedger || this.windowLedgers) + this.intervalLedgers;
    }
    try {
      const res = await fetch(this.options.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getLatestLedger",
          params: {},
        }),
      });
      const json = (await res.json()) as any;
      return Number(json?.result?.sequence ?? 0);
    } catch {
      return 0;
    }
  }

  private async computeAndStore(
    windowStart: number,
    windowEnd: number,
  ): Promise<void> {
    const startMs = Date.now();
    const snapshot = await this.computeSnapshot(windowStart, windowEnd);
    const elapsed = Date.now() - startMs;

    if (elapsed > 5_000) {
      this.logger.warn("governance-snapshot computation exceeded 5s budget", {
        elapsed,
      });
    }

    this.db
      .prepare(
        `INSERT INTO governance_snapshots
          (computed_at, ledger_height, window_start_ledger, window_end_ledger,
           participation_rate, compliance_score, active_proposals, avg_vote_time_ledgers)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshot.computed_at,
        snapshot.ledger_height,
        snapshot.window_start_ledger,
        snapshot.window_end_ledger,
        snapshot.participation_rate,
        snapshot.compliance_score,
        snapshot.active_proposals,
        snapshot.avg_vote_time_ledgers,
      );

    this.logger.info("governance snapshot stored", {
      windowStart,
      windowEnd,
      elapsedMs: elapsed,
    });
  }

  /**
   * Compute governance metrics for a ledger window.
   * Queries proposals table if it exists; falls back to defaults.
   */
  private async computeSnapshot(
    windowStart: number,
    windowEnd: number,
  ): Promise<GovernanceSnapshot> {
    // Check if proposals table exists
    const tableExists = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='proposals'",
      )
      .get() as { name: string } | undefined;

    let total = 0;
    let voted = 0;
    let active = 0;
    let avgVoteTime = 0;

    if (tableExists) {
      const row = this.db
        .prepare(
          `SELECT COUNT(*) as total,
                  SUM(CASE WHEN status IN ('executed','approved') THEN 1 ELSE 0 END) as voted,
                  SUM(CASE WHEN status IN ('created','pending','ready','scheduled') THEN 1 ELSE 0 END) as active,
                  AVG(CASE WHEN vote_ledger IS NOT NULL AND created_ledger IS NOT NULL
                           THEN vote_ledger - created_ledger ELSE NULL END) as avg_vote_time
           FROM proposals
           WHERE created_ledger >= ? AND created_ledger <= ?`,
        )
        .get(windowStart, windowEnd) as {
        total: number;
        voted: number;
        active: number;
        avg_vote_time: number | null;
      } | undefined;

      total = row?.total ?? 0;
      voted = row?.voted ?? 0;
      active = row?.active ?? 0;
      avgVoteTime = row?.avg_vote_time ?? 0;
    }

    const participationRate = total > 0 ? voted / total : 0;
    const complianceScore = total > 0 ? voted / total : 1.0;

    return {
      computed_at: new Date().toISOString(),
      ledger_height: windowEnd,
      window_start_ledger: windowStart,
      window_end_ledger: windowEnd,
      participation_rate: Math.min(1, participationRate),
      compliance_score: Math.min(1, complianceScore),
      active_proposals: active,
      avg_vote_time_ledgers: avgVoteTime,
    };
  }

  /** Get the latest governance snapshot (used by API endpoint). */
  public getLatestSnapshot(): GovernanceSnapshot | null {
    return (
      (this.db
        .prepare(
          "SELECT * FROM governance_snapshots ORDER BY ledger_height DESC LIMIT 1",
        )
        .get() as GovernanceSnapshot | undefined) ?? null
    );
  }

  public listSnapshots(limit = 20): GovernanceSnapshot[] {
    return this.db
      .prepare(
        "SELECT * FROM governance_snapshots ORDER BY ledger_height DESC LIMIT ?",
      )
      .all(limit) as unknown as GovernanceSnapshot[];
  }
}
