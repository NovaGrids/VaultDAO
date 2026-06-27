/**
 * Normalized event types for the VaultDAO system.
 * These are used by the indexer, notification system, and frontend.
 */
export enum EventType {
  // ── Core ──────────────────────────────────────────────────────────────────
  INITIALIZED = "INITIALIZED",

  // ── Proposal lifecycle ────────────────────────────────────────────────────
  PROPOSAL_CREATED = "PROPOSAL_CREATED",
  PROPOSAL_APPROVED = "PROPOSAL_APPROVED",
  PROPOSAL_ABSTAINED = "PROPOSAL_ABSTAINED",
  PROPOSAL_READY = "PROPOSAL_READY",
  PROPOSAL_SCHEDULED = "PROPOSAL_SCHEDULED",
  PROPOSAL_EXECUTED = "PROPOSAL_EXECUTED",
  PROPOSAL_EXPIRED = "PROPOSAL_EXPIRED",
  PROPOSAL_CANCELLED = "PROPOSAL_CANCELLED",
  PROPOSAL_REJECTED = "PROPOSAL_REJECTED",
  PROPOSAL_DEADLINE_REJECTED = "PROPOSAL_DEADLINE_REJECTED",
  PROPOSAL_VETOED = "PROPOSAL_VETOED",
  PROPOSAL_AMENDED = "PROPOSAL_AMENDED",
  PROPOSAL_FROM_TEMPLATE = "PROPOSAL_FROM_TEMPLATE",
  SCHEDULED_PROPOSAL_CANCELLED = "SCHEDULED_PROPOSAL_CANCELLED",
  DELEGATED_VOTE = "DELEGATED_VOTE",
  VOTE_CHANGED = "VOTE_CHANGED",
  VOTING_DEADLINE_EXTENDED = "VOTING_DEADLINE_EXTENDED",
  THRESHOLD_REDUCED = "THRESHOLD_REDUCED",
  QUORUM_REACHED = "QUORUM_REACHED",

  // ── Role / admin ──────────────────────────────────────────────────────────
  ROLE_ASSIGNED = "ROLE_ASSIGNED",
  CONFIG_UPDATED = "CONFIG_UPDATED",
  SIGNER_ADDED = "SIGNER_ADDED",
  SIGNER_REMOVED = "SIGNER_REMOVED",
  QUORUM_UPDATED = "QUORUM_UPDATED",
  ORACLE_CONFIG_UPDATED = "ORACLE_CONFIG_UPDATED",
  ORACLE_PRICE_STALE = "ORACLE_PRICE_STALE",
  RECOVERY_CONFIG_UPDATED = "RECOVERY_CONFIG_UPDATED",
  INSURANCE_CONFIG_UPDATED = "INSURANCE_CONFIG_UPDATED",
  GAS_CONFIG_UPDATED = "GAS_CONFIG_UPDATED",
  DEX_CONFIG_UPDATED = "DEX_CONFIG_UPDATED",
  CROSS_VAULT_CONFIG_SET = "CROSS_VAULT_CONFIG_SET",
  BRIDGE_CONFIG_UPDATED = "BRIDGE_CONFIG_UPDATED",
  REPUTATION_CONFIG_UPDATED = "REPUTATION_CONFIG_UPDATED",

  // ── Insurance / staking ───────────────────────────────────────────────────
  INSURANCE_LOCKED = "INSURANCE_LOCKED",
  INSURANCE_SLASHED = "INSURANCE_SLASHED",
  INSURANCE_RETURNED = "INSURANCE_RETURNED",
  STAKE_LOCKED = "STAKE_LOCKED",
  STAKE_SLASHED = "STAKE_SLASHED",
  STAKE_REFUNDED = "STAKE_REFUNDED",

