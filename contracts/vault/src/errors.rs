//! VaultDAO - Error Definitions

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultError {
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
}
