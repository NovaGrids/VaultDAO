//! VaultDAO - Type Definitions
//!
//! Core data structures for the multisig treasury contract.
//!
//! # Gas Optimization Notes
//!
//! This module implements several gas optimization techniques:
//!
//! 1. **Type Size Optimization**: Using smaller integer types (u32 instead of u64) where
//!    values won't exceed the smaller type's range. This reduces storage and serialization costs.
//!
//! 2. **Storage Packing**: Related fields are grouped in `Packed*` structs to minimize
//!    the number of storage operations. A single storage read/write is cheaper than multiple.
//!
//! 3. **Lazy Loading**: Large optional fields (attachments, conditions) are stored separately
//!    to avoid paying for their serialization when not needed.
//!
//! 4. **Bit Packing**: Boolean flags are combined into a single u8 bitfield where possible.

use soroban_sdk::{contracttype, Address, Env, Map, String, Symbol, Vec};

#[path = "types_balance_snapshot.rs"]
mod types_balance_snapshot;
use types_balance_snapshot::BalanceSnapshot;

/// Oracle configuration for price feeds
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VaultOracleConfig {
    /// Address of the oracle contract
    pub address: Address,
    /// Asset symbol for the base currency (e.g., USD)
    pub base_symbol: Symbol,
    /// Maximum ledgers before price is considered stale
    pub max_staleness: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OptionalVaultOracleConfig {
    None,
    Some(VaultOracleConfig),
}

/// Price data from an oracle
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VaultPriceData {
    pub price: i128,
    pub timestamp: u64,
}

/// Initialization configuration - groups all config params to reduce function arguments
#[contracttype]
#[derive(Clone, Debug)]
pub struct InitConfig {
    /// List of authorized signers
    pub signers: Vec<Address>,
    /// Required number of approvals (M in M-of-N)
    pub threshold: u32,
    /// Minimum number of votes (approvals + abstentions) required before threshold is checked.
    /// Set to 0 to disable quorum enforcement.
    pub quorum: u32,
    /// Quorum as a percentage of total signers (1-100). Ignored when quorum > 0.
    pub quorum_percentage: u32,
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
    /// Pre-execution hooks
    pub pre_execution_hooks: Vec<Address>,
    /// Post-execution hooks
    pub post_execution_hooks: Vec<Address>,
    /// Default voting deadline in ledgers (0 = no deadline)
    pub default_voting_deadline: u64,
    /// Addresses allowed to veto proposals.
    pub veto_addresses: Vec<Address>,
    /// Veto window in ledgers after proposal creation (0 = veto disabled)
    pub veto_window_ledgers: u64,
    /// Retry configuration for failed executions
    pub retry_config: RetryConfig,
    /// Recovery configuration
    pub recovery_config: RecoveryConfig,
    pub staking_config: StakingConfig,
    /// Proposal ID namespace prefix for multi-vault coordination (must be multiple of 1_000_000)
    pub proposal_id_prefix: u64,
    /// Whether recipient whitelist enforcement is enabled (issue #1094)
    pub whitelist_mode: bool,
    /// Grace period in ledgers after voting deadline before auto-expiry (default: 100)
    pub grace_period_ledgers: u64,
    /// Vote weight model: Flat, TokenWeighted, or Quadratic
    pub vote_weight: VoteWeight,
}

/// Vault configuration
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    /// List of authorized signers
    pub signers: Vec<Address>,
    /// Per-signer unilateral spending authority.
    pub signer_tiers: Map<Address, SignerTier>,
    /// Amounts above this threshold require approval from every signer.
    /// A value of zero disables the override.
    pub full_quorum_threshold: i128,
    /// Required number of approvals (M in M-of-N)
    pub threshold: u32,
    /// Minimum number of votes (approvals + abstentions) required before threshold is checked.
    /// Set to 0 to disable quorum enforcement.
    pub quorum: u32,
    /// Quorum requirement as a percentage of total signers.
    pub quorum_percentage: u32,
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
    /// Pre-execution hooks
    pub pre_execution_hooks: Vec<Address>,
    /// Post-execution hooks
    pub post_execution_hooks: Vec<Address>,
    /// Default voting deadline in ledgers (0 = no deadline)
    pub default_voting_deadline: u64,
    /// Addresses allowed to veto proposals.
    pub veto_addresses: Vec<Address>,
    /// Veto window in ledgers after proposal creation (0 = veto disabled)
    pub veto_window_ledgers: u64,
    /// Retry configuration for failed executions
    pub retry_config: RetryConfig,
    /// Recovery configuration
    pub recovery_config: RecoveryConfig,
    pub staking_config: StakingConfig,
    /// Proposal ID namespace prefix for multi-vault coordination
    pub proposal_id_prefix: u64,
    /// Whether recipient whitelist enforcement is enabled (issue #1094)
    pub whitelist_mode: bool,
    /// Grace period in ledgers after voting deadline before auto-expiry (default: 100)
    pub grace_period_ledgers: u64,
    /// Vote weight model: Flat, TokenWeighted, or Quadratic
    pub vote_weight: VoteWeight,
}

/// Audit record for a cancelled proposal
#[contracttype]
#[derive(Clone, Debug)]
pub struct CancellationRecord {
    pub proposal_id: u64,
    pub cancelled_by: Address,
    pub reason: Symbol,
    pub cancelled_at_ledger: u64,
    pub refunded_amount: i128,
}

/// Audit record for a proposal amendment
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProposalAmendment {
    pub proposal_id: u64,
    pub amended_by: Address,
    pub amended_at_ledger: u64,
    pub old_recipient: Address,
    pub new_recipient: Address,
    pub old_amount: i128,
    pub new_amount: i128,
    pub old_memo: Symbol,
    pub new_memo: Symbol,
}

/// Threshold strategy for dynamic approval requirements
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
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

/// Voting strategy used to determine whether a proposal has enough voting power.
#[contracttype]
#[derive(Clone, Debug)]
pub enum VotingStrategy {
    /// Original behavior: approval count must satisfy threshold strategy.
    Simple,
    /// Token-weighted voting (simplified)
    Weighted,
    /// Quadratic voting (simplified)
    Quadratic,
    /// Conviction voting (simplified)
    Conviction,
}

/// Vote weight model for threshold calculations.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum VoteWeight {
    /// 1 vote per signer regardless of token balance.
    Flat = 0,
    /// Vote weight equals raw token balance.
    TokenWeighted = 1,
    /// Vote weight equals floor(sqrt(token_balance)). Zero balance counts as 1.
    Quadratic = 2,
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
#[derive(Clone, Debug, Eq, PartialEq)]
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
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Role {
    /// Read-only access for external auditors (passes no permission checks).
    Observer = 0,
    /// Read-only access (default for non-signers).
    Member = 1,
    /// Authorized to initiate and approve transfer proposals.
    Treasurer = 2,
    /// Full operational control: manages roles, signers, and configuration.
    Admin = 3,
    /// Can resolve disputes.
    DisputeArbitrator = 4,
}

