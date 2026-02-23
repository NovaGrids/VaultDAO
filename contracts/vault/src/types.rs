//! VaultDAO - Type Definitions
//!
//! Core data structures for the multisig treasury contract.

use soroban_sdk::{contracttype, Address, String, Symbol, Vec};

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

/// Proposal priority level for queue ordering
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Priority {
    Low = 0,
    Normal = 1,
    High = 2,
    Critical = 3,
}

/// Execution condition type
#[contracttype]
#[derive(Clone, Debug)]
pub enum Condition {
    /// Execute only when balance is above threshold
    BalanceAbove(i128),
    /// Execute only after this ledger sequence
    DateAfter(u64),
    /// Execute only before this ledger sequence
    DateBefore(u64),
}

/// Logic for combining multiple conditions
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum ConditionLogic {
    /// All conditions must be true
    And = 0,
    /// At least one condition must be true
    Or = 1,
}

/// Recipient list access mode
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ListMode {
    /// No restriction on recipients
    Disabled,
    /// Only whitelisted recipients are allowed
    Whitelist,
    /// Blacklisted recipients are blocked
    Blacklist,
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
    /// Addresses that explicitly abstained
    pub abstentions: Vec<Address>,
    /// IPFS hashes of supporting documents
    pub attachments: Vec<String>,
    /// Current status
    pub status: ProposalStatus,
    /// Proposal urgency level
    pub priority: Priority,
    /// Execution conditions
    pub conditions: Vec<Condition>,
    /// Logic operator for combining conditions
    pub condition_logic: ConditionLogic,
    /// Ledger sequence when created
    pub created_at: u64,
    /// Ledger sequence when proposal expires
    pub expires_at: u64,
    /// Earliest ledger sequence when proposal can be executed (0 if no timelock)
    pub unlock_ledger: u64,
    /// Insurance amount staked by proposer (0 = no insurance). Held in vault.
    pub insurance_amount: i128,
    /// Flag indicating if this is a swap proposal
    pub is_swap: bool,
}

/// On-chain comment on a proposal
#[contracttype]
#[derive(Clone, Debug)]
pub struct Comment {
    pub id: u64,
    pub proposal_id: u64,
    pub author: Address,
    pub text: Symbol,
    /// Parent comment ID (0 = top-level)
    pub parent_id: u64,
    pub created_at: u64,
    pub edited_at: u64,
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

#[contracttype]
#[derive(Clone, Debug)]
pub struct VelocityConfig {
    /// Maximum number of transfers allowed in the window
    pub limit: u32,
    /// The time window in seconds (e.g., 3600 for 1 hour)
    pub window: u64,
}

// ============================================================================
// Reputation System (Issue: feature/reputation-system)
// ============================================================================

/// Tracks proposer/approver behavior for incentive alignment
#[contracttype]
#[derive(Clone, Debug)]
pub struct Reputation {
    /// Composite score (higher = more trusted)
    pub score: u32,
    /// Total proposals successfully executed
    pub proposals_executed: u32,
    /// Total proposals rejected
    pub proposals_rejected: u32,
    /// Total proposals created
    pub proposals_created: u32,
    /// Total approvals given
    pub approvals_given: u32,
    /// Ledger when reputation was last decayed
    pub last_decay_ledger: u64,
}

impl Reputation {
    pub fn default() -> Self {
        Reputation {
            score: 500, // Start at neutral 500/1000
            proposals_executed: 0,
            proposals_rejected: 0,
            proposals_created: 0,
            approvals_given: 0,
            last_decay_ledger: 0,
        }
    }
}

// ============================================================================
// Insurance System (Issue: feature/proposal-insurance)
// ============================================================================

/// Insurance configuration stored on-chain
#[contracttype]
#[derive(Clone, Debug)]
pub struct InsuranceConfig {
    /// Whether insurance is required for proposals above min_amount
    pub enabled: bool,
    /// Minimum proposal amount that requires insurance (in stroops)
    pub min_amount: i128,
    /// Minimum insurance as basis points of proposal amount (e.g. 100 = 1%)
    pub min_insurance_bps: u32,
    /// Percentage of insurance slashed on rejection (0-100)
    pub slash_percentage: u32,
}

// ============================================================================
// Notification Preferences (Issue: feature/execution-notifications)
// ============================================================================

/// Per-user notification preferences stored on-chain
#[contracttype]
#[derive(Clone, Debug)]
pub struct NotificationPreferences {
    pub notify_on_proposal: bool,
    pub notify_on_approval: bool,
    pub notify_on_execution: bool,
    pub notify_on_rejection: bool,
    pub notify_on_expiry: bool,
}

impl NotificationPreferences {
    pub fn default() -> Self {
        NotificationPreferences {
            notify_on_proposal: true,
            notify_on_approval: true,
            notify_on_execution: true,
            notify_on_rejection: true,
            notify_on_expiry: false,
        }
    }
}

// ============================================================================
// AMM/DEX Integration (Issue: feature/amm-integration)
// ============================================================================

/// DEX configuration for automated trading
#[contracttype]
#[derive(Clone, Debug)]
pub struct DexConfig {
    /// Enabled DEX protocols
    pub enabled_dexs: Vec<Address>,
    /// Maximum slippage tolerance in basis points (e.g., 100 = 1%)
    pub max_slippage_bps: u32,
    /// Maximum price impact in basis points (e.g., 500 = 5%)
    pub max_price_impact_bps: u32,
    /// Minimum liquidity required for swaps
    pub min_liquidity: i128,
}

/// Swap proposal type
#[contracttype]
#[derive(Clone, Debug)]
pub enum SwapProposal {
    /// Simple token swap: (dex, token_in, token_out, amount_in, min_amount_out)
    Swap(Address, Address, Address, i128, i128),
    /// Add liquidity: (dex, token_a, token_b, amount_a, amount_b, min_lp_tokens)
    AddLiquidity(Address, Address, Address, i128, i128, i128),
    /// Remove liquidity: (dex, lp_token, amount, min_token_a, min_token_b)
    RemoveLiquidity(Address, Address, i128, i128, i128),
    /// Stake LP tokens: (farm, lp_token, amount)
    StakeLp(Address, Address, i128),
    /// Unstake LP tokens: (farm, lp_token, amount)
    UnstakeLp(Address, Address, i128),
    /// Claim farming rewards: (farm)
    ClaimRewards(Address),
}

/// DEX operation result
#[contracttype]
#[derive(Clone, Debug)]
pub struct SwapResult {
    pub amount_in: i128,
    pub amount_out: i128,
    pub price_impact_bps: u32,
    pub executed_at: u64,
}