  // ── Escrow / funding ──────────────────────────────────────────────────────
  ESCROW_CREATED = "ESCROW_CREATED",
  ESCROW_RELEASED = "ESCROW_RELEASED",
  ESCROW_DISPUTED = "ESCROW_DISPUTED",
  ESCROW_RESOLVED = "ESCROW_RESOLVED",
  MILESTONE_COMPLETE = "MILESTONE_COMPLETE",
  MILESTONE_SUBMITTED = "MILESTONE_SUBMITTED",
  MILESTONE_VERIFIED = "MILESTONE_VERIFIED",
  MILESTONE_REJECTED = "MILESTONE_REJECTED",
  FUNDING_ROUND_CREATED = "FUNDING_ROUND_CREATED",
  FUNDING_ROUND_APPROVED = "FUNDING_ROUND_APPROVED",
  FUNDING_ROUND_CANCELLED = "FUNDING_ROUND_CANCELLED",
  FUNDING_ROUND_COMPLETED = "FUNDING_ROUND_COMPLETED",
  FUNDING_RELEASED = "FUNDING_RELEASED",

  // ── Recurring / streaming ─────────────────────────────────────────────────
  STREAM_CREATED = "STREAM_CREATED",
  STREAM_RATE_ADJUSTED = "STREAM_RATE_ADJUSTED",
  STREAM_STATUS = "STREAM_STATUS",
  STREAM_CLAIMED = "STREAM_CLAIMED",
  SUBSCRIPTION_CREATED = "SUBSCRIPTION_CREATED",
  SUBSCRIPTION_RENEWED = "SUBSCRIPTION_RENEWED",
  SUBSCRIPTION_CANCELLED = "SUBSCRIPTION_CANCELLED",
  SUBSCRIPTION_UPGRADED = "SUBSCRIPTION_UPGRADED",
  SUBSCRIPTION_EXPIRED = "SUBSCRIPTION_EXPIRED",

  // ── Recovery ──────────────────────────────────────────────────────────────
  RECOVERY_PROPOSED = "RECOVERY_PROPOSED",
  RECOVERY_APPROVED = "RECOVERY_APPROVED",
  RECOVERY_EXECUTED = "RECOVERY_EXECUTED",
  RECOVERY_CANCELLED = "RECOVERY_CANCELLED",

  // ── Misc ──────────────────────────────────────────────────────────────────
  REPUTATION_UPDATED = "REPUTATION_UPDATED",
  BATCH_EXECUTED = "BATCH_EXECUTED",
  BATCH_ROLLED_BACK = "BATCH_ROLLED_BACK",
  RETRY_SCHEDULED = "RETRY_SCHEDULED",
  RETRY_ATTEMPTED = "RETRY_ATTEMPTED",
  RETRIES_EXHAUSTED = "RETRIES_EXHAUSTED",
  TOKENS_LOCKED = "TOKENS_LOCKED",
  LOCK_EXTENDED = "LOCK_EXTENDED",
  TOKENS_UNLOCKED = "TOKENS_UNLOCKED",
  EARLY_UNLOCK = "EARLY_UNLOCK",
  GAS_LIMIT_EXCEEDED = "GAS_LIMIT_EXCEEDED",
  CROSS_VAULT_PROPOSED = "CROSS_VAULT_PROPOSED",
  CROSS_VAULT_EXECUTED = "CROSS_VAULT_EXECUTED",
  NOTIFICATION_PREFS_UPDATED = "NOTIFICATION_PREFS_UPDATED",
  COMMENT_ADDED = "COMMENT_ADDED",
  COMMENT_EDITED = "COMMENT_EDITED",
  COMMENT_DELETED = "COMMENT_DELETED",
  HOOK_REGISTERED = "HOOK_REGISTERED",
  HOOK_REMOVED = "HOOK_REMOVED",
  HOOK_EXECUTED = "HOOK_EXECUTED",
  LIQUIDITY_REMOVED = "LIQUIDITY_REMOVED",
  LIQUIDITY_ADDED = "LIQUIDITY_ADDED",
  LP_STAKED = "LP_STAKED",
  LP_UNSTAKED = "LP_UNSTAKED",
  REWARDS_CLAIMED = "REWARDS_CLAIMED",
  EXECUTION_FEE_ESTIMATED = "EXECUTION_FEE_ESTIMATED",
  EXECUTION_FEE_USED = "EXECUTION_FEE_USED",
  METRICS_UPDATED = "METRICS_UPDATED",
  METRICS_BUCKET_UPDATED = "METRICS_BUCKET_UPDATED",
  TEMPLATE_CREATED = "TEMPLATE_CREATED",
  TEMPLATE_UPDATED = "TEMPLATE_UPDATED",
  TEMPLATE_VERSION_PRUNED = "TEMPLATE_VERSION_PRUNED",
  TEMPLATE_STATUS_CHANGED = "TEMPLATE_STATUS_CHANGED",
  FEE_STRUCTURE_UPDATED = "FEE_STRUCTURE_UPDATED",
  FEE_COLLECTED = "FEE_COLLECTED",
  SWAP_EXECUTED = "SWAP_EXECUTED",
  PERMISSION_GRANTED = "PERMISSION_GRANTED",
  PERMISSION_REVOKED = "PERMISSION_REVOKED",
  PERMISSION_DELEGATED = "PERMISSION_DELEGATED",
  DISPUTE_RAISED = "DISPUTE_RAISED",
  DISPUTE_RESOLVED = "DISPUTE_RESOLVED",
  BRIDGE_PROPOSED = "BRIDGE_PROPOSED",
  BRIDGE_EXECUTED = "BRIDGE_EXECUTED",