impl Role {
    /// Check whether `actual` satisfies the `required` role.
    /// Hierarchy: Admin >= Treasurer >= Member >= Observer
    /// Special case: Admin and DisputeArbitrator can resolve disputes
    pub fn role_satisfies(required: Role, actual: Role) -> bool {
        match (required, actual) {
            (Role::DisputeArbitrator, Role::Admin) => true,
            (Role::DisputeArbitrator, Role::DisputeArbitrator) => true,
            _ => (actual as u32) >= (required as u32),
        }
    }
}

/// Address-role pair returned by role enumeration queries.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoleAssignment {
    pub addr: Address,
    pub role: Role,
}

/// Granular permissions for fine-grained access control
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Permission {
    CreateProposal = 0,
    ApproveProposal = 1,
    ExecuteProposal = 2,
    CancelProposal = 3,
    ManageRoles = 4,
    ManageSigners = 5,
    ManageConfig = 6,
    ManageRecurring = 7,
    ManageLists = 8,
    ManageTemplates = 9,
    ManageEscrow = 10,
    ManageSubscriptions = 11,
    ViewMetrics = 12,
    ManageRecovery = 13,
}

/// Permission grant with optional expiry
#[contracttype]
#[derive(Clone, Debug)]
pub struct PermissionGrant {
    pub permission: Permission,
    pub granted_by: Address,
    pub granted_at: u64,
    pub expires_at: Option<u64>,
}

/// Delegated permission with expiry
#[contracttype]
#[derive(Clone, Debug)]
pub struct DelegatedPermission {
    pub permission: Permission,
    pub delegator: Address,
    pub delegatee: Address,
    pub granted_at: u64,
    pub expires_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Delegation {
    pub delegator: Address,
    pub delegate: Address,
    pub created_at: u64,
    pub expiry_ledger: u64,
    pub is_active: bool,
    /// Number of delegation hops from this signer to the final delegate.
    pub chain_depth: u8,
}

/// Per-signer authority for unilateral treasury transfers.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SignerTier {
    Junior(i128),
    Senior(i128),
    /// Principals deliberately have no unilateral spending authority.
    Principal,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DelegationHistory {
    pub id: u64,
    pub delegator: Address,
    pub previous_delegate: Address,
    pub new_delegate: Address,
    pub changed_at: u64,
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
    /// Cancelled by proposer or admin, with spending refunded.
    Cancelled = 5,
    /// Approved and scheduled for future execution at a specific time.
    Scheduled = 6,
    /// Vetoed by a veto address
    Vetoed = 7,
}

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum VoteChoice {
    Approve = 0,
    Abstain = 1,
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
    /// Execute only when asset price is above threshold (in USD)
    PriceAbove(Address, i128),
    /// Execute only when asset price is below threshold (in USD)
    PriceBelow(Address, i128),
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
    /// More than half of conditions must be true
    Majority = 2,
    /// Always passes regardless of conditions (used when conditions vec is empty)
    None = 3,
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
/// Parameters for a scheduled transfer proposal.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ScheduledTransferConfig {
    /// Ledger sequence at which the proposal becomes executable
    pub execution_time: u64,
    /// Number of ledgers after execution_time within which execution is valid (0 = no upper bound)
    pub execution_window_ledgers: u64,
}

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
    /// Extensible metadata map for proposal context and integration tags
    pub metadata: Map<Symbol, String>,
    /// Optional categorical labels for proposal filtering
    pub tags: Vec<Symbol>,
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
    /// Optional scheduled execution time (ledger number) for delayed execution
    pub execution_time: Option<u64>,
    /// Execution window in ledgers after execution_time (0 = no upper bound)
    pub execution_window_ledgers: u64,
    /// Insurance amount staked by proposer (0 = no insurance). Held in vault.
    pub insurance_amount: i128,
    /// Stake amount locked by proposer (0 = no stake). Held in vault.
    pub stake_amount: i128,
    /// Gas (CPU instruction) limit for execution (0 = use global config default)
    pub gas_limit: u64,
    /// Estimated gas used during execution (populated on execution)
    pub gas_used: u64,
    /// Ledger sequence at which signers were snapshotted for this proposal
    pub snapshot_ledger: u64,
    /// Voting power snapshot — addresses eligible to vote at creation time
    pub snapshot_signers: Vec<Address>,
    /// Proposal IDs that must be executed before this proposal can execute
    pub depends_on: Vec<u64>,
    /// Flag indicating if this is a swap proposal
    pub is_swap: bool,
    /// Ledger sequence when voting must complete (0 = no deadline)
    pub voting_deadline: u64,
    /// Ledger sequence when this proposal was executed (0 = not yet executed)
    pub execution_ledger: u64,
    /// Voting power snapshot at proposal creation: signer -> voting_power
    /// Used by vote_on_proposal to prevent vote-buying attacks
    pub signer_snapshot: Map<Address, i128>,
}

/// Represents a grouped batch of proposals for atomic execution.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BatchTransaction {
    pub id: u64,
    pub proposal_ids: Vec<u64>,
    pub creator: Address,
    pub status: BatchStatus,
    pub created_at: u64,
    pub executed_count: u32,
    pub failed_count: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum BatchStatus {
    Pending = 0,
    Executing = 1,
    Completed = 2,
    RolledBack = 3,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct BatchExecutionResult {
    pub executed_count: u32,
    pub failed_count: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub enum BatchOperation {
    Transfer(u64), // proposal id
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

/// Status of a recurring payment
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum RecurringStatus {
    /// Payment is active and will execute on schedule
    Active = 0,
    /// Payment is temporarily paused; duration does not count toward schedule
    Paused = 1,
    /// Payment has been permanently stopped and cannot be resumed
    Stopped = 2,
}

/// How a recurring payment due on a non-business ledger is adjusted.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HolidayBehavior {
    PayEarly,
    PayLate,
}

/// Sorted list of administratively maintained holiday ledgers.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HolidayCalendar {
    pub holiday_ledgers: Vec<u64>,
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
    /// Configured status (Active/Paused/Stopped)
    pub status: RecurringStatus,
    /// Maximum missed payments to catch up (0 = unlimited)
    pub max_missed_payments: u32,
    /// Ledger at which the payment was paused (0 = not paused)
    pub paused_at_ledger: u64,
    /// Whether holiday/weekend adjustment is enabled.
    pub skip_holidays: bool,
    /// Direction used when the scheduled ledger is not a business ledger.
    pub holiday_behavior: HolidayBehavior,
}

/// On-chain token vesting schedule.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VestingSchedule {
    pub id: u64,
    pub beneficiary: Address,
    pub token: Address,
    pub total: i128,
    pub cliff_ledger: u32,
    pub start_ledger: u32,
    pub end_ledger: u32,
    pub claimed: i128,
    pub cancelled: bool,
}

// ============================================================================
// Streaming Payments (Issue: feature/streaming-payments)
// ============================================================================

