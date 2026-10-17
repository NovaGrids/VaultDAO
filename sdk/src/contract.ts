/**
 * VaultDAO SDK — Contract Bindings
 *
 * Low-level wrappers around every VaultDAO contract function.
 * Each function builds, simulates, and returns a signed-ready XDR string.
 * Use `signAndSubmit()` from utils.ts to broadcast the result.
 *
 * For read-only calls (getProposal, getRole, etc.) the function directly
 * decodes and returns the on-chain value without requiring a signature.
 */

import { SorobanRpc, xdr } from "@stellar/stellar-sdk";
import type {
  InitConfig,
  VaultConfig,
  Proposal,
  RecurringPayment,
  SdkOptions,
  StreamingPayment,
  Subscription,
  ProposalTemplate,
  Comment,
  VaultMetrics,
  Reputation,
  AuditEntry,
  VoteChoice,
  VotingDelegation,
  InsuranceClaim,
  InsuranceClaimStatus,
  StakeRecord,
  StakingConfig,
  ListMode,
  TokenSpendingConfig,
  TransferDetails,
  SwapProposal,
  SwapResult,
  DexConfig,
} from "./types";
import { Role, ProposalStatus, VaultError, VaultErrorCode, noopLogger } from "./types";
import type { SdkLogger } from "./types";
import {
  getContract,
  buildTransaction,
  addressToScVal,
  i128ToScVal,
  u64ToScVal,
  u32ToScVal,
  symbolToScVal,
  decodeScVal,
  parseError,
  retryOnRateLimit,
  enumToScVal,
  vecToScVal,
  boolToScVal,
  bytesN32ToScVal,
  structToScVal,
} from "./utils";
import {
  validateNonEmptyString,
  validatePositiveBigInt,
  validateNonNegativeBigInt,
  validatePositiveNumber,
  validateNonNegativeNumber,
  validateThreshold,
  validateMinInterval,
  validateMemo,
  validateRole,
  validateId,
  validateStreamLedgers,
  validateInitConfig,
  validateAddressList,
  validateIdList,
  SdkValidationError,
} from "./validation";

// ---------------------------------------------------------------------------
// Internal helper — simulate a read-only call and decode the return value
// ---------------------------------------------------------------------------

/** @internal Shared with token-flows.ts; not part of the public API. */
export async function simulateReadOnly<T>(
  operation: xdr.Operation,
  opts: SdkOptions,
  sourceKey: string,
  method?: string
): Promise<T> {
  const log: SdkLogger = opts.logger ?? noopLogger;
  const server = new SorobanRpc.Server(opts.rpcUrl, { allowHttp: false });
  const { TransactionBuilder, BASE_FEE } = await import("@stellar/stellar-sdk");
  const ctx = { contractId: opts.contractId, method };
  const simStart = Date.now();
  log.debug("Simulating read-only call", ctx);

  const sim = await retryOnRateLimit(
    async () => {
      const account = await server.getAccount(sourceKey);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: opts.networkPassphrase,
      })
        .addOperation(operation)
        .setTimeout(15)
        .build();
      return server.simulateTransaction(tx);
    },
    opts,
    log,
    "read-only simulation"
  );

  if (SorobanRpc.Api.isSimulationError(sim)) {
    const durationMs = Date.now() - simStart;
    const err = parseError(new Error(sim.error));
    log.error("Read-only simulation failed", {
      ...ctx,
      durationMs,
      errorMessage: err.message,
    });
    throw err;
  }
  if (!SorobanRpc.Api.isSimulationSuccess(sim) || !sim.result) {
    const durationMs = Date.now() - simStart;
    log.error("Read-only simulation returned no result", { ...ctx, durationMs });
    throw new Error("Simulation returned no result");
  }

  const durationMs = Date.now() - simStart;
  log.debug("Read-only call succeeded", { ...ctx, durationMs });

  return decodeScVal(sim.result.retval) as T;
}

// ---------------------------------------------------------------------------
// Internal helper — build a write transaction with logger instrumentation
// ---------------------------------------------------------------------------

/**
 * Wrap `buildTransaction` with before/after logger events for every
 * contract method invocation.
 *
 * @internal Shared with token-flows.ts; not part of the public API.
 */
export async function invokeMethod(
  method: string,
  callerPublicKey: string,
  operation: xdr.Operation,
  opts: SdkOptions
): Promise<string> {
  const log: SdkLogger = opts.logger ?? noopLogger;
  const ctx = { contractId: opts.contractId, method };

  log.debug(`Invoking contract method: ${method}`, ctx);

  try {
    const txXdr = await buildTransaction(callerPublicKey, operation, opts);
    log.debug(`Transaction built for method: ${method}`, ctx);
    return txXdr;
  } catch (err) {
    const parsed = err instanceof Error ? err : new Error(String(err));
    log.error(`Failed to build transaction for method: ${method}`, {
      ...ctx,
      errorMessage: parsed.message,
    });
    throw parsed;
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Build a transaction to initialise the VaultDAO contract (call once).
 *
 * @param adminPublicKey - Admin's Stellar public key.
 * @param config         - Vault configuration parameters.
 * @param opts           - SDK connection options.
 * @returns              Prepared transaction XDR ready for signing.
 */
export async function initialize(
  adminPublicKey: string,
  config: InitConfig,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("adminPublicKey", adminPublicKey);
  validateInitConfig(config);

  const contract = getContract(opts);

  const signersScVal = xdr.ScVal.scvVec(
    config.signers.map((s) => addressToScVal(s))
  );

  const configScVal = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("signers"),
      val: signersScVal,
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("threshold"),
      val: u32ToScVal(config.threshold),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("spending_limit"),
      val: i128ToScVal(config.spendingLimit),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("daily_limit"),
      val: i128ToScVal(config.dailyLimit),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("weekly_limit"),
      val: i128ToScVal(config.weeklyLimit),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("timelock_threshold"),
      val: i128ToScVal(config.timelockThreshold),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("timelock_delay"),
      val: u64ToScVal(config.timelockDelay),
    }),
  ]);

  const op = contract.call(
    "initialize",
    addressToScVal(adminPublicKey),
    configScVal
  );

  return invokeMethod("initialize", adminPublicKey, op, opts);
}

// ---------------------------------------------------------------------------
// Proposal Management
// ---------------------------------------------------------------------------

/**
 * Build a transaction to propose a new token transfer from the vault.
 *
 * @param proposerPublicKey - Proposer's address (must be Treasurer or Admin).
 * @param recipient         - Destination address for the funds.
 * @param tokenAddress      - Contract ID of the token.
 * @param amount            - Amount in smallest unit (e.g., stroops for XLM).
 * @param memo              - Short memo/description (≤ 32 characters).
 * @param opts              - SDK connection options.
 * @returns                 Prepared transaction XDR.
 */
export async function proposeTransfer(
  proposerPublicKey: string,
  recipient: string,
  tokenAddress: string,
  amount: bigint,
  memo: string,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("proposerPublicKey", proposerPublicKey);
  validateNonEmptyString("recipient", recipient);
  validateNonEmptyString("tokenAddress", tokenAddress);
  validatePositiveBigInt("amount", amount);
  validateMemo("memo", memo);

  const contract = getContract(opts);
  const op = contract.call(
    "propose_transfer",
    addressToScVal(proposerPublicKey),
    addressToScVal(recipient),
    addressToScVal(tokenAddress),
    i128ToScVal(amount),
    symbolToScVal(memo)
  );
  return invokeMethod("propose_transfer", proposerPublicKey, op, opts);
}

/**
 * Build a transaction for a signer to approve an existing proposal.
 *
 * @param signerPublicKey - Signer's address (must be in the signers list).
 * @param proposalId      - ID of the proposal to approve.
 * @param opts            - SDK connection options.
 */
export async function approveProposal(
  signerPublicKey: string,
  proposalId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("signerPublicKey", signerPublicKey);
  validateId("proposalId", proposalId);

  const contract = getContract(opts);
  const op = contract.call(
    "approve_proposal",
    addressToScVal(signerPublicKey),
    u64ToScVal(proposalId)
  );
  return invokeMethod("approve_proposal", signerPublicKey, op, opts);
}

/**
 * Build a transaction to execute an approved (and unlocked) proposal.
 *
 * @param executorPublicKey - Address triggering execution.
 * @param proposalId        - ID of the proposal to execute.
 * @param opts              - SDK connection options.
 */
export async function executeProposal(
  executorPublicKey: string,
  proposalId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("executorPublicKey", executorPublicKey);
  validateId("proposalId", proposalId);

  const contract = getContract(opts);
  const op = contract.call(
    "execute_proposal",
    addressToScVal(executorPublicKey),
    u64ToScVal(proposalId)
  );
  return invokeMethod("execute_proposal", executorPublicKey, op, opts);
}

/**
 * Build a transaction to reject a pending proposal.
 *
 * Only the original proposer or an Admin can reject.
 *
 * @param rejectorPublicKey - Address of the rejector.
 * @param proposalId        - ID of the proposal to reject.
 * @param opts              - SDK connection options.
 */
export async function rejectProposal(
  rejectorPublicKey: string,
  proposalId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("rejectorPublicKey", rejectorPublicKey);
  validateId("proposalId", proposalId);

  const contract = getContract(opts);
  const op = contract.call(
    "reject_proposal",
    addressToScVal(rejectorPublicKey),
    u64ToScVal(proposalId)
  );
  return buildTransaction(rejectorPublicKey, op, opts);
}

