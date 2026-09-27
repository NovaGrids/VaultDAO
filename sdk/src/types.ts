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

/** On-chain status of an escrow (mirrors `EscrowStatus` in types.rs). */
export enum EscrowStatus {
  Pending = 0,
  Active = 1,
  MilestonesComplete = 2,
  Released = 3,
  Refunded = 4,
  Disputed = 5,
}

/**
 * Milestone definition supplied when creating an escrow.
 * Percentages across all milestones must sum to exactly 100.
 */
export interface EscrowMilestoneInput {
  /** Share of the escrow total released for this milestone (1–100). */
  percentage: number;
  /** Ledger from which this milestone may be marked complete. */
  releaseLedger: bigint;
}

/** Escrow milestone as stored on-chain. */
export interface EscrowMilestone {
  id: bigint;
  percentage: number;
  releaseLedger: bigint;
  isCompleted: boolean;
  completionLedger: bigint;
}

/** Escrow agreement (mirrors `Escrow` in types.rs). */
export interface Escrow {
  id: bigint;
  funder: string;
  recipient: string;
  token: string;
  totalAmount: bigint;
  releasedAmount: bigint;
  milestones: EscrowMilestone[];
  status: EscrowStatus;
  arbitrator: string;
  disputeReason: string;
  createdAt: bigint;
  expiresAt: bigint;
  finalizedAt: bigint;
  requiresSignerApproval: boolean;
  approvalVotes: number;
  rejectionVotes: number;
}

/** Token vesting schedule (mirrors `VestingSchedule` in types.rs). */
export interface VestingSchedule {
  id: bigint;
  beneficiary: string;
  token: string;
  total: bigint;
  cliffLedger: number;
  startLedger: number;
  endLedger: number;
  claimed: bigint;
  cancelled: boolean;
}

/** Time-locked token position (mirrors `TokenLock` in types.rs). */
export interface TokenLock {
  owner: string;
  token: string;
  amount: bigint;
  lockedAt: bigint;
  duration: bigint;
  unlockAt: bigint;
  isActive: boolean;
  /** Voting power multiplier in basis points (10000 = 1x). */
  powerMultiplierBps: number;
}

/** Lifecycle states of a funding round (mirrors `FundingRoundStatus`). */
export enum FundingRoundStatus {
  Pending = "Pending",
  Approved = "Approved",
  Active = "Active",
  Completed = "Completed",
  Cancelled = "Cancelled",
}

/** Lifecycle states of a funding milestone (mirrors `FundingMilestoneStatus`). */
export enum FundingMilestoneStatus {
  Pending = "Pending",
  Submitted = "Submitted",
  Verified = "Verified",
  Rejected = "Rejected",
}

/**
 * Milestone definition supplied when creating a funding round.
 *
 * Use either fixed `amount`s, or `releasePercentageBps` values that sum to
 * exactly 10000 across all milestones.
 */
export interface FundingMilestoneInput {
  description: string;
  /** Fixed release amount (used when all `releasePercentageBps` are 0). */
  amount: bigint;
  /** Share of the round total in basis points (default 0). */
  releasePercentageBps?: number;
  /** Verifications required before funds can be released (default 1). */
  requiredVerifiers?: number;
}

/** Funding milestone as stored on-chain. */
export interface FundingMilestone {
  description: string;
  amount: bigint;
  releasePercentageBps: number;
  status: FundingMilestoneStatus;
  submittedAt: bigint;
  verifiedAt: bigint;
  requiredVerifiers: number;
  verifications: string[];
  rejectionReason: string | null;
}

/** Milestone-gated funding round (mirrors `FundingRound` in types.rs). */
export interface FundingRound {
  id: bigint;
  proposalId: bigint;
  recipient: string;
  token: string;
  totalAmount: bigint;
  releasedAmount: bigint;
  milestones: FundingMilestone[];
  status: FundingRoundStatus;
  createdAt: bigint;
  approvedAt: bigint;
  finalizedAt: bigint;
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

/** Vault metrics and statistics. Mirrors `VaultMetrics` in contracts/vault/src/types.rs. */
export interface VaultMetrics {
  totalProposals: bigint;
  executedCount: bigint;
  rejectedCount: bigint;
  expiredCount: bigint;
  totalExecutionTimeLedgers: bigint;
  totalGasUsed: bigint;
  lastUpdatedLedger: bigint;
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

  // 11xx — Streams, vesting and locks (contract codes, Issue #1739)
  StreamNotActive = 1160,
  VestingNotFound = 1161,
  LockAlreadyActive = 1162,
  VestingCapReached = 1163,
}

/** Thrown when the contract returns a known error code. */
export class VaultError extends Error {
  public readonly description?: string;

  constructor(
    public readonly code: VaultErrorCode,
    message?: string
  ) {
    const fallback = `VaultError(${code}): ${VaultErrorCode[code]}`;
    super(message ?? fallback);
    this.name = "VaultError";
    this.description = message ?? fallback;
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      description: this.description,
    };
  }
}

