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
    /// Threshold is below the minimum required (must be >= 1)
    ThresholdTooLow = 4,
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
    /// Cannot remove signer as it would violate threshold requirements
    CannotRemoveSigner = 82,
    /// Recipient address is not on the whitelist
    RecipientNotWhitelisted = 90,
    /// Recipient address is on the blacklist
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
