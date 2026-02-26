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
    /// Retry configuration for failed executions
    pub retry_config: RetryConfig,
    /// Recovery configuration
    pub recovery_config: RecoveryConfig,
    /// Staking configuration for proposals
    pub staking_config: StakingConfig,
}

/// Vault configuration
#[contracttype]
#[derive(Clone, Debug)]
pub struct Config {
    /// List of authorized signers
    pub signers: Vec<Address>,
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
    /// Retry configuration for failed executions
    pub retry_config: RetryConfig,
    /// Recovery configuration
    pub recovery_config: RecoveryConfig,
    /// Staking configuration for proposals
    pub staking_config: StakingConfig,
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

/// Chain identifier for cross-chain operations
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChainId {
    Stellar,
    Ethereum,
    Polygon,
    Arbitrum,
    Optimism,
}

/// Cross-chain asset representation
#[contracttype]
#[derive(Clone, Debug)]
pub struct CrossChainAsset {
    pub chain: ChainId,
    pub token_address: String,
    pub decimals: u32,
    pub confirmations: u32,
    pub required_confirmations: u32,
    pub status: u32,
}

/// Cross-chain transfer proposal
#[contracttype]
#[derive(Clone, Debug)]
pub struct CrossChainProposal {
    pub target_chain: ChainId,
    pub recipient: String,
    pub amount: i128,
    pub asset: CrossChainAsset,
    pub bridge_fee: i128,
}

/// Bridge configuration
#[contracttype]
#[derive(Clone, Debug)]
pub struct BridgeConfig {
    pub enabled_chains: Vec<ChainId>,
    pub max_bridge_amount: i128,
    pub fee_bps: u32,
    pub min_confirmations: Vec<ChainConfirmation>,
}

/// Minimum confirmations per chain
#[contracttype]
#[derive(Clone, Debug)]
pub struct ChainConfirmation {
    pub chain_id: ChainId,
    pub confirmations: u32,
}

/// Cross-chain transfer parameters
#[contracttype]
#[derive(Clone, Debug)]
pub struct CrossChainTransferParams {
    pub chain: ChainId,
    pub recipient: String,
    pub amount: i128,
    pub token: Address,
}

// ============================================================================
// Multi-Token Batch Transfers (Issue: feature/multi-token-batch-transfers)
// ============================================================================

/// Transfer details for batch operations supporting multiple tokens
#[contracttype]
#[derive(Clone, Debug)]
pub struct TransferDetails {
    /// Recipient of the transfer
    pub recipient: Address,
    /// Token contract address
    pub token: Address,
    /// Amount to transfer
    pub amount: i128,
    /// Optional memo
    pub memo: Symbol,
}

// ============================================================================
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
#[derive(Clone, Debug)]
pub struct RetryConfig {
    /// Whether retry logic is enabled
    pub enabled: bool,
    /// Maximum number of retry attempts allowed per proposal
    pub max_retries: u32,
    /// Initial backoff period in ledgers before first retry (~5 sec/ledger)
    pub initial_backoff_ledgers: u64,
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

/// Outcome of a dispute resolution
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
    /// Arbitrator who resolved the dispute (zero-value until resolved)
    pub arbitrator: Address,
    /// Ledger when dispute was filed
    pub filed_at: u64,
    /// Ledger when dispute was resolved (0 if unresolved)
    pub resolved_at: u64,
}

// ============================================================================
// Wallet Recovery (Issue: feature/wallet-recovery)
// ============================================================================

/// Recovery configuration stored on-chain
#[contracttype]
#[derive(Clone, Debug)]
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
// Dynamic Fee Structure (Issue: feature/dynamic-fees)
// ============================================================================

/// Fee tier based on transaction volume
#[contracttype]
#[derive(Clone, Debug)]
pub struct FeeTier {
    /// Minimum volume threshold for this tier (in stroops)
    pub min_volume: i128,
    /// Fee rate in basis points (e.g., 100 = 1%)
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

// ============================================================================
// Proposal Staking and Slashing (Issue: feature/proposal-staking)
// ============================================================================

/// Staking configuration for proposals
#[contracttype]
#[derive(Clone, Debug)]
pub struct StakingConfig {
    /// Whether staking is required for proposals
    pub enabled: bool,
    /// Minimum proposal amount that requires staking (in stroops)
    pub min_amount: i128,
    /// Base stake requirement as basis points of proposal amount (e.g. 500 = 5%)
    pub base_stake_bps: u32,
    /// Maximum stake requirement cap (absolute amount)
    pub max_stake_amount: i128,
    /// Percentage of stake slashed for malicious proposals (0-100)
    pub slash_percentage: u32,
    /// Reputation score threshold for reduced stake requirement
    pub reputation_discount_threshold: u32,
    /// Stake discount percentage for high-reputation users (0-100)
    pub reputation_discount_percentage: u32,
}

impl StakingConfig {
    pub fn default() -> Self {
        StakingConfig {
            enabled: false,
            min_amount: 1_000_000_000, // 100 XLM default minimum
            base_stake_bps: 500,        // 5% default stake
            max_stake_amount: 10_000_000_000, // 1000 XLM max stake
            slash_percentage: 50,       // 50% slashed on malicious
            reputation_discount_threshold: 750,
            reputation_discount_percentage: 30, // 30% discount for high rep
        }
    }
}

/// Stake record for a proposal
#[contracttype]
#[derive(Clone, Debug)]
pub struct StakeRecord {
    /// Proposal ID this stake is for
    pub proposal_id: u64,
    /// Address that staked
    pub staker: Address,
    /// Token staked
    pub token: Address,
    /// Amount staked
    pub amount: i128,
    /// Ledger when stake was locked
    pub locked_at: u64,
    /// Whether stake has been refunded
    pub refunded: bool,
    /// Whether stake has been slashed
    pub slashed: bool,
    /// Amount slashed (if any)
    pub slashed_amount: i128,
    /// Ledger when stake was released/slashed
    pub released_at: u64,
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
// Batch Transaction System (Issue: feature/batch-transactions)
// ============================================================================

/// Status of a batch transaction
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum BatchStatus {
    /// Batch created, awaiting execution
    Pending = 0,
    /// Batch is currently being executed
    Executing = 1,
    /// Batch execution completed successfully
    Completed = 2,
    /// Batch execution failed and was rolled back
    RolledBack = 3,
}

/// A single operation in a batch transaction
#[contracttype]
#[derive(Clone, Debug)]
pub struct BatchOperation {
    /// Recipient of the transfer
    pub recipient: Address,
    /// Token contract address
    pub token: Address,
    /// Amount to transfer
    pub amount: i128,
    /// Optional memo
    pub memo: Symbol,
}

/// Batch transaction containing multiple operations
#[contracttype]
#[derive(Clone, Debug)]
pub struct BatchTransaction {
    /// Unique batch ID
    pub id: u64,
    /// Address that created the batch
    pub creator: Address,
    /// List of operations to execute
    pub operations: Vec<BatchOperation>,
    /// Current status
    pub status: BatchStatus,
    /// Ledger when batch was created
    pub created_at: u64,
    /// Optional memo for the entire batch
    pub memo: Symbol,
    /// Estimated gas for the batch
    pub estimated_gas: u64,
}

/// Result of batch execution
#[contracttype]
#[derive(Clone, Debug)]
pub struct BatchExecutionResult {
    /// Batch ID
    pub batch_id: u64,
    /// Whether all operations succeeded
    pub success: bool,
    /// Number of operations executed successfully
    pub successful_operations: u32,
    /// Total number of operations
    pub total_operations: u32,
    /// Ledger when execution completed
    pub executed_at: u64,
    /// Index of failed operation (if any)
    pub failed_operation_index: u32,
    /// Error message (if any)
    pub error: Symbol,
    /// Number of operations executed before failure
    pub executed_count: u32,
}