/// Status of a token stream
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum StreamStatus {
    /// Stream is active and accumulating claimable tokens
    Active = 0,
    /// Stream is paused; no tokens accumulate until resumed
    Paused = 1,
    /// Stream was cancelled; any remaining tokens returned to sender
    Cancelled = 2,
    /// Stream has reached its end time and all tokens are claimed
    Completed = 3,
}

/// Continuous token transfer over time
#[contracttype]
#[derive(Clone, Debug)]
pub struct StreamingPayment {
    /// Unique stream ID
    pub id: u64,
    /// Address that created and funded the stream
    pub sender: Address,
    /// Address receiving the tokens
    pub recipient: Address,
    /// Token contract address
    pub token_addr: Address,
    /// Tokens per second (scaled to token decimals)
    pub rate: i128,
    /// Total amount committed to the stream
    pub total_amount: i128,
    /// Total amount already claimed by recipient
    pub claimed_amount: i128,
    /// Ledger timestamp when the stream was created
    pub start_timestamp: u64,
    /// Ledger timestamp when the stream will finish
    pub end_timestamp: u64,
    /// Ledger timestamp of the last status update or claim
    pub last_update_timestamp: u64,
    /// Total active seconds accumulated before the last pause
    pub accumulated_seconds: u64,
    /// Current status
    pub status: StreamStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VelocityConfig {
    /// Maximum number of transfers allowed in the window (global per proposer)
    pub limit: u32,
    /// The time window in seconds (e.g., 3600 for 1 hour)
    pub window: u64,
    /// Maximum transfers per token per proposer in the window (0 = disabled)
    pub per_token_limit: u32,
}

/// Audit action types
// ============================================================================
// Reputation System (Issue: feature/reputation-system)
// ============================================================================

/// Admin-configurable parameters for reputation decay.
///
/// Decay formula (integer approximation):
///   score = max(decay_min_score, score * 0.5 ^ (ledgers_since_last / half_life))
///
/// The exponent is computed as the number of complete half-life periods elapsed.
/// Each period halves the distance between the current score and `decay_min_score`.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReputationConfig {
    /// Number of ledgers that constitute one half-life (~30 days default).
    /// Must be > 0; a value of 0 disables decay entirely.
    pub decay_half_life_ledgers: u64,
    /// Floor score that decay can never push below (0–1000).
    pub decay_min_score: u32,
}

impl Default for ReputationConfig {
    fn default() -> Self {
        ReputationConfig {
            // ~30 days at 5 s/ledger
            decay_half_life_ledgers: 17_280 * 30,
            decay_min_score: 100,
        }
    }
}

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
    /// Total abstentions recorded
    pub abstentions_given: u32,
    /// Total governance votes cast (approvals + abstentions)
    pub participation_count: u32,
    /// Ledger when the signer last cast a governance vote
    pub last_participation_ledger: u64,
    /// Ledger when reputation was last decayed
    pub last_decay_ledger: u64,
}

impl Default for Reputation {
    fn default() -> Self {
        Reputation {
            score: 500, // Start at neutral 500/1000
            proposals_executed: 0,
            proposals_rejected: 0,
            proposals_created: 0,
            approvals_given: 0,
            abstentions_given: 0,
            participation_count: 0,
            last_participation_ledger: 0,
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

impl Default for NotificationPreferences {
    fn default() -> Self {
        NotificationPreferences {
            notify_on_proposal: true,
            notify_on_approval: true,
            notify_on_execution: true,
            notify_on_rejection: true,
            notify_on_expiry: false,
        }
    }
}

/// Rich per-signer notification preferences for on-chain subscriber filtering.
///
/// Stored in Instance storage (hot path) keyed by `signer` address so indexers
/// can selectively push events without polling every signer off-chain.
///
/// Constraints:
/// - `subscribed_events`: at most 20 Symbol entries (e.g. `"proposal_created"`)
/// - `quiet_hours_*`: ledger offset 0–1440 (one 24 h cycle at 5 s/ledger)
///   Signers are excluded from `relevant_signers` while in their quiet window.
#[contracttype]
#[derive(Clone, Debug)]
pub struct NotificationPrefs {
    /// Address whose preferences these are; also the storage key.
    pub signer: Address,
    /// Event type names the signer subscribes to (max 20).
    pub subscribed_events: Vec<Symbol>,
    /// Only notify if proposal amount >= this value (0 = no threshold).
    pub min_amount_threshold: i128,
    /// Start of the quiet window (inclusive), as offset 0–1440 within a day.
    pub quiet_hours_start: u32,
    /// End of the quiet window (exclusive), as offset 0–1440 within a day.
    pub quiet_hours_end: u32,
}

// ============================================================================
// Gas Limits (Issue: feature/gas-limits)
// ============================================================================

/// Per-vault gas (CPU instruction budget) configuration
#[contracttype]
#[derive(Clone, Debug)]
pub struct GasConfig {
    /// Whether gas limiting is enforced
    pub enabled: bool,
    /// Default gas limit applied to new proposals (0 = unlimited)
    pub default_gas_limit: u64,
    /// Base cost charged per execution
    pub base_cost: u64,
    /// Extra cost per execution condition
    pub condition_cost: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StakingConfig {
    pub enabled: bool,
    pub min_amount: i128,
    pub base_stake_bps: u32,
    pub max_stake_amount: i128,
    pub reputation_discount_threshold: u32,
    pub reputation_discount_percentage: u32,
    pub slash_percentage: u32,
    pub compound_lock_period: u64,
    pub compound_epoch: u64,
}

impl Default for StakingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            min_amount: 0,
            base_stake_bps: 100,
            max_stake_amount: i128::MAX,
            reputation_discount_threshold: 900,
            reputation_discount_percentage: 0,
            slash_percentage: 50,
            compound_lock_period: 17280, // ~1 day at 5s/ledger
            compound_epoch: 17280, // ~1 day at 5s/ledger
        }
    }
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct StakeRecord {
    pub proposal_id: u64,
    pub staker: Address,
    pub token: Address,
    pub amount: i128,
    pub locked_at: u64,
    pub refunded: bool,
    pub slashed: bool,
    pub slashed_amount: i128,
    pub released_at: u64,
    pub auto_compound: bool,
    pub reinvestment_lock_until: u64,
    pub last_compounded: u64,
}

impl Default for GasConfig {
    fn default() -> Self {
        GasConfig {
            enabled: false,
            default_gas_limit: 0,
            base_cost: 1_000,
            condition_cost: 500,
        }
    }
}

/// Estimated execution fee breakdown for a proposal.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ExecutionFeeEstimate {
    /// Flat base fee component.
    pub base_fee: u64,
    /// Dynamic fee component based on proposal execution complexity.
    pub resource_fee: u64,
    /// Total estimated execution fee.
    pub total_fee: u64,
    /// Number of logical operations used to derive `resource_fee`.
    pub operation_count: u32,
}

// ============================================================================
// Performance Metrics (Issue: feature/performance-metrics)
// ============================================================================

/// Vault-wide cumulative performance metrics
#[contracttype]
#[derive(Clone, Debug, Default)]
pub struct VaultMetrics {
    /// Total number of proposals ever created
    pub total_proposals: u64,
    /// Number of proposals successfully executed
    pub executed_count: u64,
    /// Number of proposals rejected
    pub rejected_count: u64,
    /// Number of proposals that expired without execution
    pub expired_count: u64,
    /// Cumulative ledgers elapsed from proposal creation to execution
    pub total_execution_time_ledgers: u64,
    /// Total gas units consumed across all executions
    pub total_gas_used: u64,
    /// Ledger when metrics were last updated
    pub last_updated_ledger: u64,
}

impl VaultMetrics {
    /// Success rate in basis points (0-10000)
    pub fn success_rate_bps(&self) -> u32 {
        let total = self.executed_count + self.rejected_count + self.expired_count;
        if total == 0 {
            return 0;
        }
        (self.executed_count * 10_000 / total) as u32
    }