// ---------------------------------------------------------------------------
// Voting Lifecycle
// ---------------------------------------------------------------------------

/**
 * Build a transaction for a signer to abstain on a proposal.
 *
 * @param signerPublicKey - Signer's address (must be in the signers list).
 * @param proposalId      - ID of the proposal.
 * @param opts            - SDK connection options.
 */
export async function abstainProposal(
  signerPublicKey: string,
  proposalId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("signerPublicKey", signerPublicKey);
  validateId("proposalId", proposalId);

  const contract = getContract(opts);
  const op = contract.call(
    "abstain_proposal",
    addressToScVal(signerPublicKey),
    u64ToScVal(proposalId)
  );
  return invokeMethod("abstain_proposal", signerPublicKey, op, opts);
}

/**
 * Build a transaction for a signer to change a vote they already cast.
 *
 * @param signerPublicKey - Signer's address.
 * @param proposalId      - ID of the proposal.
 * @param choice          - The new vote (`"Approve"` or `"Abstain"`).
 * @param opts            - SDK connection options.
 */
export async function changeVote(
  signerPublicKey: string,
  proposalId: bigint,
  choice: VoteChoice,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("signerPublicKey", signerPublicKey);
  validateId("proposalId", proposalId);

  const contract = getContract(opts);
  const op = contract.call(
    "change_vote",
    addressToScVal(signerPublicKey),
    u64ToScVal(proposalId),
    enumToScVal(choice)
  );
  return invokeMethod("change_vote", signerPublicKey, op, opts);
}

/**
 * Build a transaction for a signer to veto a proposal.
 *
 * @param vetoerPublicKey - Address holding veto rights.
 * @param proposalId      - ID of the proposal to veto.
 * @param opts            - SDK connection options.
 */
export async function vetoProposal(
  vetoerPublicKey: string,
  proposalId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("vetoerPublicKey", vetoerPublicKey);
  validateId("proposalId", proposalId);

  const contract = getContract(opts);
  const op = contract.call(
    "veto_proposal",
    addressToScVal(vetoerPublicKey),
    u64ToScVal(proposalId)
  );
  return invokeMethod("veto_proposal", vetoerPublicKey, op, opts);
}

/**
 * Build a transaction to cancel a proposal.
 *
 * @param cancellerPublicKey - Proposer or Admin.
 * @param proposalId         - ID of the proposal to cancel.
 * @param reason             - Short reason recorded on-chain (max 32 chars).
 * @param opts               - SDK connection options.
 */
export async function cancelProposal(
  cancellerPublicKey: string,
  proposalId: bigint,
  reason: string,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("cancellerPublicKey", cancellerPublicKey);
  validateId("proposalId", proposalId);
  validateMemo("reason", reason);

  const contract = getContract(opts);
  const op = contract.call(
    "cancel_proposal",
    addressToScVal(cancellerPublicKey),
    u64ToScVal(proposalId),
    symbolToScVal(reason)
  );
  return invokeMethod("cancel_proposal", cancellerPublicKey, op, opts);
}

/**
 * Build a transaction to amend the recipient, amount, and memo of a pending proposal.
 *
 * @param proposerPublicKey - Original proposer's address.
 * @param proposalId        - ID of the proposal to amend.
 * @param amendment         - New recipient, amount, memo, and reason for the change.
 * @param opts              - SDK connection options.
 */
export async function amendProposal(
  proposerPublicKey: string,
  proposalId: bigint,
  amendment: {
    recipient: string;
    amount: bigint;
    memo: string;
    reason: string;
  },
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("proposerPublicKey", proposerPublicKey);
  validateId("proposalId", proposalId);
  validateNonEmptyString("recipient", amendment.recipient);
  validatePositiveBigInt("amount", amendment.amount);
  validateMemo("memo", amendment.memo);
  validateMemo("reason", amendment.reason);

  const contract = getContract(opts);
  const op = contract.call(
    "amend_proposal",
    addressToScVal(proposerPublicKey),
    u64ToScVal(proposalId),
    addressToScVal(amendment.recipient),
    i128ToScVal(amendment.amount),
    symbolToScVal(amendment.memo),
    symbolToScVal(amendment.reason)
  );
  return invokeMethod("amend_proposal", proposerPublicKey, op, opts);
}

/**
 * Build a transaction that supersedes an existing proposal with a new transfer.
 *
 * The old proposal is replaced in a single contract call. Defaults to
 * `Normal` priority, no conditions (AND logic), and no insurance.
 *
 * @param proposerPublicKey - Original proposer's address.
 * @param oldProposalId     - ID of the proposal being superseded.
 * @param transfer          - Replacement recipient, token, amount, and memo.
 * @param options           - Optional priority and insurance amount.
 * @param opts              - SDK connection options.
 */
export async function supersedeProposal(
  proposerPublicKey: string,
  oldProposalId: bigint,
  transfer: {
    recipient: string;
    tokenAddress: string;
    amount: bigint;
    memo: string;
  },
  options: {
    priority?: "Low" | "Normal" | "High" | "Critical";
    insuranceAmount?: bigint;
  },
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("proposerPublicKey", proposerPublicKey);
  validateId("oldProposalId", oldProposalId);
  validateNonEmptyString("recipient", transfer.recipient);
  validateNonEmptyString("tokenAddress", transfer.tokenAddress);
  validatePositiveBigInt("amount", transfer.amount);
  validateMemo("memo", transfer.memo);
  const insuranceAmount = options.insuranceAmount ?? 0n;
  validateNonNegativeBigInt("insuranceAmount", insuranceAmount);

  const contract = getContract(opts);
  const op = contract.call(
    "supersede_proposal",
    addressToScVal(proposerPublicKey),
    u64ToScVal(oldProposalId),
    addressToScVal(transfer.recipient),
    addressToScVal(transfer.tokenAddress),
    i128ToScVal(transfer.amount),
    symbolToScVal(transfer.memo),
    enumToScVal(options.priority ?? "Normal"),
    vecToScVal([]),
    enumToScVal("And"),
    i128ToScVal(insuranceAmount)
  );
  return invokeMethod("supersede_proposal", proposerPublicKey, op, opts);
}

/**
 * Build a transaction to delegate a signer's voting power to another address.
 *
 * @param delegatorPublicKey - Address delegating its voting power.
 * @param delegation         - Delegate address and expiry ledger.
 * @param opts               - SDK connection options.
 */
export async function delegateVotingPower(
  delegatorPublicKey: string,
  delegation: VotingDelegation,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("delegatorPublicKey", delegatorPublicKey);
  validateNonEmptyString("delegate", delegation.delegate);
  validateNonNegativeBigInt("expiryLedger", delegation.expiryLedger);

  const contract = getContract(opts);
  const op = contract.call(
    "delegate_voting_power",
    addressToScVal(delegatorPublicKey),
    addressToScVal(delegation.delegate),
    u64ToScVal(delegation.expiryLedger)
  );
  return invokeMethod("delegate_voting_power", delegatorPublicKey, op, opts);
}

/**
 * Build a transaction to revoke an active voting-power delegation.
 *
 * @param delegatorPublicKey - Address that previously delegated its voting power.
 * @param opts               - SDK connection options.
 */
export async function revokeDelegation(
  delegatorPublicKey: string,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("delegatorPublicKey", delegatorPublicKey);

  const contract = getContract(opts);
  const op = contract.call(
    "revoke_delegation",
    addressToScVal(delegatorPublicKey)
  );
  return invokeMethod("revoke_delegation", delegatorPublicKey, op, opts);
}

// ---------------------------------------------------------------------------
// Insurance Claims
// ---------------------------------------------------------------------------

/**
 * Build a transaction to file an insurance claim against the insurance pool.
 *
 * @param claimantPublicKey - Address filing the claim.
 * @param claim             - Token, amount, 32-byte evidence hash (hex), and vote deadline.
 * @param opts              - SDK connection options.
 */
export async function submitInsuranceClaim(
  claimantPublicKey: string,
  claim: {
    token: string;
    amount: bigint;
    evidenceHash: string;
    voteDeadline: bigint;
  },
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("claimantPublicKey", claimantPublicKey);
  validateNonEmptyString("token", claim.token);
  validatePositiveBigInt("amount", claim.amount);
  validateNonNegativeBigInt("voteDeadline", claim.voteDeadline);

  const contract = getContract(opts);
  const op = contract.call(
    "submit_insurance_claim",
    addressToScVal(claimantPublicKey),
    addressToScVal(claim.token),
    i128ToScVal(claim.amount),
    bytesN32ToScVal(claim.evidenceHash),
    u64ToScVal(claim.voteDeadline)
  );
  return invokeMethod("submit_insurance_claim", claimantPublicKey, op, opts);
}

/**
 * Build a transaction for a signer to vote on an open insurance claim.
 *
 * @param voterPublicKey - Signer's address.
 * @param claimId        - ID of the claim.
 * @param approve        - `true` to approve the claim, `false` to reject it.
 * @param opts           - SDK connection options.
 */
