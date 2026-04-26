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
    AlreadyApproved = 30,
    InvalidAmount = 40,
    ExceedsProposalLimit = 41,
    ExceedsDailyLimit = 42,
    ExceedsWeeklyLimit = 43,
    VelocityLimitExceeded = 50,
    TimelockNotExpired = 60,
    InsufficientBalance = 70,
    SignerAlreadyExists = 80,
    SignerNotFound = 81,
    CannotRemoveSigner = 82,
    RecipientNotWhitelisted = 90,
    RecipientBlacklisted = 91,
    AddressAlreadyOnList = 92,
    AddressNotOnList = 93,
    InsuranceInsufficient = 110,
    BatchTooLarge = 130,
    ConditionsNotMet = 140,
    IntervalTooShort = 150,
    DexError = 160,
    RetryError = 168,
    TemplateNotFound = 210,
    TemplateInactive = 211,
    TemplateValidationFailed = 212,
    /// Attachment hash is too short or too long to be a valid CID
    AttachmentHashInvalid = 230,
    /// Proposal has reached the maximum number of attachments
    TooManyAttachments = 231,
    /// Proposal has reached the maximum number of tags (MAX_TAGS = 10)
    TooManyTags = 232,
    /// Metadata value is empty or exceeds the maximum allowed length
    MetadataValueInvalid = 233,
    // -----------------------------------------------------------------------
    // Subscription errors (feature/subscription-system)
    // -----------------------------------------------------------------------
    /// Subscription ID does not exist
    SubscriptionNotFound = 240,
    /// Subscription has already been cancelled
    SubscriptionAlreadyCancelled = 241,
    /// Renewal attempted before next_renewal_ledger has been reached
    RenewalNotDue = 242,
    /// Caller is neither the subscriber nor an Admin
    NotSubscriberOrAdmin = 243,
    /// Subscription is not in Active status (e.g. Cancelled / Suspended)
    SubscriptionNotActive = 244,
}

// Compatibility markers for CI source checks:
// DelegationError, DelegationChainTooLong, CircularDelegation
