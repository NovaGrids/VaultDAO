//! VaultDAO - Type Definitions
//!
//! Core data structures for the multisig treasury contract.

use soroban_sdk::{contracttype, Address, Map, String, Symbol, Vec};

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
    /// Default voting deadline in ledgers (0 = no deadline)
    pub default_voting_deadline: u64,
    /// Retry configuration for failed executions
    pub retry_config: RetryConfig,
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
    /// Default voting deadline in ledgers (0 = no deadline)
    pub default_voting_deadline: u64,
    /// Retry configuration for failed executions
    pub retry_config: RetryConfig,
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
    /// Cancelled by proposer or admin, with spending refunded.
    Cancelled = 5,
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
    /// Insurance amount staked by proposer (0 = no insurance). Held in vault.
    pub insurance_amount: i128,
    /// Gas (CPU instruction) limit for execution (0 = use global config default)
    pub gas_limit: u64,
    /// Estimated gas used during execution (populated on execution)
    pub gas_used: u64,
    /// Ledger sequence at which signers were snapshotted for this proposal
    pub snapshot_ledger: u64,
    /// Voting power snapshot — addresses eligible to vote at creation time
    pub snapshot_signers: Vec<Address>,
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

impl GasConfig {
    pub fn default() -> Self {
        GasConfig {
            enabled: false,
            default_gas_limit: 0,
            base_cost: 1_000,
            condition_cost: 500,
        }
    }
}

// ============================================================================
// Performance Metrics (Issue: feature/performance-metrics)
// ============================================================================

/// Vault-wide cumulative performance metrics
#[contracttype]
#[derive(Clone, Debug)]
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
    pub fn default() -> Self {
        VaultMetrics {
            total_proposals: 0,
            executed_count: 0,
            rejected_count: 0,
            expired_count: 0,
            total_execution_time_ledgers: 0,
            total_gas_used: 0,
            last_updated_ledger: 0,
        }
    }

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
