/**
 * Attestable vote receipts for off-chain indexers (issue #2223).
 *
 * A receipt is the SHA-256 hash of a canonical serialization of the ballot and
 * the weight snapshot used to cast it. Only the hash is published: the
 * strategy (how the weight was derived) is never leaked. Identical inputs
 * always produce an identical hash, independent of object key ordering.
 */

import { createHash } from "node:crypto";

export interface Ballot {
  proposalId: string;
  choice: "for" | "against" | "abstain";
}

export interface WeightSnapshot {
  voter: string;
  weight: string;
  ledger: number;
}

export const VOTE_RECEIPT_EVENT = "vote_receipt" as const;

/** Explicit field order keeps the hash stable across serializers and ledgers. */
export function canonicalVoteReceiptInput(
  ballot: Ballot,
  snapshot: WeightSnapshot,
): string {
  return JSON.stringify([
    "vaultdao.vote-receipt.v1",
    ballot.proposalId,
    ballot.choice,
    snapshot.voter,
    snapshot.weight,
    snapshot.ledger,
  ]);
}

export function computeVoteReceiptHash(
  ballot: Ballot,
  snapshot: WeightSnapshot,
): string {
  return createHash("sha256")
    .update(canonicalVoteReceiptInput(ballot, snapshot))
    .digest("hex");
}
