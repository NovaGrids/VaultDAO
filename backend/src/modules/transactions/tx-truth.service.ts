/**
 * TxTruthService — dual-source transaction truth with conflict reports (#2227).
 *
 * Every transaction is ingested through two independent paths:
 *
 * - `ingestHorizon` — normalized from Horizon operations (authoritative for
 *   classic payments);
 * - `ingestSoroban` — normalized from Soroban contract events (authoritative
 *   for contract calls).
 *
 * The first source to arrive is parked per transaction hash. When the second
 * arrives, the two canonical records are compared on amount, memo and success
 * bit. Any divergence creates a conflict record; the non-preferred source is
 * **retained** on that record and never silently overwritten — the canonical
 * view served for the hash follows the documented precedence (Soroban for
 * contract calls, Horizon for payments) while the conflict stays open, and an
 * explicit operator resolution is required to close it.
 *
 * Conflict rate is exported as the gauge `vaultdao_tx_truth_conflict_rate`
 * (conflicts detected / transactions reconciled), alongside the counters
 * `vaultdao_tx_truth_reconciled_total` and
 * `vaultdao_tx_truth_conflict_total`.
 */

import { createLogger } from "../../shared/logging/logger.js";
import type { MetricsRegistry } from "../health/metrics.registry.js";
import {
  normalizeHorizonTransaction,
  normalizeSorobanEvent,
  preferredSourceFor,
} from "./canonical-tx.js";
import type {
  CanonicalTransaction,
  ConflictField,
  ConflictFieldDiff,
  HorizonRawTransaction,
  ListConflictsParams,
  SorobanRawEvent,
  TransactionConflict,
  TransactionSource,
} from "./tx-truth.types.js";

const MAX_CONFLICTS_RETAINED = 10_000;

const METRIC_RECONCILED = "vaultdao_tx_truth_reconciled_total";
const METRIC_CONFLICTS = "vaultdao_tx_truth_conflict_total";
const METRIC_RATE = "vaultdao_tx_truth_conflict_rate";

interface PerHashEntry {
  horizon: CanonicalTransaction | null;
  soroban: CanonicalTransaction | null;
  conflictId: string | null;
}

export class TxTruthService {
  private readonly logger = createLogger("tx-truth");
  private readonly byHash = new Map<string, PerHashEntry>();
  private readonly conflicts = new Map<string, TransactionConflict>();
  private conflictSeq = 0;
  private reconciledCount = 0;
  private conflictCount = 0;

  constructor(private readonly metrics?: MetricsRegistry) {
    metrics?.register(
      METRIC_RECONCILED,
      "Transactions seen by both Horizon and Soroban ingest paths",
      "counter",
    );
    metrics?.register(
      METRIC_CONFLICTS,
      "Divergences between Horizon ops and Soroban events",
      "counter",
    );
    metrics?.setGauge(METRIC_RATE, 0);
  }

  /** Ingest a raw Horizon operation. Returns the normalized record, or null when it carries no hash. */
  public ingestHorizon(raw: HorizonRawTransaction): CanonicalTransaction | null {
    const canonical = normalizeHorizonTransaction(raw);
    if (!canonical) return null;
    this.ingest(canonical);
    return canonical;
  }

  /** Ingest a raw Soroban event. Returns the normalized record, or null when it carries no hash. */
  public ingestSoroban(raw: SorobanRawEvent): CanonicalTransaction | null {
    const canonical = normalizeSorobanEvent(raw);
    if (!canonical) return null;
    this.ingest(canonical);
    return canonical;
  }

  private ingest(canonical: CanonicalTransaction): void {
    const entry = this.byHash.get(canonical.transactionHash) ?? {
      horizon: null,
      soroban: null,
      conflictId: null,
    };

    if (canonical.source === "horizon") {
      // Never clobber a record already held for this source: a re-ingest of
      // the same source is a no-op for truth purposes.
      if (entry.horizon) return;
      entry.horizon = canonical;
    } else {
      if (entry.soroban) return;
      entry.soroban = canonical;
    }

    this.byHash.set(canonical.transactionHash, entry);

    if (entry.horizon && entry.soroban) {
      this.reconcile(canonical.transactionHash, entry);
    }
  }

  /** Compare the two sources; divergence creates a conflict record. */
  private reconcile(hash: string, entry: PerHashEntry): void {
    this.reconciledCount += 1;
    this.metrics?.incrementCounter(METRIC_RECONCILED);

    const horizon = entry.horizon!;
    const soroban = entry.soroban!;
    const fields = diffSources(horizon, soroban);

    if (fields.length === 0) {
      return;
    }

    const preferred = preferredSourceFor(horizon.operationKind);

    this.conflictCount += 1;
    this.metrics?.incrementCounter(METRIC_CONFLICTS);
    this.updateRateGauge();

    this.conflictSeq += 1;
    const conflictId = `conflict-${this.conflictSeq}`;
    const conflict: TransactionConflict = {
      conflictId,
      transactionHash: hash,
      ledger: horizon.ledger,
      detectedAt: new Date().toISOString(),
      status: "unresolved",
      fields,
      horizon,
      soroban,
      preferredSource: preferred,
      resolution: null,
      resolvedAt: null,
    };
    this.conflicts.set(conflictId, conflict);
    entry.conflictId = conflictId;
    this.byHash.set(hash, entry);

    // Bounded retention: drop the oldest conflict when the cap is reached.
    if (this.conflicts.size > MAX_CONFLICTS_RETAINED) {
      const oldest = this.conflicts.keys().next().value;
      if (oldest !== undefined) this.conflicts.delete(oldest);
    }

    this.logger.warn(
      `tx truth conflict ${conflictId} on ${hash}: ${fields
        .map((f) => `${f.field} horizon=${f.horizon} soroban=${f.soroban}`)
        .join("; ")}`,
    );
  }