export async function voteOnInsuranceClaim(
  voterPublicKey: string,
  claimId: bigint,
  approve: boolean,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("voterPublicKey", voterPublicKey);
  validateId("claimId", claimId);

  const contract = getContract(opts);
  const op = contract.call(
    "vote_on_insurance_claim",
    addressToScVal(voterPublicKey),
    u64ToScVal(claimId),
    boolToScVal(approve)
  );
  return invokeMethod("vote_on_insurance_claim", voterPublicKey, op, opts);
}

/**
 * Build a transaction to close voting on an insurance claim once its window has passed.
 *
 * @param closerPublicKey - Address closing the vote.
 * @param claimId         - ID of the claim.
 * @param opts            - SDK connection options.
 */
export async function closeInsuranceClaimVoting(
  closerPublicKey: string,
  claimId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("closerPublicKey", closerPublicKey);
  validateId("claimId", claimId);

  const contract = getContract(opts);
  const op = contract.call(
    "close_insurance_claim_voting",
    addressToScVal(closerPublicKey),
    u64ToScVal(claimId)
  );
  return invokeMethod("close_insurance_claim_voting", closerPublicKey, op, opts);
}

/**
 * Fetch an insurance claim by ID.
 *
 * @param claimId         - ID of the claim.
 * @param callerPublicKey - Any valid Stellar public key.
 * @param opts            - SDK connection options.
 */
export async function getInsuranceClaim(
  claimId: bigint,
  callerPublicKey: string,
  opts: SdkOptions
): Promise<InsuranceClaim> {
  validateId("claimId", claimId);
  validateNonEmptyString("callerPublicKey", callerPublicKey);

  const contract = getContract(opts);
  const op = contract.call("get_insurance_claim", u64ToScVal(claimId));
  const raw = await simulateReadOnly<Record<string, unknown>>(
    op,
    opts,
    callerPublicKey,
    "getInsuranceClaim"
  );
  return decodeInsuranceClaim(raw);
}

// ---------------------------------------------------------------------------
// Staking
// ---------------------------------------------------------------------------

/**
 * Build a transaction to opt a stake into auto-compounding.
 *
 * @param stakerPublicKey - Address that staked against the proposal.
 * @param proposalId      - Proposal the stake is locked against.
 * @param opts            - SDK connection options.
 */
export async function enableAutoCompound(
  stakerPublicKey: string,
  proposalId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("stakerPublicKey", stakerPublicKey);
  validateId("proposalId", proposalId);

  const contract = getContract(opts);
  const op = contract.call(
    "enable_auto_compound",
    addressToScVal(stakerPublicKey),
    u64ToScVal(proposalId)
  );
  return invokeMethod("enable_auto_compound", stakerPublicKey, op, opts);
}

/**
 * Build a transaction for a keeper to compound a stake's rewards.
 *
 * @param keeperPublicKey - Address triggering the compound.
 * @param proposalId      - Proposal the stake is locked against.
 * @param opts            - SDK connection options.
 */
export async function compoundStake(
  keeperPublicKey: string,
  proposalId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("keeperPublicKey", keeperPublicKey);
  validateId("proposalId", proposalId);

  const contract = getContract(opts);
  const op = contract.call(
    "compound_stake",
    addressToScVal(keeperPublicKey),
    u64ToScVal(proposalId)
  );
  return invokeMethod("compound_stake", keeperPublicKey, op, opts);
}

/**
 * Build a transaction to replace the staking configuration. Only Admin can call this.
 *
 * @param adminPublicKey - Admin's address.
 * @param config         - The full staking configuration to store.
 * @param opts           - SDK connection options.
 */
export async function updateStakingConfig(
  adminPublicKey: string,
  config: StakingConfig,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("adminPublicKey", adminPublicKey);
  validateNonNegativeBigInt("minAmount", config.minAmount);
  validateNonNegativeBigInt("maxStakeAmount", config.maxStakeAmount);
  validateNonNegativeBigInt("compoundLockPeriod", config.compoundLockPeriod);
  validateNonNegativeBigInt("compoundEpoch", config.compoundEpoch);

  const contract = getContract(opts);
  const op = contract.call(
    "update_staking_config",
    addressToScVal(adminPublicKey),
    structToScVal({
      enabled: boolToScVal(config.enabled),
      min_amount: i128ToScVal(config.minAmount),
      base_stake_bps: u32ToScVal(config.baseStakeBps),
      max_stake_amount: i128ToScVal(config.maxStakeAmount),
      reputation_discount_threshold: u32ToScVal(config.reputationDiscountThreshold),
      reputation_discount_percentage: u32ToScVal(config.reputationDiscountPercentage),
      slash_percentage: u32ToScVal(config.slashPercentage),
      cancellation_slash_percentage: u32ToScVal(config.cancellationSlashPercentage),
      slash_to_insurance_pool: boolToScVal(config.slashToInsurancePool),
      compound_lock_period: u64ToScVal(config.compoundLockPeriod),
      compound_epoch: u64ToScVal(config.compoundEpoch),
      reward_bps_per_execution: u32ToScVal(config.rewardBpsPerExecution),
    })
  );
  return invokeMethod("update_staking_config", adminPublicKey, op, opts);
}

/**
 * Build a transaction to propose withdrawing staked funds to a recipient.
 *
 * @param proposerPublicKey - Address proposing the withdrawal.
 * @param withdrawal        - Token, amount, and recipient for the withdrawal.
 * @param opts              - SDK connection options.
 */
export async function proposeStakeWithdrawal(
  proposerPublicKey: string,
  withdrawal: { token: string; amount: bigint; recipient: string },
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("proposerPublicKey", proposerPublicKey);
  validateNonEmptyString("token", withdrawal.token);
  validatePositiveBigInt("amount", withdrawal.amount);
  validateNonEmptyString("recipient", withdrawal.recipient);

  const contract = getContract(opts);
  const op = contract.call(
    "propose_stake_withdrawal",
    addressToScVal(proposerPublicKey),
    addressToScVal(withdrawal.token),
    i128ToScVal(withdrawal.amount),
    addressToScVal(withdrawal.recipient)
  );
  return invokeMethod("propose_stake_withdrawal", proposerPublicKey, op, opts);
}

/**
 * Fetch the stake record for a proposal, or `null` if none exists.
 *
 * @param proposalId      - Proposal the stake is locked against.
 * @param callerPublicKey - Any valid Stellar public key.
 * @param opts            - SDK connection options.
 */
export async function getStakeRecord(
  proposalId: bigint,
  callerPublicKey: string,
  opts: SdkOptions
): Promise<StakeRecord | null> {
  validateId("proposalId", proposalId);
  validateNonEmptyString("callerPublicKey", callerPublicKey);

  const contract = getContract(opts);
  const op = contract.call("get_stake_record", u64ToScVal(proposalId));
  const raw = await simulateReadOnly<Record<string, unknown> | null>(
    op,
    opts,
    callerPublicKey,
    "getStakeRecord"
  );
  return raw ? decodeStakeRecord(raw) : null;
}

/**
 * Fetch the current staking configuration.
 *
 * @param callerPublicKey - Any valid Stellar public key.
 * @param opts            - SDK connection options.
 */
export async function getStakingConfig(
  callerPublicKey: string,
  opts: SdkOptions
): Promise<StakingConfig> {
  validateNonEmptyString("callerPublicKey", callerPublicKey);

  const contract = getContract(opts);
  const op = contract.call("get_staking_config");
  const raw = await simulateReadOnly<Record<string, unknown>>(
    op,
    opts,
    callerPublicKey,
    "getStakingConfig"
  );
  return decodeStakingConfig(raw);
}

// ---------------------------------------------------------------------------
// Decoders for insurance and staking reads
// ---------------------------------------------------------------------------

function decodeInsuranceClaim(raw: Record<string, unknown>): InsuranceClaim {
  return {
    id: raw.id as bigint,
    claimant: raw.claimant as string,
    amount: raw.amount as bigint,
    evidenceHash: raw.evidence_hash as Uint8Array,
    voteDeadline: raw.vote_deadline as bigint,
    approveWeight: raw.approve_weight as bigint,
    rejectWeight: raw.reject_weight as bigint,
    token: raw.token as string,
    bondAmount: raw.bond_amount as bigint,
    bondSettled: raw.bond_settled as boolean,
    status: raw.status as InsuranceClaimStatus,
    createdAt: raw.created_at as bigint,
    approvalThresholdBps: raw.approval_threshold_bps as number,
    quorumBps: raw.quorum_bps as number,
    votingWindow: raw.voting_window as bigint,
    eligibleVoters: raw.eligible_voters as number,
    voterCount: raw.voter_count as number,
    votingClosed: raw.voting_closed as boolean,
  };
}

function decodeStakeRecord(raw: Record<string, unknown>): StakeRecord {
  return {
    proposalId: raw.proposal_id as bigint,
    staker: raw.staker as string,
    token: raw.token as string,
    amount: raw.amount as bigint,
    lockedAt: raw.locked_at as bigint,
    refunded: raw.refunded as boolean,
    slashed: raw.slashed as boolean,
    slashedAmount: raw.slashed_amount as bigint,
    releasedAt: raw.released_at as bigint,
    autoCompound: raw.auto_compound as boolean,
    reinvestmentLockUntil: raw.reinvestment_lock_until as bigint,
    lastCompounded: raw.last_compounded as bigint,
    stakingTier: raw.staking_tier as number,
    accumulatedRewards: raw.accumulated_rewards as bigint,
  };
}