    /// Average ledgers from creation to execution (0 if none executed)
    pub fn avg_execution_time_ledgers(&self) -> u64 {
        if self.executed_count == 0 {
            return 0;
        }
        self.total_execution_time_ledgers / self.executed_count
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

// ============================================================================
// Cross-Chain Bridge (Issue: feature/cross-chain-bridge)
// ============================================================================

/// Identifies an external chain for bridge operations.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChainId {
    /// Human-readable chain name (e.g. "ethereum", "polygon")
    pub name: soroban_sdk::Symbol,
    /// Numeric chain identifier (e.g. EVM chain ID)
    pub chain_id: u64,
}

/// A single asset transfer leg in a cross-chain proposal.
///
/// # Fee accounting for multi-hop transfers
/// Each hop may incur a bridge fee deducted from `amount`. The caller is
/// responsible for supplying an `amount` that already accounts for all
/// intermediate fees so that the final recipient receives the intended value.
/// Fee documentation should be provided off-chain (e.g. in proposal metadata).
#[contracttype]
#[derive(Clone, Debug)]
pub struct CrossChainAsset {
    /// Token contract address on the source chain (Stellar SAC or custom)
    pub token: soroban_sdk::Address,
    /// Amount to bridge (in token's smallest unit)
    pub amount: i128,
    /// Destination chain identifier
    pub destination_chain: ChainId,
    /// Recipient address on the destination chain (encoded as a Symbol/String)
    pub destination_address: soroban_sdk::String,
}

/// Configuration for the bridge module.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BridgeConfig {
    /// Whether the bridge feature is enabled
    pub enabled: bool,
    /// Authorized bridge adapter contract addresses
    pub bridge_adapters: soroban_sdk::Vec<soroban_sdk::Address>,
    /// Maximum amount per single bridge action (in stroops)
    pub max_action_amount: i128,
    /// Maximum number of actions per bridge proposal
    pub max_actions: u32,
}

/// A cross-chain bridge proposal stored alongside the base Proposal.
#[contracttype]
#[derive(Clone, Debug)]
pub struct CrossChainProposal {
    /// Assets to bridge
    pub assets: soroban_sdk::Vec<CrossChainAsset>,
    /// Current execution status
    pub status: CrossVaultStatus,
    /// Per-asset execution results (true = success)
    pub execution_results: soroban_sdk::Vec<bool>,
    /// Ledger when executed (0 if not yet executed)
    pub executed_at: u64,
}

/// Chain identifier for cross-chain operations
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum AuditAction {
    Initialize = 0,
    ProposeTransfer = 1,
    ApproveProposal = 2,
    ExecuteProposal = 3,
    RejectProposal = 4,
    SetRole = 5,
    AddSigner = 6,
    RemoveSigner = 7,
    UpdateLimits = 8,
    UpdateThreshold = 9,
    AbstainProposal = 10,
    AmendProposal = 11,
}

/// Audit trail entry with cryptographic verification
#[contracttype]
#[derive(Clone, Debug)]
pub struct AuditEntry {
    /// Unique entry ID
    pub id: u64,
    /// Action performed
    pub action: AuditAction,
    /// Actor who performed the action
    pub actor: Address,
    /// Target of the action (proposal ID, address, etc.)
    pub target: u64,
    /// Ledger timestamp
    pub timestamp: u64,
    /// Hash of previous entry (chain integrity)
    pub prev_hash: u64,
    /// Hash of this entry
    pub hash: u64,
}
/// Comment on a proposal
// Proposal Templates (Issue: feature/contract-templates)
// ============================================================================

/// Proposal template for recurring operations
///
/// Templates allow pre-approved proposal configurations to be stored on-chain,
/// enabling quick creation of common proposals like monthly payroll.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProposalTemplate {
    /// Unique template identifier
    pub id: u64,
    /// Human-readable template name
    pub name: Symbol,
    /// Template description
    pub description: Symbol,
    /// Default recipient address (optional - can be overridden)
    pub recipient: Address,
    /// Default token contract address
    pub token: Address,
    /// Default amount (can be overridden within min/max bounds)
    pub amount: i128,
    /// Default memo/description
    pub memo: Symbol,
    /// Address that created the template
    pub creator: Address,
    /// Template version number (incremented on updates)
    pub version: u32,
    /// Whether the template is active and usable
    pub is_active: bool,
    /// Ledger sequence when template was created
    pub created_at: u64,
    /// Ledger sequence when template was last updated
    pub updated_at: u64,
    /// Minimum allowed amount (0 = no minimum)
    pub min_amount: i128,
    /// Maximum allowed amount (0 = no maximum)
    pub max_amount: i128,
}

/// Overrides for creating a proposal from a template
#[contracttype]
#[derive(Clone, Debug)]
pub struct TemplateOverrides {
    /// Whether to override recipient
    pub override_recipient: bool,
    /// Override recipient address (only used if override_recipient is true)
    pub recipient: Address,
    /// Whether to override amount
    pub override_amount: bool,
    /// Override amount (only used if override_amount is true, must be within template bounds)
    pub amount: i128,
    /// Whether to override memo
    pub override_memo: bool,
    /// Override memo (only used if override_memo is true)
    pub memo: Symbol,
    /// Whether to override priority
    pub override_priority: bool,
    /// Override priority level (only used if override_priority is true)
    pub priority: Priority,
}

// ============================================================================
// Execution Retry (Issue: feature/execution-retry)
// ============================================================================

/// Configuration for automatic retry of failed proposal executions
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RetryConfig {
    /// Whether retry logic is enabled
    pub enabled: bool,
    /// Maximum number of retry attempts allowed per proposal
    pub max_retries: u32,
    /// Initial backoff period in ledgers before first retry (~5 sec/ledger)
    pub initial_backoff_ledgers: u64,
    /// Maximum backoff delay in ledgers (cap for exponential growth)
    pub max_retry_delay: u64,
}

