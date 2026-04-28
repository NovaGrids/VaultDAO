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

import { SorobanRpc, xdr } from "stellar-sdk";
import type {
  InitConfig,
  Proposal,
  RecurringPayment,
  SdkOptions,
  StreamingPayment,
  Subscription,
  Escrow,
  ProposalTemplate,
  Comment,
  VaultMetrics,
  Reputation,
  AuditEntry,
} from "./types";
import { Role, ProposalStatus, VaultError, VaultErrorCode } from "./types";
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
} from "./utils";

// ---------------------------------------------------------------------------
// Internal helper — simulate a read-only call and decode the return value
// ---------------------------------------------------------------------------

async function simulateReadOnly<T>(
  operation: xdr.Operation,
  opts: SdkOptions,
  sourceKey: string
): Promise<T> {
  const server = new SorobanRpc.Server(opts.rpcUrl, { allowHttp: false });
  const { Account, TransactionBuilder, BASE_FEE } = await import("stellar-sdk");
  const account = await server.getAccount(sourceKey);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: opts.networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(15)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw parseError(new Error(sim.error));
  }
  if (!SorobanRpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new Error("Simulation returned no result");
  }

  return decodeScVal(sim.result.retval) as T;
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

  return buildTransaction(adminPublicKey, op, opts);
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
  const contract = getContract(opts);
  const op = contract.call(
    "propose_transfer",
    addressToScVal(proposerPublicKey),
    addressToScVal(recipient),
    addressToScVal(tokenAddress),
    i128ToScVal(amount),
    symbolToScVal(memo)
  );
  return buildTransaction(proposerPublicKey, op, opts);
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
  const contract = getContract(opts);
  const op = contract.call(
    "approve_proposal",
    addressToScVal(signerPublicKey),
    u64ToScVal(proposalId)
  );
  return buildTransaction(signerPublicKey, op, opts);
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
  const contract = getContract(opts);
  const op = contract.call(
    "execute_proposal",
    addressToScVal(executorPublicKey),
    u64ToScVal(proposalId)
  );
  return buildTransaction(executorPublicKey, op, opts);
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
  const contract = getContract(opts);
  const op = contract.call(
    "reject_proposal",
    addressToScVal(rejectorPublicKey),
    u64ToScVal(proposalId)
  );
  return buildTransaction(rejectorPublicKey, op, opts);
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
  const contract = getContract(opts);
  const op = contract.call(
    "execute_recurring_payment",
    u64ToScVal(paymentId)
  );
  return buildTransaction(callerPublicKey, op, opts);
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
  const contract = getContract(opts);
  const op = contract.call("dispute_escrow", u64ToScVal(escrowId));
  return buildTransaction(partyPublicKey, op, opts);
}

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
  const contract = getContract(opts);
  const op = contract.call("get_comments", u64ToScVal(proposalId));
  const raw = await simulateReadOnly<Record<string, unknown>[]>(
    op,
    opts,
    callerPublicKey
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
  const contract = getContract(opts);
  const op = contract.call("get_vault_metrics");
  const raw = await simulateReadOnly<Record<string, unknown>>(
    op,
    opts,
    callerPublicKey
  );
  return {
    executedCount: BigInt(raw.executed_count as number),
    rejectedCount: BigInt(raw.rejected_count as number),
    expiredCount: BigInt(raw.expired_count as number),
    totalVolume: BigInt(raw.total_volume as number),
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
  const contract = getContract(opts);
  const op = contract.call("get_reputation", addressToScVal(address));
  const raw = await simulateReadOnly<Record<string, unknown>>(
    op,
    opts,
    callerPublicKey
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
 * Get audit trail entries.
 */
export async function getAuditTrail(
  callerPublicKey: string,
  opts: SdkOptions
): Promise<AuditEntry[]> {
  const contract = getContract(opts);
  const op = contract.call("get_audit_trail");
  const raw = await simulateReadOnly<Record<string, unknown>[]>(
    op,
    opts,
    callerPublicKey
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
  const contract = getContract(opts);
  const op = contract.call("get_delegation_chain", addressToScVal(address));
  return simulateReadOnly<string[]>(op, opts, callerPublicKey);
}

// ---------------------------------------------------------------------------
// View / Read-only Functions
// ---------------------------------------------------------------------------

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
  const contract = getContract(opts);
  const op = contract.call("get_proposal", u64ToScVal(proposalId));
  const raw = await simulateReadOnly<Record<string, unknown>>(
    op,
    opts,
    callerPublicKey
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
  const contract = getContract(opts);
  const op = contract.call("get_role", addressToScVal(address));
  const raw = await simulateReadOnly<number>(op, opts, callerPublicKey);
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
  const contract = getContract(opts);
  const op = contract.call("get_today_spent");
  return simulateReadOnly<bigint>(op, opts, callerPublicKey);
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
  const contract = getContract(opts);
  const op = contract.call("is_signer", addressToScVal(address));
  return simulateReadOnly<boolean>(op, opts, callerPublicKey);
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
