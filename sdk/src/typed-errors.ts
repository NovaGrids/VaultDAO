/**
 * VaultDAO SDK — Typed contract errors (#2064)
 *
 * The contract's `VaultError` enum uses on-chain numeric codes (1, 10, 920, …)
 * while the SDK's legacy `VaultErrorCode` enum uses family-ranged values
 * (100, 200, …). This module maps *both* spaces onto typed error classes so
 * callers can branch with `instanceof` instead of comparing magic numbers.
 *
 * @example
 * ```ts
 * import { parseError, PauseError } from "@vaultdao/sdk";
 *
 * try {
 *   await pauseVault(caller, opts);
 * } catch (err) {
 *   const parsed = parseError(err);
 *   if (parsed instanceof PauseError) {
 *     // show the incident UI
 *   }
 * }
 * ```
 */

import { ERROR_REGISTRY, type ErrorRegistryEntry } from "./errors";
import { VaultError, VaultErrorCode } from "./types";

// ---------------------------------------------------------------------------
// On-chain error codes
// ---------------------------------------------------------------------------

/** Numeric codes emitted by the Soroban `VaultError` enum. */
export enum ContractErrorCode {
  AlreadyInitialized = 1,
  NotInitialized = 2,
  NoSigners = 3,
  ThresholdTooLow = 4,
  ThresholdTooHigh = 5,
  QuorumTooHigh = 6,
  QuorumNotReached = 7,
  Unauthorized = 10,
  NotASigner = 11,
  InsufficientRole = 12,
  VoterNotInSnapshot = 13,
  ProposalNotFound = 20,
  ProposalNotPending = 21,
  ProposalNotApproved = 22,
  ProposalAlreadyExecuted = 23,
  ProposalExpired = 24,
  ProposalAlreadyCancelled = 25,
  DuplicateProposal = 26,
  ExecutionWindowExpired = 27,
  ProposalExecutionWindowExpired = 28,
  AlreadyApproved = 30,
  InvalidAmount = 40,
  ExceedsProposalLimit = 41,
  ExceedsDailyLimit = 42,
  ExceedsWeeklyLimit = 43,
  InvalidDeadline = 44,
  InvalidLedgerRange = 45,
  VelocityLimitExceeded = 50,
  TimelockNotExpired = 60,
  InsufficientBalance = 70,
  SignerAlreadyExists = 80,
  SignerNotFound = 81,
  CannotAssignHigherRole = 82,
  CannotRemoveSigner = 85,
  RecipientNotWhitelisted = 90,
  RecipientBlacklisted = 91,
  AddressAlreadyOnList = 92,
  AddressNotOnList = 93,
  InsuranceInsufficient = 110,
  InsurancePoolInsufficient = 111,
  DexError = 160,
  GasLimitExceeded = 161,
  RetryError = 168,
  BridgeError = 170,
  DisputeNotFound = 180,
  SubscriptionNotActive = 190,
  TemplateNotFound = 210,
  ClaimNotFound = 240,
  ClaimNotPending = 241,
  ClaimAlreadyVoted = 242,
  ClaimSelfVote = 243,
  ClaimVotingWindowClosed = 246,
  ClaimVotingStillOpen = 247,
  ClaimQuorumNotMet = 248,
  ClaimAlreadyClosed = 249,
  TokenAlreadySupported = 250,
  TokenNotSupported = 251,
  ExceedsTokenDailyLimit = 255,
  ExceedsTokenWeeklyLimit = 256,
  CircularDelegation = 330,
  DelegationChainTooLong = 331,
  WhitelistEntryExpired = 600,
  CapabilityNotFound = 630,
  CapabilityExpired = 631,
  CapabilityRevoked = 632,
  CapabilityMaxUsesReached = 633,
  CapabilityNotGranted = 634,
  CapabilityAlreadyExists = 635,
  CapabilityInvalid = 636,
  ColdSignatureTooOld = 1110,
  AmendmentLimitExceeded = 1125,
  BatchDependencyMissing = 1126,
  PauseCooldownActive = 1127,
  NotEmergencySigner = 1128,
  UpgradeUnauthorized = 920,
  UpgradeTimelockActive = 921,
  UpgradeTimelockTooShort = 922,
  UpgradeNotFound = 923,
  UpgradeHashMismatch = 924,
  VetoWindowClosed = 930,
  InvalidStatusTransition = 940,
  VaultPaused = 1020,
  VaultNotPaused = 1021,
  AlreadyAbstained = 910,
  TwapUnavailable = 1210,
  TwapDeviationExceeded = 1211,
  SwapSlippageExceeded = 1212,
  SwapPathInvalid = 1213,
  BatchCommitFailed = 1120,
  BatchApproveTooLarge = 1216,
  ConfigChangeTimelocked = 1221,
  ConfigChangeAckRequired = 1222,
  SafetyFloorViolation = 1223,
  TokenCircuitBreakerTripped = 1224,
  StreamNotActive = 1160,
  VestingNotFound = 1161,
  LockAlreadyActive = 1162,
  VestingCapReached = 1163,
}