/// Tracks retry state for a specific proposal execution
#[contracttype]
#[derive(Clone, Debug)]
pub struct RetryState {
    /// Number of retry attempts made so far
    pub retry_count: u32,
    /// Earliest ledger when next retry is allowed (exponential backoff)
    pub next_retry_ledger: u64,
    /// Ledger of the last retry attempt
    pub last_retry_ledger: u64,
}

/// Record for proposals that exhausted all retry attempts
#[contracttype]
#[derive(Clone, Debug)]
pub struct DeadLetterRecord {
    pub id: u64,
    pub proposal_id: u64,
    pub retry_count: u32,
    pub last_error: u32,
    pub added_at: u64,
    pub processed: bool,
}

// ============================================================================
// Subscription System (Issue: feature/subscription-system)
// ============================================================================

/// Subscription tier levels
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum SubscriptionTier {
    Basic = 0,
    Standard = 1,
    Premium = 2,
    Enterprise = 3,
}

/// Subscription status
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum SubscriptionStatus {
    Active = 0,
    Cancelled = 1,
    Expired = 2,
    Suspended = 3,
    Paused = 4,
}

/// Subscription record
#[contracttype]
#[derive(Clone, Debug)]
pub struct Subscription {
    pub id: u64,
    pub subscriber: Address,
    pub service_provider: Address,
    pub tier: SubscriptionTier,
    pub token: Address,
    pub amount_per_period: i128,
    pub interval_ledgers: u64,
    pub next_renewal_ledger: u64,
    pub created_at: u64,
    pub status: SubscriptionStatus,
    pub total_payments: u32,
    pub last_payment_ledger: u64,
    pub auto_renew: bool,
    /// Number of ledgers after next_renewal_ledger during which late renewal is still accepted
    pub grace_period_ledgers: u64,
    /// Ledger at which the subscription was paused (0 = not paused)
    pub paused_at_ledger: u64,
}

/// Payment record for subscription tracking
#[contracttype]
#[derive(Clone, Debug)]
pub struct SubscriptionPayment {
    pub subscription_id: u64,
    pub payment_number: u32,
    pub amount: i128,
    pub paid_at: u64,
    pub period_start: u64,
    pub period_end: u64,
}

// ============================================================================
// Cross-Vault Proposal Coordination (Issue: feature/cross-vault-coordination)
// ============================================================================

/// Status of a cross-vault proposal
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum CrossVaultStatus {
    Pending = 0,
    Approved = 1,
    Executed = 2,
    Failed = 3,
    Cancelled = 4,
}

/// Status of a cross-vault bridge operation
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum BridgeStatus {
    Initiated = 0,
    Confirmed = 1,
    Rejected = 2,
    Returned = 3,
}

/// Record of a cross-vault bridge operation
#[contracttype]
#[derive(Clone, Debug)]
pub struct BridgeRecord {
    /// Unique bridge ID (hash of source + target + amount + ledger)
    pub bridge_id: soroban_sdk::BytesN<32>,
    /// Source vault address
    pub source_vault: Address,
    /// Target vault address
    pub target_vault: Address,
    /// Token contract address
    pub token: Address,
    /// Initiated amount
    pub amount: i128,
    /// Minimum amount to receive (slippage protection)
    pub min_received: i128,
    /// Deadline ledger
    pub deadline_ledger: u64,
    /// Current status
    pub status: BridgeStatus,
    /// Actual received amount (only set when Confirmed)
    pub actual_amount: i128,
    /// Ledger when bridge was initiated
    pub initiated_at: u64,
    /// Ledger when bridge was finalized
    pub finalized_at: u64,
}

/// Describes a single action to be executed on a participant vault
#[contracttype]
#[derive(Clone, Debug)]
pub struct VaultAction {
    /// Address of the participant vault contract
    pub vault_address: Address,
    /// Recipient of the transfer from the participant vault
    pub recipient: Address,
    /// Token contract address
    pub token: Address,
    /// Amount to transfer
    pub amount: i128,
    /// Optional memo
    pub memo: Symbol,
}

/// Cross-vault proposal stored alongside the base Proposal
#[contracttype]
#[derive(Clone, Debug)]
pub struct CrossVaultProposal {
    /// List of actions to execute across participant vaults
    pub actions: Vec<VaultAction>,
    /// Current status of the cross-vault proposal
    pub status: CrossVaultStatus,
    /// Per-action execution results (true = success)
    pub execution_results: Vec<bool>,
    /// Ledger when executed (0 if not yet executed)
    pub executed_at: u64,
}

/// Configuration for cross-vault participation
#[contracttype]
#[derive(Clone, Debug)]
pub struct CrossVaultConfig {
    /// Whether this vault participates in cross-vault operations
    pub enabled: bool,
    /// Vault addresses authorized to coordinate actions on this vault
    pub authorized_coordinators: Vec<Address>,
    /// Maximum amount per single cross-vault action
    pub max_action_amount: i128,
    /// Maximum number of actions in a single cross-vault proposal
    pub max_actions: u32,
}

// ============================================================================
// Dispute Resolution (Issue: feature/dispute-resolution)
// ============================================================================

/// Lifecycle status of a dispute
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum DisputeStatus {
    /// Dispute has been filed, awaiting arbitrator review
    Filed = 0,
    /// Arbitrator is actively reviewing the dispute
    UnderReview = 1,
    /// Dispute has been resolved by an arbitrator
    Resolved = 2,
    /// Dispute was dismissed by an arbitrator
    Dismissed = 3,
}

/// Outcome of a dispute resolution (old, kept for compatibility)
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum DisputeResolution {
    /// Ruling in favor of the original proposer (proposal proceeds)
    InFavorOfProposer = 0,
    /// Ruling in favor of the disputer (proposal rejected)
    InFavorOfDisputer = 1,
    /// Compromise reached (proposal modified or partially executed)
    Compromise = 2,
    /// Dispute dismissed as invalid
    Dismissed = 3,
}

/// Outcome of a dispute resolution with bond slashing
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum DisputeOutcome {
    /// Uphold the dispute - release bond to disputer
    UpholdDispute = 0,
    /// Dismiss the dispute - slash 50% of bond
    DismissDispute = 1,
    /// Draw - return full bond to disputer
    DrawDispute = 2,
}

/// On-chain dispute record for a contested proposal
#[contracttype]
#[derive(Clone, Debug)]
pub struct Dispute {
    /// Unique dispute ID
    pub id: u64,
    /// ID of the disputed proposal
    pub proposal_id: u64,
    /// Address that filed the dispute
    pub disputer: Address,
    /// Short reason for the dispute
    pub reason: Symbol,
    /// IPFS hashes or on-chain references to supporting evidence
    pub evidence: Vec<String>,
    /// Current status
    pub status: DisputeStatus,
    /// Resolution outcome (only set when status is Resolved or Dismissed)
    pub resolution: DisputeResolution,
    /// New dispute outcome with bond handling
    pub outcome: DisputeOutcome,
    /// Arbitrator who resolved the dispute (zero-value until resolved)
    pub arbitrator: Address,
    /// Ledger when dispute was filed
    pub filed_at: u64,
    /// Ledger when dispute was resolved (0 if unresolved)
    pub resolved_at: u64,
    /// Bond posted by disputer
    pub dispute_bond: i128,
    /// Token used for the bond
    pub bond_token: Address,
}

