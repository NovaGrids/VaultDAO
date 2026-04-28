/**
 * VaultDAO SDK — Type Definitions
 *
 * Mirrors the Soroban contract types defined in contracts/vault/src/types.rs
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Permissions assigned to vault participants. */
export enum Role {
  /** Read-only access (default). */
  Member = 0,
  /** Can create and approve transfer proposals. */
  Treasurer = 1,
  /** Full control: manages roles, signers, and configuration. */
  Admin = 2,
}

/** Lifecycle states of a transfer proposal. */
export enum ProposalStatus {
  /** Awaiting more approvals. */
  Pending = 0,
  /** Approval threshold met; ready for execution. */
  Approved = 1,
  /** Funds transferred and record finalised. */
  Executed = 2,
  /** Cancelled by Admin or the original proposer. */
  Rejected = 3,
  /** Expired without reaching the approval threshold. */
  Expired = 4,
}

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

/**
 * Parameters required to initialise the VaultDAO contract.
 * Passed once to `initialize()`.
 */
export interface InitConfig {
  /** Ordered list of authorised signer addresses. */
  signers: string[];
  /** M in the M-of-N multisig requirement (≥ 1). */
  threshold: number;
  /** Maximum amount per single proposal, in stroops. */
  spendingLimit: bigint;
  /** Maximum aggregate daily outflow, in stroops. */
  dailyLimit: bigint;
  /** Maximum aggregate weekly outflow, in stroops. */
  weeklyLimit: bigint;
  /** Amount above which a timelock is applied, in stroops. */
  timelockThreshold: bigint;
  /** Timelock duration in ledgers (~5 seconds/ledger). */
  timelockDelay: bigint;
}

/**
 * Active vault configuration returned by the contract.
 */
export interface VaultConfig {
  signers: string[];
  threshold: number;
  spendingLimit: bigint;
  dailyLimit: bigint;
  weeklyLimit: bigint;
  timelockThreshold: bigint;
  timelockDelay: bigint;
}

/**
 * A transfer proposal stored on-chain.
 */
export interface Proposal {
  /** Unique sequential ID. */
  id: bigint;
  /** Address that created the proposal. */
  proposer: string;
  /** Destination address for the funds. */
  recipient: string;
  /** Contract address of the token (SAC or custom). */
  token: string;
  /** Amount in the token's smallest unit (stroops for XLM). */
  amount: bigint;
  /** Short description / memo. */
  memo: string;
  /** Addresses that have approved so far. */
  approvals: string[];
  /** Current lifecycle status. */
  status: ProposalStatus;
  /** Ledger sequence number when the proposal was created. */
  createdAt: bigint;
  /** Ledger sequence number when the proposal expires (~7 days). */
  expiresAt: bigint;
  /** Earliest ledger at which execution is permitted (0 = no timelock). */
  unlockLedger: bigint;
}

/**
 * A scheduled recurring payment.
 */
export interface RecurringPayment {
  id: bigint;
  proposer: string;
  recipient: string;
  token: string;
  amount: bigint;
  memo: string;
  /** Cadence in ledgers (minimum 720, ~1 hour). */
  interval: bigint;
  /** Next scheduled execution ledger. */
  nextPaymentLedger: bigint;
  /** Number of times this payment has been executed. */
  paymentCount: number;
  /** Whether the schedule is active. */
  isActive: boolean;
}

/** Streaming payment configuration. */
export interface StreamingPayment {
  id: bigint;
  sender: string;
  recipient: string;
  token: string;
  totalAmount: bigint;
  flowRate: bigint;
  startLedger: bigint;
  endLedger: bigint;
  claimedAmount: bigint;
}

/** Subscription configuration. */
export interface Subscription {
  id: bigint;
  subscriber: string;
  serviceProvider: string;
  tier: number;
  token: string;
  amountPerPeriod: bigint;
  intervalLedgers: bigint;
  nextRenewalLedger: bigint;
  createdAt: bigint;
  status: number;
}

/** Escrow agreement. */
export interface Escrow {
  id: bigint;
  funder: string;
  recipient: string;
  token: string;
  amount: bigint;
  releasedAmount: bigint;
  arbitrator: string;
  durationLedgers: bigint;
  createdAt: bigint;
  status: number;
}

/** Proposal template. */
export interface ProposalTemplate {
  id: bigint;
  creator: string;
  name: string;
  description: string;
  recipientTemplate: string;
  tokenTemplate: string;
  amountTemplate: bigint;
  isActive: boolean;
}

/** Comment on a proposal. */
export interface Comment {
  id: bigint;
  proposalId: bigint;
  author: string;
  content: string;
  createdAt: bigint;
}

/** Vault metrics and statistics. */
export interface VaultMetrics {
  executedCount: bigint;
  rejectedCount: bigint;
  expiredCount: bigint;
  totalVolume: bigint;
}

/** Reputation record for an address. */
export interface Reputation {
  address: string;
  score: bigint;
  proposalsCreated: bigint;
  proposalsApproved: bigint;
  lastUpdated: bigint;
}

/** Audit trail entry. */
export interface AuditEntry {
  id: bigint;
  action: string;
  actor: string;
  proposalId: bigint;
  timestamp: bigint;
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/**
 * All error codes emitted by the VaultDAO contract.
 * The numeric value matches the on-chain `VaultError` variant.
 */
export enum VaultErrorCode {
  // 1xx — Initialization
  AlreadyInitialized = 100,
  NotInitialized = 101,

  // 2xx — Authorization
  Unauthorized = 200,
  NotASigner = 201,
  InsufficientRole = 202,

  // 3xx — Proposal
  ProposalNotFound = 300,
  ProposalNotPending = 301,
  AlreadyApproved = 302,
  ProposalExpired = 303,
  ProposalNotApproved = 304,
  ProposalAlreadyExecuted = 305,

  // 4xx — Spending limits
  ExceedsProposalLimit = 400,
  ExceedsDailyLimit = 401,
  ExceedsWeeklyLimit = 402,
  InvalidAmount = 403,
  TimelockNotExpired = 404,
  IntervalTooShort = 405,

  // 5xx — Configuration
  ThresholdTooLow = 500,
  ThresholdTooHigh = 501,
  SignerAlreadyExists = 502,
  SignerNotFound = 503,
  CannotRemoveSigner = 504,
  NoSigners = 505,

  // 6xx — Token
  TransferFailed = 600,
  InsufficientBalance = 601,
}

/** Thrown when the contract returns a known error code. */
export class VaultError extends Error {
  constructor(
    public readonly code: VaultErrorCode,
    message?: string
  ) {
    super(message ?? `VaultError(${code}): ${VaultErrorCode[code]}`);
    this.name = "VaultError";
  }
}

// ---------------------------------------------------------------------------
// SDK config
// ---------------------------------------------------------------------------

/** Network presets recognised by the SDK. */
export type Network = "testnet" | "mainnet" | "futurenet" | "custom";

/** Options passed to every SDK function. */
export interface SdkOptions {
  /** Deployed contract ID (Strkey Cxxx format). */
  contractId: string;
  /** Stellar RPC endpoint URL. */
  rpcUrl: string;
  /** Stellar network passphrase. */
  networkPassphrase: string;
}