/** Broad family used to pick the typed error class. */
export type ContractErrorFamily =
  | "Initialization"
  | "Authorization"
  | "Proposal"
  | "SpendingLimits"
  | "Configuration"
  | "Token"
  | "Whitelist"
  | "Insurance"
  | "Staking"
  | "Delegation"
  | "Capability"
  | "Pause"
  | "Upgrade"
  | "Batch"
  | "Swap"
  | "Streaming"
  | "Other";

const ON_CHAIN_FAMILY: Readonly<Record<number, ContractErrorFamily>> = {
  [ContractErrorCode.AlreadyInitialized]: "Initialization",
  [ContractErrorCode.NotInitialized]: "Initialization",
  [ContractErrorCode.NoSigners]: "Initialization",
  [ContractErrorCode.ThresholdTooLow]: "Configuration",
  [ContractErrorCode.ThresholdTooHigh]: "Configuration",
  [ContractErrorCode.QuorumTooHigh]: "Configuration",
  [ContractErrorCode.QuorumNotReached]: "Proposal",
  [ContractErrorCode.Unauthorized]: "Authorization",
  [ContractErrorCode.NotASigner]: "Authorization",
  [ContractErrorCode.InsufficientRole]: "Authorization",
  [ContractErrorCode.VoterNotInSnapshot]: "Authorization",
  [ContractErrorCode.ProposalNotFound]: "Proposal",
  [ContractErrorCode.ProposalNotPending]: "Proposal",
  [ContractErrorCode.ProposalNotApproved]: "Proposal",
  [ContractErrorCode.ProposalAlreadyExecuted]: "Proposal",
  [ContractErrorCode.ProposalExpired]: "Proposal",
  [ContractErrorCode.ProposalAlreadyCancelled]: "Proposal",
  [ContractErrorCode.DuplicateProposal]: "Proposal",
  [ContractErrorCode.ExecutionWindowExpired]: "Proposal",
  [ContractErrorCode.ProposalExecutionWindowExpired]: "Proposal",
  [ContractErrorCode.AlreadyApproved]: "Proposal",
  [ContractErrorCode.AlreadyAbstained]: "Proposal",
  [ContractErrorCode.VetoWindowClosed]: "Proposal",
  [ContractErrorCode.InvalidStatusTransition]: "Proposal",
  [ContractErrorCode.AmendmentLimitExceeded]: "Proposal",
  [ContractErrorCode.InvalidAmount]: "SpendingLimits",
  [ContractErrorCode.ExceedsProposalLimit]: "SpendingLimits",
  [ContractErrorCode.ExceedsDailyLimit]: "SpendingLimits",
  [ContractErrorCode.ExceedsWeeklyLimit]: "SpendingLimits",
  [ContractErrorCode.InvalidDeadline]: "SpendingLimits",
  [ContractErrorCode.InvalidLedgerRange]: "SpendingLimits",
  [ContractErrorCode.VelocityLimitExceeded]: "SpendingLimits",
  [ContractErrorCode.TimelockNotExpired]: "SpendingLimits",
  [ContractErrorCode.InsufficientBalance]: "Token",
  [ContractErrorCode.SignerAlreadyExists]: "Configuration",
  [ContractErrorCode.SignerNotFound]: "Configuration",
  [ContractErrorCode.CannotAssignHigherRole]: "Configuration",
  [ContractErrorCode.CannotRemoveSigner]: "Configuration",
  [ContractErrorCode.RecipientNotWhitelisted]: "Whitelist",
  [ContractErrorCode.RecipientBlacklisted]: "Whitelist",
  [ContractErrorCode.AddressAlreadyOnList]: "Whitelist",
  [ContractErrorCode.AddressNotOnList]: "Whitelist",
  [ContractErrorCode.WhitelistEntryExpired]: "Whitelist",
  [ContractErrorCode.InsuranceInsufficient]: "Insurance",
  [ContractErrorCode.InsurancePoolInsufficient]: "Insurance",
  [ContractErrorCode.ClaimNotFound]: "Insurance",
  [ContractErrorCode.ClaimNotPending]: "Insurance",
  [ContractErrorCode.ClaimAlreadyVoted]: "Insurance",
  [ContractErrorCode.ClaimSelfVote]: "Insurance",
  [ContractErrorCode.ClaimVotingWindowClosed]: "Insurance",
  [ContractErrorCode.ClaimVotingStillOpen]: "Insurance",
  [ContractErrorCode.ClaimQuorumNotMet]: "Insurance",
  [ContractErrorCode.ClaimAlreadyClosed]: "Insurance",
  [ContractErrorCode.DexError]: "Swap",
  [ContractErrorCode.GasLimitExceeded]: "Swap",
  [ContractErrorCode.TwapUnavailable]: "Swap",
  [ContractErrorCode.TwapDeviationExceeded]: "Swap",
  [ContractErrorCode.SwapSlippageExceeded]: "Swap",
  [ContractErrorCode.SwapPathInvalid]: "Swap",
  [ContractErrorCode.TokenAlreadySupported]: "Token",
  [ContractErrorCode.TokenNotSupported]: "Token",
  [ContractErrorCode.ExceedsTokenDailyLimit]: "Token",
  [ContractErrorCode.ExceedsTokenWeeklyLimit]: "Token",
  [ContractErrorCode.CircularDelegation]: "Delegation",
  [ContractErrorCode.DelegationChainTooLong]: "Delegation",
  [ContractErrorCode.CapabilityNotFound]: "Capability",
  [ContractErrorCode.CapabilityExpired]: "Capability",
  [ContractErrorCode.CapabilityRevoked]: "Capability",
  [ContractErrorCode.CapabilityMaxUsesReached]: "Capability",
  [ContractErrorCode.CapabilityNotGranted]: "Capability",
  [ContractErrorCode.CapabilityAlreadyExists]: "Capability",
  [ContractErrorCode.CapabilityInvalid]: "Capability",
  [ContractErrorCode.ColdSignatureTooOld]: "Authorization",
  [ContractErrorCode.VaultPaused]: "Pause",
  [ContractErrorCode.VaultNotPaused]: "Pause",
  [ContractErrorCode.PauseCooldownActive]: "Pause",
  [ContractErrorCode.NotEmergencySigner]: "Pause",
  [ContractErrorCode.TokenCircuitBreakerTripped]: "Pause",
  [ContractErrorCode.UpgradeUnauthorized]: "Upgrade",
  [ContractErrorCode.UpgradeTimelockActive]: "Upgrade",
  [ContractErrorCode.UpgradeTimelockTooShort]: "Upgrade",
  [ContractErrorCode.UpgradeNotFound]: "Upgrade",
  [ContractErrorCode.UpgradeHashMismatch]: "Upgrade",
  [ContractErrorCode.BatchCommitFailed]: "Batch",
  [ContractErrorCode.BatchDependencyMissing]: "Batch",
  [ContractErrorCode.BatchApproveTooLarge]: "Batch",
  [ContractErrorCode.ConfigChangeTimelocked]: "Configuration",
  [ContractErrorCode.ConfigChangeAckRequired]: "Configuration",
  [ContractErrorCode.SafetyFloorViolation]: "Configuration",
  [ContractErrorCode.StreamNotActive]: "Streaming",
  [ContractErrorCode.VestingNotFound]: "Streaming",
  [ContractErrorCode.LockAlreadyActive]: "Streaming",
  [ContractErrorCode.VestingCapReached]: "Streaming",
};

