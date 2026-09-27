/**
 * VaultDAO SDK — Token Flow Helpers
 *
 * Typed wrappers for the contract's token-flow families:
 *
 *   - Vesting schedules   (create_vesting_schedule, claim_vested_tokens, …)
 *   - Token locks         (lock_tokens, extend_lock, unlock_tokens, …)
 *   - Escrow              (create_escrow, complete_milestone, release_escrow, …)
 *   - Funding rounds      (create_funding_round, verify_milestone, …)
 *
 * Write helpers return a prepared transaction XDR — pass it to
 * `signAndSubmit()`. Read helpers simulate the call and decode the result.
 */

import { xdr } from "stellar-sdk";
import type {
  SdkOptions,
  VestingSchedule,
  TokenLock,
  Escrow,
  EscrowMilestone,
  EscrowMilestoneInput,
  EscrowStatus,
  FundingRound,
  FundingMilestone,
  FundingMilestoneInput,
  FundingMilestoneStatus,
  FundingRoundStatus,
} from "./types";
import {
  getContract,
  addressToScVal,
  i128ToScVal,
  u64ToScVal,
  u32ToScVal,
  symbolToScVal,
} from "./utils";
import { invokeMethod, simulateReadOnly } from "./contract";

// ---------------------------------------------------------------------------
// ScVal encoding helpers for contract structs / enums
// ---------------------------------------------------------------------------

/**
 * Encode a `#[contracttype]` struct. Soroban serialises structs as a map
 * keyed by field-name symbols in lexicographic order.
 */
function structToScVal(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.keys(fields)
      .sort()
      .map(
        (key) =>
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val: fields[key] }),
      ),
  );
}

/** Encode a unit variant of a `#[contracttype]` enum without explicit discriminants. */
function unitVariantToScVal(name: string): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]);
}

/** Decode a unit enum variant (`["Pending"]`) into its name. */
function decodeUnitVariant<T extends string>(raw: unknown): T {
  return (Array.isArray(raw) ? raw[0] : raw) as T;
}

const big = (v: unknown): bigint => BigInt((v as bigint | number | undefined) ?? 0);

// ---------------------------------------------------------------------------
// Vesting
// ---------------------------------------------------------------------------

/**
 * Build a transaction that creates a linear vesting schedule funded from the vault.
 *
 * Nothing is claimable before `cliffLedger`; vesting is linear from
 * `startLedger` to `endLedger`.
 *
 * @param adminPublicKey - Admin creating the schedule.
 * @param beneficiary    - Address that can claim vested tokens.
 * @param token          - Token contract ID.
 * @param total          - Total amount to vest (smallest unit).
 * @param cliffLedger    - Ledger before which nothing can be claimed.
 * @param startLedger    - Ledger at which vesting starts.
 * @param endLedger      - Ledger at which the full amount is vested.
 * @param opts           - SDK connection options.
 */
export async function createVestingSchedule(
  adminPublicKey: string,
  beneficiary: string,
  token: string,
  total: bigint,
  cliffLedger: number,
  startLedger: number,
  endLedger: number,
  opts: SdkOptions
): Promise<string> {
  if (total <= 0n) throw new Error("Vesting total must be positive");
  if (!(startLedger <= cliffLedger && cliffLedger < endLedger)) {
    throw new Error("Vesting ledgers must satisfy start <= cliff < end");
  }
  const op = getContract(opts).call(
    "create_vesting_schedule",
    addressToScVal(adminPublicKey),
    addressToScVal(beneficiary),
    addressToScVal(token),
    i128ToScVal(total),
    u32ToScVal(cliffLedger),
    u32ToScVal(startLedger),
    u32ToScVal(endLedger)
  );
  return invokeMethod("create_vesting_schedule", adminPublicKey, op, opts);
}

/**
 * Build a transaction for a beneficiary to claim all currently vested tokens.
 */
export async function claimVestedTokens(
  beneficiaryPublicKey: string,
  scheduleId: bigint,
  opts: SdkOptions
): Promise<string> {
  const op = getContract(opts).call(
    "claim_vested_tokens",
    addressToScVal(beneficiaryPublicKey),
    u64ToScVal(scheduleId)
  );
  return invokeMethod("claim_vested_tokens", beneficiaryPublicKey, op, opts);
}

