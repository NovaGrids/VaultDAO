//! VaultDAO - Error Definitions

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultError {
    // Initialization errors (1xx)
    /// Contract has already been initialized
    AlreadyInitialized = 100,
    /// Contract has not been initialized
    NotInitialized = 101,

    // Authorization errors (2xx)
    /// Caller is not authorized for this action
    Unauthorized = 200,
    /// Caller is not a signer
    NotASigner = 201,
    /// Caller lacks required role
    InsufficientRole = 202,

    // Proposal errors (3xx)
    /// Proposal does not exist
    ProposalNotFound = 300,
    /// Proposal is not in pending status
    ProposalNotPending = 301,
    /// Proposal has already been approved by this signer
    AlreadyApproved = 302,
    /// Proposal has expired
    ProposalExpired = 303,
    /// Proposal is not approved (threshold not met)
    ProposalNotApproved = 304,
    /// Proposal has already been executed
    ProposalAlreadyExecuted = 305,

    // Spending limit errors (4xx)
    /// Amount exceeds per-proposal spending limit
    ExceedsProposalLimit = 400,
    /// Amount would exceed daily spending limit
    ExceedsDailyLimit = 401,
    /// Amount would exceed weekly spending limit
    ExceedsWeeklyLimit = 402,
    /// Amount must be positive
    InvalidAmount = 403,
    /// Proposal is timelocked and cannot be executed yet
    TimelockNotExpired = 404,
    /// Recurring payment interval too short
    IntervalTooShort = 405,

    // Configuration errors (5xx)
    /// Threshold must be at least 1
    ThresholdTooLow = 500,
    /// Threshold cannot exceed number of signers
    ThresholdTooHigh = 501,
    /// Signer already exists
    SignerAlreadyExists = 502,
    /// Signer does not exist
    SignerNotFound = 503,
    /// Cannot remove signer: would make threshold unreachable
    CannotRemoveSigner = 504,
    /// At least one signer is required
    NoSigners = 505,

    // Token errors (6xx)
    /// Token transfer failed
    TransferFailed = 600,
    /// Insufficient vault balance
    InsufficientBalance = 601,

    VelocityLimitExceeded = 120,
    // Condition errors (7xx)
    /// Execution conditions not met
    ConditionsNotMet = 700,
    /// Balance condition not satisfied
    BalanceConditionFailed = 701,
    /// Date condition not satisfied
    DateConditionFailed = 702,
    
    // Recipient list errors (8xx)
    /// Recipient not on whitelist
    RecipientNotWhitelisted = 800,
    /// Recipient is blacklisted
    RecipientBlacklisted = 801,
    /// Address already on list
    AddressAlreadyOnList = 802,
    /// Address not on list
    AddressNotOnList = 803,
    
    // Comment errors (9xx)
    /// Comment text too long
    CommentTooLong = 900,
    /// Not the comment author
    NotCommentAuthor = 901,
    // Initialization
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NoSigners = 3,

    // Threshold / Quorum
    ThresholdTooLow = 4,
    ThresholdTooHigh = 5,
    QuorumTooHigh = 6,

    // Authorization
    Unauthorized = 10,
    NotASigner = 11,
    InsufficientRole = 12,
    VoterNotInSnapshot = 13,

    // Proposal state
    ProposalNotFound = 20,
    ProposalNotPending = 21,
    ProposalNotApproved = 22,
    ProposalAlreadyExecuted = 23,
    ProposalExpired = 24,
    ProposalAlreadyCancelled = 25,
    VotingDeadlinePassed = 26,

    // Voting
    AlreadyApproved = 30,

    // Spending limits
    InvalidAmount = 40,
    ExceedsProposalLimit = 41,
    ExceedsDailyLimit = 42,
    ExceedsWeeklyLimit = 43,

    // Velocity
    VelocityLimitExceeded = 50,

    // Timelock
    TimelockNotExpired = 60,

    // Scheduling - consolidated
    SchedulingError = 61, // Consolidates ExecutionTimeTooEarly, ExecutionTimeInPast, NotScheduled, ExecutionTimeNotReached, CannotCancelNonScheduled

    // Balance
    InsufficientBalance = 70,

    // Signers
    SignerAlreadyExists = 80,
    SignerNotFound = 81,
    CannotRemoveSigner = 82,

    // Recipient lists
    RecipientNotWhitelisted = 90,
    RecipientBlacklisted = 91,
    AddressAlreadyOnList = 92,
    AddressNotOnList = 93,

    // Insurance
    InsuranceInsufficient = 110,

    // Gas
    GasLimitExceeded = 120,

    // Batch
    BatchTooLarge = 130,

    // Conditions
    ConditionsNotMet = 140,

    // Recurring payments
    IntervalTooShort = 150,

    // DEX/AMM - consolidated
    DexNotEnabled = 160,
    DexOperationFailed = 161, // Consolidates SlippageExceeded, PriceImpactExceeded, InvalidSwapParams, InsufficientLiquidity

    // Bridge - consolidated
    BridgeError = 165, // Consolidates BridgeNotConfigured, ChainNotSupported, ExceedsBridgeLimit

    // Retry errors - consolidated
    RetryError = 168, // Consolidates MaxRetriesExceeded, RetryBackoffNotElapsed, RetryNotEnabled

    // Cross-vault errors
    XVaultNotEnabled = 200,

    // Quorum runtime checks
    QuorumNotReached = 8,

    // Template errors
    TemplateNotFound = 210,
    TemplateInactive = 211,
    TemplateValidationFailed = 212,

    // Batch transaction errors (consolidated)
    BatchNotFound = 220,
    BatchNotPending = 221,
    BatchSizeExceeded = 222,
}
