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

    // Authorization
    Unauthorized = 10,
    NotASigner = 11,
    InsufficientRole = 12,

    // Proposal state
    ProposalNotFound = 20,
    ProposalNotPending = 21,
    ProposalNotApproved = 22,
    ProposalAlreadyExecuted = 23,
    ProposalExpired = 24,

    // Voting
    AlreadyApproved = 30,

    // Spending limits
    InvalidAmount = 40,
    ExceedsProposalLimit = 41,
    ExceedsDailyLimit = 42,
    ExceedsWeeklyLimit = 43,

    // Timelock
    TimelockNotExpired = 60,

    // Permissions
    PermissionDenied = 200,
    PermissionExpired = 201,
}