// ============================================================================
// Wallet Recovery (Issue: feature/wallet-recovery)
// ============================================================================

/// Recovery configuration stored on-chain
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryConfig {
    /// List of trusted guardians
    pub guardians: Vec<Address>,
    /// Number of guardian approvals required for recovery
    pub threshold: u32,
    /// Delay in ledgers before recovery can be executed
    pub delay: u64,
}

impl RecoveryConfig {
    pub fn default(env: &Env) -> Self {
        RecoveryConfig {
            guardians: Vec::new(env),
            threshold: 0,
            delay: 0,
        }
    }
}

/// Recovery proposal status
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum RecoveryStatus {
    Pending = 0,
    Approved = 1,
    Executed = 2,
    Cancelled = 3,
}

/// Proposal to recover wallet access by replacing signers
#[contracttype]
#[derive(Clone, Debug)]
pub struct RecoveryProposal {
    pub id: u64,
    /// Proposed new list of signers
    pub new_signers: Vec<Address>,
    /// Proposed new threshold
    pub new_threshold: u32,
    /// Guardians who have approved this proposal
    pub approvals: Vec<Address>,
    /// Current status
    pub status: RecoveryStatus,
    /// Ledger when the proposal was created
    pub created_at: u64,
    /// Earliest ledger when this recovery can be executed
    pub execution_after: u64,
}
// ============================================================================
// Escrow System (Issue: feature/escrow-system)
// ============================================================================

/// Status lifecycle of an escrow
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum EscrowStatus {
    /// Escrow created, awaiting funding
    Pending = 0,
    /// Funds locked, milestone phase active
    Active = 1,
    /// All milestones completed, funds ready for release
    MilestonesComplete = 2,
    /// Funds released to recipient
    Released = 3,
    /// Refunded to funder (on failure or dispute)
    Refunded = 4,
    /// Disputed, awaiting arbitration
    Disputed = 5,
}

/// Milestone tracking unit for progressive fund release
#[contracttype]
#[derive(Clone, Debug)]
pub struct Milestone {
    /// Unique milestone ID
    pub id: u64,
    /// Percentage of total escrow amount (0-100)
    pub percentage: u32,
    /// Ledger when this milestone can be marked complete
    pub release_ledger: u64,
    /// Whether this milestone has been verified as complete
    pub is_completed: bool,
    /// Ledger when milestone was completed (0 if not completed)
    pub completion_ledger: u64,
}

/// Escrow agreement holding funds with milestone-based releases
#[contracttype]
#[derive(Clone, Debug)]
pub struct Escrow {
    /// Unique escrow ID
    pub id: u64,
    /// Address that funded the escrow
    pub funder: Address,
    /// Address that receives funds on completion
    pub recipient: Address,
    /// Token contract address
    pub token: Address,
    /// Total escrow amount (in token's smallest unit)
    pub total_amount: i128,
    /// Amount already released
    pub released_amount: i128,
    /// Milestones for progressive fund release
    pub milestones: Vec<Milestone>,
    /// Current escrow status
    pub status: EscrowStatus,
    /// Arbitrator for dispute resolution
    pub arbitrator: Address,
    /// Optional dispute details if disputed
    pub dispute_reason: Symbol,
    /// Ledger when escrow was created
    pub created_at: u64,
    /// Ledger when escrow expires (full refund if not completed)
    pub expires_at: u64,
    /// Ledger when escrow was released/refunded (0 if still active)
    pub finalized_at: u64,
}

// ============================================================================
// Time-Weighted Voting (Issue: feature/time-weighted-voting)
// ============================================================================

/// Token lock for time-weighted voting power
#[contracttype]
#[derive(Clone, Debug)]
pub struct TokenLock {
    /// Address that locked the tokens
    pub owner: Address,
    /// Token contract address
    pub token: Address,
    /// Amount of tokens locked
    pub amount: i128,
    /// Ledger when tokens were locked
    pub locked_at: u64,
    /// Duration of the lock in ledgers
    pub duration: u64,
    /// Ledger when tokens can be unlocked
    pub unlock_at: u64,
    /// Whether the lock is active
    pub is_active: bool,
    /// Voting power multiplier (basis points, e.g., 10000 = 1x, 20000 = 2x)
    pub power_multiplier_bps: u32,
}

impl TokenLock {
    /// Calculate voting power based on locked amount and duration
    /// Longer locks get higher multipliers:
    /// - < 30 days: 1.0x (10000 bps)
    /// - 30-90 days: 1.5x (15000 bps)
    /// - 90-180 days: 2.0x (20000 bps)
    /// - 180-365 days: 3.0x (30000 bps)
    /// - > 365 days: 4.0x (40000 bps)
    pub fn calculate_voting_power(&self) -> i128 {
        if !self.is_active {
            return 0;
        }
        (self.amount * self.power_multiplier_bps as i128) / 10_000
    }

    /// Calculate power multiplier based on lock duration
    pub fn calculate_multiplier(duration_ledgers: u64) -> u32 {
        const DAY_LEDGERS: u64 = 17_280; // ~24 hours at 5 sec/ledger

        if duration_ledgers < 30 * DAY_LEDGERS {
            10_000 // 1.0x
        } else if duration_ledgers < 90 * DAY_LEDGERS {
            15_000 // 1.5x
        } else if duration_ledgers < 180 * DAY_LEDGERS {
            20_000 // 2.0x
        } else if duration_ledgers < 365 * DAY_LEDGERS {
            30_000 // 3.0x
        } else {
            40_000 // 4.0x
        }
    }

    /// Calculate remaining voting power with time decay
    /// Power decays linearly as lock approaches expiration
    pub fn calculate_decayed_power(&self, current_ledger: u64) -> i128 {
        if !self.is_active || current_ledger >= self.unlock_at {
            return 0;
        }

        let _elapsed = current_ledger.saturating_sub(self.locked_at);
        let remaining = self.unlock_at.saturating_sub(current_ledger);

        // Linear decay: power = base_power * (remaining / duration)
        let base_power = self.calculate_voting_power();
        (base_power * remaining as i128) / self.duration as i128
    }
}

/// Time-weighted voting configuration
#[contracttype]
#[derive(Clone, Debug)]
pub struct TimeWeightedConfig {
    /// Whether time-weighted voting is enabled
    pub enabled: bool,
    /// Minimum lock duration in ledgers
    pub min_lock_duration: u64,
    /// Maximum lock duration in ledgers
    pub max_lock_duration: u64,
    /// Whether to apply time decay to voting power
    pub apply_decay: bool,
    /// Penalty for early unlock (basis points, e.g., 1000 = 10%)
    pub early_unlock_penalty_bps: u32,
}