/**
 * Build a transaction for an admin to cancel a vesting schedule.
 * Unvested tokens return to the vault.
 */
export async function cancelVesting(
  adminPublicKey: string,
  scheduleId: bigint,
  opts: SdkOptions
): Promise<string> {
  const op = getContract(opts).call(
    "cancel_vesting",
    addressToScVal(adminPublicKey),
    u64ToScVal(scheduleId)
  );
  return invokeMethod("cancel_vesting", adminPublicKey, op, opts);
}

/**
 * Fetch a vesting schedule, or `null` if it does not exist.
 */
export async function getVestingSchedule(
  scheduleId: bigint,
  callerPublicKey: string,
  opts: SdkOptions
): Promise<VestingSchedule | null> {
  const op = getContract(opts).call("get_vesting_schedule", u64ToScVal(scheduleId));
  const raw = await simulateReadOnly<Record<string, unknown> | null | undefined>(
    op,
    opts,
    callerPublicKey,
    "getVestingSchedule"
  );
  if (!raw) return null;
  return {
    id: big(raw.id),
    beneficiary: raw.beneficiary as string,
    token: raw.token as string,
    total: big(raw.total),
    cliffLedger: Number(raw.cliff_ledger),
    startLedger: Number(raw.start_ledger),
    endLedger: Number(raw.end_ledger),
    claimed: big(raw.claimed),
    cancelled: Boolean(raw.cancelled),
  };
}

// ---------------------------------------------------------------------------
// Token locks
// ---------------------------------------------------------------------------

/**
 * Build a transaction that locks `amount` of `token` for `durationLedgers`.
 * Longer locks receive a higher voting-power multiplier.
 */
export async function lockTokens(
  ownerPublicKey: string,
  token: string,
  amount: bigint,
  durationLedgers: bigint,
  opts: SdkOptions
): Promise<string> {
  if (amount <= 0n) throw new Error("Lock amount must be positive");
  const op = getContract(opts).call(
    "lock_tokens",
    addressToScVal(ownerPublicKey),
    addressToScVal(token),
    i128ToScVal(amount),
    u64ToScVal(durationLedgers)
  );
  return invokeMethod("lock_tokens", ownerPublicKey, op, opts);
}

/** Build a transaction that extends the caller's active lock. */
export async function extendLock(
  ownerPublicKey: string,
  additionalDurationLedgers: bigint,
  opts: SdkOptions
): Promise<string> {
  const op = getContract(opts).call(
    "extend_lock",
    addressToScVal(ownerPublicKey),
    u64ToScVal(additionalDurationLedgers)
  );
  return invokeMethod("extend_lock", ownerPublicKey, op, opts);
}

/** Build a transaction that withdraws an expired lock. */
export async function unlockTokens(
  ownerPublicKey: string,
  opts: SdkOptions
): Promise<string> {
  const op = getContract(opts).call("unlock_tokens", addressToScVal(ownerPublicKey));
  return invokeMethod("unlock_tokens", ownerPublicKey, op, opts);
}

/** Build a transaction that withdraws a lock before expiry (penalty applies). */
export async function unlockEarly(
  ownerPublicKey: string,
  opts: SdkOptions
): Promise<string> {
  const op = getContract(opts).call("unlock_early", addressToScVal(ownerPublicKey));
  return invokeMethod("unlock_early", ownerPublicKey, op, opts);
}

/** Fetch the lock held by `owner`, or `null` if there is none. */
export async function getTokenLock(
  owner: string,
  callerPublicKey: string,
  opts: SdkOptions
): Promise<TokenLock | null> {
  const op = getContract(opts).call("get_token_lock", addressToScVal(owner));
  const raw = await simulateReadOnly<Record<string, unknown> | null | undefined>(
    op,
    opts,
    callerPublicKey,
    "getTokenLock"
  );
  if (!raw) return null;
  return {
    owner: raw.owner as string,
    token: raw.token as string,
    amount: big(raw.amount),
    lockedAt: big(raw.locked_at),
    duration: big(raw.duration),
    unlockAt: big(raw.unlock_at),
    isActive: Boolean(raw.is_active),
    powerMultiplierBps: Number(raw.power_multiplier_bps),
  };
}

// ---------------------------------------------------------------------------
// Escrow
// ---------------------------------------------------------------------------