function decodeStakingConfig(raw: Record<string, unknown>): StakingConfig {
  return {
    enabled: raw.enabled as boolean,
    minAmount: raw.min_amount as bigint,
    baseStakeBps: raw.base_stake_bps as number,
    maxStakeAmount: raw.max_stake_amount as bigint,
    reputationDiscountThreshold: raw.reputation_discount_threshold as number,
    reputationDiscountPercentage: raw.reputation_discount_percentage as number,
    slashPercentage: raw.slash_percentage as number,
    cancellationSlashPercentage: raw.cancellation_slash_percentage as number,
    slashToInsurancePool: raw.slash_to_insurance_pool as boolean,
    compoundLockPeriod: raw.compound_lock_period as bigint,
    compoundEpoch: raw.compound_epoch as bigint,
    rewardBpsPerExecution: raw.reward_bps_per_execution as number,
  };
}

// ---------------------------------------------------------------------------
// Recipient Policy (whitelist / blacklist / list mode)
// ---------------------------------------------------------------------------

/** Maximum addresses the contract accepts in one `bulk_*` call. */
const BULK_ADDRESS_CHUNK_SIZE = 50;

/**
 * Build a transaction to set the recipient list mode. Only Admin can call this.
 *
 * @param adminPublicKey - Admin's address.
 * @param mode           - `"Disabled"`, `"Whitelist"`, or `"Blacklist"`.
 * @param opts           - SDK connection options.
 */
export async function setListMode(
  adminPublicKey: string,
  mode: ListMode,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("adminPublicKey", adminPublicKey);

  const contract = getContract(opts);
  const op = contract.call(
    "set_list_mode",
    addressToScVal(adminPublicKey),
    enumToScVal(mode)
  );
  return invokeMethod("set_list_mode", adminPublicKey, op, opts);
}

/**
 * Build a transaction to add one address to the whitelist. Only Admin can call this.
 *
 * @param adminPublicKey - Admin's address.
 * @param address        - Address to whitelist.
 * @param opts           - SDK connection options.
 */
export async function addToWhitelist(
  adminPublicKey: string,
  address: string,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("adminPublicKey", adminPublicKey);
  validateNonEmptyString("address", address);

  const contract = getContract(opts);
  const op = contract.call(
    "add_to_whitelist",
    addressToScVal(adminPublicKey),
    addressToScVal(address)
  );
  return invokeMethod("add_to_whitelist", adminPublicKey, op, opts);
}

/**
 * Build a transaction to add one address to the blacklist. Only Admin can call this.
 *
 * @param adminPublicKey - Admin's address.
 * @param address        - Address to blacklist.
 * @param opts           - SDK connection options.
 */
export async function addToBlacklist(
  adminPublicKey: string,
  address: string,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("adminPublicKey", adminPublicKey);
  validateNonEmptyString("address", address);

  const contract = getContract(opts);
  const op = contract.call(
    "add_to_blacklist",
    addressToScVal(adminPublicKey),
    addressToScVal(address)
  );
  return invokeMethod("add_to_blacklist", adminPublicKey, op, opts);
}

/**
 * Split addresses into contract-sized chunks and build one `bulk_*` transaction per chunk.
 *
 * The contract rejects bulk calls over 50 addresses, so larger lists are
 * submitted as several transactions. Returns the transactions in order.
 *
 * @internal
 */
async function buildBulkAddressTransactions(
  method: string,
  adminPublicKey: string,
  addresses: string[],
  opts: SdkOptions
): Promise<string[]> {
  validateNonEmptyString("adminPublicKey", adminPublicKey);
  validateAddressList("addresses", addresses);

  const contract = getContract(opts);
  const txs: string[] = [];
  for (let i = 0; i < addresses.length; i += BULK_ADDRESS_CHUNK_SIZE) {
    const chunk = addresses.slice(i, i + BULK_ADDRESS_CHUNK_SIZE);
    const op = contract.call(
      method,
      addressToScVal(adminPublicKey),
      vecToScVal(chunk.map(addressToScVal))
    );
    txs.push(await invokeMethod(method, adminPublicKey, op, opts));
  }
  return txs;
}

/**
 * Build transactions to whitelist many addresses (chunked to 50 per transaction).
 *
 * @returns One signed-ready XDR per chunk, in submission order.
 */
export function bulkAddToWhitelist(
  adminPublicKey: string,
  addresses: string[],
  opts: SdkOptions
): Promise<string[]> {
  return buildBulkAddressTransactions("bulk_add_to_whitelist", adminPublicKey, addresses, opts);
}

/**
 * Build transactions to remove many addresses from the whitelist (chunked to 50 per transaction).
 *
 * @returns One signed-ready XDR per chunk, in submission order.
 */
export function bulkRemoveFromWhitelist(
  adminPublicKey: string,
  addresses: string[],
  opts: SdkOptions
): Promise<string[]> {
  return buildBulkAddressTransactions("bulk_remove_from_whitelist", adminPublicKey, addresses, opts);
}

/**
 * Build transactions to blacklist many addresses (chunked to 50 per transaction).
 *
 * @returns One signed-ready XDR per chunk, in submission order.
 */
export function bulkAddToBlacklist(
  adminPublicKey: string,
  addresses: string[],
  opts: SdkOptions
): Promise<string[]> {
  return buildBulkAddressTransactions("bulk_add_to_blacklist", adminPublicKey, addresses, opts);
}

/**
 * Build transactions to remove many addresses from the blacklist (chunked to 50 per transaction).
 *
 * @returns One signed-ready XDR per chunk, in submission order.
 */
export function bulkRemoveFromBlacklist(
  adminPublicKey: string,
  addresses: string[],
  opts: SdkOptions
): Promise<string[]> {
  return buildBulkAddressTransactions("bulk_remove_from_blacklist", adminPublicKey, addresses, opts);
}

// ---------------------------------------------------------------------------
// Token Allowlist
// ---------------------------------------------------------------------------

/**
 * Build a transaction to add a token to the supported-token allowlist with spending limits.
 *
 * @param adminPublicKey - Admin's address.
 * @param config         - Token address and daily/weekly spending limits.
 * @param opts           - SDK connection options.
 */
export async function addSupportedToken(
  adminPublicKey: string,
  config: { token: string; dailyLimit: bigint; weeklyLimit: bigint },
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("adminPublicKey", adminPublicKey);
  validateNonEmptyString("token", config.token);
  validateNonNegativeBigInt("dailyLimit", config.dailyLimit);
  validateNonNegativeBigInt("weeklyLimit", config.weeklyLimit);

  const contract = getContract(opts);
  const op = contract.call(
    "add_supported_token",
    addressToScVal(adminPublicKey),
    addressToScVal(config.token),
    i128ToScVal(config.dailyLimit),
    i128ToScVal(config.weeklyLimit)
  );
  return invokeMethod("add_supported_token", adminPublicKey, op, opts);
}

/**
 * Build a transaction to remove a token from the supported-token allowlist.
 *
 * @param adminPublicKey - Admin's address.
 * @param token          - Token address to remove.
 * @param opts           - SDK connection options.
 */
export async function removeSupportedToken(
  adminPublicKey: string,
  token: string,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("adminPublicKey", adminPublicKey);
  validateNonEmptyString("token", token);

  const contract = getContract(opts);
  const op = contract.call(
    "remove_supported_token",
    addressToScVal(adminPublicKey),
    addressToScVal(token)
  );
  return invokeMethod("remove_supported_token", adminPublicKey, op, opts);
}

/**
 * Build a transaction to update the spending limits of a supported token.
 *
 * @param adminPublicKey - Admin's address.
 * @param config         - Token address and new daily/weekly spending limits.
 * @param opts           - SDK connection options.
 */
export async function setTokenLimits(
  adminPublicKey: string,
  config: { token: string; dailyLimit: bigint; weeklyLimit: bigint },
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("adminPublicKey", adminPublicKey);
  validateNonEmptyString("token", config.token);
  validateNonNegativeBigInt("dailyLimit", config.dailyLimit);
  validateNonNegativeBigInt("weeklyLimit", config.weeklyLimit);

  const contract = getContract(opts);
  const op = contract.call(
    "set_token_limits",
    addressToScVal(adminPublicKey),
    addressToScVal(config.token),
    i128ToScVal(config.dailyLimit),
    i128ToScVal(config.weeklyLimit)
  );
  return invokeMethod("set_token_limits", adminPublicKey, op, opts);
}

/**
 * Fetch every supported token and its spending limits.
 *
 * @param callerPublicKey - Any valid Stellar public key.
 * @param opts            - SDK connection options.
 */
export async function getSupportedTokens(
  callerPublicKey: string,
  opts: SdkOptions
): Promise<TokenSpendingConfig[]> {
  validateNonEmptyString("callerPublicKey", callerPublicKey);

  const contract = getContract(opts);
  const op = contract.call("get_supported_tokens");
  const raw = await simulateReadOnly<Record<string, unknown>[]>(
    op,
    opts,
    callerPublicKey,
    "getSupportedTokens"
  );
  return raw.map((entry) => ({
    token: entry.token as string,
    dailyLimit: entry.daily_limit as bigint,
    weeklyLimit: entry.weekly_limit as bigint,
    isDefault: entry.is_default as boolean,
  }));
}

// ---------------------------------------------------------------------------
// Batch Execution
// ---------------------------------------------------------------------------