impl TimeWeightedConfig {
    pub fn default() -> Self {
        const DAY_LEDGERS: u64 = 17_280;
        TimeWeightedConfig {
            enabled: false,
            min_lock_duration: 7 * DAY_LEDGERS,   // 7 days minimum
            max_lock_duration: 730 * DAY_LEDGERS, // 2 years maximum
            apply_decay: true,
            early_unlock_penalty_bps: 1000, // 10% penalty
        }
    }
}

impl Escrow {
    /// Calculate total percentage from all milestones
    pub fn total_milestone_percentage(&self) -> u32 {
        let mut total: u32 = 0;
        for i in 0..self.milestones.len() {
            if let Some(m) = self.milestones.get(i) {
                total = total.saturating_add(m.percentage);
            }
        }
        total
    }

    /// Calculate amount available for immediate release
    pub fn amount_to_release(&self) -> i128 {
        let mut completed_percentage: u32 = 0;
        for i in 0..self.milestones.len() {
            if let Some(m) = self.milestones.get(i) {
                if m.is_completed {
                    completed_percentage = completed_percentage.saturating_add(m.percentage);
                }
            }
        }
        (self.total_amount * completed_percentage as i128) / 100 - self.released_amount
    }
}

// ============================================================================
// Price-Gated Escrow Conditions (Issue: feature/escrow-oracle)
// ============================================================================

/// Oracle + asset information shared by both price-condition variants.
/// Stored as a tuple variant payload because `#[contracttype]` enums require
/// tuple or unit variants (not named/struct variants).
#[contracttype]
#[derive(Clone, Debug)]
pub struct PriceConditionArgs {
    /// Address of the oracle contract exposing `get_price(asset_pair) -> VaultPriceData`.
    pub oracle: Address,
    /// The asset-pair symbol the oracle understands (e.g. `"XLM_USD"`).
    pub asset_pair: Symbol,
    /// Price threshold in oracle-native units; must be strictly positive.
    pub threshold: i128,
}

/// Release condition attached to an escrow.
///
/// `Manual`     — original behaviour; only `release_escrow_funds` can release.
/// `PriceAbove` — release when oracle reports `price > threshold`.
/// `PriceBelow` — release when oracle reports `price < threshold`.
#[contracttype]
#[derive(Clone, Debug)]
pub enum EscrowCondition {
    /// No programmatic condition — release is triggered manually.
    Manual,
    /// Release when the oracle price is strictly above the threshold.
    PriceAbove(PriceConditionArgs),
    /// Release when the oracle price is strictly below the threshold.
    PriceBelow(PriceConditionArgs),
}

/// Thin client interface for an external oracle contract.
///
/// The oracle must expose a single `get_price(asset_pair: Symbol) -> VaultPriceData`
/// method.  Any contract that satisfies this ABI (including the in-test MockOracle)
/// can be used as the `oracle` address inside an `EscrowCondition`.
#[soroban_sdk::contractclient(name = "PriceOracleClient")]
pub trait PriceOracleInterface {
    fn get_price(env: soroban_sdk::Env, asset_pair: soroban_sdk::Symbol) -> VaultPriceData;
}

// ============================================================================
// Dynamic Fee Structure (Issue: feature/dynamic-fees)
// ============================================================================

/// Status of a funding round milestone
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FundingMilestoneStatus {
    /// Milestone is pending completion
    Pending,
    /// Milestone has been submitted for verification
    Submitted,
    /// Milestone has been verified and approved
    Verified,
    /// Milestone was rejected
    Rejected,
}

/// A milestone within a funding round
#[contracttype]
#[derive(Clone, Debug)]
pub struct FundingMilestone {
    /// Milestone description
    pub description: String,
    /// Amount to release upon completion (in stroops) — used when release_percentage_bps = 0
    pub amount: i128,
    /// Percentage of total amount in basis points (e.g. 2500 = 25%).
    /// Must sum to exactly 10000 across all milestones in a round.
    /// When 0 for all milestones, the fixed `amount` field is used instead.
    pub release_percentage_bps: u32,
    /// Current status
    pub status: FundingMilestoneStatus,

    /// Ledger when milestone was submitted
    pub submitted_at: u64,

    /// Ledger when milestone was first verified/submitted for verification
    pub verified_at: u64,

    /// Number of required approvals for quorum
    pub required_verifiers: u32,

    /// All addresses that have verified this milestone
    pub verifications: Vec<Address>,

    /// Rejection reason, if rejected
    pub rejection_reason: Option<String>,
}

/// Status of a funding round
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FundingRoundStatus {
    /// Round is pending approval
    Pending,
    /// Round has been approved by admin (ready to become active)
    Approved,
    /// Round is active — milestones can be submitted and verified
    Active,
    /// Round has been completed (all milestones verified and paid)
    Completed,
    /// Round was cancelled
    Cancelled,
}

/// A funding round with multiple milestones
#[contracttype]
#[derive(Clone, Debug)]
pub struct FundingRound {
    /// Unique round ID
    pub id: u64,
    /// Associated proposal ID
    pub proposal_id: u64,
    /// Project recipient
    pub recipient: Address,
    /// Token address for funding
    pub token: Address,
    /// Total amount for this round
    pub total_amount: i128,
    /// Amount already released
    pub released_amount: i128,
    /// Milestones for this round
    pub milestones: Vec<FundingMilestone>,
    /// Current status
    pub status: FundingRoundStatus,
    /// Ledger when round was created
    pub created_at: u64,
    /// Ledger when round was approved
    pub approved_at: u64,
    /// Ledger when round was completed/cancelled
    pub finalized_at: u64,
}

impl FundingRound {
    /// Calculate total amount from all milestones
    pub fn total_milestone_amount(&self) -> i128 {
        let mut total: i128 = 0;
        for i in 0..self.milestones.len() {
            if let Some(m) = self.milestones.get(i) {
                total = total.saturating_add(m.amount);
            }
        }
        total
    }

    /// Calculate amount available for release based on verified milestones
    pub fn amount_to_release(&self) -> i128 {
        let mut verified_amount: i128 = 0;
        for i in 0..self.milestones.len() {
            if let Some(m) = self.milestones.get(i) {
                if m.status == FundingMilestoneStatus::Verified {
                    verified_amount = verified_amount.saturating_add(m.amount);
                }
            }
        }
        verified_amount - self.released_amount
    }

    /// Check if all milestones are verified
    pub fn all_milestones_verified(&self) -> bool {
        for i in 0..self.milestones.len() {
            if let Some(m) = self.milestones.get(i) {
                if m.status != FundingMilestoneStatus::Verified {
                    return false;
                }
            }
        }
        true
    }
}

/// Configuration for funding rounds system
#[contracttype]
#[derive(Clone, Debug)]
pub struct FundingRoundConfig {
    /// Whether funding rounds are enabled
    pub enabled: bool,
    /// Minimum number of milestones per round
    pub min_milestones: u32,
    /// Maximum number of milestones per round
    pub max_milestones: u32,
    /// Minimum amount per milestone
    pub min_milestone_amount: i128,
    /// Maximum rounds per proposal
    pub max_rounds_per_proposal: u32,
}

