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
    /// Velocity limit exceeded
    VelocityLimitExceeded = 602,

    // Condition errors (7xx)
    /// Execution conditions not met
    ConditionsNotMet = 700,

    // Recipient list errors (8xx)
    /// Address list error (already on list, not on list, or not allowed)
    AddressListError = 800,

    // Comment errors (9xx)
    /// Comment error (too long or not author)
    CommentError = 900,

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
    /// DEX configuration or operation error
    DexError = 1300,

    // Bridge errors (14xx)
    /// Bridge configuration or chain not supported
    BridgeConfigError = 1400,
    /// Amount exceeds bridge limit
    ExceedsBridgeLimit = 1401,

    // Recovery errors (15xx)
    /// Guardian already exists
    GuardianAlreadyExists = 1500,
    /// Guardian not found
    GuardianNotFound = 1501,
    /// Not enough guardians (minimum 2 required)
    InsufficientGuardians = 1502,
    /// Too many guardians (maximum 10)
    TooManyGuardians = 1503,
    /// Guardian threshold invalid
    InvalidGuardianThreshold = 1504,
    /// Not an active guardian
    NotAGuardian = 1505,
    /// Recovery proposal not found
    RecoveryProposalNotFound = 1506,
    /// Active recovery proposal already exists
    ActiveRecoveryExists = 1507,
    /// Recovery proposal not approved
    RecoveryNotApproved = 1508,
    /// Recovery time delay not expired
    RecoveryTimelockActive = 1509,
    /// Recovery proposal has expired
    RecoveryExpired = 1510,
    /// Guardian already approved this recovery
    GuardianAlreadyApproved = 1511,
    /// Invalid recovery state or transition
    InvalidRecoveryState = 1512,
}
