/**
 * Proposal Fingerprint Store
 *
 * Uses SHA-256 to fingerprint incoming PROPOSAL_CREATED payloads and
 * rejects duplicates only when the original fingerprint was recorded
 * within a configurable ledger window.
 *
 * Motivation: a fingerprint recorded 6 months ago must not block a
 * legitimate re-submission today. Operators set `windowLedgers` to
 * control how long a fingerprint "holds" (default: 120,960 ≈ 7 days
 * at ~5 s/ledger on Stellar).
 */

import { createHash } from "node:crypto";
import { createLogger } from "../../shared/logging/logger.js";
import type { ProposalCreatedActivityData } from "./types.js";

/**
 * The fields that define a proposal's content identity.
 * Changes to any of these produce a different fingerprint.
 */
interface FingerprintableFields {
  readonly contractId: string;
  readonly proposer: string;
  readonly recipient: string;
  readonly token: string;
  readonly amount: string;
  readonly description?: string;
}

/**
 * Internal record stored per fingerprint.
 */
interface FingerprintEntry {
  /** Ledger at which this fingerprint was first seen. */
  readonly ledger: number;
  /** proposalId associated with the original event (for diagnostics). */
  readonly proposalId: string;
}

/** Default duplicate window: 120,960 ledgers ≈ 7 days at ~5 s per ledger. */
export const DEFAULT_FINGERPRINT_WINDOW_LEDGERS = 120_960;

/**
 * ProposalFingerprintStore
 *
 * Tracks SHA-256 fingerprints of PROPOSAL_CREATED payloads.
 * A fingerprint collision is only considered a duplicate when the
 * original was seen within `windowLedgers` of the current ledger.
 *
 * Once a fingerprint ages out of the window it is eligible for
 * re-use, allowing identical proposals to be legitimately
 * re-submitted after the cooling-off period.
 */
export class ProposalFingerprintStore {
  private readonly logger = createLogger("proposal-fingerprint-store");
  private readonly store = new Map<string, FingerprintEntry>();
  private readonly windowLedgers: number;

  constructor(windowLedgers: number = DEFAULT_FINGERPRINT_WINDOW_LEDGERS) {
    if (!Number.isInteger(windowLedgers) || windowLedgers < 1) {
      throw new RangeError(
        `windowLedgers must be a positive integer, got ${windowLedgers}`,
      );
    }
    this.windowLedgers = windowLedgers;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Returns `true` and records the fingerprint when the proposal is new
   * (no prior fingerprint, or the prior one is outside the window).
   *
   * Returns `false` when an identical proposal was seen within the
   * current ledger window — i.e. it is a duplicate.
   *
   * @param contractId  Contract that emitted the event
   * @param proposalId  ID of the incoming proposal (for diagnostics)
   * @param data        PROPOSAL_CREATED activity data
   * @param ledger      Ledger number of the incoming event
   */
  public checkAndRecord(
    contractId: string,
    proposalId: string,
    data: ProposalCreatedActivityData,
    ledger: number,
  ): boolean {
    const fp = this.computeFingerprint({ contractId, ...data });
    const existing = this.store.get(fp);

    if (existing !== undefined) {
      const age = ledger - existing.ledger;
      if (age <= this.windowLedgers) {
        this.logger.debug(
          `duplicate fingerprint detected: proposalId=${proposalId} ` +
            `original=${existing.proposalId} age=${age} window=${this.windowLedgers}`,
        );
        return false; // within window → reject as duplicate
      }

      // Outside window — allow and refresh the entry
      this.logger.debug(
        `fingerprint outside window, allowing: proposalId=${proposalId} ` +
          `age=${age} window=${this.windowLedgers}`,
      );
    }

    this.store.set(fp, { ledger, proposalId });
    return true;
  }

  /**
   * Removes all fingerprint entries whose ledger is older than
   * `currentLedger - windowLedgers`. Call periodically to bound memory.
   *
   * @returns Number of entries pruned.
   */
  public pruneExpired(currentLedger: number): number {
    const cutoff = currentLedger - this.windowLedgers;
    let pruned = 0;

    for (const [fp, entry] of this.store) {
      if (entry.ledger < cutoff) {
        this.store.delete(fp);
        pruned++;
      }
    }

    if (pruned > 0) {
      this.logger.debug(`pruned ${pruned} expired fingerprint(s)`);
    }

    return pruned;
  }

  /** Current number of fingerprints held in memory. */
  public get size(): number {
    return this.store.size;
  }

  /** Configured window in ledgers. */
  public get window(): number {
    return this.windowLedgers;
  }

  /** Clears all stored fingerprints. Useful between tests. */
  public clear(): void {
    this.store.clear();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /**
   * Produces a stable, deterministic SHA-256 hex digest of the proposal's
   * content-defining fields. Field order is fixed to ensure consistency.
   */
  private computeFingerprint(fields: FingerprintableFields): string {
    const canonical = JSON.stringify({
      contractId: fields.contractId,
      proposer: fields.proposer,
      recipient: fields.recipient,
      token: fields.token,
      amount: fields.amount,
      description: fields.description ?? "",
    });

    return createHash("sha256").update(canonical, "utf8").digest("hex");
  }
}
