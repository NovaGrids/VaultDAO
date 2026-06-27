/**
 * SnapshotDiffService
 *
 * Implements incremental diff snapshots for the VaultDAO snapshot system.
 *
 * Design:
 * - Base snapshots are taken every 24 hours (full state).
 * - Diffs are taken every polling cycle (only changed fields).
 * - reconstructSnapshot(snapshotId) replays diffs from the nearest base.
 * - compact() collapses diffs older than 7 days into a new base snapshot.
 *
 * Correctness properties:
 * - reconstructSnapshot is deterministic: same diffs always produce same result.
 * - compact is atomic: new base is written before old diffs are deleted.
 */

import { randomUUID } from "node:crypto";
import { createLogger } from "../../shared/logging/logger.js";
import type {
  SemanticChange,
  SemanticDiffResult,
  SerializableContractSnapshot,
  SnapshotDiff,
  SnapshotDiffStorageAdapter,
  SnapshotFieldChange,
} from "./types.js";
import {
  DEFAULT_SEMANTIC_RULES,
  type SemanticRule,
} from "./semantic-diff-config.js";
import type { WebhookDeliveryService } from "../notifications/webhook.service.js";

const logger = createLogger("snapshot-diff-service");

/** Number of days after which diffs are eligible for compaction. */
const COMPACT_THRESHOLD_DAYS = 7;

// ── In-memory diff storage adapter ───────────────────────────────────────────

/**
 * In-memory implementation of SnapshotDiffStorageAdapter.
 * Suitable for development and testing; swap for a SQLite-backed adapter
 * in production.
 */
export class InMemorySnapshotDiffAdapter implements SnapshotDiffStorageAdapter {
  private readonly store = new Map<string, SnapshotDiff>();

  async saveDiff(diff: SnapshotDiff): Promise<void> {
    this.store.set(diff.snapshotId, diff);
  }

  async getDiff(snapshotId: string): Promise<SnapshotDiff | null> {
    return this.store.get(snapshotId) ?? null;
  }

  async listDiffs(contractId: string): Promise<SnapshotDiff[]> {
    return Array.from(this.store.values())
      .filter((d) => d.contractId === contractId)
      .sort((a, b) => a.ledger - b.ledger);
  }

  async deleteDiff(snapshotId: string): Promise<void> {
    this.store.delete(snapshotId);
  }
}

// ── Diff computation helpers ──────────────────────────────────────────────────

/**
 * Compute the set of top-level fields that differ between two serializable
 * snapshots. Returns an array of SnapshotFieldChange entries.
 */
function computeChangedFields(
  prev: SerializableContractSnapshot,
  next: SerializableContractSnapshot,
): SnapshotFieldChange[] {
  const changes: SnapshotFieldChange[] = [];

  const allKeys = new Set([
    ...Object.keys(prev),
    ...Object.keys(next),
  ]) as Set<keyof SerializableContractSnapshot>;

  for (const key of allKeys) {
    const before = JSON.stringify((prev as any)[key]);
    const after = JSON.stringify((next as any)[key]);
    if (before !== after) {
      changes.push({ field: key, before: (prev as any)[key], after: (next as any)[key] });
    }
  }

  return changes;
}

/**
 * Apply a list of SnapshotFieldChange entries to a base state, producing a
 * new state. This is the core of deterministic reconstruction.
 */
