/**
 * Proposal Activity Indexing Types
 * 
 * Defines the normalized types for proposal lifecycle events,
 * designed for efficient indexing and downstream consumption.
 */

import { EventType } from "../events/types.js";

/**
 * All possible proposal lifecycle event types for indexing.
 */
export enum ProposalActivityType {
  CREATED = "PROPOSAL_CREATED",
  APPROVED = "PROPOSAL_APPROVED",
  ABSTAINED = "PROPOSAL_ABSTAINED",
  READY = "PROPOSAL_READY",
  EXECUTED = "PROPOSAL_EXECUTED",
  EXPIRED = "PROPOSAL_EXPIRED",
  CANCELLED = "PROPOSAL_CANCELLED",
  REJECTED = "PROPOSAL_REJECTED",
  AMENDED = "PROPOSAL_AMENDED",
  VETOED = "PROPOSAL_VETOED",
  PENDING = "PROPOSAL_PENDING",
}

/**
 * Maps EventType to ProposalActivityType for consistent indexing.
 */
export const PROPOSAL_ACTIVITY_TYPE_MAP: Record<string, ProposalActivityType> = {
  [EventType.PROPOSAL_CREATED]: ProposalActivityType.CREATED,
  [EventType.PROPOSAL_APPROVED]: ProposalActivityType.APPROVED,
  [EventType.PROPOSAL_ABSTAINED]: ProposalActivityType.ABSTAINED,
  [EventType.PROPOSAL_READY]: ProposalActivityType.READY,
  [EventType.PROPOSAL_EXECUTED]: ProposalActivityType.EXECUTED,
  [EventType.PROPOSAL_EXPIRED]: ProposalActivityType.EXPIRED,
  [EventType.PROPOSAL_CANCELLED]: ProposalActivityType.CANCELLED,
  [EventType.PROPOSAL_REJECTED]: ProposalActivityType.REJECTED,
  [EventType.PROPOSAL_VETOED]: ProposalActivityType.VETOED,
};

/**
 * Metadata shared across all proposal activity records.
 */
export interface ProposalActivityMetadata {
  readonly id: string;
  readonly contractId: string;
  readonly ledger: number;
  readonly ledgerClosedAt: string;
  readonly transactionHash: string;
  readonly eventIndex: number;
}

/**
 * Proposal activity record - the core output shape for indexing.
 * This is the normalized, aggregation-ready structure.
 */
export interface ProposalActivityRecord {
  readonly activityId: string;
  readonly proposalId: string;
  readonly type: ProposalActivityType;
  readonly timestamp: string;
  readonly metadata: ProposalActivityMetadata;
  readonly data: ProposalActivityData;
}

/**
 * Union type for all proposal activity data payloads.
 */
export type ProposalActivityData =
  | ProposalCreatedActivityData
  | ProposalApprovedActivityData
  | ProposalAbstainedActivityData
  | ProposalReadyActivityData
  | ProposalExecutedActivityData
  | ProposalExpiredActivityData
  | ProposalCancelledActivityData
  | ProposalRejectedActivityData
  | ProposalAmendedActivityData
  | ProposalScheduledActivityData
  | ProposalDeadlineRejectedActivityData
  | ProposalVetoedActivityData;

/**
 * Activity data for proposal scheduled.
 */
export interface ProposalScheduledActivityData {
  readonly activityType: ProposalActivityType.SCHEDULED;
  readonly executionTime: number;
  readonly unlockLedger: number;
}

/**
 * Activity data for proposal deadline rejected.
 */
export interface ProposalDeadlineRejectedActivityData {
  readonly activityType: ProposalActivityType.DEADLINE_REJECTED;
  readonly rejector: string;
  readonly proposer: string;
}

/**
 * Activity data for proposal vetoed.
 */
export interface ProposalVetoedActivityData {
  readonly activityType: ProposalActivityType.VETOED;
  readonly vetoer: string;
}

/**
 * Activity data for proposal creation.
 */
export interface ProposalCreatedActivityData {
  readonly activityType: ProposalActivityType.CREATED;
  readonly proposer: string;
  readonly recipient: string;
  readonly token: string;
  readonly amount: string;
  readonly insuranceAmount: string;
  readonly description?: string;
}

/**
 * Activity data for proposal approval.
 */
export interface ProposalApprovedActivityData {
  readonly activityType: ProposalActivityType.APPROVED;
  readonly voter: string;
  readonly votesFor: string;
  readonly votesAgainst: string;
  readonly votesAbstain: string;
}

/**
 * Activity data for proposal abstain.
 */
export interface ProposalAbstainedActivityData {
  readonly activityType: ProposalActivityType.ABSTAINED;
  readonly voter: string;
  readonly votesAbstain: string;
}

/**
 * Activity data for proposal ready to execute.
 */
export interface ProposalReadyActivityData {
  readonly activityType: ProposalActivityType.READY;
  readonly finalVotesFor: string;
  readonly finalVotesAgainst: string;
  readonly finalVotesAbstain: string;
  readonly quorumMet: boolean;
}

/**
 * Activity data for proposal execution.
 */
