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
    FundingRoundError = 220,
    // Issue #1064: Streaming Rate Limiter
    StreamRateLimitExceeded = 230,
    StreamDustRejected = 231,
    // Issue #1075: Insurance Claim Governance
    ClaimNotFound = 240,
    ClaimNotPending = 241,
    ClaimAlreadyVoted = 242,
    ClaimSelfVote = 243,
    ClaimVoteDeadlineTooShort = 244,
    ClaimBondInsufficient = 245,
    // Issue #1081: Multi-Token Vault
    TokenAlreadySupported = 250,
    TokenNotSupported = 251,
    TooManyTokens = 252,
    CannotRemoveDefaultToken = 253,
    TokenHasActivePayments = 254,
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
    // Issue #1094: Recipient Whitelist
    // =========================================================

    /// Whitelist entry has expired
    WhitelistEntryExpired = 600,

    // =========================================================
    // Issue #1095: Voting Power Snapshot
    // =========================================================

    /// Proposal has no signers in snapshot (cannot create)
    EmptySignerSnapshot = 610,

    // =========================================================
    // Issue #1096: Multi-Phase Proposals
    // =========================================================

    /// Proposal exceeds maximum allowed phase count (5)
    TooManyPhases = 620,

    /// A phase execution failed
    PhaseExecutionFailed = 621,

    /// Multi-phase proposal not found
    MultiPhaseProposalNotFound = 622,

    // =========================================================
    // Issue #1097: Capability Tokens
    // =========================================================

    /// Capability token not found
    CapabilityNotFound = 630,

    /// Capability token has expired
    CapabilityExpired = 631,

    /// Capability token has been revoked
    CapabilityRevoked = 632,

    /// Capability token max uses reached
    CapabilityMaxUsesReached = 633,

    /// Requested action not covered by capability
    CapabilityNotGranted = 634,

    PermissionNotFound = 321,

    /// Commit phase is closed (past commit_deadline)
    CommitPhaseClosed = 1100,
    /// Reveal phase has not started yet (before commit_deadline)
    RevealPhaseNotStarted = 1101,
    /// Reveal phase is closed (past reveal_deadline)
    RevealPhaseClosed = 1102,
    /// Signer has not committed a vote for this proposal
    CommitNotFound = 1103,
    /// Revealed vote does not match the stored commitment
    CommitmentMismatch = 1104,
    /// Signer has already committed a vote for this proposal
    AlreadyCommitted = 1105,
    /// Tally can only be computed after the reveal deadline
    RevealDeadlineNotPassed = 1106,
    /// This proposal does not use private (commit-reveal) voting
    PrivateVotingNotEnabled = 1107,

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

    // =========================================================
    // Tag/Metadata errors (previously aliased, now explicit)
    // =========================================================

    /// Too many tags on a proposal (max 8 for hierarchical, max 10 for flat)
    TooManyTags = 700,

    /// Tag not found
    TagNotFound = 701,

    /// Metadata value is invalid (empty or too long)
    MetadataValueInvalid = 702,

    /// Audit trail hash chain is broken
    AuditChainBroken = 703,

    // =========================================================
    // Issue #1077: Hierarchical Tag Taxonomy
    // =========================================================

    /// Tag with this name already exists in the same parent scope
    TagAlreadyExists = 710,

    /// Tag has active proposals and cannot be deleted
    TagHasActiveProposals = 711,

    /// Maximum total tag count reached (100 per vault)
    TooManyTagsTotal = 712,

    /// Tag hierarchy exceeds maximum depth (3 levels)
    TagLevelTooDeep = 713,

    // =========================================================
    // Issue #1085: Gas Cost Estimation Oracle
    // =========================================================

    /// Cost model not configured
    CostModelNotFound = 720,

    // =========================================================
    // Issue #1083: Proposal Template with Variable Substitution
    // =========================================================

    /// Required template variable is missing from the provided values
    TemplateVariableMissing = 730,

    /// Too many variables in template (max 10)
    TooManyTemplateVariables = 731,

    /// Template is referenced by active proposals and cannot be deleted
    TemplateHasActiveProposals = 732,

    /// Max template count reached (20 per vault)
    TooManyTemplates = 733,

    // =========================================================
    // Issue #1086: Threshold Signature Scheme (Cold Storage)
    // =========================================================

    /// Cold signature is invalid (Ed25519 verification failed)
    InvalidColdSignature = 740,

    /// Cold signature has already been submitted (replay prevention)
    ColdSignatureAlreadySubmitted = 741,

    /// Cold signature has expired
    ColdSignatureExpired = 742,

    /// Address is not a registered cold signer
    NotAColdSigner = 743,

    /// Cold signer configuration not set
    ColdSignerConfigNotSet = 744,

    /// Max cold signer count reached (5)
    TooManyColdSigners = 745,
}

// Compatibility markers for CI source checks:
// DelegationError, DelegationChainTooLong, CircularDelegation
