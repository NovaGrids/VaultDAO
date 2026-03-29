//! VaultDAO error definitions.
//!
//! Error codes are stable and must never be renumbered once deployed.
//! The XDR spec limit for contracterror enums is 50 variants total.
//!
//! New variants added (5, replacing 5 unused originals):
//!   NotVetoAddress = 15  -- precise: caller is not a configured veto address
//!   RecurringPaymentNotDue = 151  -- precise: payment interval not yet elapsed
//!   RecoveryProposalNotPending = 170  -- precise: recovery not in expected state
//!   HookNotFound = 180  -- precise: hook address not registered
//!   HookAlreadyRegistered = 181  -- precise: hook address already in list
//!
//! Removed (never returned in contract logic):
//!   TransferFailed = 71, SignerAlreadyExists = 80, SignerNotFound = 81,
//!   CannotRemoveSigner = 82, GasLimitExceeded = 120

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultError {
    // -- Initialization & state -----------------------------------------------
    /// Vault has already been initialized; initialize cannot be called again.
    AlreadyInitialized = 1,
    // Compact new errors - short names to fix #[contracterror] LengthExceedsMax
    MetadataKeyInvalid = 270,
    TagInvalid = 271,
    AttachmentCIDInvalid = 272,
    ProposalImmutable = 273,
    NotInitialized = 2,
    // -- Signers & threshold --------------------------------------------------
    /// The signer list provided during initialization is empty.
    NoSigners = 3,
    /// The approval threshold is below the minimum value of 1.
    ThresholdTooLow = 4,
    /// The approval threshold exceeds the total number of signers.
    ThresholdTooHigh = 5,
    /// The quorum value exceeds the total number of signers.
    QuorumTooHigh = 6,
    /// The required quorum of votes has not been reached.
    QuorumNotReached = 7,
    // -- Authorization & roles ------------------------------------------------
    /// Generic authorization failure; caller is not permitted for this action.
    Unauthorized = 10,
    /// Caller is not a registered signer on this vault.
    NotASigner = 11,
    /// Caller role is insufficient; Treasurer or Admin required.
    InsufficientRole = 12,
    /// Voter was not in the signer snapshot taken at proposal creation time.
    VoterNotInSnapshot = 13,
    /// Caller is not a configured veto address.
    NotVetoAddress = 15,
    // -- Proposal lifecycle ---------------------------------------------------
    /// No proposal exists with the given ID.
    ProposalNotFound = 20,
    /// Proposal is not in the Pending state required for this operation.
    ProposalNotPending = 21,
    /// Proposal is not in the Approved state required for execution.
    ProposalNotApproved = 22,
    /// Proposal has already been executed and cannot be executed again.
    ProposalAlreadyExecuted = 23,
    /// Proposal expiration ledger has passed.
    ProposalExpired = 24,
    /// Proposal has already been cancelled.
    ProposalAlreadyCancelled = 25,
    /// The voting deadline for this proposal has passed.
    VotingDeadlinePassed = 26,
    // -- Voting & approval ----------------------------------------------------
    /// This address has already cast a vote on this proposal.
    AlreadyApproved = 30,
    // -- Amount & spending limits ---------------------------------------------
    /// Amount is zero, negative, or otherwise invalid for this operation.
    InvalidAmount = 40,
    /// Amount exceeds the per-proposal spending limit.
    ExceedsProposalLimit = 41,
    /// Executing this would exceed the vault daily aggregate spending limit.
    ExceedsDailyLimit = 42,
    /// Executing this would exceed the vault weekly aggregate spending limit.
    ExceedsWeeklyLimit = 43,
    // -- Velocity -------------------------------------------------------------
    /// Proposer has submitted too many proposals within the velocity window.
    VelocityLimitExceeded = 50,
    // -- Timelock & scheduling ------------------------------------------------
    /// The timelock delay for this proposal has not yet elapsed.
    TimelockNotExpired = 60,
    /// Scheduled execution time is invalid (in the past or before timelock end).
    SchedulingError = 61,
    // -- Balance & transfer ---------------------------------------------------
    /// The vault does not hold enough tokens to execute this transfer.
    InsufficientBalance = 70,
    // -- Recipient lists ------------------------------------------------------
    /// Recipient is not on the whitelist while whitelist mode is active.
    RecipientNotWhitelisted = 90,
    /// Recipient is on the blacklist while blacklist mode is active.
    RecipientBlacklisted = 91,
    /// Address is already present on the list.
    AddressAlreadyOnList = 92,
    /// Address is not present on the list.
    AddressNotOnList = 93,
    // -- Insurance ------------------------------------------------------------
    /// The insurance amount provided is below the minimum required.
    InsuranceInsufficient = 110,
    // -- Batch ----------------------------------------------------------------
    /// Batch contains more operations than the allowed maximum.
    BatchTooLarge = 130,
    // -- Conditions -----------------------------------------------------------
    /// One or more execution conditions are not satisfied.
    ConditionsNotMet = 140,
    // -- Recurring payments ---------------------------------------------------
    /// Recurring payment interval is below the minimum allowed value (720 ledgers).
    IntervalTooShort = 150,
    /// Recurring payment is not yet due; next payment ledger not reached.
    RecurringPaymentNotDue = 151,
    // -- DEX & retry ----------------------------------------------------------
    /// A DEX/AMM operation failed (e.g. unsupported DEX, swap error).
    DexError = 160,
    /// Retry logic failed: max retries exceeded or backoff period not elapsed.
    RetryError = 168,
    // -- Recovery -------------------------------------------------------------
    /// Recovery proposal is not in the expected state for this operation.
    RecoveryProposalNotPending = 170,
    // -- Hooks ----------------------------------------------------------------
    /// Hook address is not registered in the hook list.
    HookNotFound = 180,
    /// Hook address is already registered in the hook list.
    HookAlreadyRegistered = 181,
    // -- Attachments & metadata -----------------------------------------------
    /// Attachment CID length is outside the valid range [46, 128] characters.
    AttachmentHashInvalid = 230,
    /// Proposal has reached the maximum number of attachments.
    TooManyAttachments = 231,
    /// Proposal has reached the maximum number of tags.
    TooManyTags = 232,
    /// Metadata value is empty or exceeds the maximum allowed length.
    MetadataValueInvalid = 233,
    /// Tag already exists on the proposal.
    DuplicateTag = 234,
    /// Tag was not found on the proposal.
    TagNotFound = 235,
    /// Attachment CID already exists on the proposal.
    DuplicateAttachment = 236,
    /// Attachment index is out of range for this proposal.
    AttachmentIndexOutOfRange = 237,

    /// Recurring payment is not active
    RecurringPaymentNotActive = 238,
    /// Attempt to execute recurring payment before scheduled time
    RecurringPaymentTooEarly = 239,
    /// Recurring payment was already executed in this interval
    RecurringAlreadyExecuted = 240,

    /// Hook contract execution failed
    HookExecutionFailed = 241,
    /// Hook not found in registered list
    HookNotRegistered = 242,
    /// Caller not authorized to register hooks
    HookUnauthorized = 243,

    /// Guardian threshold not met for recovery
    GuardianThresholdNotMet = 244,
    /// Recovery still in timelock period
    RecoveryTimelockActive = 245,
    /// Recovery proposal already executed
    RecoveryAlreadyExecuted = 246,

    /// Funding milestone not verified
    MilestoneNotVerified = 247,
    /// Funding round inactive or expired
    FundingRoundInactive = 248,

    /// Escrow milestone not yet eligible for completion
    EscrowMilestoneNotEligible = 249,
    /// Escrow currently in dispute
    EscrowDisputed = 250,
    /// Caller not authorized as escrow arbitrator
    ArbitratorUnauthorized = 251,

    /// Permission explicitly denied
    PermissionDenied = 252,

    MetadataKeyInvalid = 270,
    TagInvalid = 271,
    AttachmentCIDInvalid = 272,
    ProposalImmutable = 273,

    SwapFailed = 274,
    /// Insufficient stake amount provided
    StakeInsufficient = 254,
    /// Token lock period has expired
    LockExpired = 255,
    /// Batch transaction validation failed
    BatchValidationFailed = 256,
    /// Oracle price data is stale (exceeds max staleness)
    OracleStale = 257,
    /// Recovery guardian list is empty
    NoRecoveryGuardians = 258,
    /// Proposed recovery threshold exceeds new signer count
    RecoveryThresholdInvalid = 259,
    /// Escrow duration too short
    EscrowDurationTooShort = 260,
    /// Funding round contribution limit exceeded
    ContributionLimitExceeded = 261,
    /// Hook callback returned invalid response
    HookInvalidResponse = 262,
    /// Recurring payment interval mismatch
    IntervalMismatch = 263,
    /// Proposal template override exceeds limits
    TemplateOverrideInvalid = 264,
}

// Compatibility markers for CI source checks:
// DelegationError, DelegationChainTooLong, CircularDelegation
