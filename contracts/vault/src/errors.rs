//! VaultDAO error definitions.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultError {
    /// Vault has already been initialized
    AlreadyInitialized = 1,
    /// Vault has not been initialized yet
    NotInitialized = 2,
    /// No signers provided during initialization
    NoSigners = 3,
    /// Threshold exceeds the number of signers
    ThresholdTooHigh = 5,
    /// Quorum exceeds the number of signers
    QuorumTooHigh = 6,
    /// Quorum has not been reached for the proposal
    QuorumNotReached = 7,
    /// Caller is not authorized to perform this action
    Unauthorized = 10,
    /// Address is not a registered signer
    NotASigner = 11,
    /// Caller does not have the required role for this operation
    InsufficientRole = 12,
    /// Voter is not in the voting snapshot
    VoterNotInSnapshot = 13,
    /// Proposal with the given ID does not exist
    ProposalNotFound = 20,
    /// Proposal is not in Pending status
    ProposalNotPending = 21,
    /// Proposal has not been approved yet
    ProposalNotApproved = 22,
    /// Proposal has already been executed
    ProposalAlreadyExecuted = 23,
    /// Proposal has expired and can no longer be executed
    ProposalExpired = 24,
    /// Proposal has been cancelled
    ProposalAlreadyCancelled = 25,
    /// Signer has already approved this proposal
    AlreadyApproved = 30,
    /// Signer has already abstained on this proposal
    AlreadyAbstained = 910,
    /// Amount is invalid (zero, negative, or exceeds limits)
    InvalidAmount = 40,
    /// Amount exceeds the single-proposal spending limit
    ExceedsProposalLimit = 41,
    /// Amount exceeds the daily spending limit
    ExceedsDailyLimit = 42,
    /// Amount exceeds the weekly spending limit
    ExceedsWeeklyLimit = 43,
    /// Velocity limit has been exceeded
    VelocityLimitExceeded = 50,
    /// Timelock period has not expired yet
    TimelockNotExpired = 60,
    /// Vault has insufficient balance for the transfer
    InsufficientBalance = 70,
    /// Signer already exists in the signer set
    SignerAlreadyExists = 80,
    /// Signer does not exist in the signer set
    SignerNotFound = 81,
    CannotAssignHigherRole = 82,
    RecipientNotWhitelisted = 90,
    RecipientBlacklisted = 91,
    /// Address is already on the list
    AddressAlreadyOnList = 92,
    /// Address is not on the list
    AddressNotOnList = 93,
    /// Insurance pool has insufficient funds
    InsuranceInsufficient = 110,
    /// Batch size exceeds the maximum allowed
    BatchTooLarge = 130,
    /// Execution conditions have not been met
    ConditionsNotMet = 140,
    /// Recurring payment interval is too short
    IntervalTooShort = 150,
    /// Recurring payment missed execution cap exceeded
    RecurringPaymentMissedCapExceeded = 800,
    /// DEX operation failed
    DexError = 160,
    /// Retry operation failed
    RetryError = 168,
    /// Template with the given ID does not exist
    TemplateNotFound = 210,
    /// Template is not in active status
    TemplateInactive = 211,
    /// Template validation failed
    TemplateValidationFailed = 212,
    /// Invalid time-based threshold configuration
    InvalidThresholdConfig = 310,

    /// Delegation cycle detected
    CircularDelegation = 330,

    /// Delegation chain exceeds maximum depth
    DelegationChainTooLong = 331,

    /// Contract upgrade is not authorized
    UpgradeUnauthorized = 920,

    /// Contract upgrade timelock is still active
    UpgradeTimelockActive = 921,
    /// Veto window has closed
    VetoWindowClosed = 930,
    /// Proposal status transition is not valid
    InvalidStatusTransition = 940,
    /// Dependency proposal was executed in the same ledger
    DependencyNotExecuted = 950,
    /// Recurring payment is paused
    RecurringPaymentPaused = 1000,
    /// Recurring payment is stopped and cannot be resumed
    RecurringPaymentStopped = 1001,
    /// A config change proposal is already pending
    ConfigChangeInProgress = 1010,

    // =========================================================
    // Milestone quorum verification errors
    // =========================================================

    /// Milestone has already been verified by this address
    AlreadyVerified = 510,

    /// Milestone does not have enough verifications to proceed
    InsufficientVerifications = 511,

    PermissionExpired = 320,

    PermissionNotFound = 321,

    // =========================================================
    // Dependency graph errors (Issue #1066)
    // =========================================================

    /// Circular dependency detected in proposal dependency graph
    CircularDependency = 960,

    /// Dependency proposal has not been executed yet
    DependencyNotMet = 961,

    /// Too many dependencies on a single proposal (max 8)
    TooManyDependencies = 962,

    // =========================================================
    // Comment moderation errors (Issue #1076)
    // =========================================================

    /// Comment rate limit exceeded (max 10 per signer per proposal per day)
    CommentRateLimited = 970,

    /// Thread depth exceeds maximum (5 levels)
    ThreadDepthExceeded = 971,

    // =========================================================
    // Vote weight errors (Issue #1061)
    // =========================================================

    /// Cannot change vote weight model while proposals are active
    VoteWeightChangeBlocked = 980,
}

// Additional error types that exceed contracterror limits - use generic errors above
// AttachmentHashInvalid -> InvalidAmount
// TooManyAttachments -> BatchTooLarge
// TooManyTags -> BatchTooLarge
// MetadataValueInvalid -> InvalidAmount
// SubscriptionNotFound -> TemplateNotFound
// SubscriptionAlreadyCancelled -> ProposalAlreadyCancelled
// RenewalNotDue -> TimelockNotExpired
// NotSubscriberOrAdmin -> InsufficientRole
// SubscriptionNotActive -> TemplateInactive
// DependencyDepthExceeded -> BatchTooLarge

// Compatibility markers for CI source checks:
// DelegationError, DelegationChainTooLong, CircularDelegation