const LEGACY_CATEGORY_FAMILY: Readonly<Record<ErrorRegistryEntry["category"], ContractErrorFamily>> = {
  Initialization: "Initialization",
  Authorization: "Authorization",
  Proposal: "Proposal",
  SpendingLimits: "SpendingLimits",
  Configuration: "Configuration",
  Token: "Token",
  Recurring: "Streaming",
  Streaming: "Streaming",
  Bridge: "Other",
  Subscription: "Other",
  Escrow: "Other",
  Template: "Other",
  Tag: "Other",
  Staking: "Staking",
  Delegation: "Delegation",
  CommitReveal: "Proposal",
  ColdSignature: "Authorization",
  Pause: "Pause",
  Upgrade: "Upgrade",
  Insurance: "Insurance",
  Dispute: "Other",
  Compliance: "Other",
  Metrics: "Other",
  Batch: "Batch",
  Comment: "Other",
  Capability: "Capability",
  Other: "Other",
};

/** Resolve the error family for a numeric on-chain or legacy SDK code. */
export function contractErrorFamily(code: number): ContractErrorFamily {
  if (Object.prototype.hasOwnProperty.call(ON_CHAIN_FAMILY, code)) {
    return ON_CHAIN_FAMILY[code];
  }
  const legacy = ERROR_REGISTRY[code as VaultErrorCode];
  return legacy ? LEGACY_CATEGORY_FAMILY[legacy.category] : "Other";
}

