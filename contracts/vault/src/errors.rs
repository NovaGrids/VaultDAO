//! VaultDAO - Error Types
//!
//! Custom error enum for all contract failure cases.

use soroban_sdk::contracterror;

/// Contract error codes
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
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
    AddressAlreadyOnList = 800,
    AddressNotOnList = 801,
    RecipientNotWhitelisted = 802,
    RecipientBlacklisted = 803,

    // Comment errors (9xx)
    CommentTooLong = 900,
    NotCommentAuthor = 901,

    // Batch errors (10xx)
    /// Batch size exceeds the maximum allowed limit
    BatchTooLarge = 1000,

    // Insurance errors (11xx)
    /// Insufficient insurance stake for the proposal amount
    InsuranceInsufficient = 1100,

    // Reputation errors (12xx)
    /// Caller's reputation score is too low to perform this action
    ReputationTooLow = 1200,

    // DEX/AMM errors (13xx)
    /// DEX is not enabled in configuration
    DexNotEnabled = 1300,
    /// Slippage exceeds maximum tolerance
    SlippageExceeded = 1301,
    /// Price impact exceeds maximum tolerance
    PriceImpactExceeded = 1302,
    /// Insufficient liquidity in pool
    InsufficientLiquidity = 1303,
    /// Invalid swap parameters
    InvalidSwapParams = 1304,
    /// DEX operation failed
    DexOperationFailed = 1305,
}
