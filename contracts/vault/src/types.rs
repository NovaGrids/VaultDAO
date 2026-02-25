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

#[contracttype]
#[derive(Clone, Debug)]
pub struct VelocityConfig {
    /// Maximum number of transfers allowed in the window
    pub limit: u32,
    /// The time window in seconds (e.g., 3600 for 1 hour)
    pub window: u64,
}

/// Audit action types
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

/// Recipient list mode
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum ListMode {
    Disabled = 0,
    Whitelist = 1,
    Blacklist = 2,
}

/// Comment on a proposal
#[contracttype]
#[derive(Clone, Debug)]
pub struct Comment {
    pub id: u64,
    pub proposal_id: u64,
    pub author: Address,
    pub text: Symbol,
    pub parent_id: u64,
    pub created_at: u64,
    pub edited_at: u64,
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