// ---------------------------------------------------------------------------
// Typed error classes
// ---------------------------------------------------------------------------

/** Common base for all family-specific SDK errors. */
export class TypedVaultError extends VaultError {
  public readonly family: ContractErrorFamily;

  constructor(code: VaultErrorCode | number, message?: string, family?: ContractErrorFamily) {
    super(code as VaultErrorCode, message);
    this.name = new.target.name;
    this.family = family ?? contractErrorFamily(Number(code));
  }
}

export class InitializationError extends TypedVaultError {}
export class AuthorizationError extends TypedVaultError {}
export class ProposalError extends TypedVaultError {}
export class SpendingLimitError extends TypedVaultError {}
export class ConfigurationError extends TypedVaultError {}
export class TokenError extends TypedVaultError {}
export class WhitelistError extends TypedVaultError {}
export class InsuranceError extends TypedVaultError {}
export class StakingError extends TypedVaultError {}
export class DelegationError extends TypedVaultError {}
export class CapabilityError extends TypedVaultError {}
export class PauseError extends TypedVaultError {}
export class UpgradeError extends TypedVaultError {}
export class BatchError extends TypedVaultError {}
export class SwapError extends TypedVaultError {}
export class StreamingError extends TypedVaultError {}

const FAMILY_CLASS: Readonly<
  Record<
    ContractErrorFamily,
    new (
      code: VaultErrorCode | number,
      message?: string,
      family?: ContractErrorFamily
    ) => TypedVaultError
  >
> = {
  Initialization: InitializationError,
  Authorization: AuthorizationError,
  Proposal: ProposalError,
  SpendingLimits: SpendingLimitError,
  Configuration: ConfigurationError,
  Token: TokenError,
  Whitelist: WhitelistError,
  Insurance: InsuranceError,
  Staking: StakingError,
  Delegation: DelegationError,
  Capability: CapabilityError,
  Pause: PauseError,
  Upgrade: UpgradeError,
  Batch: BatchError,
  Swap: SwapError,
  Streaming: StreamingError,
  Other: TypedVaultError,
};

/** Split a PascalCase enum name into a readable description. */
function describeCode(code: number): string {
  const onChainName = (ContractErrorCode as Record<number, string>)[code];
  const legacyName = (VaultErrorCode as Record<number, string>)[code];
  const name = onChainName ?? legacyName;
  if (!name) return `VaultDAO contract error ${code}`;
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

/**
 * Build a typed SDK error from a numeric contract error code.
 *
 * Both on-chain codes and the legacy SDK range are accepted.
 */
export function createContractError(code: number, message?: string): TypedVaultError {
  const family = contractErrorFamily(code);
  const legacy = ERROR_REGISTRY[code as VaultErrorCode];
  const description = message ?? legacy?.description ?? describeCode(code);
  const ErrorClass = FAMILY_CLASS[family];
  return new ErrorClass(code, description, family);
}

/** True when `code` is a recognised on-chain or legacy contract error. */
export function isKnownContractErrorCode(code: number): boolean {
  return (
    Object.prototype.hasOwnProperty.call(ON_CHAIN_FAMILY, code) ||
    Object.prototype.hasOwnProperty.call(ERROR_REGISTRY, code)
  );
}

/**
 * Convert an arbitrary thrown value into a typed vault error when it contains
 * a recognised `Error(Contract, N)` code. Other values are returned unchanged.
 */
export function toTypedVaultError(err: unknown): VaultError | Error {
  if (err instanceof VaultError) {
    // Preserve existing errors exactly so callers can rely on identity checks.
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/Error\(Contract,\s*(\d+)\)/);
  if (match) {
    const code = Number(match[1]);
    if (isKnownContractErrorCode(code)) {
      return createContractError(code);
    }
  }
  return err instanceof Error ? err : new Error(message);
}