function escrowMilestonesToScVal(milestones: EscrowMilestoneInput[]): xdr.ScVal {
  if (milestones.length === 0) {
    throw new Error("Escrow requires at least one milestone");
  }
  const total = milestones.reduce((sum, m) => sum + m.percentage, 0);
  if (milestones.some((m) => m.percentage <= 0 || m.percentage > 100) || total !== 100) {
    throw new Error("Escrow milestone percentages must each be 1-100 and sum to 100");
  }
  return xdr.ScVal.scvVec(
    milestones.map((m, i) =>
      structToScVal({
        id: u64ToScVal(BigInt(i + 1)),
        percentage: u32ToScVal(m.percentage),
        release_ledger: u64ToScVal(m.releaseLedger),
        is_completed: xdr.ScVal.scvBool(false),
        completion_ledger: u64ToScVal(0n),
      })
    )
  );
}

/**
 * Build a transaction that funds a milestone-based escrow.
 *
 * Milestones are numbered from 1 in the order given; percentages must sum to 100.
 *
 * @param funderPublicKey - Address funding the escrow.
 * @param recipient       - Address receiving funds as milestones complete.
 * @param token           - Token contract ID.
 * @param amount          - Total escrow amount (smallest unit).
 * @param milestones      - Milestone schedule.
 * @param durationLedgers - Ledgers until the escrow expires (full refund).
 * @param arbitrator      - Address that resolves disputes.
 * @param opts            - SDK connection options.
 */
export async function createEscrow(
  funderPublicKey: string,
  recipient: string,
  token: string,
  amount: bigint,
  milestones: EscrowMilestoneInput[],
  durationLedgers: bigint,
  arbitrator: string,
  opts: SdkOptions
): Promise<string> {
  if (amount <= 0n) throw new Error("Escrow amount must be positive");
  const op = getContract(opts).call(
    "create_escrow",
    addressToScVal(funderPublicKey),
    addressToScVal(recipient),
    addressToScVal(token),
    i128ToScVal(amount),
    escrowMilestonesToScVal(milestones),
    u64ToScVal(durationLedgers),
    addressToScVal(arbitrator)
  );
  return invokeMethod("create_escrow", funderPublicKey, op, opts);
}

/** Build a transaction marking an escrow milestone complete. */
export async function completeMilestone(
  completerPublicKey: string,
  escrowId: bigint,
  milestoneId: bigint,
  opts: SdkOptions
): Promise<string> {
  const op = getContract(opts).call(
    "complete_milestone",
    addressToScVal(completerPublicKey),
    u64ToScVal(escrowId),
    u64ToScVal(milestoneId)
  );
  return invokeMethod("complete_milestone", completerPublicKey, op, opts);
}

/** Build a transaction releasing funds for completed escrow milestones. */
export async function releaseEscrow(
  callerPublicKey: string,
  escrowId: bigint,
  opts: SdkOptions
): Promise<string> {
  const op = getContract(opts).call(
    "release_escrow",
    addressToScVal(callerPublicKey),
    u64ToScVal(escrowId)
  );
  return invokeMethod("release_escrow", callerPublicKey, op, opts);
}

/**
 * Build a transaction raising a dispute on an escrow.
 *
 * @param reason - Short reason code (Soroban Symbol: ≤ 32 chars, `[A-Za-z0-9_]`).
 */
export async function disputeEscrow(
  disputerPublicKey: string,
  escrowId: bigint,
  reason: string,
  opts: SdkOptions
): Promise<string> {
  const op = getContract(opts).call(
    "dispute_escrow",
    addressToScVal(disputerPublicKey),
    u64ToScVal(escrowId),
    symbolToScVal(reason)
  );
  return invokeMethod("dispute_escrow", disputerPublicKey, op, opts);
}

/**
 * Build a transaction for the arbitrator to resolve a disputed escrow,
 * either releasing to the recipient or refunding the funder.
 */
export async function resolveEscrowDispute(
  arbitratorPublicKey: string,
  escrowId: bigint,
  releaseToRecipient: boolean,
  opts: SdkOptions
): Promise<string> {
  const op = getContract(opts).call(
    "resolve_escrow_dispute",
    addressToScVal(arbitratorPublicKey),
    u64ToScVal(escrowId),
    xdr.ScVal.scvBool(releaseToRecipient)
  );
  return invokeMethod("resolve_escrow_dispute", arbitratorPublicKey, op, opts);
}

