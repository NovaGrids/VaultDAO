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
    AlreadyInitialized = 100,
    NotInitialized = 101,

    // Authorization errors (2xx)
    Unauthorized = 200,
    NotASigner = 201,
    InsufficientRole = 202,

    // Proposal errors (3xx)
    ProposalNotFound = 300,
    ProposalNotPending = 301,
    AlreadyApproved = 302,
    ProposalExpired = 303,
    ProposalNotApproved = 304,
    ProposalAlreadyExecuted = 305,

    // Spending limit errors (4xx)
    ExceedsProposalLimit = 400,
    ExceedsDailyLimit = 401,
    ExceedsWeeklyLimit = 402,
    InvalidAmount = 403,
    TimelockNotExpired = 404,
    IntervalTooShort = 405,
    VelocityLimitExceeded = 406,

    // Configuration errors (5xx)
    ThresholdTooLow = 500,
    ThresholdTooHigh = 501,
    SignerAlreadyExists = 502,
    SignerNotFound = 503,
    CannotRemoveSigner = 504,
    NoSigners = 505,

    // Token errors (6xx)
    TransferFailed = 600,
    InsufficientBalance = 601,

    // Condition errors (7xx)
    ConditionsNotMet = 700,

    // Recipient list errors (8xx)
    AddressAlreadyOnList = 800,
    AddressNotOnList = 801,
    RecipientNotWhitelisted = 802,
    RecipientBlacklisted = 803,

    // Comment errors (9xx)
    CommentTooLong = 900,
    NotCommentAuthor = 901,

    // Batch errors (10xx)
    BatchTooLarge = 1000,

    // Insurance errors (11xx)
    InsuranceInsufficient = 1100,

    // Reputation errors (12xx)
    ReputationTooLow = 1200,

    // DEX/AMM errors (13xx)
    DexNotEnabled = 1300,
    SlippageExceeded = 1301,
    PriceImpactExceeded = 1302,
    InsufficientLiquidity = 1303,
    InvalidSwapParams = 1304,

    // Bridge errors (14xx)
    BridgeNotConfigured = 1400,
    ChainNotSupported = 1401,
    ExceedsBridgeLimit = 1402,

    // Oracle errors (15xx)
    OracleNotConfigured = 1500,
    PriceFeedStale = 1501,
    InsufficientOracleSources = 1502,
}