  UNKNOWN = "UNKNOWN",
}

/**
 * Metadata shared by all normalized events.
 */
export interface EventMetadata {
  readonly id: string;
  readonly contractId: string;
  readonly ledger: number;
  readonly ledgerClosedAt: string;
}

/**
 * The base structure for all normalized events.
 */
export interface NormalizedEvent<T = any> {
  readonly type: EventType;
  readonly data: T;
  readonly metadata: EventMetadata;
}

// ── Proposal data interfaces ──────────────────────────────────────────────────

export interface ProposalCreatedData {
  readonly proposalId: string;
  readonly proposer: string;
  readonly recipient: string;
  readonly token: string;
  readonly amount: string;
  readonly insuranceAmount: string;
}

export interface ProposalApprovedData {
  readonly proposalId: string;
  readonly approver: string;
  readonly approvalCount: number;
  readonly threshold: number;
}

export interface ProposalAbstainedData {
  readonly proposalId: string;
  readonly abstainer: string;
  readonly abstentionCount: number;
  readonly quorumVotes: number;
}

export interface ProposalReadyData {
  readonly proposalId: string;
  readonly unlockLedger: number;
}

export interface ProposalScheduledData {
  readonly proposalId: string;
  readonly executionTime: number;
  readonly unlockLedger: number;
}

export interface ProposalExecutedData {
  readonly proposalId: string;
  readonly executor: string;
  readonly recipient: string;
  readonly token: string;
  readonly amount: string;
  readonly ledger: number;
}

export interface ProposalExpiredData {
  readonly proposalId: string;
  readonly expiresAt: number;
}

export interface ProposalCancelledData {
  readonly proposalId: string;
  readonly cancelledBy: string;
  readonly reason: string;
  readonly refundedAmount: string;
}

export interface ProposalRejectedData {
  readonly proposalId: string;
  readonly rejector: string;
  readonly proposer: string;
}

export interface ProposalVetoedData {
  readonly proposalId: string;
  readonly vetoer: string;
}

export interface ProposalAmendedData {
  readonly proposalId: string;
  readonly amendedBy: string;
  readonly oldRecipient: string;
  readonly newRecipient: string;
  readonly oldAmount: string;
  readonly newAmount: string;
  readonly amendedAtLedger: number;
}