/** Fetch an escrow by ID. */
export async function getEscrowInfo(
  escrowId: bigint,
  callerPublicKey: string,
  opts: SdkOptions
): Promise<Escrow> {
  const op = getContract(opts).call("get_escrow_info", u64ToScVal(escrowId));
  const raw = await simulateReadOnly<Record<string, unknown>>(
    op,
    opts,
    callerPublicKey,
    "getEscrowInfo"
  );
  return {
    id: big(raw.id),
    funder: raw.funder as string,
    recipient: raw.recipient as string,
    token: raw.token as string,
    totalAmount: big(raw.total_amount),
    releasedAmount: big(raw.released_amount),
    milestones: ((raw.milestones as Record<string, unknown>[]) ?? []).map(
      (m): EscrowMilestone => ({
        id: big(m.id),
        percentage: Number(m.percentage),
        releaseLedger: big(m.release_ledger),
        isCompleted: Boolean(m.is_completed),
        completionLedger: big(m.completion_ledger),
      })
    ),
    status: Number(raw.status) as EscrowStatus,
    arbitrator: raw.arbitrator as string,
    disputeReason: (raw.dispute_reason as string) ?? "",
    createdAt: big(raw.created_at),
    expiresAt: big(raw.expires_at),
    finalizedAt: big(raw.finalized_at),
    requiresSignerApproval: Boolean(raw.requires_signer_approval),
    approvalVotes: Number(raw.approval_votes ?? 0),
    rejectionVotes: Number(raw.rejection_votes ?? 0),
  };
}

/** List escrow IDs funded by `funder`. */
export async function getFunderEscrows(
  funder: string,
  callerPublicKey: string,
  opts: SdkOptions
): Promise<bigint[]> {
  const op = getContract(opts).call("get_funder_escrows", addressToScVal(funder));
  const raw = await simulateReadOnly<unknown[]>(op, opts, callerPublicKey, "getFunderEscrows");
  return (raw ?? []).map(big);
}

/** List escrow IDs where `recipient` is the payee. */
export async function getRecipientEscrows(
  recipient: string,
  callerPublicKey: string,
  opts: SdkOptions
): Promise<bigint[]> {
  const op = getContract(opts).call("get_recipient_escrows", addressToScVal(recipient));
  const raw = await simulateReadOnly<unknown[]>(
    op,
    opts,
    callerPublicKey,
    "getRecipientEscrows"
  );
  return (raw ?? []).map(big);
}

// ---------------------------------------------------------------------------
// Funding rounds
// ---------------------------------------------------------------------------

function fundingMilestonesToScVal(milestones: FundingMilestoneInput[]): xdr.ScVal {
  if (milestones.length === 0) {
    throw new Error("Funding round requires at least one milestone");
  }
  const bps = milestones.map((m) => m.releasePercentageBps ?? 0);
  if (bps.some((b) => b > 0) && bps.reduce((a, b) => a + b, 0) !== 10_000) {
    throw new Error("Funding milestone releasePercentageBps must sum to 10000");
  }
  return xdr.ScVal.scvVec(
    milestones.map((m) =>
      structToScVal({
        description: xdr.ScVal.scvString(m.description),
        amount: i128ToScVal(m.amount),
        release_percentage_bps: u32ToScVal(m.releasePercentageBps ?? 0),
        status: unitVariantToScVal("Pending"),
        submitted_at: u64ToScVal(0n),
        verified_at: u64ToScVal(0n),
        required_verifiers: u32ToScVal(m.requiredVerifiers ?? 1),
        verifications: xdr.ScVal.scvVec([]),
        rejection_reason: xdr.ScVal.scvVoid(),
      })
    )
  );
}

/**
 * Build a transaction proposing a milestone-gated funding round.
 *
 * @param proposerPublicKey - Proposer's address.
 * @param recipient         - Project receiving the funds.
 * @param token             - Token contract ID.
 * @param totalAmount       - Total round amount (smallest unit).
 * @param milestones        - Milestone schedule.
 * @param opts              - SDK connection options.
 */