/**
 * Build a transaction to group existing proposals into a batch.
 *
 * @param creatorPublicKey - Address creating the batch.
 * @param proposalIds      - IDs of the proposals to group.
 * @param opts             - SDK connection options.
 */
export async function createBatch(
  creatorPublicKey: string,
  proposalIds: bigint[],
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("creatorPublicKey", creatorPublicKey);
  validateIdList("proposalIds", proposalIds);

  const contract = getContract(opts);
  const op = contract.call(
    "create_batch",
    addressToScVal(creatorPublicKey),
    vecToScVal(proposalIds.map(u64ToScVal))
  );
  return invokeMethod("create_batch", creatorPublicKey, op, opts);
}

/**
 * Build a transaction to execute a previously created batch.
 *
 * @param executorPublicKey - Address triggering execution.
 * @param batchId           - ID of the batch from `createBatch`.
 * @param opts              - SDK connection options.
 */
export async function executeBatch(
  executorPublicKey: string,
  batchId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("executorPublicKey", executorPublicKey);
  validateId("batchId", batchId);

  const contract = getContract(opts);
  const op = contract.call(
    "execute_batch",
    addressToScVal(executorPublicKey),
    u64ToScVal(batchId)
  );
  return invokeMethod("execute_batch", executorPublicKey, op, opts);
}

/**
 * Build a transaction that executes many approved proposals in one contract call.
 *
 * Unlike executing each proposal separately, the contract applies the batch
 * atomically. The result (executed IDs and failure count) is returned by the
 * contract as a `BatchResult`.
 *
 * @param executorPublicKey - Address triggering execution.
 * @param proposalIds       - IDs of the approved proposals to execute.
 * @param opts              - SDK connection options.
 */
export async function batchExecuteProposals(
  executorPublicKey: string,
  proposalIds: bigint[],
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("executorPublicKey", executorPublicKey);
  validateIdList("proposalIds", proposalIds);

  const contract = getContract(opts);
  const op = contract.call(
    "batch_execute_proposals",
    addressToScVal(executorPublicKey),
    vecToScVal(proposalIds.map(u64ToScVal))
  );
  return invokeMethod("batch_execute_proposals", executorPublicKey, op, opts);
}

/**
 * Build a transaction that proposes many transfers in one contract call.
 *
 * Defaults to `Normal` priority, no conditions (AND logic), and no insurance.
 *
 * @param proposerPublicKey - Address proposing the transfers.
 * @param transfers         - Recipient, token, and amount for each transfer.
 * @param options          - Optional priority and insurance amount.
 * @param opts              - SDK connection options.
 */
export async function batchProposeTransfers(
  proposerPublicKey: string,
  transfers: TransferDetails[],
  options: {
    priority?: "Low" | "Normal" | "High" | "Critical";
    insuranceAmount?: bigint;
  },
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("proposerPublicKey", proposerPublicKey);
  if (transfers.length === 0) {
    throw new SdkValidationError("transfers", transfers, "transfers must not be empty");
  }
  transfers.forEach((transfer, index) => {
    validateNonEmptyString(`transfers[${index}].recipient`, transfer.recipient);
    validateNonEmptyString(`transfers[${index}].token`, transfer.token);
    validatePositiveBigInt(`transfers[${index}].amount`, transfer.amount);
  });
  const insuranceAmount = options.insuranceAmount ?? 0n;
  validateNonNegativeBigInt("insuranceAmount", insuranceAmount);

  const contract = getContract(opts);
  const op = contract.call(
    "batch_propose_transfers",
    addressToScVal(proposerPublicKey),
    vecToScVal(
      transfers.map((transfer) =>
        structToScVal({
          recipient: addressToScVal(transfer.recipient),
          token: addressToScVal(transfer.token),
          amount: i128ToScVal(transfer.amount),
        })
      )
    ),
    enumToScVal(options.priority ?? "Normal"),
    vecToScVal([]),
    enumToScVal("And"),
    i128ToScVal(insuranceAmount)
  );
  return invokeMethod("batch_propose_transfers", proposerPublicKey, op, opts);
}

// ---------------------------------------------------------------------------
// Swap Proposals
// ---------------------------------------------------------------------------

/** @internal Encode a `SwapProposal` as its Soroban enum variant. */
function swapProposalToScVal(swap: SwapProposal): xdr.ScVal {
  switch (swap.type) {
    case "Swap":
      return enumToScVal("Swap", [
        addressToScVal(swap.dex),
        addressToScVal(swap.tokenIn),
        addressToScVal(swap.tokenOut),
        i128ToScVal(swap.amountIn),
        i128ToScVal(swap.minAmountOut),
      ]);
    case "AddLiquidity":
      return enumToScVal("AddLiquidity", [
        addressToScVal(swap.dex),
        addressToScVal(swap.tokenA),
        addressToScVal(swap.tokenB),
        i128ToScVal(swap.amountA),
        i128ToScVal(swap.amountB),
        i128ToScVal(swap.minLpTokens),
      ]);
    case "RemoveLiquidity":
      return enumToScVal("RemoveLiquidity", [
        addressToScVal(swap.dex),
        addressToScVal(swap.lpToken),
        i128ToScVal(swap.amount),
        i128ToScVal(swap.minTokenA),
        i128ToScVal(swap.minTokenB),
      ]);
    case "StakeLp":
      return enumToScVal("StakeLp", [
        addressToScVal(swap.farm),
        addressToScVal(swap.lpToken),
        i128ToScVal(swap.amount),
      ]);
    case "UnstakeLp":
      return enumToScVal("UnstakeLp", [
        addressToScVal(swap.farm),
        addressToScVal(swap.lpToken),
        i128ToScVal(swap.amount),
      ]);
    case "ClaimRewards":
      return enumToScVal("ClaimRewards", [addressToScVal(swap.farm)]);
  }
}

/**
 * Build a transaction to propose a DEX swap or liquidity action.
 *
 * Defaults to `Normal` priority, no conditions (AND logic), and no insurance.
 *
 * @param proposerPublicKey - Address proposing the swap.
 * @param swap              - The swap or liquidity action to propose.
 * @param options           - Optional priority and insurance amount.
 * @param opts              - SDK connection options.
 */
export async function proposeSwap(
  proposerPublicKey: string,
  swap: SwapProposal,
  options: {
    priority?: "Low" | "Normal" | "High" | "Critical";
    insuranceAmount?: bigint;
  },
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("proposerPublicKey", proposerPublicKey);
  const insuranceAmount = options.insuranceAmount ?? 0n;
  validateNonNegativeBigInt("insuranceAmount", insuranceAmount);

  const contract = getContract(opts);
  const op = contract.call(
    "propose_swap",
    addressToScVal(proposerPublicKey),
    swapProposalToScVal(swap),
    enumToScVal(options.priority ?? "Normal"),
    vecToScVal([]),
    enumToScVal("And"),
    i128ToScVal(insuranceAmount)
  );
  return invokeMethod("propose_swap", proposerPublicKey, op, opts);
}

/**
 * Build a transaction to execute an approved swap proposal.
 *
 * @param executorPublicKey - Address triggering execution.
 * @param proposalId        - ID of the swap proposal.
 * @param opts              - SDK connection options.
 */
export async function executeSwapProposal(
  executorPublicKey: string,
  proposalId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("executorPublicKey", executorPublicKey);
  validateId("proposalId", proposalId);

  const contract = getContract(opts);
  const op = contract.call(
    "execute_swap_proposal",
    addressToScVal(executorPublicKey),
    u64ToScVal(proposalId)
  );
  return invokeMethod("execute_swap_proposal", executorPublicKey, op, opts);
}

/**
 * Fetch the recorded result of an executed swap, or `null` if it has not run.
 *
 * @param proposalId      - ID of the swap proposal.
 * @param callerPublicKey - Any valid Stellar public key.
 * @param opts            - SDK connection options.
 */
export async function getSwapResult(
  proposalId: bigint,
  callerPublicKey: string,
  opts: SdkOptions
): Promise<SwapResult | null> {
  validateId("proposalId", proposalId);
  validateNonEmptyString("callerPublicKey", callerPublicKey);

  const contract = getContract(opts);
  const op = contract.call("get_swap_result", u64ToScVal(proposalId));
  const raw = await simulateReadOnly<Record<string, unknown> | null>(
    op,
    opts,
    callerPublicKey,
    "getSwapResult"
  );
  if (!raw) return null;
  return {
    amountIn: raw.amount_in as bigint,
    amountOut: raw.amount_out as bigint,
    priceImpactBps: raw.price_impact_bps as number,
    executedAt: raw.executed_at as bigint,
  };
}

/**
 * Build a transaction to set DEX routing and safety limits. Only Admin can call this.
 *
 * @param adminPublicKey - Admin's address.
 * @param config         - Enabled DEXs, slippage and price-impact caps, and minimum liquidity.
 * @param opts           - SDK connection options.
 */
export async function setDexConfig(
  adminPublicKey: string,
  config: DexConfig,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("adminPublicKey", adminPublicKey);
  validateAddressList("enabledDexs", config.enabledDexs);
  validateNonNegativeBigInt("minLiquidity", config.minLiquidity);

  const contract = getContract(opts);
  const op = contract.call(
    "set_dex_config",
    addressToScVal(adminPublicKey),
    structToScVal({
      enabled_dexs: vecToScVal(config.enabledDexs.map(addressToScVal)),
      max_slippage_bps: u32ToScVal(config.maxSlippageBps),
      max_price_impact_bps: u32ToScVal(config.maxPriceImpactBps),
      min_liquidity: i128ToScVal(config.minLiquidity),
    })
  );
  return invokeMethod("set_dex_config", adminPublicKey, op, opts);
}