/// A single operation within a batch transaction
/// Fee tier based on transaction volume
#[contracttype]
#[derive(Clone, Debug)]
pub struct FeeTier {
    /// Cumulative volume threshold to qualify for this tier (in stroops)
    pub volume_threshold: i128,
    /// Fee rate in basis points (e.g., 100 = 1%); minimum 1, maximum 10_000
    pub fee_bps: u32,
}

/// Dynamic fee structure configuration
#[contracttype]
#[derive(Clone, Debug)]
pub struct FeeStructure {
    /// Volume-based fee tiers (sorted by min_volume ascending)
    pub tiers: Vec<FeeTier>,
    /// Base fee rate in basis points (used if no tiers match)
    pub base_fee_bps: u32,
    /// Reputation score threshold for discount eligibility
    pub reputation_discount_threshold: u32,
    /// Discount percentage for high-reputation users (0-100)
    pub reputation_discount_percentage: u32,
    /// Treasury address for fee distribution
    pub treasury: Address,
    /// Whether fee collection is enabled
    pub enabled: bool,
}

impl FeeStructure {
    pub fn default(env: &Env) -> Self {
        // Use contract's own address as default treasury
        // Admin should set a proper treasury address before enabling fees
        let treasury = env.current_contract_address();

        FeeStructure {
            tiers: Vec::new(env),
            base_fee_bps: 50, // 0.5% default
            reputation_discount_threshold: 750,
            reputation_discount_percentage: 50, // 50% discount
            treasury,
            enabled: false,
        }
    }
}

/// Fee calculation result
#[contracttype]
#[derive(Clone, Debug)]
pub struct FeeCalculation {
    /// Base fee before discounts
    pub base_fee: i128,
    /// Discount amount applied
    pub discount: i128,
    /// Final fee to collect
    pub final_fee: i128,
    /// Fee rate used (in basis points)
    pub fee_bps: u32,
    /// Whether reputation discount was applied
    pub reputation_discount_applied: bool,
}

// ============================================================================
// Tiered Recurring-Payment Fee System
// ============================================================================

/// Tracks a payer's cumulative payment volume within the current fee window.
/// Stored in Temporary storage; absence means the window has expired and volume is 0.
#[contracttype]
#[derive(Clone, Debug)]
pub struct CumulativeVolume {
    /// Total payment volume processed during the current window (in stroops)
    pub volume: i128,
    /// Ledger sequence at which the current window started
    pub window_start: u64,
}

/// Admin-configurable settings for the tiered recurring-payment fee system.
/// Stored as instance storage under FeatureKey::TierFeeConfig.
#[contracttype]
#[derive(Clone, Debug)]
pub struct TierFeeConfig {
    /// Fee tiers sorted ascending by volume_threshold (max 5)
    pub tiers: Vec<FeeTier>,
    /// Volume window length in ledgers; 0 means use the 30-day default
    pub volume_window: u64,
}

// ============================================================================
// Execution Snapshot (for rollback support)
// ============================================================================

/// Snapshot of proposal state before execution
#[contracttype]
#[derive(Clone, Debug)]
pub struct ExecutionSnapshot {
    /// The proposal at time of execution
    pub proposal: Proposal,
    /// Whether it was in priority queue
    pub was_in_priority_queue: bool,
}

/// Details of a transfer
#[contracttype]
#[derive(Clone, Debug)]
pub struct TransferDetails {
    /// Recipient address
    pub recipient: Address,
    /// Token contract address
    pub token: Address,
    /// Amount to transfer
    pub amount: i128,
}

// ============================================================================
// Issue #1094: On-Chain Recipient Whitelist
// ============================================================================

/// Entry in the on-chain recipient whitelist
#[contracttype]
#[derive(Clone, Debug)]
pub struct WhitelistEntry {
    /// Human-readable label for this entry
    pub label: Symbol,
    /// Maximum amount allowed per proposal to this recipient (0 = no limit)
    pub max_amount: i128,
    /// Ledger after which this entry expires (0 = never expires)
    pub expiry_ledger: u32,
    /// Signers who approved adding this entry
    pub approved_by: Vec<Address>,
}

// ============================================================================
// Issue #1095: Voting Power Snapshot
// ============================================================================
// (Fields are added to Proposal: signer_snapshot: Map<Address, i128>)
// No separate type needed — Map is used inline.

// ============================================================================
// Issue #1096: Multi-Phase Proposal Execution
// ============================================================================

/// Operation that can be performed in a proposal phase
#[contracttype]
#[derive(Clone, Debug)]
pub enum ProposalOperation {
    /// Transfer tokens: (recipient, token, amount, memo)
    Transfer(Address, Address, i128, Symbol),
}

/// Optional ProposalOperation wrapper (Soroban contracttype limitation)
#[contracttype]
#[derive(Clone, Debug)]
pub enum OptionalProposalOperation {
    None,
    Some(ProposalOperation),
}

/// Status of a single proposal phase
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum ProposalPhaseStatus {
    Pending = 0,
    Executed = 1,
    RolledBack = 2,
    Failed = 3,
}

/// A single phase in a multi-phase proposal
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProposalPhase {
    /// The operation to execute in this phase
    pub operation: ProposalOperation,
    /// Optional rollback operation to run if a later phase fails
    pub rollback_operation: OptionalProposalOperation,
    /// Execution status
    pub status: ProposalPhaseStatus,
}

/// Multi-phase proposal stored alongside the base Proposal
#[contracttype]
#[derive(Clone, Debug)]
pub struct MultiPhaseProposal {
    /// Base proposal ID
    pub proposal_id: u64,
    /// Ordered list of phases (max 5)
    pub phases: Vec<ProposalPhase>,
    /// Index of last successfully executed phase (-1 if none)
    pub last_executed_phase: i32,
}

// ============================================================================
// Issue #1097: Cross-Contract Capability Tokens
// ============================================================================

/// Scoped capability granted to an external address
#[contracttype]
#[derive(Clone, Debug)]
pub enum Capability {
    /// Allow initiating a stream up to max_amount
    InitiateStream(i128),
    /// Allow creating a proposal up to max_amount
    CreateProposal(i128),
    /// Allow executing a specific recurring payment
    ExecuteRecurring(u64),
}

/// Capability token granting scoped permissions to an external address
#[contracttype]
#[derive(Clone, Debug)]
pub struct CapabilityToken {
    /// Unique token ID (32 bytes)
    pub id: soroban_sdk::BytesN<32>,
    /// Address the token is granted to
    pub granted_to: Address,
    /// List of capabilities this token grants
    pub capabilities: Vec<Capability>,
    /// Ledger after which this token expires
    pub expires_at: u32,
    /// Maximum number of times this token can be used (0 = unlimited)
    pub max_uses: u32,
    /// Number of times this token has been used
    pub uses_count: u32,
    /// Whether this token has been revoked
    pub revoked: bool,
}


