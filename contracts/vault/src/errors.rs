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
    /// The configured quorum exceeds the total number of signers.
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

    // Comments
    NotCommentAuthor = 100,

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

    // DEX/AMM
    DexError = 160,

    // Bridge
    BridgeError = 170,

    // Reputation
    ReputationTooLow = 180,

    // Expiration errors
    ProposalNotExpired = 190,
    GracePeriodNotExpired = 191,
    InvalidExpirationPeriod = 192,
    InvalidGracePeriod = 193,
}