// ---------------------------------------------------------------------------
// Admin Functions
// ---------------------------------------------------------------------------

/**
 * Build a transaction to assign a role to an address.
 *
 * Only Admin can call this.
 *
 * @param adminPublicKey - Admin's address.
 * @param targetAddress  - Address to assign the role to.
 * @param role           - The `Role` to assign.
 * @param opts           - SDK connection options.
 */
export async function setRole(
  adminPublicKey: string,
  targetAddress: string,
  role: Role,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("adminPublicKey", adminPublicKey);
  validateNonEmptyString("targetAddress", targetAddress);
  validateRole("role", role);

  const contract = getContract(opts);
  const op = contract.call(
    "set_role",
    addressToScVal(adminPublicKey),
    addressToScVal(targetAddress),
    u32ToScVal(role)
  );
  return buildTransaction(adminPublicKey, op, opts);
}

/**
 * Build a transaction to add a new signer to the vault.
 *
 * @param adminPublicKey  - Admin's address.
 * @param newSignerAddress - Address to add as a signer.
 * @param opts            - SDK connection options.
 */
export async function addSigner(
  adminPublicKey: string,
  newSignerAddress: string,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("adminPublicKey", adminPublicKey);
  validateNonEmptyString("newSignerAddress", newSignerAddress);

  const contract = getContract(opts);
  const op = contract.call(
    "add_signer",
    addressToScVal(adminPublicKey),
    addressToScVal(newSignerAddress)
  );
  return buildTransaction(adminPublicKey, op, opts);
}

/**
 * Build a transaction to remove an existing signer.
 *
 * Will fail if removal would make the threshold unreachable.
 *
 * @param adminPublicKey   - Admin's address.
 * @param signerAddress    - Address to remove.
 * @param opts             - SDK connection options.
 */
export async function removeSigner(
  adminPublicKey: string,
  signerAddress: string,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("adminPublicKey", adminPublicKey);
  validateNonEmptyString("signerAddress", signerAddress);

  const contract = getContract(opts);
  const op = contract.call(
    "remove_signer",
    addressToScVal(adminPublicKey),
    addressToScVal(signerAddress)
  );
  return buildTransaction(adminPublicKey, op, opts);
}

/**
 * Build a transaction to update per-proposal and daily spending limits.
 *
 * @param adminPublicKey - Admin's address.
 * @param spendingLimit  - New per-proposal limit in stroops.
 * @param dailyLimit     - New daily aggregate limit in stroops.
 * @param opts           - SDK connection options.
 */
export async function updateLimits(
  adminPublicKey: string,
  spendingLimit: bigint,
  dailyLimit: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("adminPublicKey", adminPublicKey);
  validateNonNegativeBigInt("spendingLimit", spendingLimit);
  validateNonNegativeBigInt("dailyLimit", dailyLimit);

  const contract = getContract(opts);
  const op = contract.call(
    "update_limits",
    addressToScVal(adminPublicKey),
    i128ToScVal(spendingLimit),
    i128ToScVal(dailyLimit)
  );
  return buildTransaction(adminPublicKey, op, opts);
}

/**
 * Build a transaction to change the M-of-N approval threshold.
 *
 * @param adminPublicKey - Admin's address.
 * @param threshold      - New threshold value (1 ≤ threshold ≤ signers.length).
 * @param opts           - SDK connection options.
 */
export async function updateThreshold(
  adminPublicKey: string,
  threshold: number,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("adminPublicKey", adminPublicKey);
  validateThreshold("threshold", threshold);

  const contract = getContract(opts);
  const op = contract.call(
    "update_threshold",
    addressToScVal(adminPublicKey),
    u32ToScVal(threshold)
  );
  return buildTransaction(adminPublicKey, op, opts);
}

// ---------------------------------------------------------------------------
// Recurring Payments
// ---------------------------------------------------------------------------

/**
 * Build a transaction to schedule a recurring payment.
 *
 * @param proposerPublicKey - Treasurer/Admin address.
 * @param recipient         - Destination address.
 * @param tokenAddress      - Token contract ID.
 * @param amount            - Per-execution amount in stroops.
 * @param memo              - Short memo string.
 * @param intervalLedgers   - Cadence in ledgers (min 720, ~1 hour).
 * @param opts              - SDK connection options.
 */
export async function schedulePayment(
  proposerPublicKey: string,
  recipient: string,
  tokenAddress: string,
  amount: bigint,
  memo: string,
  intervalLedgers: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("proposerPublicKey", proposerPublicKey);
  validateNonEmptyString("recipient", recipient);
  validateNonEmptyString("tokenAddress", tokenAddress);
  validatePositiveBigInt("amount", amount);
  validateMemo("memo", memo);
  validateMinInterval("intervalLedgers", intervalLedgers);

  const contract = getContract(opts);
  const op = contract.call(
    "schedule_payment",
    addressToScVal(proposerPublicKey),
    addressToScVal(recipient),
    addressToScVal(tokenAddress),
    i128ToScVal(amount),
    symbolToScVal(memo),
    u64ToScVal(intervalLedgers)
  );
  return buildTransaction(proposerPublicKey, op, opts);
}

/**
 * Build a transaction to execute a due recurring payment.
 *
 * Anyone (e.g., a keeper bot) can call this once the schedule is due.
 *
 * @param callerPublicKey - Caller's address (any Stellar account).
 * @param paymentId       - ID of the recurring payment schedule.
 * @param opts            - SDK connection options.
 */
export async function executeRecurringPayment(
  callerPublicKey: string,
  paymentId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("callerPublicKey", callerPublicKey);
  validateId("paymentId", paymentId);

  const contract = getContract(opts);
  const op = contract.call(
    "execute_recurring_payment",
    u64ToScVal(paymentId)
  );
  return buildTransaction(callerPublicKey, op, opts);
}

/**
 * List all recurring payments with pagination.
 *
 * Fetches a paginated list of recurring payments, handling RecurringNotFound
 * gracefully when the end of the list is reached.
 *
 * @param callerPublicKey - Any valid Stellar public key (used as simulation source).
 * @param offset          - Starting index for pagination (0-based).
 * @param limit           - Maximum number of payments to return per page.
 * @param opts            - SDK connection options.
 * @returns               Array of RecurringPayment objects for the requested page.
 */
export async function listRecurringPayments(
  callerPublicKey: string,
  offset: bigint,
  limit: bigint,
  opts: SdkOptions
): Promise<RecurringPayment[]> {
  const contract = getContract(opts);
  const op = contract.call(
    "list_recurring_payments",
    u64ToScVal(offset),
    u64ToScVal(limit)
  );
  const raw = await simulateReadOnly<Record<string, unknown>[]>(
    op,
    opts,
    callerPublicKey,
    "listRecurringPayments"
  );

  return raw.map((p) => ({
    id: BigInt(p.id as number),
    proposer: p.proposer as string,
    recipient: p.recipient as string,
    token: p.token as string,
    amount: BigInt(p.amount as number),
    memo: p.memo as string,
    interval: BigInt(p.interval as number),
    nextPaymentLedger: BigInt(p.next_payment_ledger as number),
    paymentCount: Number(p.payment_count),
    isActive: p.is_active as boolean,
  }));
}

// ---------------------------------------------------------------------------
// Streaming Payments
// ---------------------------------------------------------------------------

/**
 * Create a new streaming payment.
 */
export async function createStream(
  senderPublicKey: string,
  recipient: string,
  token: string,
  totalAmount: bigint,
  flowRate: bigint,
  startLedger: bigint,
  endLedger: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("senderPublicKey", senderPublicKey);
  validateNonEmptyString("recipient", recipient);
  validateNonEmptyString("token", token);
  validatePositiveBigInt("totalAmount", totalAmount);
  validatePositiveBigInt("flowRate", flowRate);
  validateStreamLedgers("startLedger", startLedger, "endLedger", endLedger);

  const contract = getContract(opts);
  const op = contract.call(
    "create_stream",
    addressToScVal(senderPublicKey),
    addressToScVal(recipient),
    addressToScVal(token),
    i128ToScVal(totalAmount),
    i128ToScVal(flowRate),
    u64ToScVal(startLedger),
    u64ToScVal(endLedger)
  );
  return buildTransaction(senderPublicKey, op, opts);
}

/**
 * Claim streamed funds.
 */
export async function claimStream(
  recipientPublicKey: string,
  streamId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("recipientPublicKey", recipientPublicKey);
  validateId("streamId", streamId);

  const contract = getContract(opts);
  const op = contract.call("claim_stream", u64ToScVal(streamId));
  return buildTransaction(recipientPublicKey, op, opts);
}

/**
 * Pause a streaming payment.
 */
export async function pauseStream(
  senderPublicKey: string,
  streamId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("senderPublicKey", senderPublicKey);
  validateId("streamId", streamId);

  const contract = getContract(opts);
  const op = contract.call("pause_stream", u64ToScVal(streamId));
  return buildTransaction(senderPublicKey, op, opts);
}