// ---------------------------------------------------------------------------
// Observability / Logging
// ---------------------------------------------------------------------------

/**
 * Additional structured context attached to each log call.
 *
 * The SDK populates common fields automatically (e.g. `method`, `contractId`,
 * `txHash`). Callers may receive additional ad-hoc fields in the future, so
 * implementations should treat this as an open record.
 */
export interface LogContext {
  /** Contract method being invoked, e.g. `"propose_transfer"`. */
  method?: string;
  /** Deployed contract ID the call targets. */
  contractId?: string;
  /** Transaction XDR hash (available after signing/submission). */
  txHash?: string;
  /** Elapsed time in milliseconds (available after a call completes). */
  durationMs?: number;
  /** On-chain error code when a `VaultError` is thrown. */
  errorCode?: number;
  /** Human-readable error message. */
  errorMessage?: string;
  /** Any additional structured data. */
  [key: string]: unknown;
}

/**
 * Logger interface that VaultDAO SDK accepts for custom observability.
 *
 * Implement this interface to route SDK telemetry to any logging backend
 * (console, Winston, Pino, Datadog, etc.).
 *
 * @example
 * ```ts
 * import pino from "pino";
 *
 * const log = pino();
 *
 * const opts = buildOptions("testnet", CONTRACT_ID, {
 *   logger: {
 *     debug: (msg, ctx) => log.debug(ctx, msg),
 *     info:  (msg, ctx) => log.info(ctx, msg),
 *     warn:  (msg, ctx) => log.warn(ctx, msg),
 *     error: (msg, ctx) => log.error(ctx, msg),
 *   },
 * });
 * ```
 *
 * @example — console logger
 * ```ts
 * const opts = buildOptions("testnet", CONTRACT_ID, {
 *   logger: {
 *     debug: (msg, ctx) => console.debug("[VaultDAO]", msg, ctx),
 *     info:  (msg, ctx) => console.info("[VaultDAO]",  msg, ctx),
 *     warn:  (msg, ctx) => console.warn("[VaultDAO]",  msg, ctx),
 *     error: (msg, ctx) => console.error("[VaultDAO]", msg, ctx),
 *   },
 * });
 * ```
 */
export interface SdkLogger {
  /**
   * Verbose diagnostic messages — RPC call lifecycle, simulation steps.
   * These are high-frequency and typically disabled in production.
   */
  debug(message: string, context?: LogContext): void;

  /**
   * Informational messages — successful transactions, notable state changes.
   */
  info(message: string, context?: LogContext): void;

  /**
   * Recoverable issues — e.g. polling retries, unexpected but non-fatal states.
   */
  warn(message: string, context?: LogContext): void;

  /**
   * Errors that prevented an operation from completing.
   */
  error(message: string, context?: LogContext): void;
}

/**
 * A silent no-op logger used when no custom logger is provided.
 * All methods are empty and impose zero runtime overhead.
 */
export const noopLogger: SdkLogger = {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  debug: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  info: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  warn: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  error: () => {},
};

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
  /**
   * Optional custom logger for SDK observability.
   *
   * When omitted the SDK operates silently (no-op logger).
   * Provide any object that satisfies {@link SdkLogger} to capture
   * debug/info/warn/error events emitted during RPC calls, transaction
   * building, signing, and submission.
   *
   * @example
   * ```ts
   * const opts: SdkOptions = {
   *   contractId: "CXXX...",
   *   rpcUrl: "https://soroban-testnet.stellar.org",
   *   networkPassphrase: Networks.TESTNET,
   *   logger: {
   *     debug: (msg, ctx) => console.debug(msg, ctx),
   *     info:  (msg, ctx) => console.info(msg, ctx),
   *     warn:  (msg, ctx) => console.warn(msg, ctx),
   *     error: (msg, ctx) => console.error(msg, ctx),
   *   },
   * };
   * ```
   */
  logger?: SdkLogger;
  /** Maximum number of additional attempts after an HTTP 429 response. */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff after HTTP 429. */
  retryDelayMs?: number;
  /** Polling interval for `watchProposal`, in milliseconds. */
  proposalWatchIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// Transaction Simulation & State Diffing (#1456)
// ---------------------------------------------------------------------------

/** Before and after values for a modified key. */
export interface StateChangeValue {
  before: unknown | null;
  after: unknown | null;
}

/** Individual key state change details. */
export interface StateChangeEntry {
  key: string;
  before: unknown | null;
  after: unknown | null;
  isNew: boolean;
}

/** State diff result extracted from transaction simulation. */
export interface StateDiff {
  /** Record of modified existing keys showing before and after values. */
  modifiedKeys: Record<string, StateChangeValue>;
  /** List of brand new keys created during simulation. */
  newKeys: string[];
  /** Detailed list of all state changes. */
  changes: StateChangeEntry[];
}