  private updateRateGauge(): void {
    if (!this.metrics) return;
    const rate =
      this.reconciledCount === 0
        ? 0
        : this.conflictCount / this.reconciledCount;
    this.metrics.setGauge(METRIC_RATE, Number(rate.toFixed(6)));
  }

  /**
   * The canonical view for a hash, applying precedence. While an unresolved
   * conflict exists the preferred source is served; once resolved, the
   * operator's chosen source is served.
   */
  public getCanonicalTransaction(hash: string): CanonicalTransaction | null {
    const entry = this.byHash.get(hash);
    if (!entry) return null;
    const conflict = entry.conflictId
      ? this.conflicts.get(entry.conflictId) ?? null
      : null;
    if (conflict?.resolution) {
      return conflict.resolution === "horizon" ? entry.horizon : entry.soroban;
    }
    if (conflict) {
      return conflict.preferredSource === "horizon"
        ? entry.horizon
        : entry.soroban;
    }
    return entry.horizon ?? entry.soroban;
  }

  /** List conflicts, defaulting to unresolved ones (the operator queue). */
  public listConflicts(params: ListConflictsParams = {}): TransactionConflict[] {
    const status = params.status ?? "unresolved";
    const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
    const out: TransactionConflict[] = [];
    for (const conflict of [...this.conflicts.values()].reverse()) {
      if (conflict.status !== status) continue;
      out.push(conflict);
      if (out.length >= limit) break;
    }
    return out;
  }

  public getConflict(conflictId: string): TransactionConflict | null {
    return this.conflicts.get(conflictId) ?? null;
  }

  /**
   * Close a conflict by choosing which source is truth. The rejected record
   * stays on the conflict for audit; it is never overwritten or dropped.
   */
  public resolveConflict(
    conflictId: string,
    resolution: TransactionSource,
  ): TransactionConflict | null {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) return null;
    if (conflict.status === "resolved") return conflict;
    const resolved: TransactionConflict = {
      ...conflict,
      status: "resolved",
      resolution,
      resolvedAt: new Date().toISOString(),
    };
    this.conflicts.set(conflictId, resolved);
    const entry = this.byHash.get(conflict.transactionHash);
    if (entry) this.byHash.set(conflict.transactionHash, entry);
    this.logger.info(
      `tx truth conflict ${conflictId} resolved in favour of ${resolution}`,
    );
    return resolved;
  }

  /**
   * Hashes seen by the Soroban path but not yet by the Horizon path. The
   * Horizon ingest job works through this queue.
   */
  public getHorizonPendingHashes(limit = 50): string[] {
    const out: string[] = [];
    for (const [hash, entry] of this.byHash) {
      if (entry.soroban && !entry.horizon) {
        out.push(hash);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /** Ingest-path counters for the admin stats endpoint. */
  public getStats(): {
    transactionsTracked: number;
    reconciled: number;
    conflicts: number;
    unresolvedConflicts: number;
    horizonPending: number;
    conflictRate: number;
  } {
    let unresolved = 0;
    let horizonPending = 0;
    for (const conflict of this.conflicts.values()) {
      if (conflict.status === "unresolved") unresolved += 1;
    }
    for (const entry of this.byHash.values()) {
      if (entry.soroban && !entry.horizon) horizonPending += 1;
    }
    return {
      transactionsTracked: this.byHash.size,
      reconciled: this.reconciledCount,
      conflicts: this.conflictCount,
      unresolvedConflicts: unresolved,
      horizonPending,
      conflictRate:
        this.reconciledCount === 0
          ? 0
          : Number((this.conflictCount / this.reconciledCount).toFixed(6)),
    };
  }
}

/** Field-level comparison of the two normalized sources. */
function diffSources(
  horizon: CanonicalTransaction,
  soroban: CanonicalTransaction,
): ConflictFieldDiff[] {
  const fields: ConflictFieldDiff[] = [];

  const amountDiff: ConflictField = "amount";
  if (horizon.amount !== soroban.amount) {
    fields.push({
      field: amountDiff,
      horizon: horizon.amount,
      soroban: soroban.amount,
    });
  }
  if ((horizon.memo ?? "") !== (soroban.memo ?? "")) {
    fields.push({
      field: "memo",
      horizon: horizon.memo ?? "<none>",
      soroban: soroban.memo ?? "<none>",
    });
  }
  if (horizon.successful !== soroban.successful) {
    fields.push({
      field: "success",
      horizon: horizon.successful ? "true" : "false",
      soroban: soroban.successful ? "true" : "false",
    });
  }
  return fields;
}