/**
 * Cancel a streaming payment.
 */
export async function cancelStream(
  senderPublicKey: string,
  streamId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("senderPublicKey", senderPublicKey);
  validateId("streamId", streamId);

  const contract = getContract(opts);
  const op = contract.call("cancel_stream", u64ToScVal(streamId));
  return buildTransaction(senderPublicKey, op, opts);
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/**
 * Create a new subscription.
 */
export async function createSubscription(
  subscriberPublicKey: string,
  serviceProvider: string,
  tier: number,
  token: string,
  amountPerPeriod: bigint,
  intervalLedgers: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("subscriberPublicKey", subscriberPublicKey);
  validateNonEmptyString("serviceProvider", serviceProvider);
  validateNonNegativeNumber("tier", tier);
  validateNonEmptyString("token", token);
  validatePositiveBigInt("amountPerPeriod", amountPerPeriod);
  validateMinInterval("intervalLedgers", intervalLedgers);

  const contract = getContract(opts);
  const op = contract.call(
    "create_subscription",
    addressToScVal(subscriberPublicKey),
    addressToScVal(serviceProvider),
    u32ToScVal(tier),
    addressToScVal(token),
    i128ToScVal(amountPerPeriod),
    u64ToScVal(intervalLedgers)
  );
  return buildTransaction(subscriberPublicKey, op, opts);
}

/**
 * Renew a subscription.
 */
export async function renewSubscription(
  subscriberPublicKey: string,
  subscriptionId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("subscriberPublicKey", subscriberPublicKey);
  validateId("subscriptionId", subscriptionId);

  const contract = getContract(opts);
  const op = contract.call("renew_subscription", u64ToScVal(subscriptionId));
  return buildTransaction(subscriberPublicKey, op, opts);
}

/**
 * Cancel a subscription.
 */
export async function cancelSubscription(
  subscriberPublicKey: string,
  subscriptionId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("subscriberPublicKey", subscriberPublicKey);
  validateId("subscriptionId", subscriptionId);

  const contract = getContract(opts);
  const op = contract.call("cancel_subscription", u64ToScVal(subscriptionId));
  return buildTransaction(subscriberPublicKey, op, opts);
}

// ---------------------------------------------------------------------------
// Escrow
// ---------------------------------------------------------------------------

/**
 * Create an escrow agreement.
 */
export async function createEscrow(
  funderPublicKey: string,
  recipient: string,
  token: string,
  amount: bigint,
  arbitrator: string,
  durationLedgers: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("funderPublicKey", funderPublicKey);
  validateNonEmptyString("recipient", recipient);
  validateNonEmptyString("token", token);
  validatePositiveBigInt("amount", amount);
  validateNonEmptyString("arbitrator", arbitrator);
  validateNonNegativeBigInt("durationLedgers", durationLedgers);

  const contract = getContract(opts);
  const op = contract.call(
    "create_escrow",
    addressToScVal(funderPublicKey),
    addressToScVal(recipient),
    addressToScVal(token),
    i128ToScVal(amount),
    addressToScVal(arbitrator),
    u64ToScVal(durationLedgers)
  );
  return buildTransaction(funderPublicKey, op, opts);
}

/**
 * Complete an escrow milestone.
 */
export async function completeMilestone(
  recipientPublicKey: string,
  escrowId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("recipientPublicKey", recipientPublicKey);
  validateId("escrowId", escrowId);

  const contract = getContract(opts);
  const op = contract.call("complete_milestone", u64ToScVal(escrowId));
  return buildTransaction(recipientPublicKey, op, opts);
}

/**
 * Release escrow funds.
 */
export async function releaseEscrow(
  arbitratorPublicKey: string,
  escrowId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("arbitratorPublicKey", arbitratorPublicKey);
  validateId("escrowId", escrowId);

  const contract = getContract(opts);
  const op = contract.call("release_escrow", u64ToScVal(escrowId));
  return buildTransaction(arbitratorPublicKey, op, opts);
}

/**
 * Dispute an escrow agreement.
 */
export async function disputeEscrow(
  partyPublicKey: string,
  escrowId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("partyPublicKey", partyPublicKey);
  validateId("escrowId", escrowId);

  const contract = getContract(opts);
  const op = contract.call("dispute_escrow", u64ToScVal(escrowId));
  return buildTransaction(partyPublicKey, op, opts);
}
// Escrow helpers live in token-flows.ts alongside vesting, token locks and
// funding rounds.

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * Create a proposal template.
 */
export async function createTemplate(
  creatorPublicKey: string,
  name: string,
  description: string,
  recipientTemplate: string,
  tokenTemplate: string,
  amountTemplate: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("creatorPublicKey", creatorPublicKey);
  validateNonEmptyString("name", name);
  validateNonEmptyString("description", description);
  validateNonEmptyString("recipientTemplate", recipientTemplate);
  validateNonEmptyString("tokenTemplate", tokenTemplate);
  validateNonNegativeBigInt("amountTemplate", amountTemplate);

  const contract = getContract(opts);
  const op = contract.call(
    "create_template",
    addressToScVal(creatorPublicKey),
    xdr.ScVal.scvString(name),
    xdr.ScVal.scvString(description),
    xdr.ScVal.scvString(recipientTemplate),
    xdr.ScVal.scvString(tokenTemplate),
    i128ToScVal(amountTemplate)
  );
  return buildTransaction(creatorPublicKey, op, opts);
}

/**
 * Propose a transfer from a template.
 */
export async function proposeFromTemplate(
  proposerPublicKey: string,
  templateId: bigint,
  recipient: string,
  amount: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("proposerPublicKey", proposerPublicKey);
  validateId("templateId", templateId);
  validateNonEmptyString("recipient", recipient);
  validatePositiveBigInt("amount", amount);

  const contract = getContract(opts);
  const op = contract.call(
    "propose_from_template",
    u64ToScVal(templateId),
    addressToScVal(recipient),
    i128ToScVal(amount)
  );
  return buildTransaction(proposerPublicKey, op, opts);
}

/**
 * Deactivate a proposal template.
 */
export async function deactivateTemplate(
  creatorPublicKey: string,
  templateId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("creatorPublicKey", creatorPublicKey);
  validateId("templateId", templateId);

  const contract = getContract(opts);
  const op = contract.call("deactivate_template", u64ToScVal(templateId));
  return buildTransaction(creatorPublicKey, op, opts);
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/**
 * Add a comment to a proposal.
 */
export async function addComment(
  authorPublicKey: string,
  proposalId: bigint,
  content: string,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("authorPublicKey", authorPublicKey);
  validateId("proposalId", proposalId);
  validateNonEmptyString("content", content);

  const contract = getContract(opts);
  const op = contract.call(
    "add_comment",
    u64ToScVal(proposalId),
    xdr.ScVal.scvString(content)
  );
  return buildTransaction(authorPublicKey, op, opts);
}

/**
 * Edit a comment.
 */
export async function editComment(
  authorPublicKey: string,
  commentId: bigint,
  newContent: string,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("authorPublicKey", authorPublicKey);
  validateId("commentId", commentId);
  validateNonEmptyString("newContent", newContent);

  const contract = getContract(opts);
  const op = contract.call(
    "edit_comment",
    u64ToScVal(commentId),
    xdr.ScVal.scvString(newContent)
  );
  return buildTransaction(authorPublicKey, op, opts);
}

/**
 * Get comments for a proposal.
 */
export async function getComments(
  proposalId: bigint,
  callerPublicKey: string,
  opts: SdkOptions
): Promise<Comment[]> {
  validateId("proposalId", proposalId);
  validateNonEmptyString("callerPublicKey", callerPublicKey);

  const contract = getContract(opts);
  const op = contract.call("get_proposal_comments", u64ToScVal(proposalId));
  const raw = await simulateReadOnly<Record<string, unknown>[]>(
    op,
    opts,
    callerPublicKey,
    "getComments"
  );
  return raw.map((c) => ({
    id: BigInt(c.id as number),
    proposalId: BigInt(c.proposal_id as number),
    author: c.author as string,
    content: c.content as string,
    createdAt: BigInt(c.created_at as number),
  }));
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

/**
 * Propose a recovery action.
 */
export async function proposeRecovery(
  proposerPublicKey: string,
  recoveryType: string,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("proposerPublicKey", proposerPublicKey);
  validateNonEmptyString("recoveryType", recoveryType);

  const contract = getContract(opts);
  const op = contract.call(
    "propose_recovery",
    xdr.ScVal.scvString(recoveryType)
  );
  return buildTransaction(proposerPublicKey, op, opts);
}

/**
 * Approve a recovery proposal.
 */
export async function approveRecovery(
  approverPublicKey: string,
  recoveryId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("approverPublicKey", approverPublicKey);
  validateId("recoveryId", recoveryId);

  const contract = getContract(opts);
  const op = contract.call("approve_recovery", u64ToScVal(recoveryId));
  return buildTransaction(approverPublicKey, op, opts);
}

/**
 * Execute a recovery action.
 */
export async function executeRecovery(
  executorPublicKey: string,
  recoveryId: bigint,
  opts: SdkOptions
): Promise<string> {
  validateNonEmptyString("executorPublicKey", executorPublicKey);
  validateId("recoveryId", recoveryId);

  const contract = getContract(opts);
  const op = contract.call("execute_recovery", u64ToScVal(recoveryId));
  return buildTransaction(executorPublicKey, op, opts);
}

// ---------------------------------------------------------------------------
// Read Functions
// ---------------------------------------------------------------------------

/**
 * Get vault metrics.
 */
export async function getVaultMetrics(
  callerPublicKey: string,
  opts: SdkOptions
): Promise<VaultMetrics> {
  validateNonEmptyString("callerPublicKey", callerPublicKey);

  const contract = getContract(opts);
  const op = contract.call("get_metrics");
  const raw = await simulateReadOnly<Record<string, unknown>>(
    op,
    opts,
    callerPublicKey,
    "getVaultMetrics"
  );
  return {
    totalProposals: BigInt(raw.total_proposals as number),
    executedCount: BigInt(raw.executed_count as number),
    rejectedCount: BigInt(raw.rejected_count as number),
    expiredCount: BigInt(raw.expired_count as number),
    totalExecutionTimeLedgers: BigInt(raw.total_execution_time_ledgers as number),
    totalGasUsed: BigInt(raw.total_gas_used as number),
    lastUpdatedLedger: BigInt(raw.last_updated_ledger as number),
  };
}

/**
 * Get vault metrics for a specific weekly period.
 *
 * @param callerPublicKey - Any valid Stellar public key (used as simulation source).
 * @param fromWeek        - Start week number (inclusive).
 * @param toWeek          - End week number (inclusive).
 * @param opts            - SDK connection options.
 * @returns               Aggregated VaultMetrics for the requested period.
 */
export async function getMetricsForPeriod(
  callerPublicKey: string,
  fromWeek: bigint,
  toWeek: bigint,
  opts: SdkOptions
): Promise<VaultMetrics> {
  const contract = getContract(opts);
  const op = contract.call(
    "get_metrics_for_period",
    u64ToScVal(fromWeek),
    u64ToScVal(toWeek)
  );
  const raw = await simulateReadOnly<Record<string, unknown>>(
    op,
    opts,
    callerPublicKey,
    "getMetricsForPeriod"
  );
  return {
    totalProposals: BigInt(raw.total_proposals as number),
    executedCount: BigInt(raw.executed_count as number),
    rejectedCount: BigInt(raw.rejected_count as number),
    expiredCount: BigInt(raw.expired_count as number),
    totalExecutionTimeLedgers: BigInt(raw.total_execution_time_ledgers as number),
    totalGasUsed: BigInt(raw.total_gas_used as number),
    lastUpdatedLedger: BigInt(raw.last_updated_ledger as number),
  };
}

/**
 * Get reputation for an address.
 */
export async function getReputation(
  address: string,
  callerPublicKey: string,
  opts: SdkOptions
): Promise<Reputation> {
  validateNonEmptyString("address", address);
  validateNonEmptyString("callerPublicKey", callerPublicKey);

  const contract = getContract(opts);
  const op = contract.call("get_reputation", addressToScVal(address));
  const raw = await simulateReadOnly<Record<string, unknown>>(
    op,
    opts,
    callerPublicKey,
    "getReputation"
  );
  return {
    address: raw.address as string,
    score: BigInt(raw.score as number),
    proposalsCreated: BigInt(raw.proposals_created as number),
    proposalsApproved: BigInt(raw.proposals_approved as number),
    lastUpdated: BigInt(raw.last_updated as number),
  };
}

/**
 * Get audit trail entries with pagination.
 *
 * @param callerPublicKey - Any valid Stellar public key (used as simulation source).
 * @param opts            - SDK options (network, contract ID, etc.).
 * @param offset          - Zero-based entry offset (default: 0).
 * @param limit           - Number of entries to return, capped at 50 on-chain (default: 50).
 */
export async function getAuditTrail(
  callerPublicKey: string,
  opts: SdkOptions,
  offset: bigint = 0n,
  limit: number = 50
): Promise<AuditEntry[]> {
  validateNonEmptyString("callerPublicKey", callerPublicKey);

  const contract = getContract(opts);
  const op = contract.call(
    "get_audit_trail",
    u64ToScVal(offset),
    u32ToScVal(limit)
  );
  const raw = await simulateReadOnly<Record<string, unknown>[]>(
    op,
    opts,
    callerPublicKey,
    "getAuditTrail"
  );
  return raw.map((e) => ({
    id: BigInt(e.id as number),
    action: e.action as string,
    actor: e.actor as string,
    proposalId: BigInt(e.proposal_id as number),
    timestamp: BigInt(e.timestamp as number),
  }));
}

/**
 * Get delegation chain for an address.
 */
export async function getDelegationChain(
  address: string,
  callerPublicKey: string,
  opts: SdkOptions
): Promise<string[]> {
  validateNonEmptyString("address", address);
  validateNonEmptyString("callerPublicKey", callerPublicKey);

  const contract = getContract(opts);
  const op = contract.call("get_delegation_chain", addressToScVal(address));
  return simulateReadOnly<string[]>(op, opts, callerPublicKey, "getDelegationChain");
}

// ---------------------------------------------------------------------------
// View / Read-only Functions
// ---------------------------------------------------------------------------

/**
 * Fetch the current vault configuration without submitting a transaction.
 *
 * @param callerPublicKey - Any valid Stellar public key (used as simulation source).
 * @param opts            - SDK connection options.
 * @returns               The current vault configuration.
 */
export async function getConfig(
  callerPublicKey: string,
  opts: SdkOptions
): Promise<VaultConfig> {
  const contract = getContract(opts);
  const op = contract.call("get_config");
  const raw = await simulateReadOnly<Record<string, unknown>>(
    op,
    opts,
    callerPublicKey,
    "getConfig"
  );
  return {
    signers: (raw.signers as string[]) || [],
    threshold: Number(raw.threshold) || 0,
    spendingLimit: BigInt(raw.spending_limit as number) || 0n,
    dailyLimit: BigInt(raw.daily_limit as number) || 0n,
    weeklyLimit: BigInt(raw.weekly_limit as number) || 0n,
    timelockThreshold: BigInt(raw.timelock_threshold as number) || 0n,
    timelockDelay: BigInt(raw.timelock_delay as number) || 0n,
  };
}

/**
 * Fetch a proposal by ID without submitting a transaction.
 *
 * @param proposalId      - ID of the proposal to fetch.
 * @param callerPublicKey - Any valid Stellar public key (used as simulation source).
 * @param opts            - SDK connection options.
 */
export async function getProposal(
  proposalId: bigint,
  callerPublicKey: string,
  opts: SdkOptions
): Promise<Proposal> {
  validateId("proposalId", proposalId);
  validateNonEmptyString("callerPublicKey", callerPublicKey);

  const contract = getContract(opts);
  const op = contract.call("get_proposal", u64ToScVal(proposalId));
  const raw = await simulateReadOnly<Record<string, unknown>>(
    op,
    opts,
    callerPublicKey,
    "getProposal"
  );
  return decodeProposal(raw);
}

/**
 * Get the `Role` for an address.
 *
 * @param address         - The address to query.
 * @param callerPublicKey - Any valid Stellar public key.
 * @param opts            - SDK connection options.
 */
export async function getRole(
  address: string,
  callerPublicKey: string,
  opts: SdkOptions
): Promise<Role> {
  validateNonEmptyString("address", address);
  validateNonEmptyString("callerPublicKey", callerPublicKey);

  const contract = getContract(opts);
  const op = contract.call("get_role", addressToScVal(address));
  const raw = await simulateReadOnly<number>(op, opts, callerPublicKey, "getRole");
  return raw as Role;
}

/**
 * Get today's aggregate spending (in stroops).
 *
 * @param callerPublicKey - Any valid Stellar public key.
 * @param opts            - SDK connection options.
 */
export async function getTodaySpent(
  callerPublicKey: string,
  opts: SdkOptions
): Promise<bigint> {
  validateNonEmptyString("callerPublicKey", callerPublicKey);

  const contract = getContract(opts);
  const op = contract.call("get_today_spent");
  return simulateReadOnly<bigint>(op, opts, callerPublicKey, "getTodaySpent");
}

/**
 * Check whether an address is a registered signer.
 *
 * @param address         - Address to check.
 * @param callerPublicKey - Any valid Stellar public key.
 * @param opts            - SDK connection options.
 */
export async function isSigner(
  address: string,
  callerPublicKey: string,
  opts: SdkOptions
): Promise<boolean> {
  validateNonEmptyString("address", address);
  validateNonEmptyString("callerPublicKey", callerPublicKey);

  const contract = getContract(opts);
  const op = contract.call("is_signer", addressToScVal(address));
  return simulateReadOnly<boolean>(op, opts, callerPublicKey, "isSigner");
}

// ---------------------------------------------------------------------------
// Decoding helpers
// ---------------------------------------------------------------------------

function decodeProposal(raw: Record<string, unknown>): Proposal {
  return {
    id: BigInt(raw.id as number),
    proposer: raw.proposer as string,
    recipient: raw.recipient as string,
    token: raw.token as string,
    amount: BigInt(raw.amount as number),
    memo: raw.memo as string,
    approvals: raw.approvals as string[],
    status: raw.status as ProposalStatus,
    createdAt: BigInt(raw.created_at as number),
    expiresAt: BigInt(raw.expires_at as number),
    unlockLedger: BigInt(raw.unlock_ledger as number),
  };
}