export interface DelegatedVoteData {
  readonly proposalId: string;
  readonly effectiveVoter: string;
  readonly signer: string;
}

export interface VotingDeadlineExtendedData {
  readonly proposalId: string;
  readonly oldDeadline: number;
  readonly newDeadline: number;
  readonly admin: string;
}

export interface QuorumReachedData {
  readonly proposalId: string;
  readonly quorumVotes: number;
  readonly requiredQuorum: number;
}

// ── Role / admin data interfaces ──────────────────────────────────────────────

export interface RoleAssignedData {
  readonly address: string;
  readonly role: number;
}

export interface SignerChangedData {
  readonly signer: string;
  readonly totalSigners: number;
}

export interface QuorumUpdatedData {
  readonly admin: string;
  readonly oldQuorum: number;
  readonly newQuorum: number;
}

// ── Insurance / staking data interfaces ──────────────────────────────────────

export interface InsuranceLockedData {
  readonly proposalId: string;
  readonly proposer: string;
  readonly amount: string;
  readonly token: string;
}

export interface InsuranceSlashedData {
  readonly proposalId: string;
  readonly proposer: string;
  readonly slashedAmount: string;
  readonly returnedAmount: string;
}

export interface InsuranceReturnedData {
  readonly proposalId: string;
  readonly proposer: string;
  readonly amount: string;
}

// ── Escrow data interfaces ────────────────────────────────────────────────────

export interface EscrowCreatedData {
  readonly escrowId: string;
  readonly funder: string;
  readonly recipient: string;
  readonly token: string;
  readonly amount: string;
  readonly durationLedgers: number;
}

export interface EscrowReleasedData {
  readonly escrowId: string;
  readonly recipient: string;
  readonly amount: string;
  readonly isRefund: boolean;
}

export interface EscrowDisputedData {
  readonly escrowId: string;
  readonly disputer: string;
  readonly reason: string;
}

export interface EscrowResolvedData {
  readonly escrowId: string;
  readonly arbitrator: string;
  readonly releasedToRecipient: boolean;
}

export interface MilestoneData {
  readonly escrowId: string;
  readonly milestoneId: string;
  readonly actor: string;
}

export interface FundingRoundCreatedData {
  readonly roundId: string;
  readonly proposalId: string;
  readonly recipient: string;
  readonly token: string;
  readonly totalAmount: string;
  readonly milestoneCount: number;
}

export interface FundingReleasedData {
  readonly roundId: string;
  readonly recipient: string;
  readonly amount: string;
  readonly milestoneIndex: number;
}

// ── Staking data interfaces ───────────────────────────────────────────────────

export interface StakeLockedData {
  readonly proposalId: string;
  readonly staker: string;
  readonly amount: string;
  readonly token: string;
}

export interface StakeSlashedData {
  readonly proposalId: string;
  readonly staker: string;
  readonly slashedAmount: string;
  readonly returnedAmount: string;
}

export interface StakeRefundedData {
  readonly proposalId: string;
  readonly staker: string;
  readonly amount: string;
}

// ── Funding round extension data interfaces ───────────────────────────────────

export interface FundingRoundApprovedData {
  readonly roundId: string;
  readonly proposalId: string;
  readonly approver: string;
}

export interface FundingRoundCancelledData {
  readonly roundId: string;
  readonly cancelledBy: string;
  readonly reason: string;
}

export interface FundingRoundCompletedData {
  readonly roundId: string;
  readonly totalReleased: string;
}

// ── Recurring / streaming data interfaces ─────────────────────────────────────

export interface StreamCreatedData {
  readonly streamId: string;
  readonly sender: string;
  readonly recipient: string;
  readonly token: string;
  readonly totalAmount: string;
  readonly rate: string;
}

export interface StreamStatusData {
  readonly streamId: string;
  readonly status: string;
  readonly updatedBy: string;
}

