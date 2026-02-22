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

    // Delegation errors (7xx)
    /// Delegation does not exist
    DelegationNotFound = 700,
    /// Delegation has expired
    DelegationExpired = 701,
    /// Cannot delegate to self
    CannotDelegateToSelf = 702,
    /// Circular delegation detected
    CircularDelegation = 703,
    /// Delegation chain exceeds maximum depth
    DelegationChainTooDeep = 704,
    /// Delegator already has an active delegation
    DelegationAlreadyExists = 705,
    /// Cannot delegate: not a signer
    DelegatorNotSigner = 706,
    /// Cannot delegate to non-signer
    DelegateNotSigner = 707,
}