export interface ProposalExecutedActivityData {
  readonly activityType: ProposalActivityType.EXECUTED;
  readonly executor: string;
  readonly recipient: string;
  readonly token: string;
  readonly amount: string;
  readonly executionLedger: number;
}

/**
 * Activity data for proposal expiration.
 */
export interface ProposalExpiredActivityData {
  readonly activityType: ProposalActivityType.EXPIRED;
  readonly finalVotesFor: string;
  readonly finalVotesAgainst: string;
  readonly finalVotesAbstain: string;
}

/**
 * Activity data for proposal cancellation.
 */
export interface ProposalCancelledActivityData {
  readonly activityType: ProposalActivityType.CANCELLED;
  readonly cancelledBy: string;
  readonly reason?: string;
}

/**
 * Activity data for proposal rejection.
 */
export interface ProposalRejectedActivityData {
  readonly activityType: ProposalActivityType.REJECTED;
  readonly finalVotesFor: string;
  readonly finalVotesAgainst: string;
  readonly finalVotesAbstain: string;
  readonly rejectionReason?: string;
}

/**
 * Activity data for proposal amendment.
 */
export interface ProposalAmendedActivityData {
  readonly activityType: ProposalActivityType.AMENDED;
  readonly amendedBy: string;
  readonly previousAmount?: string;
  readonly newAmount?: string;
  readonly previousRecipient?: string;
  readonly newRecipient?: string;
}

/**
 * Aggregated proposal activity summary for a single proposal.
 */
export interface ProposalActivitySummary {
  readonly proposalId: string;
  readonly contractId: string;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly totalEvents: number;
  readonly currentStatus: ProposalActivityType;
  readonly events: ProposalActivityRecord[];
}

/**
 * Configuration for the proposal indexer service.
 */
export interface ProposalIndexerConfig {
  readonly enabled: boolean;
  readonly batchSize: number;
  readonly flushIntervalMs: number;
  readonly persistenceEnabled: boolean;
}

/**
 * Consumer callback type for processed proposal events.
 */
export type ProposalEventConsumer = (
  record: ProposalActivityRecord
) => Promise<void> | void;

/**
 * Batch consumer callback for processing multiple records.
 */
export type ProposalBatchConsumer = (
  records: ProposalActivityRecord[]
) => Promise<void> | void;

/**
 * Interface for proposal activity persistence (for future storage integration).
 */
export interface ProposalActivityPersistence {
  save(record: ProposalActivityRecord): Promise<void>;
  saveBatch(records: ProposalActivityRecord[]): Promise<void>;
  getByProposalId(proposalId: string): Promise<ProposalActivityRecord[]>;
  getByContractId(contractId: string): Promise<ProposalActivityRecord[]>;
  getSummary(proposalId: string): Promise<ProposalActivitySummary | null>;
}

/**
 * Interface for persistence adapter factory.
 */
export interface PersistenceAdapterFactory {
  create(): ProposalActivityPersistence;
}

// ─── Core entity ─────────────────────────────────────────────────────────

export interface ProposalActivity {
  /** Auto-incremented primary key (undefined before first save). */
  id?: number;
  /** On-chain proposal ID (e.g. UUID or incremented integer as string). */
  proposalId: string;
  /** Soroban contract address that owns this proposal. */
  contractId: string;
  /**
   * Activity type tag.
   *
   * Standard values: `"created"` | `"vote_cast"` | `"vote_approved"` |
   * `"vote_rejected"` | `"executed"` | `"cancelled"` | `"timelock_started"` |
   * `"timelock_expired"` | `"spending_limit_exceeded"`
   */
  activityType: string;
  /** Stellar public key of the actor (signer, executor, etc.). */
  actor?: string;
  /** Arbitrary JSON payload — stored as a serialized string in SQLite. */
  data?: Record<string, unknown>;
  /** Unix timestamp in milliseconds when the event occurred. */
  timestamp: number;
  /** Stellar ledger sequence number when the event was recorded. */
  ledgerSequence?: number;
  /** On-chain transaction hash. */
  txHash?: string;
}

// ─── Summary ──────────────────────────────────────────────────────────────

export interface ProposalActivitySummary {
  proposalId: string;
  contractId: string;
  totalEvents: number;
  firstEventAt: number;
  lastEventAt: number;
  voteCount: number;
  approvalCount: number;
  rejectionCount: number;
  executionCount: number;
  cancellationCount: number;
}

// ─── Persistence interface ─────────────────────────────────────────────────

export interface ProposalActivityPersistence {
  /**
   * Persist a single activity record.
   * Returns the saved record with its assigned `id`.
   */
  save(activity: Omit<ProposalActivity, "id">): ProposalActivity;

  /**
   * Persist multiple activity records atomically.
   * Implementations should use a transaction for batch inserts.
   */
  saveBatch(activities: Omit<ProposalActivity, "id">[]): ProposalActivity[];

  /**
   * Return all activity records for a proposal in chronological order.
   */
  getByProposalId(proposalId: string): ProposalActivity[];

  /**
   * Return all activity records for a contract in chronological order.
   */
  getByContractId(contractId: string): ProposalActivity[];

  /**
   * Return an aggregated summary for a proposal.
   * Returns `null` when no activity exists.
   */
  getSummary(proposalId: string): ProposalActivitySummary | null;
}