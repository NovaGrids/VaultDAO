//! VaultDAO - Type Definitions
//!
//! Core data structures for the multisig treasury contract.

use soroban_sdk::{contracttype, Address, Symbol, Vec};

/// Initialization configuration - groups all config params to reduce function arguments
#[contracttype]
#[derive(Clone, Debug)]
pub struct InitConfig {
    /// List of authorized signers
    pub signers: Vec<Address>,
    /// Required number of approvals (M in M-of-N)
    pub threshold: u32,
    /// Maximum amount per proposal (in stroops)
    pub spending_limit: i128,
    /// Maximum aggregate daily spending (in stroops)
    pub daily_limit: i128,
    /// Maximum aggregate weekly spending (in stroops)
    pub weekly_limit: i128,
    /// Amount threshold above which a timelock applies
    pub timelock_threshold: i128,
    /// Delay in ledgers for timelocked proposals
    pub timelock_delay: u64,
    pub velocity_limit: VelocityConfig,
    /// Threshold strategy configuration
    pub threshold_strategy: ThresholdStrategy,
}

/// Vault configuration
#[contracttype]
#[derive(Clone, Debug)]
pub struct Config {
    /// List of authorized signers
    pub signers: Vec<Address>,
    /// Required number of approvals (M in M-of-N)
    pub threshold: u32,
    /// Maximum amount per proposal (in stroops)
    pub spending_limit: i128,
    /// Maximum aggregate daily spending (in stroops)
    pub daily_limit: i128,
    /// Maximum aggregate weekly spending (in stroops)
    pub weekly_limit: i128,
    /// Amount threshold above which a timelock applies
    pub timelock_threshold: i128,
    /// Delay in ledgers for timelocked proposals
    pub timelock_delay: u64,
    pub velocity_limit: VelocityConfig,
    /// Threshold strategy configuration
    pub threshold_strategy: ThresholdStrategy,
}

/// Threshold strategy for dynamic approval requirements
#[contracttype]
#[derive(Clone, Debug)]
pub enum ThresholdStrategy {
    /// Fixed threshold (original behavior)
    Fixed,
    /// Percentage-based: threshold = ceil(signers * percentage / 100)
    Percentage(u32),
    /// Amount-based tiers: (amount_threshold, required_approvals)
    AmountBased(Vec<AmountTier>),
    /// Time-based: threshold reduces after time passes
    TimeBased(TimeBasedThreshold),
}

/// Amount-based threshold tier
#[contracttype]
#[derive(Clone, Debug)]
pub struct AmountTier {
    /// Amount threshold for this tier
    pub amount: i128,
    /// Required approvals for this tier
    pub approvals: u32,
}

/// Time-based threshold configuration
#[contracttype]
#[derive(Clone, Debug)]
pub struct TimeBasedThreshold {
    /// Initial threshold
    pub initial_threshold: u32,
    /// Reduced threshold after delay
    pub reduced_threshold: u32,
    /// Ledgers to wait before reduction
    pub reduction_delay: u64,
}

/// Permissions assigned to vault participants.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Role {
    /// Read-only access (default for non-signers).
    Member = 0,
    /// Authorized to initiate and approve transfer proposals.
    Treasurer = 1,
    /// Full operational control: manages roles, signers, and configuration.
    Admin = 2,
}

/// The lifecycle states of a proposal.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum ProposalStatus {
    /// Initial state, awaiting more approvals.
    Pending = 0,
    /// Voting threshold met. Ready for execution (checked against timelocks).
    Approved = 1,
    /// Funds successfully transferred and record finalized.
    Executed = 2,
    /// Manually cancelled by an admin or the proposer.
    Rejected = 3,
    /// Reached expiration ledger without hitting the approval threshold.
    Expired = 4,
}

/// Transfer proposal
#[contracttype]
#[derive(Clone, Debug)]
pub struct Proposal {
    /// Unique proposal ID
    pub id: u64,
    /// Address that created the proposal
    pub proposer: Address,
    /// Recipient of the transfer
    pub recipient: Address,
    /// Token contract address (SAC or custom)
    pub token: Address,
    /// Amount to transfer (in token's smallest unit)
    pub amount: i128,
    /// Optional memo/description
    pub memo: Symbol,
    /// Addresses that have approved
    pub approvals: Vec<Address>,
    /// Current status
    pub status: ProposalStatus,
    /// Ledger sequence when created
    pub created_at: u64,
    /// Ledger sequence when proposal expires
    pub expires_at: u64,
    /// Earliest ledger sequence when proposal can be executed (0 if no timelock)
    pub unlock_ledger: u64,
}

/// Recurring payment schedule
#[contracttype]
#[derive(Clone, Debug)]
pub struct RecurringPayment {
    pub id: u64,
    pub proposer: Address,
    pub recipient: Address,
    pub token: Address,
    pub amount: i128,
    pub memo: Symbol,
    /// Interval in ledgers (e.g., 172800 for ~1 week)
    pub interval: u64,
    /// Next scheduled execution ledger
    pub next_payment_ledger: u64,
    /// Total payments made so far
    pub payment_count: u32,
    /// Configured status (Active/Stopped)
    pub is_active: bool,
}

// Add this new struct to types.rs
#[contracttype]
#[derive(Clone, Debug)]
pub struct VelocityConfig {
    /// Maximum number of transfers allowed in the window
    pub limit: u32,
    /// The time window in seconds (e.g., 3600 for 1 hour)
    pub window: u64,
}

/// Emergency pause state for the vault
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum PauseState {
    /// Vault is operational
    Active = 0,
    /// Vault operations are frozen
    Paused = 1,
}

/// Information about the current pause state
#[contracttype]
#[derive(Clone, Debug)]
pub struct PauseInfo {
    /// Current pause state
    pub state: PauseState,
    /// Address that triggered the pause
    pub pauser: Address,
    /// Reason for pause (stored as symbol)
    pub reason: Symbol,
    /// Ledger timestamp when paused
    pub paused_at: u64,
    /// Current unpause vote count
    pub unpause_votes: u32,
    /// Ledger when unpause voting started (0 if not voting)
    pub voting_started_at: u64,
}

/// A record of pause/unpause history
#[contracttype]
#[derive(Clone, Debug)]
pub struct PauseHistoryEntry {
    /// Whether this was a pause (true) or unpause (false)
    pub is_pause: bool,
    /// Address that triggered the action
    pub actor: Address,
    /// Reason for the action
    pub reason: Symbol,
    /// Ledger timestamp
    pub timestamp: u64,
}

/// Recipient list mode for whitelist/blacklist functionality
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum ListMode {
    /// No restrictions on recipients
    Disabled = 0,
    /// Only whitelisted addresses can receive funds
    Whitelist = 1,
    /// Blacklisted addresses cannot receive funds
    Blacklist = 2,
}

/// Comment on a proposal
#[contracttype]
#[derive(Clone, Debug)]
pub struct Comment {
    /// Unique comment ID
    pub id: u64,
    /// Proposal this comment belongs to
    pub proposal_id: u64,
    /// Author of the comment
    pub author: Address,
    /// Comment text
    pub text: Symbol,
    /// Parent comment ID (0 if top-level)
    pub parent_id: u64,
    /// Ledger when created
    pub created_at: u64,
    /// Ledger when last edited (0 if never edited)
    pub edited_at: u64,
}