function applyChanges(
  base: SerializableContractSnapshot,
  changes: SnapshotFieldChange[],
): SerializableContractSnapshot {
  const result: any = { ...base };
  for (const change of changes) {
    result[change.field] = change.after;
  }
  return result as SerializableContractSnapshot;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class SnapshotDiffService {
  constructor(protected readonly storage: SnapshotDiffStorageAdapter) {}

  /**
   * Record a base snapshot (full state). Call this every 24 hours or on first
   * snapshot for a contract.
   *
   * @returns The snapshotId of the saved base.
   */
  public async saveBaseSnapshot(
    snapshot: SerializableContractSnapshot,
  ): Promise<string> {
    const snapshotId = randomUUID();
    const diff: SnapshotDiff = {
      snapshotId,
      parentSnapshotId: null,
      contractId: snapshot.contractId,
      changedFields: [],
      timestamp: snapshot.snapshotAt,
      ledger: snapshot.lastProcessedLedger,
      isBase: true,
      baseState: snapshot,
    };
    await this.storage.saveDiff(diff);
    logger.info("base snapshot saved", {
      snapshotId,
      contractId: snapshot.contractId,
      ledger: snapshot.lastProcessedLedger,
    });
    return snapshotId;
  }

  /**
   * Record an incremental diff against the previous snapshot.
   * If no previous snapshot exists, saves a base snapshot instead.
   *
   * @returns The snapshotId of the saved diff.
   */
  public async saveDiff(
    snapshot: SerializableContractSnapshot,
  ): Promise<string> {
    const diffs = await this.storage.listDiffs(snapshot.contractId);
    const prev = diffs.length > 0 ? diffs[diffs.length - 1] : null;

    if (!prev) {
      // No history — save as base
      return this.saveBaseSnapshot(snapshot);
    }

    // Reconstruct previous state to compute diff
    const prevState = await this.reconstructSnapshot(prev.snapshotId);
    if (!prevState) {
      // Fallback: save as base if reconstruction fails
      return this.saveBaseSnapshot(snapshot);
    }

    const changedFields = computeChangedFields(prevState, snapshot);
    const snapshotId = randomUUID();
    const diff: SnapshotDiff = {
      snapshotId,
      parentSnapshotId: prev.snapshotId,
      contractId: snapshot.contractId,
      changedFields,
      timestamp: snapshot.snapshotAt,
      ledger: snapshot.lastProcessedLedger,
      isBase: false,
    };
    await this.storage.saveDiff(diff);
    logger.debug("incremental diff saved", {
      snapshotId,
      contractId: snapshot.contractId,
      ledger: snapshot.lastProcessedLedger,
      changedFieldCount: changedFields.length,
    });
    return snapshotId;
  }

  /**
   * Reconstruct the full snapshot state at a given snapshotId by replaying
   * diffs from the nearest base snapshot.
   *
   * This operation is deterministic: the same chain of diffs always produces
   * the same result.
   *
   * @returns The reconstructed snapshot, or null if not found.
   */
  public async reconstructSnapshot(
    snapshotId: string,
  ): Promise<SerializableContractSnapshot | null> {
    const target = await this.storage.getDiff(snapshotId);
    if (!target) return null;

    // Walk the chain back to the base
    const chain: SnapshotDiff[] = [target];
    let current = target;

    while (!current.isBase && current.parentSnapshotId !== null) {
      const parent = await this.storage.getDiff(current.parentSnapshotId);
      if (!parent) {
        logger.warn("broken diff chain — parent not found", {
          snapshotId: current.snapshotId,
          parentSnapshotId: current.parentSnapshotId,
        });
        return null;
      }
      chain.unshift(parent);
      current = parent;
    }

    // The first entry must be a base snapshot
    const base = chain[0];
    if (!base.isBase || !base.baseState) {
      logger.warn("diff chain does not start with a base snapshot", {
        snapshotId: base.snapshotId,
      });
      return null;
    }

    // Replay diffs forward from the base
    let state: SerializableContractSnapshot = base.baseState;
    for (let i = 1; i < chain.length; i++) {
      state = applyChanges(state, chain[i].changedFields);
    }

    return state;
  }

  /**
   * Get the diff entry for a given snapshotId (without reconstruction).
   */
  public async getDiff(snapshotId: string): Promise<SnapshotDiff | null> {
    return this.storage.getDiff(snapshotId);
  }

  /**
   * Get the diff from the previous snapshot for a given snapshotId.
   * Returns null if the snapshot is a base (no parent).
   */
  public async getDiffFromPrevious(
    snapshotId: string,
  ): Promise<SnapshotDiff | null> {
    const diff = await this.storage.getDiff(snapshotId);
    if (!diff || diff.isBase) return null;
    return diff;
  }

  /**
   * Compact diffs older than COMPACT_THRESHOLD_DAYS into a new base snapshot.
   *
   * The operation is atomic: the new base is written before old diffs are
   * deleted. If deletion fails for any entry, the base is still preserved.
   *
   * @returns The number of diffs that were compacted.
   */
  public async compact(contractId: string): Promise<number> {
    const diffs = await this.storage.listDiffs(contractId);
    if (diffs.length === 0) return 0;

    const cutoff = Date.now() - COMPACT_THRESHOLD_DAYS * 86_400_000;
    const toCompact = diffs.filter(
      (d) => new Date(d.timestamp).getTime() < cutoff,
    );

    if (toCompact.length === 0) {
      logger.info("compact: no diffs older than threshold", { contractId });
      return 0;
    }

    // Reconstruct state at the last diff to compact
    const lastToCompact = toCompact[toCompact.length - 1];
    const reconstructed = await this.reconstructSnapshot(lastToCompact.snapshotId);
    if (!reconstructed) {
      logger.warn("compact: could not reconstruct state, aborting", {
        contractId,
        snapshotId: lastToCompact.snapshotId,
      });
      return 0;
    }

    // Write new base BEFORE deleting old diffs (atomicity guarantee)
    await this.saveBaseSnapshot(reconstructed);

    // Delete compacted diffs
    let deleted = 0;
    for (const diff of toCompact) {
      try {
        await this.storage.deleteDiff(diff.snapshotId);
        deleted++;
      } catch (err) {
        logger.warn("compact: failed to delete diff", {
          snapshotId: diff.snapshotId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info("compact completed", { contractId, deleted });
    return deleted;
  }
}

// ── Semantic Diff Service ──────────────────────────────────────────────────────────────

/**
 * SemanticSnapshotDiffService
 *
 * Extends SnapshotDiffService with semantic change classification.
 * Rules are loaded from semantic-diff-config.ts; adding new rules
 * requires no code changes here (open/closed principle).
 *
 * Critical changes trigger an immediate webhook delivery (not batched).
 */
export class SemanticSnapshotDiffService extends SnapshotDiffService {
  private readonly rules: SemanticRule[];

  constructor(
    storage: SnapshotDiffStorageAdapter,
    private readonly webhookService?: WebhookDeliveryService,
    rules: SemanticRule[] = DEFAULT_SEMANTIC_RULES,
  ) {
    super(storage);
    this.rules = rules;
  }

  // ── Classification ──────────────────────────────────────────────────────────

  /**
   * Classify a list of raw field changes into SemanticChange entries.
   *
   * Rules are evaluated in declaration order; the first matching rule wins.
   * The special "*" field acts as a catch-all for unmatched fields.
   */
  public classifyChanges(changes: SnapshotFieldChange[]): SemanticChange[] {
    return changes.map((change) => {
      // Find the first matching rule for this specific field
      const rule =
        this.rules.find(
          (r) =>
            r.field === change.field &&
            (r.when === undefined || r.when(change.before, change.after)),
        ) ??
        // Fall back to catch-all
        this.rules.find(
          (r) =>
            r.field === "*" &&
            (r.when === undefined || r.when(change.before, change.after)),
        );

      if (!rule) {
        return {
          field: change.field,
          old_value: change.before,
          new_value: change.after,
          severity: "info" as const,
          description: `Field "${change.field}" changed.`,
        };
      }

      return {
        field: change.field,
        old_value: change.before,
        new_value: change.after,
        severity: rule.severity,
        description: rule.describe(change.before, change.after),
      };
    });
  }

  // ── Semantic diff between two ledger snapshots ─────────────────────────────────

  /**
   * Compute the semantic diff between snapshots spanning fromLedger to toLedger
   * for a given vault.
   *
   * - Reconstructs the "from" and "to" states from the diff chain.
   * - Classifies each field change with a semantic rule.
   * - Fires webhook immediately for any critical changes.
   *
   * @param vaultAddress - Stellar contract address (vault)
   * @param fromLedger   - Starting ledger (inclusive)
   * @param toLedger     - Ending ledger (inclusive)
   * @returns SemanticDiffResult or null if snapshots are not found
   */
  public async computeSemanticDiff(
    vaultAddress: string,
    fromLedger: number,
    toLedger: number,
  ): Promise<SemanticDiffResult | null> {
    const allDiffs = await this.storage.listDiffs(vaultAddress);

    // Find the most recent diff at or before each ledger boundary
    const fromCandidates = allDiffs.filter((d) => d.ledger <= fromLedger);
    const toCandidates = allDiffs.filter((d) => d.ledger <= toLedger);

    if (fromCandidates.length === 0 || toCandidates.length === 0) {
      logger.warn("computeSemanticDiff: no snapshots found in ledger range", {
        vaultAddress,
        fromLedger,
        toLedger,
      });
      return null;
    }

    const fromSnap = fromCandidates[fromCandidates.length - 1]!;
    const toSnap = toCandidates[toCandidates.length - 1]!;

    const [fromState, toState] = await Promise.all([
      this.reconstructSnapshot(fromSnap.snapshotId),
      this.reconstructSnapshot(toSnap.snapshotId),
    ]);

    if (!fromState || !toState) {
      logger.warn("computeSemanticDiff: could not reconstruct snapshot states", {
        vaultAddress,
        fromSnapshotId: fromSnap.snapshotId,
        toSnapshotId: toSnap.snapshotId,
      });
      return null;
    }

    const rawChanges = computeChangedFields(fromState, toState);
    const semanticChanges = this.classifyChanges(rawChanges);
    const hasCritical = semanticChanges.some((c) => c.severity === "critical");

    const result: SemanticDiffResult = {
      vaultAddress,
      fromLedger: fromSnap.ledger,
      toLedger: toSnap.ledger,
      changes: semanticChanges,
      hasCritical,
      computedAt: new Date().toISOString(),
    };

    // Fire webhook immediately for critical changes (not batched)
    if (hasCritical && this.webhookService) {
      const criticals = semanticChanges.filter((c) => c.severity === "critical");
      logger.warn("critical semantic changes detected — triggering webhook", {
        vaultAddress,
        fromLedger,
        toLedger,
        criticalCount: criticals.length,
      });
      void this.webhookService.deliver({
        id: randomUUID(),
        topic: "snapshot:critical-change",
        source: "snapshot-diff-service",
        createdAt: new Date().toISOString(),
        payload: result as unknown as Record<string, unknown>,
      });
    }

    return result;
  }

  // ── Critical change endpoint support ──────────────────────────────────────────────

  /**
   * Scan recent diffs across all known vaults and return only those
   * containing at least one critical semantic change.
   *
   * Intended for: GET /api/v1/snapshots/diff/critical (admin endpoint).
   *
   * @param knownVaults   - List of vault addresses to scan
   * @param currentLedger - Current ledger for age filtering
   * @param maxAgeLedgers - How many ledgers back to scan (default: all)
   */
  public async getCriticalChanges(
    knownVaults: string[],
    currentLedger?: number,
    maxAgeLedgers?: number,
  ): Promise<SemanticDiffResult[]> {
    const results: SemanticDiffResult[] = [];

    for (const vault of knownVaults) {
      const diffs = await this.storage.listDiffs(vault);
      if (diffs.length < 2) continue;

      const relevant =
        currentLedger !== undefined && maxAgeLedgers !== undefined
          ? diffs.filter((d) => d.ledger >= currentLedger - maxAgeLedgers)
          : diffs;

      if (relevant.length < 2) continue;

      for (let i = 1; i < relevant.length; i++) {
        const prev = relevant[i - 1]!;
        const curr = relevant[i]!;

        const [prevState, currState] = await Promise.all([
          this.reconstructSnapshot(prev.snapshotId),
          this.reconstructSnapshot(curr.snapshotId),
        ]);

        if (!prevState || !currState) continue;

        const rawChanges = computeChangedFields(prevState, currState);
        const semanticChanges = this.classifyChanges(rawChanges);
        const criticals = semanticChanges.filter(
          (c) => c.severity === "critical",
        );

        if (criticals.length > 0) {
          results.push({
            vaultAddress: vault,
            fromLedger: prev.ledger,
            toLedger: curr.ledger,
            changes: criticals,
            hasCritical: true,
            computedAt: new Date().toISOString(),
          });
        }
      }
    }

    return results;
  }
}