export interface StreamClaimedData {
  readonly streamId: string;
  readonly recipient: string;
  readonly amount: string;
}

export interface StreamRateAdjustedData {
  readonly streamId: string;
  readonly oldRate: string;
  readonly newRate: string;
  readonly adjustedBy: string;
}

// ── Subscription data interfaces ──────────────────────────────────────────────

export interface SubscriptionCreatedData {
  readonly subscriptionId: string;
  readonly subscriber: string;
  readonly tier: number;
  readonly amount: string;
}

export interface SubscriptionRenewedData {
  readonly subscriptionId: string;
  readonly paymentNumber: number;
  readonly amount: string;
}

export interface SubscriptionCancelledData {
  readonly subscriptionId: string;
  readonly cancelledBy: string;
}

export interface SubscriptionUpgradedData {
  readonly subscriptionId: string;
  readonly oldTier: string;
  readonly newTier: string;
  readonly additionalAmount: string;
}

export interface SubscriptionExpiredData {
  readonly subscriptionId: string;
}

// ── Recovery data interfaces ──────────────────────────────────────────────────

export interface RecoveryProposedData {
  readonly proposalId: string;
  readonly newThreshold: number;
}

export interface RecoveryApprovedData {
  readonly proposalId: string;
  readonly guardian: string;
}

export interface RecoveryExecutedData {
  readonly proposalId: string;
}

export interface RecoveryCancelledData {
  readonly proposalId: string;
  readonly cancelledBy: string;
}

export interface GenericEventData {
  readonly topic: string;
  readonly topicArgs: readonly string[];
  readonly value: unknown;
}

// ── Misc data interfaces ──────────────────────────────────────────────────────

export interface ReputationUpdatedData {
  readonly address: string;
  readonly oldScore: number;
  readonly newScore: number;
  readonly reason: string;
}

export interface BatchExecutedData {
  readonly batchId: string;
  readonly executor: string;
  readonly count: number;
  readonly successCount: number;
}

export interface RetryScheduledData {
  readonly targetId: string;
  readonly retryAt: number;
  readonly attemptNumber: number;
}

export interface RetryAttemptedData {
  readonly targetId: string;
  readonly attemptNumber: number;
  readonly success: boolean;
}

export interface RetriesExhaustedData {
  readonly targetId: string;
  readonly maxAttempts: number;
}

export interface TokensLockedData {
  readonly address: string;
  readonly amount: string;
  readonly token: string;
  readonly unlockLedger: number;
}

export interface LockExtendedData {
  readonly address: string;
  readonly token: string;
  readonly newUnlockLedger: number;
}

export interface TokensUnlockedData {
  readonly address: string;
  readonly amount: string;
  readonly token: string;
}

export interface EarlyUnlockData {
  readonly address: string;
  readonly amount: string;
  readonly token: string;
  readonly penalty: string;
}

export interface GasLimitExceededData {
  readonly proposalId: string;
  readonly gasUsed: number;
  readonly gasLimit: number;
}

export interface CrossVaultProposedData {
  readonly proposalId: string;
  readonly sourceVault: string;
  readonly targetVault: string;
  readonly amount: string;
  readonly token: string;
}

export interface CrossVaultExecutedData {
  readonly proposalId: string;
  readonly sourceVault: string;
  readonly targetVault: string;
  readonly amount: string;
  readonly token: string;
}

export interface ConfigUpdatedData {
  readonly admin: string;
  readonly field: string;
  readonly oldValue: string;
  readonly newValue: string;
}

export interface OracleConfigUpdatedData {
  readonly admin: string;
  readonly oracle: string;
  readonly config: string;
}

// ── Map of contract event topics → EventType ─────────────────────────────────