export async function createFundingRound(
  proposerPublicKey: string,
  recipient: string,
  token: string,
  totalAmount: bigint,
  milestones: FundingMilestoneInput[],
  opts: SdkOptions
): Promise<string> {
  if (totalAmount <= 0n) throw new Error("Funding round amount must be positive");
  const op = getContract(opts).call(
    "create_funding_round",
    addressToScVal(proposerPublicKey),
    addressToScVal(recipient),
    addressToScVal(token),
    i128ToScVal(totalAmount),
    fundingMilestonesToScVal(milestones)
  );
  return invokeMethod("create_funding_round", proposerPublicKey, op, opts);
}

/** Build a transaction approving a pending funding round. */
export async function approveFundingRound(
  approverPublicKey: string,
  roundId: bigint,
  opts: SdkOptions
): Promise<string> {
  const op = getContract(opts).call(
    "approve_funding_round",
    addressToScVal(approverPublicKey),
    u64ToScVal(roundId)
  );
  return invokeMethod("approve_funding_round", approverPublicKey, op, opts);
}

/** Build a transaction submitting a funding milestone for verification. */
export async function submitMilestone(
  submitterPublicKey: string,
  roundId: bigint,
  milestoneIndex: number,
  opts: SdkOptions
): Promise<string> {
  const op = getContract(opts).call(
    "submit_milestone",
    addressToScVal(submitterPublicKey),
    u64ToScVal(roundId),
    u32ToScVal(milestoneIndex)
  );
  return invokeMethod("submit_milestone", submitterPublicKey, op, opts);
}

/** Build a transaction verifying a submitted funding milestone. */
export async function verifyMilestone(
  verifierPublicKey: string,
  roundId: bigint,
  milestoneIndex: number,
  opts: SdkOptions
): Promise<string> {
  const op = getContract(opts).call(
    "verify_milestone",
    addressToScVal(verifierPublicKey),
    u64ToScVal(roundId),
    u32ToScVal(milestoneIndex)
  );
  return invokeMethod("verify_milestone", verifierPublicKey, op, opts);
}

/** Build a transaction releasing funds for a verified funding milestone. */
export async function releaseRoundFunds(
  releaserPublicKey: string,
  roundId: bigint,
  milestoneIndex: number,
  opts: SdkOptions
): Promise<string> {
  const op = getContract(opts).call(
    "release_round_funds",
    addressToScVal(releaserPublicKey),
    u64ToScVal(roundId),
    u32ToScVal(milestoneIndex)
  );
  return invokeMethod("release_round_funds", releaserPublicKey, op, opts);
}

/** Build a transaction cancelling a funding round. */
export async function cancelFundingRound(
  cancellerPublicKey: string,
  roundId: bigint,
  opts: SdkOptions
): Promise<string> {
  const op = getContract(opts).call(
    "cancel_funding_round",
    addressToScVal(cancellerPublicKey),
    u64ToScVal(roundId)
  );
  return invokeMethod("cancel_funding_round", cancellerPublicKey, op, opts);
}

/** Fetch a funding round by ID. */
export async function getFundingRound(
  roundId: bigint,
  callerPublicKey: string,
  opts: SdkOptions
): Promise<FundingRound> {
  const op = getContract(opts).call("get_funding_round", u64ToScVal(roundId));
  const raw = await simulateReadOnly<Record<string, unknown>>(
    op,
    opts,
    callerPublicKey,
    "getFundingRound"
  );
  return {
    id: big(raw.id),
    proposalId: big(raw.proposal_id),
    recipient: raw.recipient as string,
    token: raw.token as string,
    totalAmount: big(raw.total_amount),
    releasedAmount: big(raw.released_amount),
    milestones: ((raw.milestones as Record<string, unknown>[]) ?? []).map(
      (m): FundingMilestone => ({
        description: m.description as string,
        amount: big(m.amount),
        releasePercentageBps: Number(m.release_percentage_bps ?? 0),
        status: decodeUnitVariant<FundingMilestoneStatus>(m.status),
        submittedAt: big(m.submitted_at),
        verifiedAt: big(m.verified_at),
        requiredVerifiers: Number(m.required_verifiers ?? 0),
        verifications: (m.verifications as string[]) ?? [],
        rejectionReason: (m.rejection_reason as string | null | undefined) ?? null,
      })
    ),
    status: decodeUnitVariant<FundingRoundStatus>(raw.status),
    createdAt: big(raw.created_at),
    approvedAt: big(raw.approved_at),
    finalizedAt: big(raw.finalized_at),
  };
}
