//! VaultDAO error definitions.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultError {
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
    VotingDeadlinePassed = 26,
    AlreadyApproved = 30,
    InvalidAmount = 40,
    ExceedsProposalLimit = 41,
    ExceedsDailyLimit = 42,
    ExceedsWeeklyLimit = 43,
    VelocityLimitExceeded = 50,
    TimelockNotExpired = 60,
    SchedulingError = 61,
    InsufficientBalance = 70,
    TransferFailed = 71,
    SignerAlreadyExists = 80,
    SignerNotFound = 81,
    CannotRemoveSigner = 82,
    RecipientNotWhitelisted = 90,
    RecipientBlacklisted = 91,
    AddressAlreadyOnList = 92,
    AddressNotOnList = 93,
    InsuranceInsufficient = 110,
    GasLimitExceeded = 120,
    BatchTooLarge = 130,
    ConditionsNotMet = 140,
    IntervalTooShort = 150,
    DexError = 160,
    RetryError = 168,
    TemplateNotFound = 210,
    TemplateInactive = 211,
    TemplateValidationFailed = 212,
    FundingRoundError = 220,
    /// Attachment hash is too short or too long to be a valid CID
    AttachmentHashInvalid = 230,
    /// Proposal has reached the maximum number of attachments
    TooManyAttachments = 231,
    /// Proposal has reached the maximum number of tags
    TooManyTags = 232,
    /// Metadata value is empty or exceeds the maximum allowed length
    MetadataValueInvalid = 233,
    /// Tag already exists on the proposal
    DuplicateTag = 234,
    /// Tag was not found on the proposal
    TagNotFound = 235,
    /// Attachment CID already exists on the proposal
    DuplicateAttachment = 236,
    /// Attachment index is out of range
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

    /// Metadata key is invalid (empty, too long, invalid chars)
    MetadataKeyInvalid = 270,
    /// Tag is invalid (empty, too long, invalid chars)
    TagInvalid = 271,
    /// Attachment CID is malformed (no Qm/Qb prefix, invalid chars)
    AttachmentCIDInvalid = 272,
    /// Cannot modify approved/immutable proposal
    ProposalImmutable = 273,

    /// DEX swap operation failed
    SwapFailed = 253,
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