export const CONTRACT_EVENT_MAP: Record<string, EventType> = {
  // Core
  initialized: EventType.INITIALIZED,

  // Proposal lifecycle
  proposal_created: EventType.PROPOSAL_CREATED,
  proposal_approved: EventType.PROPOSAL_APPROVED,
  proposal_abstained: EventType.PROPOSAL_ABSTAINED,
  proposal_ready: EventType.PROPOSAL_READY,
  proposal_scheduled: EventType.PROPOSAL_SCHEDULED,
  proposal_executed: EventType.PROPOSAL_EXECUTED,
  proposal_expired: EventType.PROPOSAL_EXPIRED,
  proposal_cancelled: EventType.PROPOSAL_CANCELLED,
  proposal_rejected: EventType.PROPOSAL_REJECTED,
  proposal_deadline_rejected: EventType.PROPOSAL_DEADLINE_REJECTED,
  proposal_vetoed: EventType.PROPOSAL_VETOED,
  proposal_amended: EventType.PROPOSAL_AMENDED,
  proposal_from_template: EventType.PROPOSAL_FROM_TEMPLATE,
  scheduled_proposal_cancelled: EventType.SCHEDULED_PROPOSAL_CANCELLED,
  delegated_vote: EventType.DELEGATED_VOTE,
  vote_changed: EventType.VOTE_CHANGED,
  voting_deadline_ext: EventType.VOTING_DEADLINE_EXTENDED,
  threshold_reduced: EventType.THRESHOLD_REDUCED,
  quorum_reached: EventType.QUORUM_REACHED,

  // Role / admin
  role_assigned: EventType.ROLE_ASSIGNED,
  config_updated: EventType.CONFIG_UPDATED,
  signer_added: EventType.SIGNER_ADDED,
  signer_removed: EventType.SIGNER_REMOVED,
  quorum_updated: EventType.QUORUM_UPDATED,
  oracle_cfg_updated: EventType.ORACLE_CONFIG_UPDATED,
  oracle_price_stale: EventType.ORACLE_PRICE_STALE,
  recovery_config: EventType.RECOVERY_CONFIG_UPDATED,
  insurance_cfg_updated: EventType.INSURANCE_CONFIG_UPDATED,
  gas_cfg_updated: EventType.GAS_CONFIG_UPDATED,
  dex_cfg_updated: EventType.DEX_CONFIG_UPDATED,
  cv_config_set: EventType.CROSS_VAULT_CONFIG_SET,
  bridge_cfg_updated: EventType.BRIDGE_CONFIG_UPDATED,
  rep_config_updated: EventType.REPUTATION_CONFIG_UPDATED,

  // Insurance / staking
  insurance_locked: EventType.INSURANCE_LOCKED,
  insurance_slashed: EventType.INSURANCE_SLASHED,
  insurance_returned: EventType.INSURANCE_RETURNED,
  stake_locked: EventType.STAKE_LOCKED,
  stake_slashed: EventType.STAKE_SLASHED,
  stake_refunded: EventType.STAKE_REFUNDED,

  // Escrow / funding
  escrow_created: EventType.ESCROW_CREATED,
  escrow_released: EventType.ESCROW_RELEASED,
  escrow_disputed: EventType.ESCROW_DISPUTED,
  escrow_resolved: EventType.ESCROW_RESOLVED,
  milestone_complete: EventType.MILESTONE_COMPLETE,
  milestone_submitted: EventType.MILESTONE_SUBMITTED,
  milestone_verified: EventType.MILESTONE_VERIFIED,
  milestone_rejected: EventType.MILESTONE_REJECTED,
  funding_round_created: EventType.FUNDING_ROUND_CREATED,
  funding_round_approved: EventType.FUNDING_ROUND_APPROVED,
  funding_round_cancelled: EventType.FUNDING_ROUND_CANCELLED,
  funding_round_completed: EventType.FUNDING_ROUND_COMPLETED,
  funding_released: EventType.FUNDING_RELEASED,

  // Recurring / streaming
  stream_created: EventType.STREAM_CREATED,
  stream_rate_adj: EventType.STREAM_RATE_ADJUSTED,
  stream_status: EventType.STREAM_STATUS,
  stream_claimed: EventType.STREAM_CLAIMED,
  subscription_created: EventType.SUBSCRIPTION_CREATED,
  subscription_renewed: EventType.SUBSCRIPTION_RENEWED,
  subscription_cancelled: EventType.SUBSCRIPTION_CANCELLED,
  subscription_upgraded: EventType.SUBSCRIPTION_UPGRADED,
  subscription_expired: EventType.SUBSCRIPTION_EXPIRED,

  // Recovery
  recovery_proposed: EventType.RECOVERY_PROPOSED,
  recovery_approved: EventType.RECOVERY_APPROVED,
  recovery_executed: EventType.RECOVERY_EXECUTED,
  recovery_cancelled: EventType.RECOVERY_CANCELLED,

  // Misc
  reputation_updated: EventType.REPUTATION_UPDATED,
  batch_executed: EventType.BATCH_EXECUTED,
  batch_rolled_back: EventType.BATCH_ROLLED_BACK,
  retry_scheduled: EventType.RETRY_SCHEDULED,
  retry_attempted: EventType.RETRY_ATTEMPTED,
  retries_exhausted: EventType.RETRIES_EXHAUSTED,
  tokens_locked: EventType.TOKENS_LOCKED,
  lock_extended: EventType.LOCK_EXTENDED,
  tokens_unlocked: EventType.TOKENS_UNLOCKED,
  early_unlock: EventType.EARLY_UNLOCK,
  gas_limit_exceeded: EventType.GAS_LIMIT_EXCEEDED,
  cv_proposed: EventType.CROSS_VAULT_PROPOSED,
  cv_executed: EventType.CROSS_VAULT_EXECUTED,
  notif_prefs_updated: EventType.NOTIFICATION_PREFS_UPDATED,
  comment_added: EventType.COMMENT_ADDED,
  comment_edited: EventType.COMMENT_EDITED,
  comment_deleted: EventType.COMMENT_DELETED,
  hook_registered: EventType.HOOK_REGISTERED,
  hook_removed: EventType.HOOK_REMOVED,
  hook_executed: EventType.HOOK_EXECUTED,
  liquidity_removed: EventType.LIQUIDITY_REMOVED,
  liquidity_added: EventType.LIQUIDITY_ADDED,
  lp_staked: EventType.LP_STAKED,
  lp_unstaked: EventType.LP_UNSTAKED,
  rewards_claimed: EventType.REWARDS_CLAIMED,
  exec_fee_estimated: EventType.EXECUTION_FEE_ESTIMATED,
  exec_fee_used: EventType.EXECUTION_FEE_USED,
  metrics_updated: EventType.METRICS_UPDATED,
  metrics_bucket_upd: EventType.METRICS_BUCKET_UPDATED,
  template_created: EventType.TEMPLATE_CREATED,
  template_updated: EventType.TEMPLATE_UPDATED,
  template_ver_pruned: EventType.TEMPLATE_VERSION_PRUNED,
  template_status: EventType.TEMPLATE_STATUS_CHANGED,
  fee_structure_updated: EventType.FEE_STRUCTURE_UPDATED,
  fee_collected: EventType.FEE_COLLECTED,
  swap_executed: EventType.SWAP_EXECUTED,
  permission_granted: EventType.PERMISSION_GRANTED,
  permission_revoked: EventType.PERMISSION_REVOKED,
  permission_delegated: EventType.PERMISSION_DELEGATED,
  dispute_raised: EventType.DISPUTE_RAISED,
  dispute_resolved: EventType.DISPUTE_RESOLVED,
  bridge_proposed: EventType.BRIDGE_PROPOSED,
  bridge_executed: EventType.BRIDGE_EXECUTED,
};
