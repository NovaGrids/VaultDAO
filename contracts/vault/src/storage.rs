//! VaultDAO - Storage Layer
//!
//! Storage keys and helper functions for persistent state.
//!
//! # Gas Optimization Notes
//!
//! This module implements several gas optimization techniques:
//!
//! 1. **Packed Storage Keys**: Related data is stored together using `Packed*` structs
//!    to reduce the number of storage operations.
//!
//! 2. **Temporary Storage**: Short-lived data (daily/weekly spending, velocity history)
//!    uses temporary storage which is cheaper and auto-expires.
//!
//! 3. **Lazy Loading**: Large optional fields are stored separately and loaded only when needed.
//!
//! 4. **Caching**: Frequently accessed data is cached in instance storage for faster access.
//!
//! 5. **Batch Operations**: Multiple related updates are batched into single storage operations.

use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{contracttype, Address, BytesN, Env, Map, String, Symbol, Vec};

use crate::errors::VaultError;
use crate::types::{
    AuditCheckpoint, AuditEntry, BridgeConfig, CapabilityToken, ColdSignatureRecord,
    ColdSignerConfig, Comment, Config, CostModel, CrossChainProposal, DeadLetterRecord,
    DelegatedPermission, Delegation, DelegationHistory, DexConfig, Escrow, ExecutionFeeEstimate,
    ExecutionSnapshot, FeeStructure, ForceRotationRequest, FundingRound, FundingRoundConfig,
    GasConfig, GasPriceOracleConfig, GovernanceProposal, HolidayCalendar, HookEventType,
    HookRegistration, InsuranceClaim, InsuranceConfig, InsuranceVotingConfig, ListMode,
    MergeRecord, MultiPhaseProposal, NotificationPreferences, NotificationPrefs,
    PauseCooldownConfig, PauseState, PermissionGrant, Proposal, ProposalAmendment, ProposalStatus,
    ProposalTemplate, RecoveryProposal, Reputation, ReputationConfig, RetryState, Role,
    RoleAssignment, ScopedDelegation, SignerParticipationScore, SignerTier, StakeRecord,
    StakingConfig, StreamRateWindow, Subscription, SwapProposal, SwapResult, Tag, TemplateVarRef,
    TimeWeightedConfig, TokenLock, TokenSpendingConfig, VarTemplate, VaultMetrics, VelocityConfig,
    VestingSchedule, VotingStrategy, WhitelistEntry,
};
use crate::types_balance_snapshot::BalanceSnapshot;

/// Core storage key definitions (kept minimal to avoid size limits)
#[contracttype(export = false)]
#[derive(Clone)]
pub enum DataKey {
    /// Contract initialization flag
    Initialized,
    /// Vault configuration -> Config
    Config,
    /// Role assignment for address -> Role
    Role(Address),
    /// Index of addresses with explicitly tracked roles -> Vec<Address>
    RoleIndex,
    /// Proposal by ID -> Proposal
    Proposal(u64),
    /// Next proposal ID counter -> u64
    NextProposalId,
    /// Priority queue index (u32 priority level) -> Vec<u64>
    PriorityQueue(u32),
    /// Daily spending tracker (day number) -> i128
    DailySpent(u64),
    /// Weekly spending tracker (week number) -> i128
    WeeklySpent(u64),
    /// Recurring payment configuration -> RecurringPayment
    Recurring(u64),
    /// Next recurring payment ID counter -> u64
    NextRecurringId,
    /// Proposer transfer timestamps for velocity checking (Address) -> Vec<u64>
    VelocityHistory(Address),
    /// Recipient list mode
    ListMode,
    /// Whitelist entry
    Whitelist(Address),
    /// Blacklist entry
    Blacklist(Address),
    /// Comment by ID
    Comment(u64),
    /// Comments for a proposal
    ProposalComments(u64),
    /// Next comment ID counter
    NextCommentId,
    /// Audit entry by ID
    AuditEntry(u64),
    /// Next audit entry ID counter
    NextAuditId,
    /// Last audit entry hash
    LastAuditHash,
    /// Proposal IPFS attachment hashes -> Vec<String>
    Attachments(u64),
    /// Reputation record per address -> Reputation
    Reputation(Address),
    /// Voting strategy configuration
    VotingStrategy,
    /// Approval ledger (proposal_id, voter)
    ApprovalLedger(u64, Address),
    /// Streaming payment by ID
    Stream(u64),
    /// Next stream payment ID counter -> u64
    NextStreamId,
    /// Cancellation record by proposal ID
    CancellationRecord(u64),
    /// Cancellation history
    CancellationHistory,
    /// Amendment history for a proposal
    AmendmentHistory(u64),
    // ---- Issue #1356: Amendment limits ----
    /// Number of amendments applied to a proposal (proposal_id) -> u32
    AmendmentCount(u64),
    /// Execution snapshot for rollback
    ExecutionSnapshot(u64),
    /// Execution fee estimate
    ExecutionFeeEstimate(u64),
    // ---- Issue #1064: Stream rate window per stream sender ----
    /// Rolling-window outflow tracker for streaming payments (stream_id) -> StreamRateWindow
    StreamRateWindow(u64),
    // ---- Issue #1075: Insurance Claim Governance ----
    /// Insurance claim by ID -> InsuranceClaim
    InsuranceClaim(u64),
    /// Next insurance claim ID -> u64
    NextInsuranceClaimId,
    /// Vote record — prevents double-voting (claim_id, voter) -> bool
    InsuranceClaimVote(u64, Address),
    // ---- Issue #1081: Per-token spending limits ----
    /// Daily spent for a specific token (token_addr, day) -> i128
    TokenDailySpent(Address, u64),
    /// Weekly spent for a specific token (token_addr, week) -> i128
    TokenWeeklySpent(Address, u64),
    /// Supported token spending config by token address -> TokenSpendingConfig
    TokenSpendingConfig(Address),
    /// Voting power delegation (delegator) -> Delegation
    Delegation(Address),
    /// Delegation history for an address -> Vec<DelegationHistory>
    DelegationHistory(Address),
    /// Next delegation history ID counter -> u64
    NextDelegationId,
    /// Reverse delegation index: delegate -> Vec<delegators>
    DelegatorsFor(Address),
    /// Per-proposer per-token velocity history -> Vec<u64>
    VelocityHistoryByToken(Address, Address),
    /// Proposal IDs indexed by status (u32 repr of ProposalStatus) -> Vec<u64>
    StatusIndex(u32),
    /// Whitelist address index -> Vec<Address> (Issue #1094)
    WhitelistIndex,
    /// Blacklist address index -> Vec<Address> (Issue #1094)
    BlacklistIndex,
    /// Notification prefs subscriber index -> Vec<Address>
    NotificationPrefsIndex,
    // ---- Issue #1077: Hierarchical Tag Taxonomy ----
    /// Hierarchical tag record by ID -> Tag
    HTag(u64),
    /// Children tag IDs for a parent tag -> Vec<u64>
    HTagChildren(u64),
    /// Proposal IDs tagged with a hierarchical tag ID -> Vec<u64>
    HTagProposals(u64),
    /// Tag IDs assigned to a proposal (hierarchical) -> Vec<u64>
    ProposalHTagIds(u64),
    /// Next hierarchical tag ID counter -> u64
    NextHTagId,
    /// Total hierarchical tag count -> u64
    HTagCount,
    /// Tag name uniqueness within a parent scope.
    /// Key: parent_id (0 = root scope) -> Map<Symbol, u64> (name -> tag_id)
    HTagNameScope(u64),
    // ---- Issue #1086: Cold Storage Signatures ----
    /// Cold signature record (proposal_id, signer_pubkey_hash) -> ColdSignatureRecord
    ColdSig(u64, soroban_sdk::BytesN<32>),
    /// All cold signature pubkey hashes for a proposal -> Vec<BytesN<32>>
    ColdSigIndex(u64),
    /// Replay-prevention set: signature hash -> bool
    ColdSigUsed(soroban_sdk::BytesN<32>),
    // ---- Issue #1083: Variable Template Storage ----
    /// Variable-substitution template by ID -> VarTemplate
    VarTemplate(u64),
    /// Next VarTemplate ID counter -> u64
    NextVarTemplateId,
    /// Total VarTemplate count -> u64
    VarTemplateCount,
    /// VarTemplate name -> ID mapping -> u64
    VarTemplateName(soroban_sdk::Symbol),
    /// Template var-ref for a proposal -> TemplateVarRef
    ProposalVarRef(u64),
    /// Proposal IDs created from a VarTemplate -> Vec<u64>
    VarTemplateProposals(u64),
    // ---- Issue #1087: Audit Trail Compression ----
    /// Audit checkpoint by ID -> AuditCheckpoint
    AuditCheckpoint(u64),
    /// Next audit checkpoint ID counter -> u64
    NextAuditCheckpointId,
    // ---- Issue #1100: Vault Merge Protocol ----
    /// Merge record by ID -> MergeRecord
    MergeRecord(u64),
    /// Next merge ID counter -> u64
    NextMergeId,
    /// Whether this vault has been permanently deactivated by a completed merge -> bool
    VaultDeactivated,
    /// Active merge ID for this vault (0 if none) -> u64
    ActiveMergeId,
    // ---- Issue #1414: Reentrancy Guard ----
    /// Reentrancy guard for proposal execution (proposal_id) -> bool
    ProposalInProgress(u64),
    // ---- Issue #23: Proposal Supersession Chain ----
    /// Proposal ID -> ID of the proposal it supersedes (its parent in the chain), if any
    Supersedes(u64),
    /// Proposal ID -> ID of the proposal that superseded it (its direct child), if any
    SupersededBy(u64),
    // ---- Issue #1640: Timelock Ready Index ----
    /// Index of proposal IDs that are Approved and waiting inside a timelock window -> Vec<u64>
    TimelockReady,
    // ---- Issue #1093: Signer Participation Scoring ----
    /// Per-signer participation score -> SignerParticipationScore
    ParticipationScore(Address),
    /// Pending/executed force-rotation request by ID -> ForceRotationReq
    ForceRotationReq(u64),
    /// Next force-rotation request ID -> u64
    NextForceRotationId,
}

#[contracttype(export = false)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CounterKey {
    Template = 1,
    Escrow = 2,
    Dispute = 3,
    Subscription = 4,
    Recovery = 5,
    FundingRound = 6,
    Batch = 7,
    ScopedDelegation = 8,
}

#[contracttype(export = false)]
#[derive(Clone)]
pub enum VestingKey {
    Schedule(u64),
    NextId,
    ActiveCount,
    Reserved(Address),
}

#[contracttype(export = false)]
#[derive(Clone)]
pub enum CalendarKey {
    Holidays,
}

/// Feature-specific storage keys (split to avoid enum size limits)
#[contracttype(export = false)]
#[derive(Clone)]
pub enum FeatureKey {
    /// Generic counter key
    Counter(CounterKey),
    /// Insurance configuration -> InsuranceConfig
    InsuranceConfig,
    /// Per-user notification preferences -> NotificationPreferences
    NotificationPrefs(Address),
    /// DEX configuration -> DexConfig
    DexConfig,
    /// Swap proposal by ID -> SwapProposal
    SwapProposal(u64),
    /// Swap result by proposal ID -> SwapResult
    SwapResult(u64),
    /// Gas execution limit configuration -> GasConfig
    GasConfig,
    /// Cached fee estimate for proposal execution -> ExecutionFeeEstimate
    ExecutionFeeEstimate(u64),
    /// Vault-wide performance metrics -> VaultMetrics
    Metrics,
    /// Proposal template by ID -> ProposalTemplate
    Template(u64),
    /// Template name to ID mapping -> u64
    TemplateName(soroban_sdk::Symbol),
    /// Retry state for a proposal -> RetryState
    RetryState(u64),
    /// Escrow agreement by ID -> Escrow
    Escrow(u64),
    /// Escrow IDs by funder address -> Vec<u64>
    FunderEscrows(Address),
    /// Escrow IDs by recipient address -> Vec<u64>
    RecipientEscrows(Address),
    /// Insurance pool accumulated slashed funds (Token Address) -> i128
    InsurancePool(Address),
    /// Token lock by owner address -> TokenLock
    TokenLock(Address),
    /// Time-weighted voting configuration -> TimeWeightedConfig
    TimeWeightedConfig,
    /// Total locked tokens by address -> i128
    TotalLocked(Address),
    /// Fee structure configuration -> FeeStructure
    FeeStructure,
    /// Total fees collected per token -> i128
    FeesCollected(Address),
    /// User's total transaction volume per token -> i128
    UserVolume(Address, Address),
    /// Staking configuration -> StakingConfig
    StakingConfig,
    // ---- Issue #1355: Insurance claim voting governance ----
    /// Insurance claim voting parameters -> InsuranceVotingConfig
    InsuranceVotingConfig,
    // ---- Issue #1356: Amendment limits ----
    /// Maximum number of amendments allowed per proposal -> u32
    MaxAmendments,
    /// Staking pool accumulated funds (Token Address) -> i128
    StakePool(Address),
    /// Stake record for a proposal -> StakeRecord
    StakeRecord(u64),
    /// Cross-vault proposal configuration -> CrossVaultProposal
    CrossVaultProposal(u64),
    /// Cross-vault configuration -> CrossVaultConfig
    CrossVaultConfig,
    /// Bridge record by bridge ID -> BridgeRecord
    BridgeRecord(soroban_sdk::BytesN<32>),
    /// Dispute by ID -> Dispute
    Dispute(u64),
    /// Disputes for a proposal -> Vec<u64>
    ProposalDisputes(u64),
    /// Batch transaction by ID -> BatchTransaction
    Batch(u64),
    /// Batch execution result -> BatchExecutionResult
    BatchResult(u64),
    /// Batch rollback state -> Vec<(Address, i128)>
    BatchRollback(u64),
    /// Threshold reduction flag for a proposal -> bool
    ThresholdReduced(u64),
    /// Recovery proposal by ID -> RecoveryProposal
    RecoveryProposal(u64),
    /// Insurance pool accumulated slashed funds (Token Address) -> i128
    /// Funding round by ID -> FundingRound
    FundingRound(u64),
    /// Funding round IDs by proposal ID -> Vec<u64>
    ProposalFundingRounds(u64),
    /// Funding round configuration -> FundingRoundConfig
    FundingRoundConfig,
    /// Batch transaction storage (nested with BatchKey)
    /// Oracle configuration -> VaultOracleConfig
    VaultOracleConfig,
    /// Active voting strategy for proposal approvals -> VotingStrategy
    VotingStrategy,
    /// Ledger sequence when an approval was cast -> u64
    ApprovalLedger(u64, Address),
    /// Address permissions -> Vec<PermissionGrant>
    Permissions(Address),
    /// Delegated permissions (delegatee, delegator, permission as u32) -> DelegatedPermission
    DelegatedPermission(Address, Address, u32),
    /// Auto-complete flag for a stream (stream id) -> bool (Issue #1359)
    StreamAutoComplete(u64),
    /// Subscription by ID -> Subscription
    Subscription(u64),
    /// Subscription IDs indexed by subscriber address -> Vec<u64>
    SubscriberIndex(Address),
    /// Reputation decay configuration -> ReputationConfig
    ReputationConfig,
    /// Bridge configuration -> BridgeConfig
    BridgeConfig,
    /// Cross-chain proposal -> CrossChainProposal
    CrossChainProposal(u64),
    /// Re-entrancy guard for bridge execution (proposal_id) -> bool
    BridgeLock(u64),
    /// Time-bucketed metrics snapshot keyed by week number -> VaultMetrics
    MetricsBucket(u64),
    /// Ordered list of stored bucket week numbers (for pruning) -> Vec<u64>
    MetricsBucketIndex,
    /// Pending config change proposal ID -> u64
    PendingConfig,
    /// On-chain whitelist entry -> WhitelistEntry (issue #1094)
    WhitelistEntry(Address),
    /// Multi-phase proposal by base proposal ID -> MultiPhaseProposal (issue #1096)
    MultiPhaseProposal(u64),
    /// Capability token by ID -> CapabilityToken (issue #1097)
    CapabilityToken(BytesN<32>),
    /// Moderator flag for an address -> bool
    Moderator(Address),
    /// Comment rate tracking: (proposal_id, author, day_number) -> u32
    CommentRateCount(u64, Address, u64),
    // ---- Issue #1085: Gas Cost Estimation Oracle ----
    /// Per-operation cost model -> CostModel
    CostModel,
    // ---- Issue #1367: Gas-Price Oracle for fee estimation ----
    /// Live gas-price oracle configuration -> GasPriceOracleConfig
    GasPriceOracle,
    // ---- Issue #1086: Cold Storage Config ----
    /// Cold signer configuration -> ColdSignerConfig
    ColdSignerConfig,
    // ---- Dead letter queue helpers ----
    /// Dead letter record by ID -> DeadLetterRecord
    DeadLetter(u64),
    /// Dead letter count -> u64
    DeadLetterCount,
    /// Vault pause state -> PauseState
    PauseState,
    /// Emergency signers list -> Vec<Address>
    EmergencySigners,
    /// Pause cooldown configuration -> PauseCooldownConfig (Issue #1350)
    PauseCooldownConfig,
    /// Circuit breaker outflow per hour window -> i128
    CircuitBreakerOutflow(u64),
    /// Proposal content fingerprint -> bool
    ProposalFingerprint(soroban_sdk::BytesN<32>),
    /// Circuit breaker threshold -> i128
    CircuitBreakerThreshold,
    /// Compliance rules -> Vec<ComplianceRule>
    ComplianceRules,
    /// Scoped delegation record -> ScopedDelegation
    ScopedDelegation(u64),
    /// Scoped delegation IDs by delegator -> Vec<u64>
    ScopedDelegationsByDelegator(soroban_sdk::Address),
    /// Balance snapshots -> Vec<BalanceSnapshot>
    BalanceSnapshots,
    /// Snapshot interval in ledgers -> u32
    SnapshotInterval,
    /// Last snapshot ledger -> u64
    LastSnapshotLedger,
    /// Governance proposal by ID -> GovernanceProposal
    GovernanceProposal(u64),
    /// Governance supermajority threshold (percentage) -> u32
    GovernanceThreshold,
    /// Active governance proposal count -> u32
    ActiveGovernanceCount,
    /// Next governance proposal ID -> u64
    NextGovernanceId,
    /// Deadline extension count per proposal -> u32
    DeadlineExtensionCount(u64),
    /// Staking tier for a proposer (Address) -> u32
    ProposerStakingTier(Address),
    /// Execution count for tier progression (Address) -> u64
    ProposerExecutionCount(Address),
    /// Accumulated rewards for a proposer (Address) -> i128
    ProposerAccumulatedRewards(Address),
    /// Subscription tier usage tracking (subscription_id) -> Map of usage metrics
    SubscriptionUsage(u64),
    // ---- Issue #1091: Keeper Network Lifecycle Hooks ----
    /// Registered keeper hooks for a specific event type -> Vec<HookRegistration>
    KeeperHooks(u32),
    /// Total keeper hook count across all event types -> u32
    KeeperHookCount,
}

/// TTL constants (in ledgers, ~5 seconds each)
pub const DAY_IN_LEDGERS: u32 = 17_280; // ~24 hours
pub const PROPOSAL_TTL: u32 = DAY_IN_LEDGERS * 7; // 7 days
pub const INSTANCE_TTL: u32 = DAY_IN_LEDGERS * 30; // 30 days
pub const INSTANCE_TTL_THRESHOLD: u32 = DAY_IN_LEDGERS * 7; // Extend when below 7 days
pub const PERSISTENT_TTL: u32 = DAY_IN_LEDGERS * 30; // 30 days
pub const PERSISTENT_TTL_THRESHOLD: u32 = DAY_IN_LEDGERS * 7; // Extend when below 7 days
/// Default volume-tracking window for the tiered fee system (~30 days)
pub const VOLUME_WINDOW_DEFAULT: u64 = DAY_IN_LEDGERS as u64 * 30;

// ============================================================================
// Signer tiers
// ============================================================================

pub fn set_signer_tier(env: &Env, signer: &Address, tier: &SignerTier) {
    if let Some(mut config) = env.storage().instance().get::<_, Config>(&DataKey::Config) {
        config.signer_tiers.set(signer.clone(), tier.clone());
        env.storage().instance().set(&DataKey::Config, &config);
    }
}

pub fn get_signer_tier(env: &Env, signer: &Address) -> SignerTier {
    env.storage()
        .instance()
        .get::<_, Config>(&DataKey::Config)
        .and_then(|config| config.signer_tiers.get(signer.clone()))
        .unwrap_or(SignerTier::Principal)
}

pub fn set_full_quorum_threshold(env: &Env, threshold: i128) {
    if let Some(mut config) = env.storage().instance().get::<_, Config>(&DataKey::Config) {
        config.full_quorum_threshold = threshold;
        env.storage().instance().set(&DataKey::Config, &config);
    }
}

pub fn get_full_quorum_threshold(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, Config>(&DataKey::Config)
        .map(|config| config.full_quorum_threshold)
        .unwrap_or(0)
}

// ============================================================================
// Vesting schedules
// ============================================================================

pub fn next_vesting_id(env: &Env) -> u64 {
    let id = env
        .storage()
        .instance()
        .get(&VestingKey::NextId)
        .unwrap_or(1);
    env.storage().instance().set(&VestingKey::NextId, &(id + 1));
    id
}

pub fn set_vesting_schedule(env: &Env, schedule: &VestingSchedule) {
    let key = VestingKey::Schedule(schedule.id);
    env.storage().persistent().set(&key, schedule);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_vesting_schedule(env: &Env, id: u64) -> Option<VestingSchedule> {
    env.storage().persistent().get(&VestingKey::Schedule(id))
}

pub fn get_active_vesting_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&VestingKey::ActiveCount)
        .unwrap_or(0)
}

pub fn set_active_vesting_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&VestingKey::ActiveCount, &count);
}

pub fn get_reserved_vesting(env: &Env, token: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&VestingKey::Reserved(token.clone()))
        .unwrap_or(0)
}

pub fn set_reserved_vesting(env: &Env, token: &Address, amount: i128) {
    let key = VestingKey::Reserved(token.clone());
    env.storage().persistent().set(&key, &amount);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

// ============================================================================
// Holiday calendar
// ============================================================================

pub fn set_holiday_calendar(env: &Env, calendar: &HolidayCalendar) {
    env.storage()
        .persistent()
        .set(&CalendarKey::Holidays, calendar);
    env.storage().persistent().extend_ttl(
        &CalendarKey::Holidays,
        PERSISTENT_TTL_THRESHOLD,
        PERSISTENT_TTL,
    );
}

pub fn get_holiday_calendar(env: &Env) -> HolidayCalendar {
    env.storage()
        .persistent()
        .get(&CalendarKey::Holidays)
        .unwrap_or(HolidayCalendar {
            holiday_ledgers: Vec::new(env),
        })
}

// ============================================================================
// Initialization
// ============================================================================

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

// ============================================================================
// Config
// ============================================================================

pub fn get_config(env: &Env) -> Result<Config, VaultError> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(VaultError::NotInitialized)
}

pub fn set_config(env: &Env, config: &Config) {
    env.storage().instance().set(&DataKey::Config, config);
}

pub fn get_voting_strategy(env: &Env) -> VotingStrategy {
    env.storage()
        .instance()
        .get(&DataKey::VotingStrategy)
        .unwrap_or(VotingStrategy::Simple)
}

pub fn set_voting_strategy(env: &Env, strategy: &VotingStrategy) {
    env.storage()
        .instance()
        .set(&DataKey::VotingStrategy, strategy);
}

pub fn set_approval_ledger(env: &Env, proposal_id: u64, voter: &Address, ledger: u64) {
    let key = DataKey::ApprovalLedger(proposal_id, voter.clone());
    env.storage().persistent().set(&key, &ledger);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

#[allow(dead_code)]
pub fn get_approval_ledger(env: &Env, proposal_id: u64, voter: &Address) -> Option<u64> {
    let key = DataKey::ApprovalLedger(proposal_id, voter.clone());
    env.storage().persistent().get(&key)
}

pub fn is_veto_address(env: &Env, addr: &Address) -> Result<bool, VaultError> {
    let config = get_config(env)?;
    Ok(config.veto_addresses.contains(addr))
}

// ============================================================================
// Roles
// ============================================================================

pub fn get_role(env: &Env, addr: &Address) -> Role {
    env.storage()
        .persistent()
        .get(&DataKey::Role(addr.clone()))
        .unwrap_or(Role::Member)
}

pub fn set_role(env: &Env, addr: &Address, role: Role) {
    let key = DataKey::Role(addr.clone());
    env.storage().persistent().set(&key, &role);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
    add_role_index_address(env, addr);
}

pub fn get_role_index(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::RoleIndex)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_role_index_address(env: &Env, addr: &Address) {
    let mut index = get_role_index(env);
    if !index.contains(addr) {
        index.push_back(addr.clone());
        env.storage().instance().set(&DataKey::RoleIndex, &index);
    }
}

pub fn get_role_assignments(env: &Env) -> Vec<RoleAssignment> {
    let index = get_role_index(env);
    let mut assignments = Vec::new(env);

    for i in 0..index.len() {
        if let Some(addr) = index.get(i) {
            assignments.push_back(RoleAssignment {
                role: get_role(env, &addr),
                addr,
            });
        }
    }

    assignments
}

// ============================================================================
// Proposals
// ============================================================================

pub fn get_proposal(env: &Env, id: u64) -> Result<Proposal, VaultError> {
    let mut proposal: Proposal = env
        .storage()
        .persistent()
        .get(&DataKey::Proposal(id))
        .ok_or(VaultError::ProposalNotFound)?;
    proposal.attachments = get_attachments(env, id);
    // Issue #1345: migrate legacy proposals that predate spend bucket fields.
    // `has_spend_buckets == false` is the Soroban default for old stored proposals.
    if !proposal.has_spend_buckets {
        proposal.spend_day = get_day_number(env);
        proposal.spend_week = get_week_number(env);
        proposal.has_spend_buckets = true;
        set_proposal(env, &proposal);
    }
    Ok(proposal)
}

pub fn proposal_exists(env: &Env, id: u64) -> bool {
    env.storage().persistent().has(&DataKey::Proposal(id))
}

pub fn set_proposal(env: &Env, proposal: &Proposal) {
    let key = DataKey::Proposal(proposal.id);
    env.storage().persistent().set(&key, proposal);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
    // Maintain StatusIndex
    let status_u32 = proposal.status.clone() as u32;
    let idx_key = DataKey::StatusIndex(status_u32);
    let mut ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&idx_key)
        .unwrap_or_else(|| Vec::new(env));
    if !ids.contains(proposal.id) {
        ids.push_back(proposal.id);
        env.storage().persistent().set(&idx_key, &ids);
        env.storage()
            .persistent()
            .extend_ttl(&idx_key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
    }
    // Maintain TimelockReady index (Issue #1640)
    // A proposal belongs in the index only while it is Approved AND still inside
    // its timelock window (unlock_ledger > 0).  Any terminal/non-timelocked
    // transition removes it from the index.
    if proposal.status == ProposalStatus::Approved && proposal.unlock_ledger > 0 {
        add_to_timelock_ready_index(env, proposal.id);
    } else {
        remove_from_timelock_ready_index(env, proposal.id);
    }
}

pub fn get_next_proposal_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextProposalId)
        .unwrap_or_else(|| {
            // Start from prefix + 1 if prefix is set
            let cfg: Option<crate::types::Config> = env.storage().instance().get(&DataKey::Config);
            if let Some(c) = cfg {
                if c.proposal_id_prefix > 0 {
                    c.proposal_id_prefix + 1
                } else {
                    1
                }
            } else {
                1
            }
        })
}

pub fn increment_proposal_id(env: &Env) -> u64 {
    let id = get_next_proposal_id(env);
    env.storage()
        .instance()
        .set(&DataKey::NextProposalId, &(id + 1));
    id
}

/// Return a page of existing proposal IDs in ascending creation order.
///
/// IDs are assigned sequentially starting at 1. This function scans the
/// range `[offset+1 .. next_id)` and collects up to `limit` IDs that have
/// a stored proposal entry, skipping any gaps left by deleted proposals.
///
/// # Arguments
/// * `offset` - Number of proposals to skip (0-based).
/// * `limit`  - Maximum number of IDs to return. Capped at 100 internally.
///
/// # Returns
/// A vector of proposal IDs in ascending order, paginated by offset/limit.
pub fn get_proposal_ids_paginated(env: &Env, offset: u64, limit: u64) -> Vec<u64> {
    let cap: u64 = if limit > 100 { 100 } else { limit };
    let next_id = get_next_proposal_id(env);
    let mut ids: Vec<u64> = Vec::new(env);
    let mut skipped: u64 = 0;

    for id in 1..next_id {
        if !env.storage().persistent().has(&DataKey::Proposal(id)) {
            continue;
        }
        if skipped < offset {
            skipped += 1;
            continue;
        }
        ids.push_back(id);
        if ids.len() as u64 >= cap {
            break;
        }
    }
    ids
}

// ============================================================================
// TimelockReady Index  (Issue #1640)
// ============================================================================

/// Add `proposal_id` to the timelock-ready index.
///
/// Called when a proposal transitions to `Approved` with a non-zero `unlock_ledger`
/// (i.e., it must wait inside its timelock window before execution).
pub fn add_to_timelock_ready_index(env: &Env, proposal_id: u64) {
    let mut ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&DataKey::TimelockReady)
        .unwrap_or_else(|| Vec::new(env));
    if !ids.contains(proposal_id) {
        ids.push_back(proposal_id);
        env.storage()
            .persistent()
            .set(&DataKey::TimelockReady, &ids);
        env.storage().persistent().extend_ttl(
            &DataKey::TimelockReady,
            PROPOSAL_TTL / 2,
            PROPOSAL_TTL,
        );
    }
}

/// Remove `proposal_id` from the timelock-ready index.
///
/// Called when a proposal leaves the timelock window (executed, cancelled, rejected, expired)
/// or when it is found to have become executable (unlock_ledger passed) during a query.
pub fn remove_from_timelock_ready_index(env: &Env, proposal_id: u64) {
    let ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&DataKey::TimelockReady)
        .unwrap_or_else(|| Vec::new(env));
    let mut new_ids: Vec<u64> = Vec::new(env);
    for id in ids.iter() {
        if id != proposal_id {
            new_ids.push_back(id);
        }
    }
    env.storage()
        .persistent()
        .set(&DataKey::TimelockReady, &new_ids);
    if !new_ids.is_empty() {
        env.storage().persistent().extend_ttl(
            &DataKey::TimelockReady,
            PROPOSAL_TTL / 2,
            PROPOSAL_TTL,
        );
    }
}

/// Return a paginated slice of proposal IDs that are `Approved` and are still
/// inside their timelock window (`unlock_ledger > current_ledger`).
///
/// Entries that no longer satisfy these conditions (proposal gone, status changed,
/// or timelock already expired) are skipped but **not** pruned here to keep this
/// function read-only and gas-predictable.  Index compaction is handled lazily by
/// `remove_from_timelock_ready_index` at execution/cancellation time.
///
/// # Arguments
/// * `offset` – Number of qualifying entries to skip (0-based).
/// * `limit`  – Maximum entries to return (capped at 50).
///
/// # Returns
/// `Vec<u64>` of proposal IDs in index insertion order.
pub fn get_pending_timelocked_proposals(env: &Env, offset: u64, limit: u32) -> Vec<u64> {
    let cap: u32 = if limit > 50 { 50 } else { limit };
    let current_ledger = env.ledger().sequence() as u64;

    let ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&DataKey::TimelockReady)
        .unwrap_or_else(|| Vec::new(env));

    let mut result: Vec<u64> = Vec::new(env);
    let mut skipped: u64 = 0;

    for i in 0..ids.len() {
        if result.len() >= cap {
            break;
        }
        let id = match ids.get(i) {
            Some(v) => v,
            None => continue,
        };
        // Skip proposals that no longer exist in storage
        let proposal: Proposal = match env.storage().persistent().get(&DataKey::Proposal(id)) {
            Some(p) => p,
            None => continue,
        };
        // Must still be Approved with a pending (non-zero, not-yet-passed) timelock
        if proposal.status != ProposalStatus::Approved {
            continue;
        }
        if proposal.unlock_ledger == 0 || current_ledger >= proposal.unlock_ledger {
            continue;
        }
        // Entry qualifies — apply offset/limit
        if skipped < offset {
            skipped += 1;
            continue;
        }
        result.push_back(id);
    }
    result
}

// ============================================================================
// Priority Queue
// ============================================================================

pub fn get_priority_queue(env: &Env, priority: u32) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::PriorityQueue(priority))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn get_active_priority_queue(env: &Env, priority: u32) -> Vec<u64> {
    let queue = get_priority_queue(env, priority);
    let mut active_queue = Vec::new(env);

    for proposal_id in queue.iter() {
        let status = env
            .storage()
            .persistent()
            .get::<_, Proposal>(&DataKey::Proposal(proposal_id))
            .map(|proposal| proposal.status);

        if status == Some(ProposalStatus::Pending) {
            active_queue.push_back(proposal_id);
        }
    }

    active_queue
}

pub fn add_to_priority_queue(env: &Env, priority: u32, proposal_id: u64) {
    let mut queue = get_priority_queue(env, priority);
    queue.push_back(proposal_id);
    let key = DataKey::PriorityQueue(priority);
    env.storage().persistent().set(&key, &queue);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

pub fn remove_from_priority_queue(env: &Env, priority: u32, proposal_id: u64) {
    let queue = get_priority_queue(env, priority);
    let mut new_queue: Vec<u64> = Vec::new(env);
    for i in 0..queue.len() {
        let id = queue.get(i).unwrap();
        if id != proposal_id {
            new_queue.push_back(id);
        }
    }
    let key = DataKey::PriorityQueue(priority);
    env.storage().persistent().set(&key, &new_queue);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

pub fn compact_priority_queue(env: &Env, priority: u32) -> Vec<u64> {
    let active_queue = get_active_priority_queue(env, priority);
    let key = DataKey::PriorityQueue(priority);
    env.storage().persistent().set(&key, &active_queue);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
    active_queue
}

// ============================================================================
// Daily Spending
// ============================================================================

/// Get current day number from ledger timestamp
pub fn get_day_number(env: &Env) -> u64 {
    env.ledger().timestamp() / 86400
}

pub fn get_daily_spent(env: &Env, day: u64) -> i128 {
    env.storage()
        .temporary()
        .get(&DataKey::DailySpent(day))
        .unwrap_or(0)
}

pub fn add_daily_spent(env: &Env, day: u64, amount: i128) {
    // Soroban ledger execution is single-writer per transaction; reading and
    // writing in the same invocation is atomic with respect to other transactions.
    let current = get_daily_spent(env, day);
    let key = DataKey::DailySpent(day);
    env.storage().temporary().set(&key, &(current + amount));
    env.storage()
        .temporary()
        .extend_ttl(&key, DAY_IN_LEDGERS * 2, DAY_IN_LEDGERS * 2);
}

/// Atomically deduct `amount` from the daily spent counter.
///
/// Reads the current value, validates the deduction won't go negative, then
/// writes the result in the same storage call. Returns `true` on success,
/// `false` if the deduction would underflow (counter already at zero).
///
/// # Soroban single-writer guarantee
/// Soroban executes each transaction sequentially within a ledger. A read
/// followed by a write in the same contract invocation is therefore atomic:
/// no other transaction can interleave between the read and the write.
/// This prevents the double-refund race described in issue #904.
pub fn try_deduct_daily_spent(env: &Env, day: u64, amount: i128) -> bool {
    let current = get_daily_spent(env, day);
    if amount > current {
        return false;
    }
    let key = DataKey::DailySpent(day);
    env.storage().temporary().set(&key, &(current - amount));
    env.storage()
        .temporary()
        .extend_ttl(&key, DAY_IN_LEDGERS * 2, DAY_IN_LEDGERS * 2);
    true
}

// ============================================================================
// Weekly Spending
// ============================================================================

/// Get current week number (epoch / 7 days)
pub fn get_week_number(env: &Env) -> u64 {
    env.ledger().timestamp() / 604800
}

pub fn get_weekly_spent(env: &Env, week: u64) -> i128 {
    env.storage()
        .temporary()
        .get(&DataKey::WeeklySpent(week))
        .unwrap_or(0)
}

pub fn add_weekly_spent(env: &Env, week: u64, amount: i128) {
    // Soroban ledger execution is single-writer per transaction; reading and
    // writing in the same invocation is atomic with respect to other transactions.
    let current = get_weekly_spent(env, week);
    let key = DataKey::WeeklySpent(week);
    env.storage().temporary().set(&key, &(current + amount));
    env.storage()
        .temporary()
        .extend_ttl(&key, DAY_IN_LEDGERS * 14, DAY_IN_LEDGERS * 14);
}

/// Atomically deduct `amount` from the weekly spent counter.
///
/// See `try_deduct_daily_spent` for the atomicity guarantee.
/// Returns `true` on success, `false` if the deduction would underflow.
pub fn try_deduct_weekly_spent(env: &Env, week: u64, amount: i128) -> bool {
    let current = get_weekly_spent(env, week);
    if amount > current {
        return false;
    }
    let key = DataKey::WeeklySpent(week);
    env.storage().temporary().set(&key, &(current - amount));
    env.storage()
        .temporary()
        .extend_ttl(&key, DAY_IN_LEDGERS * 14, DAY_IN_LEDGERS * 14);
    true
}

// ============================================================================
// Recurring Payments
// ============================================================================

pub fn get_next_recurring_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextRecurringId)
        .unwrap_or(1)
}

pub fn increment_recurring_id(env: &Env) -> u64 {
    let id = get_next_recurring_id(env);
    env.storage()
        .instance()
        .set(&DataKey::NextRecurringId, &(id + 1));
    id
}

pub fn set_recurring_payment(env: &Env, payment: &crate::types::RecurringPayment) {
    let key = DataKey::Recurring(payment.id);
    env.storage().persistent().set(&key, payment);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

pub fn get_recurring_payment(
    env: &Env,
    id: u64,
) -> Result<crate::types::RecurringPayment, VaultError> {
    env.storage()
        .persistent()
        .get(&DataKey::Recurring(id))
        .ok_or(VaultError::ProposalNotFound)
}

// ============================================================================
// Recurring Payments - Listing
// ============================================================================

/// Return a page of existing recurring payment IDs in ascending creation order.
///
/// IDs are assigned sequentially starting at 1. This function scans the
/// range `[offset+1 .. next_id)` and collects up to `limit` IDs that have
/// a stored recurring payment entry.
///
/// # Arguments
/// * `offset` - Number of payments to skip (0-based).
/// * `limit`  - Maximum number of IDs to return. Capped at 100 internally.
///
/// # Returns
/// A vector of recurring payment IDs in ascending order, paginated by offset/limit.
pub fn get_recurring_payment_ids_paginated(env: &Env, offset: u64, limit: u64) -> Vec<u64> {
    let cap: u64 = if limit > 100 { 100 } else { limit };
    let next_id = get_next_recurring_id(env);
    let mut ids: Vec<u64> = Vec::new(env);
    let mut skipped: u64 = 0;

    for id in 1..next_id {
        if !env.storage().persistent().has(&DataKey::Recurring(id)) {
            continue;
        }
        if skipped < offset {
            skipped += 1;
            continue;
        }
        ids.push_back(id);
        if ids.len() as u64 >= cap {
            break;
        }
    }
    ids
}

/// Return a page of recurring payments in ascending creation order.
///
/// # Arguments
/// * `offset` - Number of payments to skip (0-based).
/// * `limit`  - Maximum number of payments to return. Capped at 50 internally.
///
/// # Returns
/// A vector of RecurringPayment structs in ascending order by ID.
pub fn get_recurring_payments_paginated(
    env: &Env,
    offset: u64,
    limit: u64,
) -> Vec<crate::types::RecurringPayment> {
    let cap: u64 = if limit > 50 { 50 } else { limit };
    let ids = get_recurring_payment_ids_paginated(env, offset, cap);
    let mut payments: Vec<crate::types::RecurringPayment> = Vec::new(env);

    for id in ids {
        if let Ok(payment) = get_recurring_payment(env, id) {
            payments.push_back(payment);
        }
    }
    payments
}

// ============================================================================
// Streaming Payments
// ============================================================================

pub fn get_next_stream_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextStreamId)
        .unwrap_or(1u64)
}

pub fn increment_stream_id(env: &Env) -> u64 {
    let id = get_next_stream_id(env);
    env.storage()
        .instance()
        .set(&DataKey::NextStreamId, &(id + 1));
    extend_instance_ttl(env);
    id
}

pub fn set_streaming_payment(env: &Env, stream: &crate::types::StreamingPayment) {
    let key = DataKey::Stream(stream.id);
    env.storage().persistent().set(&key, stream);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_streaming_payment(
    env: &Env,
    id: u64,
) -> Result<crate::types::StreamingPayment, VaultError> {
    env.storage()
        .persistent()
        .get(&DataKey::Stream(id))
        .ok_or(VaultError::ProposalNotFound)
}

/// Store the auto-complete-on-insufficient-balance flag for a stream (Issue #1359).
pub fn set_stream_auto_complete(env: &Env, stream_id: u64, enabled: bool) {
    let key = FeatureKey::StreamAutoComplete(stream_id);
    env.storage().persistent().set(&key, &enabled);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

/// Read the auto-complete flag for a stream; defaults to `false` (Issue #1359).
pub fn get_stream_auto_complete(env: &Env, stream_id: u64) -> bool {
    env.storage()
        .persistent()
        .get(&FeatureKey::StreamAutoComplete(stream_id))
        .unwrap_or(false)
}

// ============================================================================
// TTL Management
// ============================================================================

pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

// ============================================================================
// Recipient Lists
// ============================================================================

pub fn get_list_mode(env: &Env) -> ListMode {
    env.storage()
        .instance()
        .get(&DataKey::ListMode)
        .unwrap_or(ListMode::Disabled)
}

pub fn set_list_mode(env: &Env, mode: ListMode) {
    env.storage().instance().set(&DataKey::ListMode, &mode);
}

pub fn is_whitelisted(env: &Env, addr: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Whitelist(addr.clone()))
        .unwrap_or(false)
}

pub fn add_to_whitelist(env: &Env, addr: &Address) {
    let key = DataKey::Whitelist(addr.clone());
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
    // Maintain index
    let mut index: Vec<Address> = env
        .storage()
        .persistent()
        .get(&DataKey::WhitelistIndex)
        .unwrap_or_else(|| Vec::new(env));
    if !index.contains(addr) {
        index.push_back(addr.clone());
        env.storage()
            .persistent()
            .set(&DataKey::WhitelistIndex, &index);
        env.storage().persistent().extend_ttl(
            &DataKey::WhitelistIndex,
            INSTANCE_TTL_THRESHOLD,
            INSTANCE_TTL,
        );
    }
}

pub fn remove_from_whitelist(env: &Env, addr: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Whitelist(addr.clone()));
    // Remove from index
    let index: Vec<Address> = env
        .storage()
        .persistent()
        .get(&DataKey::WhitelistIndex)
        .unwrap_or_else(|| Vec::new(env));
    let mut new_index: Vec<Address> = Vec::new(env);
    for a in index.iter() {
        if a != *addr {
            new_index.push_back(a);
        }
    }
    env.storage()
        .persistent()
        .set(&DataKey::WhitelistIndex, &new_index);
}

pub fn is_blacklisted(env: &Env, addr: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Blacklist(addr.clone()))
        .unwrap_or(false)
}

pub fn add_to_blacklist(env: &Env, addr: &Address) {
    let key = DataKey::Blacklist(addr.clone());
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
    // Maintain index
    let mut index: Vec<Address> = env
        .storage()
        .persistent()
        .get(&DataKey::BlacklistIndex)
        .unwrap_or_else(|| Vec::new(env));
    if !index.contains(addr) {
        index.push_back(addr.clone());
        env.storage()
            .persistent()
            .set(&DataKey::BlacklistIndex, &index);
        env.storage().persistent().extend_ttl(
            &DataKey::BlacklistIndex,
            INSTANCE_TTL_THRESHOLD,
            INSTANCE_TTL,
        );
    }
}

pub fn remove_from_blacklist(env: &Env, addr: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Blacklist(addr.clone()));
    // Remove from index
    let index: Vec<Address> = env
        .storage()
        .persistent()
        .get(&DataKey::BlacklistIndex)
        .unwrap_or_else(|| Vec::new(env));
    let mut new_index: Vec<Address> = Vec::new(env);
    for a in index.iter() {
        if a != *addr {
            new_index.push_back(a);
        }
    }
    env.storage()
        .persistent()
        .set(&DataKey::BlacklistIndex, &new_index);
}

pub fn get_whitelist_index(env: &Env) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::WhitelistIndex)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn get_blacklist_index(env: &Env) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::BlacklistIndex)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn get_whitelist_paginated(env: &Env, offset: u64, limit: u64) -> Vec<Address> {
    let cap: u64 = if limit > 100 { 100 } else { limit };
    let index = get_whitelist_index(env);
    let mut result: Vec<Address> = Vec::new(env);
    let mut skipped: u64 = 0;
    for i in 0..index.len() {
        if let Some(addr) = index.get(i) {
            if skipped < offset {
                skipped += 1;
                continue;
            }
            result.push_back(addr);
            if result.len() as u64 >= cap {
                break;
            }
        }
    }
    result
}

pub fn get_blacklist_paginated(env: &Env, offset: u64, limit: u64) -> Vec<Address> {
    let cap: u64 = if limit > 100 { 100 } else { limit };
    let index = get_blacklist_index(env);
    let mut result: Vec<Address> = Vec::new(env);
    let mut skipped: u64 = 0;
    for i in 0..index.len() {
        if let Some(addr) = index.get(i) {
            if skipped < offset {
                skipped += 1;
                continue;
            }
            result.push_back(addr);
            if result.len() as u64 >= cap {
                break;
            }
        }
    }
    result
}

pub fn get_proposals_by_status(env: &Env, status: u32, offset: u64, limit: u64) -> Vec<u64> {
    let cap: u64 = if limit > 50 { 50 } else { limit };
    let key = DataKey::StatusIndex(status);
    let ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    let mut result: Vec<u64> = Vec::new(env);
    let mut skipped: u64 = 0;
    for i in 0..ids.len() {
        if let Some(id) = ids.get(i) {
            if !env.storage().persistent().has(&DataKey::Proposal(id)) {
                continue;
            }
            if skipped < offset {
                skipped += 1;
                continue;
            }
            result.push_back(id);
            if result.len() as u64 >= cap {
                break;
            }
        }
    }
    result
}

pub fn get_proposals_by_ledger_range(
    env: &Env,
    from_ledger: u64,
    to_ledger: u64,
    offset: u64,
    limit: u64,
) -> Vec<u64> {
    let cap: u64 = if limit > 50 { 50 } else { limit };
    let next_id = get_next_proposal_id(env);
    let mut result: Vec<u64> = Vec::new(env);
    let mut skipped: u64 = 0;
    // Determine start ID: for prefixed vaults, scan from prefix+1
    let cfg: Option<crate::types::Config> = env.storage().instance().get(&DataKey::Config);
    let start_id = if let Some(c) = cfg {
        if c.proposal_id_prefix > 0 {
            c.proposal_id_prefix + 1
        } else {
            1
        }
    } else {
        1
    };
    for id in start_id..next_id {
        if result.len() as u64 >= cap {
            break;
        }
        if !env.storage().persistent().has(&DataKey::Proposal(id)) {
            continue;
        }
        let proposal: crate::types::Proposal =
            match env.storage().persistent().get(&DataKey::Proposal(id)) {
                Some(p) => p,
                None => continue,
            };
        if proposal.created_at >= from_ledger && proposal.created_at <= to_ledger {
            if skipped < offset {
                skipped += 1;
                continue;
            }
            result.push_back(id);
        }
    }
    result
}

pub fn prune_status_index_for_proposal(env: &Env, proposal_id: u64) {
    // Remove proposal_id from all status index entries
    for status_u32 in 0u32..8u32 {
        let key = DataKey::StatusIndex(status_u32);
        if let Some(ids) = env.storage().persistent().get::<_, Vec<u64>>(&key) {
            let mut new_ids: Vec<u64> = Vec::new(env);
            for id in ids.iter() {
                if id != proposal_id {
                    new_ids.push_back(id);
                }
            }
            env.storage().persistent().set(&key, &new_ids);
        }
    }
}

#[allow(dead_code)]
pub fn validate_recipient_list(env: &Env, recipient: &Address) -> Result<(), VaultError> {
    let mode = get_list_mode(env);
    match mode {
        ListMode::Disabled => Ok(()),
        ListMode::Whitelist => {
            if !is_whitelisted(env, recipient) {
                return Err(VaultError::RecipientBlacklisted);
            }
            Ok(())
        }
        ListMode::Blacklist => {
            if is_blacklisted(env, recipient) {
                return Err(VaultError::RecipientBlacklisted);
            }
            Ok(())
        }
    }
}

// ============================================================================
// Velocity Checking (Sliding Window)
// ============================================================================

pub fn check_and_update_velocity(
    env: &Env,
    addr: &Address,
    token: &Address,
    config: &VelocityConfig,
) -> bool {
    let now = env.ledger().timestamp();
    let window_start = now.saturating_sub(config.window);

    // --- Global per-proposer check ---
    let global_key = DataKey::VelocityHistory(addr.clone());
    let global_history: Vec<u64> = env
        .storage()
        .temporary()
        .get(&global_key)
        .unwrap_or_else(|| Vec::new(env));

    let mut updated_global: Vec<u64> = Vec::new(env);
    for ts in global_history.iter() {
        if ts > window_start {
            updated_global.push_back(ts);
        }
    }

    if updated_global.len() >= config.limit {
        return false;
    }

    // --- Per-token per-proposer check (if per_token_limit > 0) ---
    if config.per_token_limit > 0 {
        let token_key = DataKey::VelocityHistoryByToken(addr.clone(), token.clone());
        let token_history: Vec<u64> = env
            .storage()
            .temporary()
            .get(&token_key)
            .unwrap_or_else(|| Vec::new(env));

        let mut updated_token: Vec<u64> = Vec::new(env);
        for ts in token_history.iter() {
            if ts > window_start {
                updated_token.push_back(ts);
            }
        }

        if updated_token.len() >= config.per_token_limit {
            return false;
        }

        updated_token.push_back(now);
        env.storage().temporary().set(&token_key, &updated_token);
        env.storage()
            .temporary()
            .extend_ttl(&token_key, DAY_IN_LEDGERS, DAY_IN_LEDGERS);
    }

    // Commit global history
    updated_global.push_back(now);
    env.storage().temporary().set(&global_key, &updated_global);
    env.storage()
        .temporary()
        .extend_ttl(&global_key, DAY_IN_LEDGERS, DAY_IN_LEDGERS);

    // Warn the signer when this write leaves exactly one transfer of
    // remaining capacity before the sliding-window cap is hit.
    let remaining_capacity = config.limit.saturating_sub(updated_global.len());
    if remaining_capacity == 1 {
        crate::events::emit_velocity_warning(env, addr, remaining_capacity);
    }

    true
}

pub fn set_cancellation_record(env: &Env, record: &crate::types::CancellationRecord) {
    let key = DataKey::CancellationRecord(record.proposal_id);
    env.storage().persistent().set(&key, record);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_cancellation_record(
    env: &Env,
    proposal_id: u64,
) -> Result<crate::types::CancellationRecord, crate::errors::VaultError> {
    env.storage()
        .persistent()
        .get(&DataKey::CancellationRecord(proposal_id))
        .ok_or(crate::errors::VaultError::ProposalNotFound)
}

pub fn add_to_cancellation_history(env: &Env, proposal_id: u64) {
    let key = DataKey::CancellationHistory;
    let mut history: soroban_sdk::Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(soroban_sdk::Vec::new(env));
    history.push_back(proposal_id);
    env.storage().persistent().set(&key, &history);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_cancellation_history(env: &Env) -> soroban_sdk::Vec<u64> {
    let key = DataKey::CancellationHistory;
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or(soroban_sdk::Vec::new(env))
}

pub fn get_amendment_history(env: &Env, proposal_id: u64) -> Vec<ProposalAmendment> {
    let key = DataKey::AmendmentHistory(proposal_id);
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_amendment_record(env: &Env, record: &ProposalAmendment) {
    let key = DataKey::AmendmentHistory(record.proposal_id);
    let mut history = get_amendment_history(env, record.proposal_id);
    history.push_back(record.clone());
    env.storage().persistent().set(&key, &history);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

/// Record that `new_id` supersedes `old_id`: links both directions so the
/// chain can be walked forward (old -> new) and backward (new -> old).
pub fn set_supersession_link(env: &Env, old_id: u64, new_id: u64) {
    let supersedes_key = DataKey::Supersedes(new_id);
    env.storage().persistent().set(&supersedes_key, &old_id);
    env.storage().persistent().extend_ttl(
        &supersedes_key,
        PERSISTENT_TTL_THRESHOLD,
        PERSISTENT_TTL,
    );

    let superseded_by_key = DataKey::SupersededBy(old_id);
    env.storage().persistent().set(&superseded_by_key, &new_id);
    env.storage().persistent().extend_ttl(
        &superseded_by_key,
        PERSISTENT_TTL_THRESHOLD,
        PERSISTENT_TTL,
    );
}

/// The proposal ID that `proposal_id` supersedes (its parent), if any.
pub fn get_supersedes(env: &Env, proposal_id: u64) -> Option<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::Supersedes(proposal_id))
}

/// The proposal ID that superseded `proposal_id` (its direct child), if any.
pub fn get_superseded_by(env: &Env, proposal_id: u64) -> Option<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::SupersededBy(proposal_id))
}

/// Refund spending limits when a proposal is cancelled.
///
/// Credits the original day/week buckets where the spend was reserved
/// (Issue #1345), not the current ledger's buckets.
pub fn refund_spending_limits(env: &Env, amount: i128, spend_day: u64, spend_week: u64) {
    // Use atomic try_deduct helpers to ensure counters never go negative.
    // Each helper reads, validates, and writes in a single storage call,
    // preventing double-refund if two cancellations land in the same ledger.
    try_deduct_daily_spent(env, spend_day, amount);
    try_deduct_weekly_spent(env, spend_week, amount);
}
// ============================================================================
// Comments
// ============================================================================

pub fn get_next_comment_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextCommentId)
        .unwrap_or(1)
}

pub fn increment_comment_id(env: &Env) -> u64 {
    let id = get_next_comment_id(env);
    env.storage()
        .instance()
        .set(&DataKey::NextCommentId, &(id + 1));
    id
}

pub fn set_comment(env: &Env, comment: &Comment) {
    let key = DataKey::Comment(comment.id);
    env.storage().persistent().set(&key, comment);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

pub fn get_comment(env: &Env, id: u64) -> Result<Comment, VaultError> {
    env.storage()
        .persistent()
        .get(&DataKey::Comment(id))
        .ok_or(VaultError::ProposalNotFound)
}

pub fn get_proposal_comments(env: &Env, proposal_id: u64) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::ProposalComments(proposal_id))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_comment_to_proposal(env: &Env, proposal_id: u64, comment_id: u64) {
    let mut comments = get_proposal_comments(env, proposal_id);
    comments.push_back(comment_id);
    let key = DataKey::ProposalComments(proposal_id);
    env.storage().persistent().set(&key, &comments);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

#[allow(dead_code)]
pub fn is_in_priority_queue(env: &Env, priority: u32, proposal_id: u64) -> bool {
    get_priority_queue(env, priority).contains(proposal_id)
}

// ============================================================================
// Execution Snapshot Management
// ============================================================================

#[allow(dead_code)]
pub fn set_execution_snapshot(env: &Env, proposal_id: u64, snapshot: &ExecutionSnapshot) {
    let key = DataKey::ExecutionSnapshot(proposal_id);
    env.storage().temporary().set(&key, snapshot);
    env.storage()
        .temporary()
        .extend_ttl(&key, DAY_IN_LEDGERS, DAY_IN_LEDGERS);
}

pub fn get_execution_snapshot(env: &Env, proposal_id: u64) -> Option<ExecutionSnapshot> {
    env.storage()
        .temporary()
        .get(&DataKey::ExecutionSnapshot(proposal_id))
}

pub fn remove_execution_snapshot(env: &Env, proposal_id: u64) {
    env.storage()
        .temporary()
        .remove(&DataKey::ExecutionSnapshot(proposal_id));
}

// ============================================================================
// Audit Trail
// ============================================================================

pub fn get_next_audit_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextAuditId)
        .unwrap_or(1)
}

pub fn increment_audit_id(env: &Env) -> u64 {
    let id = get_next_audit_id(env);
    env.storage()
        .instance()
        .set(&DataKey::NextAuditId, &(id + 1));
    id
}

pub fn get_last_audit_hash(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::LastAuditHash)
        .unwrap_or(0)
}

pub fn set_last_audit_hash(env: &Env, hash: u64) {
    env.storage().instance().set(&DataKey::LastAuditHash, &hash);
}
// Attachments
// ============================================================================

pub fn get_attachments(env: &Env, proposal_id: u64) -> Vec<String> {
    env.storage()
        .persistent()
        .get(&DataKey::Attachments(proposal_id))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_attachments(env: &Env, proposal_id: u64, attachments: &Vec<String>) {
    let key = DataKey::Attachments(proposal_id);
    env.storage().persistent().set(&key, attachments);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

// ============================================================================
// Reputation (Issue: feature/reputation-system)
// ============================================================================

pub fn get_reputation(env: &Env, addr: &Address) -> Reputation {
    env.storage()
        .persistent()
        .get(&DataKey::Reputation(addr.clone()))
        .unwrap_or_default()
}

pub fn set_reputation(env: &Env, addr: &Address, rep: &Reputation) {
    let key = DataKey::Reputation(addr.clone());
    env.storage().persistent().set(&key, rep);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

/// Apply time-based decay to a reputation score using the admin-configured
/// `ReputationConfig`.
///
/// Decay formula (integer approximation of exponential half-life):
///   For each complete half-life period elapsed:
///     distance = score - decay_min_score
///     score    = decay_min_score + (distance / 2)
///
/// This is equivalent to `score ≈ decay_min_score + (score - decay_min_score) * 0.5^periods`.
///
/// The function is deterministic: given the same `last_decay_ledger` and
/// current ledger sequence it always produces the same result.
/// `decay_min_score` is never breached.
pub fn apply_reputation_decay(env: &Env, rep: &mut Reputation) {
    let current_ledger = env.ledger().sequence() as u64;
    let cfg = get_reputation_config(env);

    // A half-life of 0 means decay is disabled.
    if cfg.decay_half_life_ledgers == 0 {
        rep.last_decay_ledger = current_ledger;
        return;
    }

    let elapsed = current_ledger.saturating_sub(rep.last_decay_ledger);
    let periods = elapsed / cfg.decay_half_life_ledgers;
    if periods == 0 {
        rep.last_decay_ledger = current_ledger;
        return;
    }

    // Apply one halving per period, clamped to decay_min_score.
    for _ in 0..periods {
        if rep.score <= cfg.decay_min_score {
            rep.score = cfg.decay_min_score;
            break;
        }
        let distance = rep.score - cfg.decay_min_score;
        // Integer halving: distance / 2 (rounds down, so score drifts toward floor)
        rep.score = cfg.decay_min_score + (distance / 2);
    }

    rep.last_decay_ledger = current_ledger;
}

// ============================================================================
// Reputation Config
// ============================================================================

pub fn get_reputation_config(env: &Env) -> ReputationConfig {
    env.storage()
        .instance()
        .get(&FeatureKey::ReputationConfig)
        .unwrap_or_else(ReputationConfig::default)
}

pub fn set_reputation_config(env: &Env, config: &ReputationConfig) {
    env.storage()
        .instance()
        .set(&FeatureKey::ReputationConfig, config);
}

// ============================================================================
// Signer Participation Scoring (Issue #1093)
// ============================================================================

/// Max number of outcomes tracked per signer in the circular history buffer.
pub const PARTICIPATION_HISTORY_CAP: u32 = 100;

pub fn get_participation_score(env: &Env, signer: &Address) -> SignerParticipationScore {
    env.storage()
        .persistent()
        .get(&DataKey::ParticipationScore(signer.clone()))
        .unwrap_or_else(|| SignerParticipationScore {
            signer: signer.clone(),
            proposals_voted: 0,
            proposals_missed: 0,
            last_active_ledger: 0,
            history: Vec::new(env),
            history_cursor: 0,
            consecutive_low_periods: 0,
            low_participation_since_ledger: None,
        })
}

pub fn set_participation_score(env: &Env, score: &SignerParticipationScore) {
    let key = DataKey::ParticipationScore(score.signer.clone());
    env.storage().persistent().set(&key, score);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

fn push_history(score: &mut SignerParticipationScore, voted: bool) {
    let len = score.history.len();
    if len < PARTICIPATION_HISTORY_CAP {
        score.history.push_back(voted);
        score.history_cursor = score.history.len() % PARTICIPATION_HISTORY_CAP;
    } else {
        score.history.set(score.history_cursor, voted);
        score.history_cursor = (score.history_cursor + 1) % PARTICIPATION_HISTORY_CAP;
    }
}

/// Rate (0-100) of `true` (voted) outcomes among the most recent `window`
/// entries of `score.history` (fewer, if less history exists). Callers are
/// responsible for validating `window <= PARTICIPATION_HISTORY_CAP`.
pub fn compute_participation_rate(score: &SignerParticipationScore, window: u32) -> u32 {
    let len = score.history.len();
    let n = window.min(len);
    if n == 0 {
        return 0;
    }

    // Modulus of the index space currently in use: while the buffer hasn't
    // filled, indices only span 0..len; once full, they wrap over the cap.
    let modulus = if len < PARTICIPATION_HISTORY_CAP {
        len
    } else {
        PARTICIPATION_HISTORY_CAP
    };
    let mut idx = if len < PARTICIPATION_HISTORY_CAP {
        len - 1
    } else {
        (score.history_cursor + PARTICIPATION_HISTORY_CAP - 1) % PARTICIPATION_HISTORY_CAP
    };

    let mut voted_count: u32 = 0;
    for _ in 0..n {
        if score.history.get(idx).unwrap_or(false) {
            voted_count += 1;
        }
        idx = (idx + modulus - 1) % modulus;
    }

    (voted_count * 100) / n
}

/// Recomputes low-participation streak state after a new outcome was
/// recorded. Returns `(current_rate, should_alert)` where `should_alert` is
/// true exactly when the consecutive-low-periods counter has just reached
/// (or continues to exceed) `Config.low_participation_streak_n`.
fn update_low_participation_state(
    env: &Env,
    score: &mut SignerParticipationScore,
    config: &Config,
) -> (u32, bool) {
    let rate = compute_participation_rate(score, config.participation_rate_window);
    if rate < config.min_participation_rate {
        score.consecutive_low_periods += 1;
        if score.low_participation_since_ledger.is_none() {
            score.low_participation_since_ledger = Some(env.ledger().sequence());
        }
    } else {
        score.consecutive_low_periods = 0;
        score.low_participation_since_ledger = None;
    }

    let should_alert = score.low_participation_since_ledger.is_some()
        && score.consecutive_low_periods >= config.low_participation_streak_n;
    (rate, should_alert)
}

/// Records that `signer` explicitly voted (approved or abstained) on a
/// proposal. Returns `(new_rate, should_alert)`.
pub fn record_participation_vote(env: &Env, signer: &Address, config: &Config) -> (u32, bool) {
    let mut score = get_participation_score(env, signer);
    score.proposals_voted += 1;
    score.last_active_ledger = env.ledger().sequence();
    push_history(&mut score, true);
    let result = update_low_participation_state(env, &mut score, config);
    set_participation_score(env, &score);
    result
}

/// Records that `signer` failed to vote before a proposal expired while
/// still Pending. Returns `(new_rate, should_alert)`.
pub fn record_participation_miss(env: &Env, signer: &Address, config: &Config) -> (u32, bool) {
    let mut score = get_participation_score(env, signer);
    score.proposals_missed += 1;
    push_history(&mut score, false);
    let result = update_low_participation_state(env, &mut score, config);
    set_participation_score(env, &score);
    result
}

// ============================================================================
// Force Rotation Requests (Issue #1093)
// ============================================================================

pub fn next_force_rotation_id(env: &Env) -> u64 {
    let id = env
        .storage()
        .instance()
        .get(&DataKey::NextForceRotationId)
        .unwrap_or(1u64);
    env.storage()
        .instance()
        .set(&DataKey::NextForceRotationId, &(id + 1));
    id
}

pub fn get_force_rotation_request(env: &Env, id: u64) -> Result<ForceRotationRequest, VaultError> {
    env.storage()
        .persistent()
        .get(&DataKey::ForceRotationReq(id))
        .ok_or(VaultError::ForceRotationRequestNotFound)
}

pub fn set_force_rotation_request(env: &Env, request: &ForceRotationRequest) {
    let key = DataKey::ForceRotationReq(request.id);
    env.storage().persistent().set(&key, request);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

// ============================================================================
// Insurance Config (Issue: feature/proposal-insurance)
// ============================================================================

pub fn get_insurance_config(env: &Env) -> InsuranceConfig {
    env.storage()
        .instance()
        .get(&FeatureKey::InsuranceConfig)
        .unwrap_or(InsuranceConfig {
            enabled: false,
            min_amount: 0,
            min_insurance_bps: 100, // 1% default
            slash_percentage: 50,   // 50% slashed on rejection by default
        })
}

pub fn set_insurance_config(env: &Env, config: &InsuranceConfig) {
    env.storage()
        .instance()
        .set(&FeatureKey::InsuranceConfig, config);
}

pub fn get_insurance_pool(env: &Env, token_addr: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&FeatureKey::InsurancePool(token_addr.clone()))
        .unwrap_or(0)
}

pub fn add_to_insurance_pool(env: &Env, token_addr: &Address, amount: i128) {
    let current = get_insurance_pool(env, token_addr);
    let key = FeatureKey::InsurancePool(token_addr.clone());
    env.storage().persistent().set(&key, &(current + amount));
    // extend TTL
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PERSISTENT_TTL); // Keeps pool persistent
}

#[allow(dead_code)]
pub fn subtract_from_insurance_pool(env: &Env, token_addr: &Address, amount: i128) {
    let current = get_insurance_pool(env, token_addr);
    let key = FeatureKey::InsurancePool(token_addr.clone());
    env.storage()
        .persistent()
        .set(&key, &(current.saturating_sub(amount).max(0)));
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PERSISTENT_TTL);
}

// ============================================================================
// Notification Preferences (Issue: feature/execution-notifications)
// ============================================================================

/// Returns the rich notification preferences for `addr`, or `None` if not set.
/// Uses Instance storage (hot path) — read on every significant event emission.
pub fn get_notification_prefs(env: &Env, addr: &Address) -> Option<NotificationPrefs> {
    env.storage()
        .instance()
        .get(&FeatureKey::NotificationPrefs(addr.clone()))
}

/// Persist rich notification preferences and register the signer in the prefs
/// index so `compute_relevant_signers` can enumerate all opted-in addresses.
pub fn set_notification_prefs(env: &Env, prefs: &NotificationPrefs) {
    env.storage()
        .instance()
        .set(&FeatureKey::NotificationPrefs(prefs.signer.clone()), prefs);
    // Keep the index up-to-date
    let mut index = get_notification_prefs_index(env);
    if !index.contains(&prefs.signer) {
        index.push_back(prefs.signer.clone());
        env.storage()
            .instance()
            .set(&DataKey::NotificationPrefsIndex, &index);
    }
}

/// All addresses that have ever called `set_notification_prefs`.
pub fn get_notification_prefs_index(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::NotificationPrefsIndex)
        .unwrap_or_else(|| Vec::new(env))
}

/// Legacy boolean-flag prefs getter; kept for backward compatibility only.
pub fn get_legacy_notification_prefs(env: &Env, addr: &Address) -> NotificationPreferences {
    env.storage()
        .persistent()
        .get(&FeatureKey::NotificationPrefs(addr.clone()))
        .unwrap_or_else(NotificationPreferences::default)
}

/// Legacy boolean-flag prefs setter; kept for backward compatibility only.
pub fn set_legacy_notification_prefs(env: &Env, addr: &Address, prefs: &NotificationPreferences) {
    let key = FeatureKey::NotificationPrefs(addr.clone());
    env.storage().persistent().set(&key, prefs);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

// ============================================================================
// DEX/AMM Integration (Issue: feature/amm-integration)
// ============================================================================

pub fn set_dex_config(env: &Env, config: &DexConfig) {
    env.storage().instance().set(&FeatureKey::DexConfig, config);
}

pub fn get_dex_config(env: &Env) -> Option<DexConfig> {
    env.storage().instance().get(&FeatureKey::DexConfig)
}

// ============================================================================
// Oracle Config
// ============================================================================
// NOTE: Oracle config functions commented out due to DataKey enum size limit
//
pub fn set_oracle_config(env: &Env, config: &crate::OptionalVaultOracleConfig) {
    env.storage()
        .instance()
        .set(&FeatureKey::VaultOracleConfig, config);
}

pub fn get_oracle_config(env: &Env) -> crate::OptionalVaultOracleConfig {
    env.storage()
        .instance()
        .get(&FeatureKey::VaultOracleConfig)
        .unwrap_or(crate::OptionalVaultOracleConfig::None)
}

pub fn set_swap_proposal(env: &Env, proposal_id: u64, swap: &SwapProposal) {
    let key = FeatureKey::SwapProposal(proposal_id);
    env.storage().persistent().set(&key, swap);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PROPOSAL_TTL);
}

#[allow(dead_code)]
pub fn get_swap_proposal(env: &Env, proposal_id: u64) -> Option<SwapProposal> {
    env.storage()
        .persistent()
        .get(&FeatureKey::SwapProposal(proposal_id))
}

#[allow(dead_code)]
pub fn set_swap_result(env: &Env, proposal_id: u64, result: &SwapResult) {
    let key = FeatureKey::SwapResult(proposal_id);
    env.storage().persistent().set(&key, result);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PROPOSAL_TTL);
}

pub fn get_swap_result(env: &Env, proposal_id: u64) -> Option<SwapResult> {
    env.storage()
        .persistent()
        .get(&FeatureKey::SwapResult(proposal_id))
}

// ============================================================================
// Gas Config (Issue: feature/gas-limits)
// ============================================================================

pub fn get_gas_config(env: &Env) -> GasConfig {
    env.storage()
        .instance()
        .get(&FeatureKey::GasConfig)
        .unwrap_or_else(GasConfig::default)
}

pub fn set_gas_config(env: &Env, config: &GasConfig) {
    env.storage().instance().set(&FeatureKey::GasConfig, config);
}

// ============================================================================
// Batch Transaction Storage
// ============================================================================

pub fn get_batch(env: &Env, batch_id: u64) -> Result<crate::types::BatchTransaction, VaultError> {
    env.storage()
        .persistent()
        .get(&FeatureKey::Batch(batch_id))
        .ok_or(VaultError::ProposalNotFound)
}

pub fn set_batch(env: &Env, batch: &crate::types::BatchTransaction) {
    let key = FeatureKey::Batch(batch.id);
    env.storage().persistent().set(&key, batch);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

pub fn get_next_batch_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&FeatureKey::Counter(CounterKey::Batch))
        .unwrap_or(1)
}

pub fn increment_batch_id(env: &Env) -> u64 {
    let id = get_next_batch_id(env);
    env.storage()
        .instance()
        .set(&FeatureKey::Counter(CounterKey::Batch), &(id + 1));
    id
}

pub fn set_batch_result(env: &Env, batch_id: u64, result: &crate::types::BatchExecutionResult) {
    let key = FeatureKey::BatchResult(batch_id);
    env.storage().persistent().set(&key, result);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

pub fn get_batch_result(env: &Env, batch_id: u64) -> Option<crate::types::BatchExecutionResult> {
    env.storage()
        .persistent()
        .get(&FeatureKey::BatchResult(batch_id))
}

pub fn set_batch_rollback(env: &Env, batch_id: u64, entries: &Vec<(Address, i128)>) {
    let key = FeatureKey::BatchRollback(batch_id);
    env.storage().persistent().set(&key, entries);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

pub fn get_batch_rollback(env: &Env, batch_id: u64) -> Option<Vec<(Address, i128)>> {
    env.storage()
        .persistent()
        .get(&FeatureKey::BatchRollback(batch_id))
}

pub fn is_threshold_reduced(env: &Env, proposal_id: u64) -> bool {
    env.storage()
        .persistent()
        .get(&FeatureKey::ThresholdReduced(proposal_id))
        .unwrap_or(false)
}

pub fn set_threshold_reduced(env: &Env, proposal_id: u64) {
    let key = FeatureKey::ThresholdReduced(proposal_id);
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

pub fn get_execution_fee_estimate(env: &Env, proposal_id: u64) -> Option<ExecutionFeeEstimate> {
    env.storage()
        .persistent()
        .get(&DataKey::ExecutionFeeEstimate(proposal_id))
}

pub fn set_execution_fee_estimate(env: &Env, proposal_id: u64, estimate: &ExecutionFeeEstimate) {
    let key = DataKey::ExecutionFeeEstimate(proposal_id);
    env.storage().persistent().set(&key, estimate);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

// ============================================================================
// Performance Metrics (Issue: feature/performance-metrics)
// ============================================================================

pub fn get_metrics(env: &Env) -> VaultMetrics {
    env.storage()
        .instance()
        .get(&FeatureKey::Metrics)
        .unwrap_or_else(VaultMetrics::default)
}

pub fn set_metrics(env: &Env, metrics: &VaultMetrics) {
    env.storage().instance().set(&FeatureKey::Metrics, metrics);
}

pub fn metrics_on_execution(env: &Env, gas_used: u64, execution_time_ledgers: u64) {
    let mut metrics = get_metrics(env);
    metrics.executed_count = metrics.executed_count.saturating_add(1);
    metrics.total_gas_used = metrics.total_gas_used.saturating_add(gas_used);
    metrics.total_execution_time_ledgers = metrics
        .total_execution_time_ledgers
        .saturating_add(execution_time_ledgers);
    metrics.last_updated_ledger = env.ledger().sequence() as u64;
    set_metrics(env, &metrics);
    update_metrics_bucket(env, &metrics);
}

pub fn metrics_on_rejection(env: &Env) {
    let mut metrics = get_metrics(env);
    metrics.rejected_count = metrics.rejected_count.saturating_add(1);
    metrics.last_updated_ledger = env.ledger().sequence() as u64;
    set_metrics(env, &metrics);
    update_metrics_bucket(env, &metrics);
}

pub fn metrics_on_expiry(env: &Env) {
    let mut metrics = get_metrics(env);
    metrics.expired_count = metrics.expired_count.saturating_add(1);
    metrics.last_updated_ledger = env.ledger().sequence() as u64;
    set_metrics(env, &metrics);
}

pub fn metrics_on_proposal(env: &Env) {
    let mut metrics = get_metrics(env);
    metrics.total_proposals = metrics.total_proposals.saturating_add(1);
    metrics.last_updated_ledger = env.ledger().sequence() as u64;
    set_metrics(env, &metrics);
    update_metrics_bucket(env, &metrics);
}

pub fn get_staking_config(env: &Env) -> StakingConfig {
    env.storage()
        .instance()
        .get(&FeatureKey::StakingConfig)
        .unwrap_or_else(StakingConfig::default)
}

pub fn set_staking_config(env: &Env, config: &StakingConfig) {
    env.storage()
        .instance()
        .set(&FeatureKey::StakingConfig, config);
}

// ----------------------------------------------------------------------------
// Issue #1355: Insurance claim voting governance
// ----------------------------------------------------------------------------

pub fn get_insurance_voting_config(env: &Env) -> InsuranceVotingConfig {
    env.storage()
        .instance()
        .get(&FeatureKey::InsuranceVotingConfig)
        .unwrap_or_else(InsuranceVotingConfig::default)
}

pub fn set_insurance_voting_config(env: &Env, config: &InsuranceVotingConfig) {
    env.storage()
        .instance()
        .set(&FeatureKey::InsuranceVotingConfig, config);
}

// ----------------------------------------------------------------------------
// Issue #1356: Proposal amendment limits
// ----------------------------------------------------------------------------

/// Default ceiling on how many times a single proposal may be amended.
pub const DEFAULT_MAX_AMENDMENTS: u32 = 3;

pub fn get_max_amendments(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&FeatureKey::MaxAmendments)
        .unwrap_or(DEFAULT_MAX_AMENDMENTS)
}

pub fn set_max_amendments(env: &Env, max: u32) {
    env.storage()
        .instance()
        .set(&FeatureKey::MaxAmendments, &max);
}

pub fn get_amendment_count(env: &Env, proposal_id: u64) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::AmendmentCount(proposal_id))
        .unwrap_or(0)
}

pub fn set_amendment_count(env: &Env, proposal_id: u64, count: u32) {
    let key = DataKey::AmendmentCount(proposal_id);
    env.storage().persistent().set(&key, &count);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_stake_pool(env: &Env, token_addr: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&FeatureKey::StakePool(token_addr.clone()))
        .unwrap_or(0)
}

pub fn add_to_stake_pool(env: &Env, token_addr: &Address, amount: i128) {
    let current = get_stake_pool(env, token_addr);
    let key = FeatureKey::StakePool(token_addr.clone());
    env.storage().persistent().set(&key, &(current + amount));
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn subtract_from_stake_pool(env: &Env, token_addr: &Address, amount: i128) {
    let current = get_stake_pool(env, token_addr);
    let key = FeatureKey::StakePool(token_addr.clone());
    env.storage()
        .persistent()
        .set(&key, &(current.saturating_sub(amount).max(0)));
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_stake_record(env: &Env, proposal_id: u64) -> Option<StakeRecord> {
    env.storage()
        .persistent()
        .get(&FeatureKey::StakeRecord(proposal_id))
}

pub fn set_stake_record(env: &Env, record: &StakeRecord) {
    let key = FeatureKey::StakeRecord(record.proposal_id);
    env.storage().persistent().set(&key, record);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PROPOSAL_TTL);
}

pub fn get_bridge_record(
    env: &Env,
    bridge_id: soroban_sdk::BytesN<32>,
) -> Option<crate::types::BridgeRecord> {
    env.storage()
        .persistent()
        .get(&FeatureKey::BridgeRecord(bridge_id))
}

pub fn set_bridge_record(env: &Env, record: &crate::types::BridgeRecord) {
    let key = FeatureKey::BridgeRecord(record.bridge_id.clone());
    env.storage().persistent().set(&key, record);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PROPOSAL_TTL);
}

pub fn get_permissions(env: &Env, addr: &Address) -> Vec<PermissionGrant> {
    env.storage()
        .persistent()
        .get(&FeatureKey::Permissions(addr.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_permissions(env: &Env, addr: &Address, permissions: Vec<PermissionGrant>) {
    let key = FeatureKey::Permissions(addr.clone());
    env.storage().persistent().set(&key, &permissions);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_delegated_permission(
    env: &Env,
    addr: &Address,
    signer: &Address,
    permission: u32,
) -> Option<DelegatedPermission> {
    env.storage()
        .persistent()
        .get(&FeatureKey::DelegatedPermission(
            addr.clone(),
            signer.clone(),
            permission,
        ))
}

pub fn set_delegated_permission(env: &Env, delegation: &DelegatedPermission) {
    let key = FeatureKey::DelegatedPermission(
        delegation.delegatee.clone(),
        delegation.delegator.clone(),
        delegation.permission as u32,
    );
    env.storage().persistent().set(&key, delegation);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn set_audit_entry(env: &Env, entry: &AuditEntry) {
    let key = DataKey::AuditEntry(entry.id);
    env.storage().persistent().set(&key, entry);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

/// Read an audit entry, extending its TTL on the way out.
///
/// Audit entries are the vault's permanent record of privileged actions, but
/// persistent storage is rent-based: an entry that is only ever read — never
/// rewritten — has its TTL run down and can be evicted by the network, losing
/// exactly the historical actions most worth keeping. Extending on read means
/// any entry someone still consults stays alive.
///
/// The extension is a no-op when the entry is already above the threshold, so
/// repeated reads do not accumulate cost.
pub fn get_audit_entry(env: &Env, id: u64) -> Result<AuditEntry, VaultError> {
    let key = DataKey::AuditEntry(id);

    let entry: AuditEntry = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(VaultError::ProposalNotFound)?;

    // Only extend once the read has confirmed the entry exists — extending a
    // missing key would create a phantom entry.
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);

    Ok(entry)
}

/// Compute audit hash using SHA256 over deterministic serialization
///
/// Serialization format (documented for upgrade compatibility):
/// - id: u64 (8 bytes, little-endian)
/// - action: u32 (4 bytes, little-endian)
/// - actor: Address bytes (32 bytes)
/// - target: u64 (8 bytes, little-endian)
/// - timestamp: u64 (8 bytes, little-endian)
/// - prev_hash: u64 (8 bytes, little-endian)
///
/// Total: 68 bytes deterministic input to SHA256
pub fn compute_audit_hash(
    env: &Env,
    id: u64,
    action: &crate::types::AuditAction,
    actor: &Address,
    target: u64,
    timestamp: u64,
    prev_hash: u64,
) -> u64 {
    use soroban_sdk::Bytes;

    // Create deterministic serialization (68 bytes total)
    let mut data = Bytes::new(env);

    // id: u64 (8 bytes, little-endian)
    data.extend_from_array(&id.to_le_bytes());

    // action: u32 (4 bytes, little-endian)
    data.extend_from_array(&(action.clone() as u32).to_le_bytes());

    // actor: Address XDR bytes
    data.append(&actor.clone().to_xdr(env));

    // target: u64 (8 bytes, little-endian)
    data.extend_from_array(&target.to_le_bytes());

    // timestamp: u64 (8 bytes, little-endian)
    data.extend_from_array(&timestamp.to_le_bytes());

    // prev_hash: u64 (8 bytes, little-endian)
    data.extend_from_array(&prev_hash.to_le_bytes());

    // Compute SHA256 hash
    let hash_bytes = env.crypto().sha256(&data);

    // Convert first 8 bytes of hash to u64 (little-endian)
    let hash_array = hash_bytes.to_array();
    u64::from_le_bytes(hash_array[0..8].try_into().unwrap())
}

pub fn create_audit_entry(
    env: &Env,
    action: crate::types::AuditAction,
    actor: &Address,
    target: u64,
) {
    let id = increment_audit_id(env);
    let timestamp = env.ledger().sequence() as u64;
    let prev_hash = get_last_audit_hash(env);
    let hash = compute_audit_hash(env, id, &action, actor, target, timestamp, prev_hash);

    let entry = AuditEntry {
        id,
        action,
        actor: actor.clone(),
        target,
        timestamp,
        prev_hash,
        hash,
    };

    set_audit_entry(env, &entry);
    set_last_audit_hash(env, hash);
}

// ============================================================================
// Proposal Templates (Issue: feature/contract-templates)
// ============================================================================

/// Get the next template ID counter
pub fn get_next_template_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&FeatureKey::Counter(CounterKey::Template))
        .unwrap_or(1)
}

/// Increment and return the next template ID
pub fn increment_template_id(env: &Env) -> u64 {
    let id = get_next_template_id(env);
    env.storage()
        .instance()
        .set(&FeatureKey::Counter(CounterKey::Template), &(id + 1));
    id
}

/// Store a proposal template
pub fn set_template(env: &Env, template: &ProposalTemplate) {
    let key = FeatureKey::Template(template.id);
    env.storage().persistent().set(&key, template);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

/// Get a proposal template by ID
pub fn get_template(env: &Env, id: u64) -> Result<ProposalTemplate, VaultError> {
    env.storage()
        .persistent()
        .get(&FeatureKey::Template(id))
        .ok_or(VaultError::TemplateNotFound)
}

/// Check if a template exists
#[allow(dead_code)]
pub fn template_exists(env: &Env, id: u64) -> bool {
    env.storage().persistent().has(&FeatureKey::Template(id))
}

/// Get template ID by name
pub fn get_template_id_by_name(env: &Env, name: &soroban_sdk::Symbol) -> Option<u64> {
    env.storage()
        .instance()
        .get(&FeatureKey::TemplateName(name.clone()))
}

pub fn set_template_name_mapping(env: &Env, name: &soroban_sdk::Symbol, id: u64) {
    env.storage()
        .instance()
        .set(&FeatureKey::TemplateName(name.clone()), &id);
}

pub fn template_name_exists(env: &Env, name: &soroban_sdk::Symbol) -> bool {
    env.storage()
        .instance()
        .has(&FeatureKey::TemplateName(name.clone()))
}

pub fn get_retry_state(env: &Env, proposal_id: u64) -> Option<RetryState> {
    env.storage()
        .persistent()
        .get(&FeatureKey::RetryState(proposal_id))
}

pub fn set_retry_state(env: &Env, proposal_id: u64, state: &RetryState) {
    let key = FeatureKey::RetryState(proposal_id);
    env.storage().persistent().set(&key, state);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

// ============================================================================
// Dead Letter Queue
// ============================================================================

pub fn get_dead_letter(env: &Env, id: u64) -> Option<DeadLetterRecord> {
    env.storage().persistent().get(&FeatureKey::DeadLetter(id))
}

pub fn set_dead_letter(env: &Env, record: &DeadLetterRecord) {
    let key = FeatureKey::DeadLetter(record.id);
    env.storage().persistent().set(&key, record);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_dead_letter_count(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get(&FeatureKey::DeadLetterCount)
        .unwrap_or(0)
}

pub fn increment_dead_letter_count(env: &Env) -> u64 {
    let count = get_dead_letter_count(env) + 1;
    env.storage()
        .persistent()
        .set(&FeatureKey::DeadLetterCount, &count);
    count
}

// ============================================================================
// Escrow
// ============================================================================

fn get_next_escrow_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&FeatureKey::Counter(CounterKey::Escrow))
        .unwrap_or(1)
}

pub fn increment_escrow_id(env: &Env) -> u64 {
    let id = get_next_escrow_id(env);
    env.storage()
        .instance()
        .set(&FeatureKey::Counter(CounterKey::Escrow), &(id + 1));
    id
}

pub fn set_escrow(env: &Env, escrow: &Escrow) {
    let key = FeatureKey::Escrow(escrow.id);
    env.storage().persistent().set(&key, escrow);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

pub fn get_escrow(env: &Env, id: u64) -> Result<Escrow, VaultError> {
    env.storage()
        .persistent()
        .get(&FeatureKey::Escrow(id))
        .ok_or(VaultError::ProposalNotFound)
}

pub fn get_funder_escrows(env: &Env, funder: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&FeatureKey::FunderEscrows(funder.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_funder_escrow(env: &Env, funder: &Address, escrow_id: u64) {
    let mut escrows = get_funder_escrows(env, funder);
    escrows.push_back(escrow_id);
    let key = FeatureKey::FunderEscrows(funder.clone());
    env.storage().persistent().set(&key, &escrows);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_recipient_escrows(env: &Env, recipient: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&FeatureKey::RecipientEscrows(recipient.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_recipient_escrow(env: &Env, recipient: &Address, escrow_id: u64) {
    let mut escrows = get_recipient_escrows(env, recipient);
    escrows.push_back(escrow_id);
    let key = FeatureKey::RecipientEscrows(recipient.clone());
    env.storage().persistent().set(&key, &escrows);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PERSISTENT_TTL);
}

// ============================================================================
// Time-weighted Voting
// ============================================================================

pub fn get_time_weighted_config(env: &Env) -> TimeWeightedConfig {
    env.storage()
        .instance()
        .get(&FeatureKey::TimeWeightedConfig)
        .unwrap_or_else(TimeWeightedConfig::default)
}

pub fn set_time_weighted_config(env: &Env, config: &TimeWeightedConfig) {
    env.storage()
        .instance()
        .set(&FeatureKey::TimeWeightedConfig, config);
}

pub fn get_token_lock(env: &Env, owner: &Address) -> Option<TokenLock> {
    env.storage()
        .persistent()
        .get(&FeatureKey::TokenLock(owner.clone()))
}

pub fn set_token_lock(env: &Env, lock: &TokenLock) {
    let key = FeatureKey::TokenLock(lock.owner.clone());
    env.storage().persistent().set(&key, lock);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

pub fn set_total_locked(env: &Env, owner: &Address, amount: i128) {
    let key = FeatureKey::TotalLocked(owner.clone());
    env.storage().persistent().set(&key, &amount);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

pub fn calculate_voting_power(env: &Env, addr: &Address) -> i128 {
    let cfg = get_time_weighted_config(env);
    if !cfg.enabled {
        return 1;
    }

    match get_token_lock(env, addr) {
        Some(lock) => {
            let power = if cfg.apply_decay {
                lock.calculate_decayed_power(env.ledger().sequence() as u64)
            } else {
                lock.calculate_voting_power()
            };
            if power > 0 {
                power
            } else {
                1
            }
        }
        None => 1,
    }
}

// ============================================================================
// Recovery
// ============================================================================

fn get_next_recovery_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&FeatureKey::Counter(CounterKey::Recovery))
        .unwrap_or(1)
}

pub fn increment_recovery_id(env: &Env) -> u64 {
    let id = get_next_recovery_id(env);
    env.storage()
        .instance()
        .set(&FeatureKey::Counter(CounterKey::Recovery), &(id + 1));
    id
}

pub fn set_recovery_proposal(env: &Env, proposal: &RecoveryProposal) {
    let key = FeatureKey::RecoveryProposal(proposal.id);
    env.storage().persistent().set(&key, proposal);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

pub fn get_recovery_proposal(env: &Env, id: u64) -> Result<RecoveryProposal, VaultError> {
    env.storage()
        .persistent()
        .get(&FeatureKey::RecoveryProposal(id))
        .ok_or(VaultError::ProposalNotFound)
}

// ============================================================================
// Funding Rounds
// ============================================================================

fn get_next_funding_round_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&FeatureKey::Counter(CounterKey::FundingRound))
        .unwrap_or(1)
}

pub fn bump_funding_round_id(env: &Env) -> u64 {
    let id = get_next_funding_round_id(env);
    env.storage()
        .instance()
        .set(&FeatureKey::Counter(CounterKey::FundingRound), &(id + 1));
    id
}

pub fn set_funding_round(env: &Env, round: &FundingRound) {
    let key = FeatureKey::FundingRound(round.id);
    env.storage().persistent().set(&key, round);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

pub fn get_funding_round(env: &Env, id: u64) -> Result<FundingRound, VaultError> {
    env.storage()
        .persistent()
        .get(&FeatureKey::FundingRound(id))
        .ok_or(VaultError::ProposalNotFound)
}

pub fn get_proposal_funding_rounds(env: &Env, proposal_id: u64) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&FeatureKey::ProposalFundingRounds(proposal_id))
        .unwrap_or_else(|| Vec::new(env))
}

#[allow(dead_code)]
pub fn add_proposal_funding_round(env: &Env, proposal_id: u64, round_id: u64) {
    let mut rounds = get_proposal_funding_rounds(env, proposal_id);
    rounds.push_back(round_id);
    let key = FeatureKey::ProposalFundingRounds(proposal_id);
    env.storage().persistent().set(&key, &rounds);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

pub fn get_funding_round_config(env: &Env) -> Option<FundingRoundConfig> {
    env.storage()
        .instance()
        .get(&FeatureKey::FundingRoundConfig)
}

pub fn set_funding_round_config(env: &Env, config: &FundingRoundConfig) {
    env.storage()
        .instance()
        .set(&FeatureKey::FundingRoundConfig, config);
}

// ============================================================================
// Dynamic Fees
// ============================================================================

pub fn get_fee_structure(env: &Env) -> FeeStructure {
    env.storage()
        .instance()
        .get(&FeatureKey::FeeStructure)
        .unwrap_or_else(|| FeeStructure::default(env))
}

pub fn set_fee_structure(env: &Env, fee_structure: &FeeStructure) {
    env.storage()
        .instance()
        .set(&FeatureKey::FeeStructure, fee_structure);
}

pub fn get_fees_collected(env: &Env, token: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&FeatureKey::FeesCollected(token.clone()))
        .unwrap_or(0)
}

pub fn add_fees_collected(env: &Env, token: &Address, amount: i128) {
    let current = get_fees_collected(env, token);
    let key = FeatureKey::FeesCollected(token.clone());
    env.storage().persistent().set(&key, &(current + amount));
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

pub fn get_user_volume(env: &Env, user: &Address, token: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&FeatureKey::UserVolume(user.clone(), token.clone()))
        .unwrap_or(0)
}

pub fn add_user_volume(env: &Env, user: &Address, token: &Address, amount: i128) {
    let current = get_user_volume(env, user, token);
    let key = FeatureKey::UserVolume(user.clone(), token.clone());
    env.storage().persistent().set(&key, &(current + amount));
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

fn add_to_delegators_index(env: &Env, delegate: &Address, delegator: &Address) {
    let mut delegators = get_delegators_for(env, delegate);
    if !delegators.contains(delegator) {
        delegators.push_back(delegator.clone());
        let key = DataKey::DelegatorsFor(delegate.clone());
        env.storage().persistent().set(&key, &delegators);
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
    }
}

fn remove_from_delegators_index(env: &Env, delegate: &Address, delegator: &Address) {
    let delegators = get_delegators_for(env, delegate);
    let mut new_delegators = Vec::new(env);
    for d in delegators.iter() {
        if d != *delegator {
            new_delegators.push_back(d);
        }
    }
    let key = DataKey::DelegatorsFor(delegate.clone());
    env.storage().persistent().set(&key, &new_delegators);
}

pub fn get_delegators_for(env: &Env, delegate: &Address) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::DelegatorsFor(delegate.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn get_delegation_history(env: &Env, user: &Address) -> Vec<DelegationHistory> {
    env.storage()
        .persistent()
        .get(&DataKey::DelegationHistory(user.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_delegation_history(env: &Env, history: &DelegationHistory) {
    let mut entries = get_delegation_history(env, &history.delegator);
    entries.push_back(history.clone());
    let key = DataKey::DelegationHistory(history.delegator.clone());
    env.storage().persistent().set(&key, &entries);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn increment_delegation_id(env: &Env) -> u64 {
    let key = DataKey::NextDelegationId;
    let id: u64 = env.storage().instance().get(&key).unwrap_or(1);
    env.storage().instance().set(&key, &(id + 1));
    id
}

// ============================================================================
// Cross-Vault
// ============================================================================

pub fn set_cross_vault_config(env: &Env, config: &crate::types::CrossVaultConfig) {
    env.storage()
        .instance()
        .set(&FeatureKey::CrossVaultConfig, config);
}

pub fn get_cross_vault_config(env: &Env) -> Option<crate::types::CrossVaultConfig> {
    env.storage().instance().get(&FeatureKey::CrossVaultConfig)
}

// ============================================================================
// Issue #1064: Streaming Rate Limiter — StreamRateWindow storage
// ============================================================================

/// Retrieve the current rate window for a stream sender.
pub fn get_stream_rate_window(env: &Env, stream_id: u64) -> Option<StreamRateWindow> {
    env.storage()
        .temporary()
        .get(&DataKey::StreamRateWindow(stream_id))
}

/// Persist an updated rate window. Uses Temporary storage so it auto-evicts.
pub fn set_stream_rate_window(env: &Env, stream_id: u64, window: &StreamRateWindow) {
    let key = DataKey::StreamRateWindow(stream_id);
    env.storage().temporary().set(&key, window);
    // Keep alive for ~2 days — enough for any reasonable rate window
    env.storage()
        .temporary()
        .extend_ttl(&key, DAY_IN_LEDGERS * 2, DAY_IN_LEDGERS * 2);
}

// ============================================================================
// Issue #1075: Insurance Claim Governance
// ============================================================================

pub fn get_next_insurance_claim_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextInsuranceClaimId)
        .unwrap_or(1)
}

pub fn increment_insurance_claim_id(env: &Env) -> u64 {
    let id = get_next_insurance_claim_id(env);
    env.storage()
        .instance()
        .set(&DataKey::NextInsuranceClaimId, &(id + 1));
    id
}

pub fn set_insurance_claim(env: &Env, claim: &InsuranceClaim) {
    let key = DataKey::InsuranceClaim(claim.id);
    env.storage().persistent().set(&key, claim);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn set_cross_vault_proposal(
    env: &Env,
    proposal_id: u64,
    cv: &crate::types::CrossVaultProposal,
) {
    let key = FeatureKey::CrossVaultProposal(proposal_id);
    env.storage().persistent().set(&key, cv);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_cross_vault_proposal(
    env: &Env,
    proposal_id: u64,
) -> Option<crate::types::CrossVaultProposal> {
    env.storage()
        .persistent()
        .get(&FeatureKey::CrossVaultProposal(proposal_id))
}

// ============================================================================
// Dispute Resolution
// ============================================================================

fn get_next_dispute_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&FeatureKey::Counter(CounterKey::Dispute))
        .unwrap_or(1)
}

pub fn increment_dispute_id(env: &Env) -> u64 {
    let id = get_next_dispute_id(env);
    env.storage()
        .instance()
        .set(&FeatureKey::Counter(CounterKey::Dispute), &(id + 1));
    id
}

pub fn set_dispute(env: &Env, dispute: &crate::types::Dispute) {
    let key = FeatureKey::Dispute(dispute.id);
    env.storage().persistent().set(&key, dispute);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_dispute(env: &Env, id: u64) -> Result<crate::types::Dispute, VaultError> {
    env.storage()
        .persistent()
        .get(&FeatureKey::Dispute(id))
        .ok_or(VaultError::ProposalNotFound)
}

pub fn get_proposal_disputes(env: &Env, proposal_id: u64) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&FeatureKey::ProposalDisputes(proposal_id))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_proposal_dispute(env: &Env, proposal_id: u64, dispute_id: u64) {
    let key = FeatureKey::ProposalDisputes(proposal_id);
    let mut ids = get_proposal_disputes(env, proposal_id);
    ids.push_back(dispute_id);
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

// ============================================================================
// Subscriptions
// ============================================================================

pub fn get_next_subscription_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&FeatureKey::Counter(CounterKey::Subscription))
        .unwrap_or(1)
}

pub fn increment_subscription_id(env: &Env) -> u64 {
    let id = get_next_subscription_id(env);
    env.storage()
        .instance()
        .set(&FeatureKey::Counter(CounterKey::Subscription), &(id + 1));
    id
}

pub fn set_subscription(env: &Env, sub: &Subscription) {
    let key = FeatureKey::Subscription(sub.id);
    env.storage().persistent().set(&key, sub);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_insurance_claim(env: &Env, claim_id: u64) -> Result<InsuranceClaim, VaultError> {
    env.storage()
        .persistent()
        .get(&DataKey::InsuranceClaim(claim_id))
        .ok_or(VaultError::ProposalNotFound)
}

/// Returns true if the given voter has already cast a vote on this claim.
pub fn has_voted_on_claim(env: &Env, claim_id: u64, voter: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::InsuranceClaimVote(claim_id, voter.clone()))
        .unwrap_or(false)
}

/// Record that `voter` has cast a vote on `claim_id`.
pub fn record_claim_vote(env: &Env, claim_id: u64, voter: &Address) {
    let key = DataKey::InsuranceClaimVote(claim_id, voter.clone());
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_subscription(env: &Env, id: u64) -> Result<Subscription, VaultError> {
    env.storage()
        .persistent()
        .get(&FeatureKey::Subscription(id))
        .ok_or(VaultError::SubscriptionNotFound)
}

// ============================================================================
// Subscriber Index
// ============================================================================

pub fn get_subscriber_index(env: &Env, subscriber: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&FeatureKey::SubscriberIndex(subscriber.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_to_subscriber_index(env: &Env, subscriber: &Address, subscription_id: u64) {
    let mut ids = get_subscriber_index(env, subscriber);
    ids.push_back(subscription_id);
    let key = FeatureKey::SubscriberIndex(subscriber.clone());
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

// ============================================================================
// Issue #1081: Per-token spending limits
// ============================================================================

/// Get how much of `token` has been spent today.
pub fn get_token_daily_spent(env: &Env, token: &Address, day: u64) -> i128 {
    env.storage()
        .temporary()
        .get(&DataKey::TokenDailySpent(token.clone(), day))
        .unwrap_or(0)
}

/// Add `amount` to today's per-token spending total.
pub fn add_token_daily_spent(env: &Env, token: &Address, day: u64, amount: i128) {
    let current = get_token_daily_spent(env, token, day);
    let key = DataKey::TokenDailySpent(token.clone(), day);
    env.storage().temporary().set(&key, &(current + amount));
    env.storage()
        .temporary()
        .extend_ttl(&key, DAY_IN_LEDGERS * 2, DAY_IN_LEDGERS * 2);
}

/// Get how much of `token` has been spent this week.
pub fn get_token_weekly_spent(env: &Env, token: &Address, week: u64) -> i128 {
    env.storage()
        .temporary()
        .get(&DataKey::TokenWeeklySpent(token.clone(), week))
        .unwrap_or(0)
}

/// Add `amount` to this week's per-token spending total.
pub fn add_token_weekly_spent(env: &Env, token: &Address, week: u64, amount: i128) {
    let current = get_token_weekly_spent(env, token, week);
    let key = DataKey::TokenWeeklySpent(token.clone(), week);
    env.storage().temporary().set(&key, &(current + amount));
    env.storage()
        .temporary()
        .extend_ttl(&key, DAY_IN_LEDGERS * 14, DAY_IN_LEDGERS * 14);
}

/// Retrieve the spending config for a supported token.
pub fn get_token_spending_config(env: &Env, token: &Address) -> Option<TokenSpendingConfig> {
    env.storage()
        .persistent()
        .get(&DataKey::TokenSpendingConfig(token.clone()))
}

/// Persist the spending config for a supported token.
pub fn set_token_spending_config(env: &Env, config: &TokenSpendingConfig) {
    let key = DataKey::TokenSpendingConfig(config.token.clone());
    env.storage().persistent().set(&key, config);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PERSISTENT_TTL);
}

/// Remove a token spending config (used during token removal).
pub fn remove_token_spending_config(env: &Env, token: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::TokenSpendingConfig(token.clone()));
}

/// Refund per-token spending when a proposal is cancelled.
///
/// Credits the original day/week buckets where the spend was reserved
/// (Issue #1345), not the current ledger's buckets.
pub fn refund_token_spending_limits(
    env: &Env,
    token: &Address,
    amount: i128,
    spend_day: u64,
    spend_week: u64,
) {
    let current_daily = get_token_daily_spent(env, token, spend_day);
    let refunded_daily = current_daily.saturating_sub(amount).max(0);
    let key_daily = DataKey::TokenDailySpent(token.clone(), spend_day);
    env.storage().temporary().set(&key_daily, &refunded_daily);
    env.storage()
        .temporary()
        .extend_ttl(&key_daily, DAY_IN_LEDGERS * 2, DAY_IN_LEDGERS * 2);

    let current_weekly = get_token_weekly_spent(env, token, spend_week);
    let refunded_weekly = current_weekly.saturating_sub(amount).max(0);
    let key_weekly = DataKey::TokenWeeklySpent(token.clone(), spend_week);
    env.storage().temporary().set(&key_weekly, &refunded_weekly);
    env.storage()
        .temporary()
        .extend_ttl(&key_weekly, DAY_IN_LEDGERS * 14, DAY_IN_LEDGERS * 14);
}

// ============================================================================
// Bridge Storage
// ============================================================================

pub fn get_bridge_config(env: &Env) -> Option<BridgeConfig> {
    env.storage().instance().get(&FeatureKey::BridgeConfig)
}

pub fn set_bridge_config(env: &Env, config: &BridgeConfig) {
    env.storage()
        .instance()
        .set(&FeatureKey::BridgeConfig, config);
}

pub fn get_cross_chain_proposal(env: &Env, proposal_id: u64) -> Option<CrossChainProposal> {
    env.storage()
        .persistent()
        .get(&FeatureKey::CrossChainProposal(proposal_id))
}

pub fn set_cross_chain_proposal(env: &Env, proposal_id: u64, proposal: &CrossChainProposal) {
    let key = FeatureKey::CrossChainProposal(proposal_id);
    env.storage().persistent().set(&key, proposal);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

/// Acquire the bridge re-entrancy lock for a proposal.
/// Returns `true` if the lock was acquired (was not already held), `false` otherwise.
pub fn acquire_bridge_lock(env: &Env, proposal_id: u64) -> bool {
    let key = FeatureKey::BridgeLock(proposal_id);
    if env
        .storage()
        .temporary()
        .get::<_, bool>(&key)
        .unwrap_or(false)
    {
        return false; // already locked
    }
    env.storage().temporary().set(&key, &true);
    env.storage()
        .temporary()
        .extend_ttl(&key, DAY_IN_LEDGERS, DAY_IN_LEDGERS);
    true
}

/// Release the bridge re-entrancy lock for a proposal.
pub fn release_bridge_lock(env: &Env, proposal_id: u64) {
    env.storage()
        .temporary()
        .remove(&FeatureKey::BridgeLock(proposal_id));
}

// ============================================================================
// Metrics Bucket Storage (Issue: feature/performance-metrics time-bucketed)
// ============================================================================

const MAX_METRIC_BUCKETS: u32 = 52;
const BUCKET_TTL: u32 = DAY_IN_LEDGERS * 365;

fn get_metrics_bucket_index(env: &Env) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&FeatureKey::MetricsBucketIndex)
        .unwrap_or_else(|| Vec::new(env))
}

fn set_metrics_bucket_index(env: &Env, index: &Vec<u64>) {
    let key = FeatureKey::MetricsBucketIndex;
    env.storage().persistent().set(&key, index);
    env.storage()
        .persistent()
        .extend_ttl(&key, BUCKET_TTL / 2, BUCKET_TTL);
}

pub fn get_metrics_bucket(env: &Env, week: u64) -> VaultMetrics {
    env.storage()
        .persistent()
        .get(&FeatureKey::MetricsBucket(week))
        .unwrap_or_else(VaultMetrics::default)
}

pub fn set_metrics_bucket(env: &Env, week: u64, metrics: &VaultMetrics) {
    let key = FeatureKey::MetricsBucket(week);
    env.storage().persistent().set(&key, metrics);
    env.storage()
        .persistent()
        .extend_ttl(&key, BUCKET_TTL / 2, BUCKET_TTL);

    // Update index and prune if over cap
    let mut index = get_metrics_bucket_index(env);
    if !index.contains(week) {
        index.push_back(week);
        // Prune oldest bucket if over cap
        if index.len() > MAX_METRIC_BUCKETS {
            let oldest = index.get(0).unwrap();
            env.storage()
                .persistent()
                .remove(&FeatureKey::MetricsBucket(oldest));
            index.remove(0);
        }
        set_metrics_bucket_index(env, &index);
    }
}

/// Update the current week's metrics bucket with the latest cumulative snapshot.
pub fn update_metrics_bucket(env: &Env, metrics: &VaultMetrics) {
    let week = get_week_number(env);
    set_metrics_bucket(env, week, metrics);
    crate::events::emit_metrics_bucket_updated(
        env,
        week,
        metrics.executed_count,
        metrics.rejected_count,
        metrics.expired_count,
    );
}

/// Aggregate metrics buckets across a week range (inclusive).
pub fn get_metrics_for_period(env: &Env, from_week: u64, to_week: u64) -> VaultMetrics {
    let mut agg = VaultMetrics::default();
    for week in from_week..=to_week {
        let bucket = get_metrics_bucket(env, week);
        agg.total_proposals = agg.total_proposals.saturating_add(bucket.total_proposals);
        agg.executed_count = agg.executed_count.saturating_add(bucket.executed_count);
        agg.rejected_count = agg.rejected_count.saturating_add(bucket.rejected_count);
        agg.expired_count = agg.expired_count.saturating_add(bucket.expired_count);
        agg.total_execution_time_ledgers = agg
            .total_execution_time_ledgers
            .saturating_add(bucket.total_execution_time_ledgers);
        agg.total_gas_used = agg.total_gas_used.saturating_add(bucket.total_gas_used);
        if bucket.last_updated_ledger > agg.last_updated_ledger {
            agg.last_updated_ledger = bucket.last_updated_ledger;
        }
    }
    agg
}

// ============================================================
// Delegation Storage Helpers
// ============================================================

pub fn get_delegation(env: &Env, delegator: &Address) -> Delegation {
    env.storage()
        .instance()
        .get(&DataKey::Delegation(delegator.clone()))
        .unwrap_or(Delegation {
            delegator: delegator.clone(),
            delegate: delegator.clone(),
            created_at: 0,
            expiry_ledger: 0,
            is_active: false,
            chain_depth: 0,
        })
}

pub fn set_delegation(env: &Env, delegation: &Delegation) {
    env.storage().instance().set(
        &DataKey::Delegation(delegation.delegator.clone()),
        delegation,
    );
}

pub fn remove_delegation(env: &Env, delegator: &Address) {
    env.storage()
        .instance()
        .remove(&DataKey::Delegation(delegator.clone()));
}

pub fn add_delegator_index(env: &Env, delegate: &Address, delegator: &Address) {
    let mut list: Vec<Address> = env
        .storage()
        .instance()
        .get(&DataKey::DelegatorsFor(delegate.clone()))
        .unwrap_or(Vec::new(env));

    if !list.contains(delegator) {
        list.push_back(delegator.clone());
    }

    env.storage()
        .instance()
        .set(&DataKey::DelegatorsFor(delegate.clone()), &list);
}

pub fn remove_delegator_index(env: &Env, delegate: &Address, delegator: &Address) {
    let list: Vec<Address> = env
        .storage()
        .instance()
        .get(&DataKey::DelegatorsFor(delegate.clone()))
        .unwrap_or(Vec::new(env));

    let mut updated = Vec::new(env);

    for d in list.iter() {
        if d != *delegator {
            updated.push_back(d);
        }
    }

    env.storage()
        .instance()
        .set(&DataKey::DelegatorsFor(delegate.clone()), &updated);
}

// ============================================================================
// Issue #1094: On-Chain Recipient Whitelist
// ============================================================================

pub fn get_whitelist_entry(env: &Env, addr: &Address) -> Option<WhitelistEntry> {
    env.storage()
        .persistent()
        .get(&FeatureKey::WhitelistEntry(addr.clone()))
}

pub fn set_whitelist_entry(env: &Env, addr: &Address, entry: &WhitelistEntry) {
    let key = FeatureKey::WhitelistEntry(addr.clone());
    env.storage().persistent().set(&key, entry);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PERSISTENT_TTL);
}

pub fn remove_whitelist_entry(env: &Env, addr: &Address) {
    env.storage()
        .persistent()
        .remove(&FeatureKey::WhitelistEntry(addr.clone()));
}

pub fn has_whitelist_entry(env: &Env, addr: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&FeatureKey::WhitelistEntry(addr.clone()))
}

// ============================================================================
// Issue #1096: Multi-Phase Proposals
// ============================================================================

pub fn get_multi_phase_proposal(env: &Env, proposal_id: u64) -> Option<MultiPhaseProposal> {
    env.storage()
        .persistent()
        .get(&FeatureKey::MultiPhaseProposal(proposal_id))
}

pub fn set_multi_phase_proposal(env: &Env, mp: &MultiPhaseProposal) {
    let key = FeatureKey::MultiPhaseProposal(mp.proposal_id);
    env.storage().persistent().set(&key, mp);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PERSISTENT_TTL);
}

// ============================================================================
// Issue #1097: Capability Tokens
// ============================================================================

pub fn get_capability_token(env: &Env, id: &BytesN<32>) -> Option<CapabilityToken> {
    env.storage()
        .persistent()
        .get(&FeatureKey::CapabilityToken(id.clone()))
}

pub fn set_capability_token(env: &Env, token: &CapabilityToken) {
    let key = FeatureKey::CapabilityToken(token.id.clone());
    env.storage().persistent().set(&key, token);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PERSISTENT_TTL);
}

pub fn remove_capability_token(env: &Env, id: &BytesN<32>) {
    env.storage()
        .persistent()
        .remove(&FeatureKey::CapabilityToken(id.clone()));
}

// ============================================================================
// Issue #1095: Voting Power Snapshot helper
// ============================================================================

/// Build a voting power snapshot for all current signers.
/// Each signer gets voting_power = 1 (simple equal weight).
/// Returns an empty map if there are no signers.
pub fn build_signer_snapshot(env: &Env, signers: &Vec<Address>) -> Map<Address, i128> {
    let mut snapshot = Map::new(env);
    for signer in signers.iter() {
        snapshot.set(signer, 1i128);
    }
    snapshot
}

// ============================================================================
// Moderator Management (Issue #1076)
// ============================================================================

/// Check if an address has the Moderator sub-role.
pub fn is_moderator(env: &Env, addr: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&FeatureKey::Moderator(addr.clone()))
        .unwrap_or(false)
}

/// Set or remove the Moderator sub-role for an address.
pub fn set_moderator(env: &Env, addr: &Address, is_mod: bool) {
    if is_mod {
        env.storage()
            .persistent()
            .set(&FeatureKey::Moderator(addr.clone()), &true);
        env.storage().persistent().extend_ttl(
            &FeatureKey::Moderator(addr.clone()),
            PERSISTENT_TTL_THRESHOLD,
            PERSISTENT_TTL,
        );
    } else {
        env.storage()
            .persistent()
            .remove(&FeatureKey::Moderator(addr.clone()));
    }
}

// ============================================================================
// Comment Rate Limiting (Issue #1076)
// ============================================================================

/// Get the comment count for a signer on a proposal for a given day.
pub fn get_comment_rate_count(env: &Env, proposal_id: u64, author: &Address, day: u64) -> u32 {
    env.storage()
        .temporary()
        .get(&FeatureKey::CommentRateCount(
            proposal_id,
            author.clone(),
            day,
        ))
        .unwrap_or(0)
}

/// Increment the comment count for a signer on a proposal for a given day.
pub fn increment_comment_rate_count(env: &Env, proposal_id: u64, author: &Address, day: u64) {
    let key = FeatureKey::CommentRateCount(proposal_id, author.clone(), day);
    let count: u32 = env.storage().temporary().get(&key).unwrap_or(0);
    env.storage().temporary().set(&key, &(count + 1));
    // TTL of 2 days to cover edge cases spanning two ledger epochs
    env.storage()
        .temporary()
        .extend_ttl(&key, DAY_IN_LEDGERS, DAY_IN_LEDGERS * 2);
}

// ============================================================================
// Expired Proposal TTL Reduction (Issue #1062)
// ============================================================================

/// Reduce TTL for an expired proposal to reclaim ledger rent sooner.
pub fn reduce_expired_proposal_ttl(env: &Env, proposal_id: u64) {
    let key = DataKey::Proposal(proposal_id);
    // Set a short TTL (1 day) for expired proposals instead of the default 7 days
    env.storage()
        .persistent()
        .extend_ttl(&key, DAY_IN_LEDGERS / 2, DAY_IN_LEDGERS);
}

// ============================================================================
// Flat tag index helpers (used by existing add_proposal_tag / remove_proposal_tag)
// ============================================================================

/// Add `proposal_id` to the flat tag index for `tag`.
pub fn tag_index_add(env: &Env, tag: &Symbol, proposal_id: u64) {
    let key = DataKey::HTagProposals(symbol_to_u64_key(env, tag));
    let mut ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    if !ids.contains(proposal_id) {
        ids.push_back(proposal_id);
        env.storage().persistent().set(&key, &ids);
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
    }
}

/// Remove `proposal_id` from the flat tag index for `tag`.
pub fn tag_index_remove(env: &Env, tag: &Symbol, proposal_id: u64) {
    let key = DataKey::HTagProposals(symbol_to_u64_key(env, tag));
    let ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    let mut new_ids: Vec<u64> = Vec::new(env);
    for id in ids.iter() {
        if id != proposal_id {
            new_ids.push_back(id);
        }
    }
    env.storage().persistent().set(&key, &new_ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

/// Remove a proposal from every tag index entry it appears in (flat tags).
pub fn tag_index_prune_proposal(env: &Env, tags: &Vec<Symbol>, proposal_id: u64) {
    for tag in tags.iter() {
        tag_index_remove(env, &tag, proposal_id);
    }
}

/// Return all proposal IDs for a flat tag symbol.
pub fn get_tag_index(env: &Env, tag: &Symbol) -> Vec<u64> {
    let key = DataKey::HTagProposals(symbol_to_u64_key(env, tag));
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env))
}

/// Derive a stable u64 hash from a Symbol for use as a DataKey discriminant.
/// Uses the SHA-256 of the symbol's string bytes (first 8 bytes, little-endian).
fn symbol_to_u64_key(env: &Env, tag: &Symbol) -> u64 {
    let tag_bytes = tag.clone().to_xdr(env);
    let hash = env.crypto().sha256(&tag_bytes);
    let hash_bytes = hash.to_array();
    u64::from_le_bytes(hash_bytes[0..8].try_into().unwrap())
}

// ============================================================================
// Issue #1077: Hierarchical Tag Taxonomy Storage
// ============================================================================

pub const MAX_HTAG_COUNT: u64 = 100;
pub const MAX_HTAG_LEVEL: u32 = 2; // 0=root, 1=child, 2=grandchild

pub fn get_htag(env: &Env, id: u64) -> Result<Tag, VaultError> {
    env.storage()
        .persistent()
        .get(&DataKey::HTag(id))
        .ok_or(VaultError::TagNotFound)
}

pub fn set_htag(env: &Env, tag: &Tag) {
    let key = DataKey::HTag(tag.id);
    env.storage().persistent().set(&key, tag);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn htag_exists(env: &Env, id: u64) -> bool {
    env.storage().persistent().has(&DataKey::HTag(id))
}

pub fn get_htag_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::HTagCount)
        .unwrap_or(0)
}

pub fn increment_htag_count(env: &Env) -> u64 {
    let count = get_htag_count(env) + 1;
    env.storage().instance().set(&DataKey::HTagCount, &count);
    count
}

pub fn decrement_htag_count(env: &Env) {
    let count = get_htag_count(env).saturating_sub(1);
    env.storage().instance().set(&DataKey::HTagCount, &count);
}

pub fn get_next_htag_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextHTagId)
        .unwrap_or(1)
}

pub fn increment_htag_id(env: &Env) -> u64 {
    let id = get_next_htag_id(env);
    env.storage()
        .instance()
        .set(&DataKey::NextHTagId, &(id + 1));
    id
}

/// Check whether a tag name already exists within a given parent scope.
/// `parent_scope` = parent_id, or 0 for root-level tags.
pub fn htag_name_in_scope_exists(env: &Env, parent_scope: u64, name: &Symbol) -> bool {
    let key = DataKey::HTagNameScope(parent_scope);
    let map: Map<Symbol, u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Map::new(env));
    map.contains_key(name.clone())
}

pub fn set_htag_name_in_scope(env: &Env, parent_scope: u64, name: &Symbol, tag_id: u64) {
    let key = DataKey::HTagNameScope(parent_scope);
    let mut map: Map<Symbol, u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Map::new(env));
    map.set(name.clone(), tag_id);
    env.storage().persistent().set(&key, &map);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn remove_htag_name_in_scope(env: &Env, parent_scope: u64, name: &Symbol) {
    let key = DataKey::HTagNameScope(parent_scope);
    let mut map: Map<Symbol, u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Map::new(env));
    map.remove(name.clone());
    env.storage().persistent().set(&key, &map);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_htag_children(env: &Env, parent_id: u64) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::HTagChildren(parent_id))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_htag_child(env: &Env, parent_id: u64, child_id: u64) {
    let key = DataKey::HTagChildren(parent_id);
    let mut children: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    if !children.contains(child_id) {
        children.push_back(child_id);
        env.storage().persistent().set(&key, &children);
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
    }
}

pub fn remove_htag_child(env: &Env, parent_id: u64, child_id: u64) {
    let key = DataKey::HTagChildren(parent_id);
    let children: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    let mut new_children: Vec<u64> = Vec::new(env);
    for c in children.iter() {
        if c != child_id {
            new_children.push_back(c);
        }
    }
    env.storage().persistent().set(&key, &new_children);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_htag_proposals(env: &Env, tag_id: u64) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::HTagProposals(tag_id))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_proposal_to_htag(env: &Env, tag_id: u64, proposal_id: u64) {
    let key = DataKey::HTagProposals(tag_id);
    let mut ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    if !ids.contains(proposal_id) {
        ids.push_back(proposal_id);
        env.storage().persistent().set(&key, &ids);
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
    }
}

pub fn remove_proposal_from_htag(env: &Env, tag_id: u64, proposal_id: u64) {
    let key = DataKey::HTagProposals(tag_id);
    let ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    let mut new_ids: Vec<u64> = Vec::new(env);
    for id in ids.iter() {
        if id != proposal_id {
            new_ids.push_back(id);
        }
    }
    env.storage().persistent().set(&key, &new_ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_proposal_htag_ids(env: &Env, proposal_id: u64) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::ProposalHTagIds(proposal_id))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_proposal_htag_ids(env: &Env, proposal_id: u64, tag_ids: &Vec<u64>) {
    let key = DataKey::ProposalHTagIds(proposal_id);
    env.storage().persistent().set(&key, tag_ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

/// Collect all descendant tag IDs for a given tag (depth-first, max depth 3, max 50 results).
pub fn collect_htag_descendants(env: &Env, tag_id: u64, result: &mut Vec<u64>, limit: u32) {
    if result.len() >= limit {
        return;
    }
    let children = get_htag_children(env, tag_id);
    for child_id in children.iter() {
        if result.len() >= limit {
            break;
        }
        result.push_back(child_id);
        collect_htag_descendants(env, child_id, result, limit);
    }
}

// ============================================================================
// Issue #1085: Gas Cost Estimation Oracle Storage
// ============================================================================

pub fn get_cost_model(env: &Env) -> CostModel {
    env.storage()
        .instance()
        .get(&FeatureKey::CostModel)
        .unwrap_or_else(CostModel::default)
}

pub fn set_cost_model(env: &Env, model: &CostModel) {
    env.storage().instance().set(&FeatureKey::CostModel, model);
}

// ============================================================================
// Issue #1367: Gas-Price Oracle Storage
// ============================================================================

/// Retrieve the gas-price oracle configuration, if one has been set by an admin.
pub fn get_gas_price_oracle_config(env: &Env) -> Option<GasPriceOracleConfig> {
    env.storage().instance().get(&FeatureKey::GasPriceOracle)
}

/// Persist the gas-price oracle configuration.
pub fn set_gas_price_oracle_config(env: &Env, config: &GasPriceOracleConfig) {
    env.storage()
        .instance()
        .set(&FeatureKey::GasPriceOracle, config);
}

/// Remove the gas-price oracle configuration (reverts to local-only estimation).
pub fn clear_gas_price_oracle_config(env: &Env) {
    env.storage().instance().remove(&FeatureKey::GasPriceOracle);
}

// ============================================================================
// Issue #1083: Variable-Substitution Template Storage
// ============================================================================

pub const MAX_VAR_TEMPLATES: u64 = 20;
pub const MAX_TEMPLATE_VARIABLES: usize = 10;

pub fn get_next_var_template_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextVarTemplateId)
        .unwrap_or(1)
}

pub fn increment_var_template_id(env: &Env) -> u64 {
    let id = get_next_var_template_id(env);
    env.storage()
        .instance()
        .set(&DataKey::NextVarTemplateId, &(id + 1));
    id
}

pub fn get_var_template_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::VarTemplateCount)
        .unwrap_or(0)
}

pub fn increment_var_template_count(env: &Env) {
    let count = get_var_template_count(env) + 1;
    env.storage()
        .instance()
        .set(&DataKey::VarTemplateCount, &count);
}

pub fn decrement_var_template_count(env: &Env) {
    let count = get_var_template_count(env).saturating_sub(1);
    env.storage()
        .instance()
        .set(&DataKey::VarTemplateCount, &count);
}

pub fn get_var_template(env: &Env, id: u64) -> Result<VarTemplate, VaultError> {
    env.storage()
        .persistent()
        .get(&DataKey::VarTemplate(id))
        .ok_or(VaultError::TemplateNotFound)
}

pub fn set_var_template(env: &Env, template: &VarTemplate) {
    let key = DataKey::VarTemplate(template.id);
    env.storage().persistent().set(&key, template);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn var_template_exists(env: &Env, id: u64) -> bool {
    env.storage().persistent().has(&DataKey::VarTemplate(id))
}

pub fn var_template_name_exists(env: &Env, name: &Symbol) -> bool {
    env.storage()
        .instance()
        .has(&DataKey::VarTemplateName(name.clone()))
}

pub fn set_var_template_name(env: &Env, name: &Symbol, id: u64) {
    env.storage()
        .instance()
        .set(&DataKey::VarTemplateName(name.clone()), &id);
}

pub fn remove_var_template_name(env: &Env, name: &Symbol) {
    env.storage()
        .instance()
        .remove(&DataKey::VarTemplateName(name.clone()));
}

pub fn get_proposal_var_ref(env: &Env, proposal_id: u64) -> Option<TemplateVarRef> {
    env.storage()
        .persistent()
        .get(&DataKey::ProposalVarRef(proposal_id))
}

pub fn set_proposal_var_ref(env: &Env, proposal_id: u64, var_ref: &TemplateVarRef) {
    let key = DataKey::ProposalVarRef(proposal_id);
    env.storage().persistent().set(&key, var_ref);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

pub fn get_var_template_proposals(env: &Env, template_id: u64) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::VarTemplateProposals(template_id))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_proposal_to_var_template(env: &Env, template_id: u64, proposal_id: u64) {
    let key = DataKey::VarTemplateProposals(template_id);
    let mut ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    if !ids.contains(proposal_id) {
        ids.push_back(proposal_id);
        env.storage().persistent().set(&key, &ids);
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
    }
}

// ============================================================================
// Issue #1086: Cold Storage Signature Storage
// ============================================================================

pub fn get_cold_signer_config(env: &Env) -> ColdSignerConfig {
    env.storage()
        .instance()
        .get(&FeatureKey::ColdSignerConfig)
        .unwrap_or_else(|| ColdSignerConfig::default(env))
}

pub fn set_cold_signer_config(env: &Env, config: &ColdSignerConfig) {
    env.storage()
        .instance()
        .set(&FeatureKey::ColdSignerConfig, config);
}

pub fn get_cold_sig(
    env: &Env,
    proposal_id: u64,
    pubkey_hash: &BytesN<32>,
) -> Option<ColdSignatureRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::ColdSig(proposal_id, pubkey_hash.clone()))
}

pub fn set_cold_sig(env: &Env, record: &ColdSignatureRecord, pubkey_hash: &BytesN<32>) {
    let key = DataKey::ColdSig(record.proposal_id, pubkey_hash.clone());
    env.storage().persistent().set(&key, record);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_cold_sig_index(env: &Env, proposal_id: u64) -> Vec<BytesN<32>> {
    env.storage()
        .persistent()
        .get(&DataKey::ColdSigIndex(proposal_id))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_cold_sig_to_index(env: &Env, proposal_id: u64, pubkey_hash: &BytesN<32>) {
    let key = DataKey::ColdSigIndex(proposal_id);
    let mut index: Vec<BytesN<32>> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    if !index.contains(pubkey_hash.clone()) {
        index.push_back(pubkey_hash.clone());
        env.storage().persistent().set(&key, &index);
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
    }
}

/// Check if a signature hash was already used (replay prevention).
pub fn is_cold_sig_used(env: &Env, sig_hash: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::ColdSigUsed(sig_hash.clone()))
        .unwrap_or(false)
}

/// Mark a signature hash as used.
pub fn mark_cold_sig_used(env: &Env, sig_hash: &BytesN<32>) {
    let key = DataKey::ColdSigUsed(sig_hash.clone());
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

/// Count valid (non-expired) cold signatures for a proposal.
pub fn count_valid_cold_sigs(env: &Env, proposal_id: u64, expiry_ledgers: u32) -> u32 {
    let current_ledger = env.ledger().sequence();
    let index = get_cold_sig_index(env, proposal_id);
    let mut count: u32 = 0;
    for pubkey_hash in index.iter() {
        if let Some(record) = get_cold_sig(env, proposal_id, &pubkey_hash) {
            let expiry = record.signed_at_ledger.saturating_add(expiry_ledgers);
            if current_ledger <= expiry {
                count += 1;
            }
        }
    }
    count
}

// ============================================================================
// Template versioning helper (used by existing update_template)
// ============================================================================

/// Store current template as an archived version before update.
/// Returns the pruned version number if the archive is full (max 5 versions).
pub fn store_template_version(env: &Env, template: &ProposalTemplate) -> Option<u32> {
    // Reuse FeatureKey::Template for archived versions using a composite key approach.
    // Archived version key: Template(id * 1_000_000 + version)
    let archive_id = template.id * 1_000_000 + template.version as u64;
    let key = FeatureKey::Template(archive_id);
    env.storage().persistent().set(&key, template);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);

    // Prune if version count exceeds 5
    if template.version > 5 {
        let old_archive_id = template.id * 1_000_000 + (template.version as u64).saturating_sub(5);
        env.storage()
            .persistent()
            .remove(&FeatureKey::Template(old_archive_id));
        return Some(template.version.saturating_sub(5));
    }
    None
}

// Emergency Pause / Circuit Breaker (#1084)
// ============================================================================

pub fn get_pause_state(env: &Env) -> PauseState {
    env.storage()
        .instance()
        .get(&FeatureKey::PauseState)
        .unwrap_or(PauseState {
            is_paused: false,
            paused_by: None,
            paused_at_ledger: 0,
            cause: soroban_sdk::Symbol::new(env, "none"),
        })
}

pub fn set_pause_state(env: &Env, state: &PauseState) {
    env.storage().instance().set(&FeatureKey::PauseState, state);
}

// ============================================================================
// Issue #1350: Pause Circuit Breaker Cooldown
// ============================================================================

pub fn get_pause_cooldown_config(env: &Env) -> Option<PauseCooldownConfig> {
    env.storage()
        .instance()
        .get(&FeatureKey::PauseCooldownConfig)
}

pub fn set_pause_cooldown_config(env: &Env, config: &PauseCooldownConfig) {
    env.storage()
        .instance()
        .set(&FeatureKey::PauseCooldownConfig, config);
}

pub fn is_pause_cooldown_active(env: &Env) -> bool {
    if let Some(config) = get_pause_cooldown_config(env) {
        let current_ledger = env.ledger().sequence() as u64;
        current_ledger < config.last_action_ledger + config.cooldown_ledgers
    } else {
        false
    }
}

pub fn get_pause_cooldown_remaining_ledgers(env: &Env) -> u64 {
    if let Some(config) = get_pause_cooldown_config(env) {
        let current_ledger = env.ledger().sequence() as u64;
        let target_ledger = config.last_action_ledger + config.cooldown_ledgers;
        target_ledger.saturating_sub(current_ledger)
    } else {
        0
    }
}

pub fn update_pause_cooldown_ledger(env: &Env) {
    if let Some(mut config) = get_pause_cooldown_config(env) {
        config.last_action_ledger = env.ledger().sequence() as u64;
        set_pause_cooldown_config(env, &config);
    }
}

pub fn get_emergency_signers(env: &Env) -> soroban_sdk::Vec<Address> {
    env.storage()
        .instance()
        .get(&FeatureKey::EmergencySigners)
        .unwrap_or_else(|| soroban_sdk::Vec::new(env))
}

pub fn set_emergency_signers(env: &Env, signers: &soroban_sdk::Vec<Address>) {
    env.storage()
        .instance()
        .set(&FeatureKey::EmergencySigners, signers);
}

pub fn get_circuit_breaker_threshold(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&FeatureKey::CircuitBreakerThreshold)
        .unwrap_or(0i128)
}

pub fn set_circuit_breaker_threshold(env: &Env, threshold: i128) {
    env.storage()
        .instance()
        .set(&FeatureKey::CircuitBreakerThreshold, &threshold);
}

/// Returns the 1-hour window index for circuit breaker tracking (~720 ledgers per hour)
pub fn get_hour_window(env: &Env) -> u64 {
    env.ledger().sequence() as u64 / 720
}

pub fn get_circuit_breaker_outflow(env: &Env, window: u64) -> i128 {
    env.storage()
        .temporary()
        .get(&FeatureKey::CircuitBreakerOutflow(window))
        .unwrap_or(0i128)
}

pub fn add_circuit_breaker_outflow(env: &Env, window: u64, amount: i128) {
    let current: i128 = get_circuit_breaker_outflow(env, window);
    let key = FeatureKey::CircuitBreakerOutflow(window);
    env.storage().temporary().set(&key, &(current + amount));
    env.storage().temporary().extend_ttl(&key, 1440, 1440); // 2 hours
}

// ============================================================================
// Proposal Fingerprint Deduplication (#1089)
// ============================================================================

/// ~30 days in ledgers
pub const FINGERPRINT_TTL: u32 = DAY_IN_LEDGERS * 30;

pub fn has_proposal_fingerprint(env: &Env, fingerprint: &soroban_sdk::BytesN<32>) -> bool {
    env.storage()
        .temporary()
        .has(&FeatureKey::ProposalFingerprint(fingerprint.clone()))
}

pub fn set_proposal_fingerprint(env: &Env, fingerprint: &soroban_sdk::BytesN<32>) {
    let key = FeatureKey::ProposalFingerprint(fingerprint.clone());
    env.storage().temporary().set(&key, &true);
    env.storage()
        .temporary()
        .extend_ttl(&key, FINGERPRINT_TTL, FINGERPRINT_TTL);
}

// ============================================================================

// Scoped Delegation (#1082)
// ============================================================================

pub fn get_next_scoped_delegation_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&FeatureKey::Counter(CounterKey::ScopedDelegation))
        .unwrap_or(1)
}

pub fn increment_scoped_delegation_id(env: &Env) -> u64 {
    let id = get_next_scoped_delegation_id(env);
    env.storage().instance().set(
        &FeatureKey::Counter(CounterKey::ScopedDelegation),
        &(id + 1),
    );
    id
}

pub fn set_scoped_delegation(env: &Env, d: &ScopedDelegation) {
    let key = FeatureKey::ScopedDelegation(d.id);
    env.storage().persistent().set(&key, d);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_scoped_delegation(env: &Env, id: u64) -> Option<ScopedDelegation> {
    env.storage()
        .persistent()
        .get(&FeatureKey::ScopedDelegation(id))
}

pub fn get_scoped_delegations_by_delegator(env: &Env, delegator: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&FeatureKey::ScopedDelegationsByDelegator(delegator.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_scoped_delegations_by_delegator(env: &Env, delegator: &Address, ids: &Vec<u64>) {
    let key = FeatureKey::ScopedDelegationsByDelegator(delegator.clone());
    env.storage().persistent().set(&key, ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

// ============================================================================
// Balance Snapshots (#1080)
// ============================================================================

const MAX_SNAPSHOTS: u32 = 90;

pub fn get_snapshots(env: &Env) -> Vec<BalanceSnapshot> {
    env.storage()
        .persistent()
        .get(&FeatureKey::BalanceSnapshots)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_snapshot(env: &Env, snapshot: &BalanceSnapshot) {
    let mut snapshots = get_snapshots(env);
    if snapshots.len() >= MAX_SNAPSHOTS {
        snapshots.remove(0);
    }
    snapshots.push_back(snapshot.clone());
    let key = FeatureKey::BalanceSnapshots;
    env.storage().persistent().set(&key, &snapshots);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);

    env.storage()
        .persistent()
        .set(&FeatureKey::LastSnapshotLedger, &snapshot.ledger);
}

pub fn get_last_snapshot_ledger(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get(&FeatureKey::LastSnapshotLedger)
        .unwrap_or(0)
}

pub fn get_snapshot_interval(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&FeatureKey::SnapshotInterval)
        .unwrap_or(0)
}

pub fn set_snapshot_interval(env: &Env, interval: u32) {
    env.storage()
        .instance()
        .set(&FeatureKey::SnapshotInterval, &interval);
}

pub fn get_snapshot_at(env: &Env, target_ledger: u32) -> Option<BalanceSnapshot> {
    let snapshots = get_snapshots(env);
    let len = snapshots.len();
    if len == 0 {
        return None;
    }
    // Binary search for nearest snapshot at or before target_ledger
    let target = target_ledger as u64;
    let mut lo: u32 = 0;
    let mut hi: u32 = len - 1;
    let mut best: Option<BalanceSnapshot> = None;

    while lo <= hi {
        let mid = lo + (hi - lo) / 2;
        let snap = snapshots.get(mid).unwrap();
        if snap.ledger <= target {
            best = Some(snap);
            if mid == hi {
                break;
            }
            lo = mid + 1;
        } else {
            if mid == 0 {
                break;
            }
            hi = mid - 1;
        }
    }
    best
}

// ============================================================================
// Governance Proposals (#1068)
// ============================================================================

pub fn get_next_governance_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&FeatureKey::NextGovernanceId)
        .unwrap_or(1)
}

pub fn increment_governance_id(env: &Env) -> u64 {
    let id = get_next_governance_id(env);
    env.storage()
        .instance()
        .set(&FeatureKey::NextGovernanceId, &(id + 1));
    id
}

pub fn get_governance_proposal(env: &Env, id: u64) -> Option<GovernanceProposal> {
    env.storage()
        .persistent()
        .get(&FeatureKey::GovernanceProposal(id))
}

pub fn set_governance_proposal(env: &Env, gp: &GovernanceProposal) {
    let key = FeatureKey::GovernanceProposal(gp.id);
    env.storage().persistent().set(&key, gp);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_governance_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&FeatureKey::GovernanceThreshold)
        .unwrap_or(67)
}

pub fn set_governance_threshold(env: &Env, threshold: u32) {
    env.storage()
        .instance()
        .set(&FeatureKey::GovernanceThreshold, &threshold);
}

pub fn get_active_governance_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&FeatureKey::ActiveGovernanceCount)
        .unwrap_or(0)
}

pub fn set_active_governance_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&FeatureKey::ActiveGovernanceCount, &count);
}

// ============================================================================
// Pending Config Change (Issue #943)
// ============================================================================

pub fn get_pending_config_proposal(env: &Env) -> Option<u64> {
    env.storage().instance().get(&FeatureKey::PendingConfig)
}

pub fn set_pending_config_proposal(env: &Env, proposal_id: u64) {
    env.storage()
        .instance()
        .set(&FeatureKey::PendingConfig, &proposal_id);
}

pub fn clear_pending_config_proposal(env: &Env) {
    env.storage().instance().remove(&FeatureKey::PendingConfig);
}

// ============================================================================
// Recipient whitelist helper
// ============================================================================

pub fn is_recipient_whitelisted(env: &Env, recipient: &Address) -> bool {
    match get_list_mode(env) {
        ListMode::Disabled => true,
        ListMode::Whitelist => is_whitelisted(env, recipient),
        ListMode::Blacklist => !is_blacklisted(env, recipient),
    }
}

// ============================================================================
// Issue #1087: Audit Trail Compression
// ============================================================================

pub fn get_next_audit_checkpoint_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextAuditCheckpointId)
        .unwrap_or(1)
}

pub fn increment_audit_checkpoint_id(env: &Env) -> u64 {
    let id = get_next_audit_checkpoint_id(env);
    env.storage()
        .instance()
        .set(&DataKey::NextAuditCheckpointId, &(id + 1));
    id
}

pub fn set_audit_checkpoint(env: &Env, checkpoint: &AuditCheckpoint) {
    let key = DataKey::AuditCheckpoint(checkpoint.id);
    env.storage().persistent().set(&key, checkpoint);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_audit_checkpoint(env: &Env, id: u64) -> Option<AuditCheckpoint> {
    env.storage()
        .persistent()
        .get(&DataKey::AuditCheckpoint(id))
}

pub fn remove_audit_entry(env: &Env, id: u64) {
    env.storage().persistent().remove(&DataKey::AuditEntry(id));
}

// ============================================================================
// Issue #1100: Vault Merge Protocol Storage
// ============================================================================

pub fn get_next_merge_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextMergeId)
        .unwrap_or(1)
}

pub fn increment_merge_id(env: &Env) -> u64 {
    let id = get_next_merge_id(env);
    env.storage()
        .instance()
        .set(&DataKey::NextMergeId, &(id + 1));
    id
}

pub fn set_merge_record(env: &Env, record: &MergeRecord) {
    let key = DataKey::MergeRecord(record.id);
    env.storage().persistent().set(&key, record);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_merge_record(env: &Env, id: u64) -> Option<MergeRecord> {
    env.storage().persistent().get(&DataKey::MergeRecord(id))
}

pub fn set_active_merge_id(env: &Env, merge_id: u64) {
    env.storage()
        .instance()
        .set(&DataKey::ActiveMergeId, &merge_id);
}

pub fn get_active_merge_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::ActiveMergeId)
        .unwrap_or(0)
}

pub fn set_vault_deactivated(env: &Env) {
    env.storage()
        .instance()
        .set(&DataKey::VaultDeactivated, &true);
}

pub fn is_vault_deactivated(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::VaultDeactivated)
        .unwrap_or(false)
}

// ============================================================================
// Voting deadline extensions
// ============================================================================

pub fn get_deadline_extension_count(env: &Env, proposal_id: u64) -> u32 {
    env.storage()
        .temporary()
        .get(&FeatureKey::DeadlineExtensionCount(proposal_id))
        .unwrap_or(0)
}

pub fn increment_deadline_extension_count(env: &Env, proposal_id: u64) -> u32 {
    let count = get_deadline_extension_count(env, proposal_id) + 1;
    let key = FeatureKey::DeadlineExtensionCount(proposal_id);
    env.storage().temporary().set(&key, &count);
    env.storage()
        .temporary()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
    count
}

/// Retrieve a specific historical version of a template.
pub fn get_template_version(
    env: &Env,
    template_id: u64,
    version: u32,
) -> Result<ProposalTemplate, VaultError> {
    let archive_id = template_id * 1_000_000 + version as u64;
    env.storage()
        .persistent()
        .get(&FeatureKey::Template(archive_id))
        .ok_or(VaultError::TemplateNotFound)
}

// ============================================================================
// Staking Tier Progression (#1438)
// ============================================================================

pub fn get_proposer_staking_tier(env: &Env, proposer: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&FeatureKey::ProposerStakingTier(proposer.clone()))
        .unwrap_or(0)
}

pub fn set_proposer_staking_tier(env: &Env, proposer: &Address, tier: u32) {
    let key = FeatureKey::ProposerStakingTier(proposer.clone());
    env.storage().persistent().set(&key, &tier);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_proposer_execution_count(env: &Env, proposer: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&FeatureKey::ProposerExecutionCount(proposer.clone()))
        .unwrap_or(0)
}

pub fn increment_proposer_execution_count(env: &Env, proposer: &Address) -> u64 {
    let count = get_proposer_execution_count(env, proposer) + 1;
    let key = FeatureKey::ProposerExecutionCount(proposer.clone());
    env.storage().persistent().set(&key, &count);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
    count
}

// ============================================================================
// Staking Rewards Accrual (#1439)
// ============================================================================

pub fn get_proposer_accumulated_rewards(env: &Env, proposer: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&FeatureKey::ProposerAccumulatedRewards(proposer.clone()))
        .unwrap_or(0)
}

pub fn add_proposer_rewards(env: &Env, proposer: &Address, amount: i128) {
    let current = get_proposer_accumulated_rewards(env, proposer);
    let new_total = current + amount;
    let key = FeatureKey::ProposerAccumulatedRewards(proposer.clone());
    env.storage().persistent().set(&key, &new_total);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

// ============================================================================
// Subscription Tier Usage Tracking (#1437)
// ============================================================================

pub fn get_subscription_usage(env: &Env, subscription_id: u64) -> Map<Symbol, i128> {
    env.storage()
        .persistent()
        .get(&FeatureKey::SubscriptionUsage(subscription_id))
        .unwrap_or_else(|| Map::new(env))
}

pub fn set_subscription_usage(env: &Env, subscription_id: u64, usage: &Map<Symbol, i128>) {
    let key = FeatureKey::SubscriptionUsage(subscription_id);
    env.storage().persistent().set(&key, usage);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn increment_subscription_usage(
    env: &Env,
    subscription_id: u64,
    metric: &Symbol,
    amount: i128,
) {
    let mut usage = get_subscription_usage(env, subscription_id);
    let current = usage.get(metric.clone()).unwrap_or(0);
    usage.set(metric.clone(), current + amount);
    set_subscription_usage(env, subscription_id, &usage);
}

// ============================================================================
// Issue #1414: Reentrancy Guard for Proposal Execution
// ============================================================================

pub fn set_proposal_in_progress(env: &Env, proposal_id: u64) {
    env.storage()
        .instance()
        .set(&DataKey::ProposalInProgress(proposal_id), &true);
}

pub fn is_proposal_in_progress(env: &Env, proposal_id: u64) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::ProposalInProgress(proposal_id))
        .unwrap_or(false)
}

pub fn clear_proposal_in_progress(env: &Env, proposal_id: u64) {
    env.storage()
        .instance()
        .remove(&DataKey::ProposalInProgress(proposal_id));
}

// ============================================================================
// Issue #1091: Keeper Network Lifecycle Hooks
// ============================================================================

/// Maximum keeper hooks registered per event type.
pub const MAX_KEEPER_HOOKS_PER_EVENT: u32 = 5;
/// Maximum total keeper hooks across all event types per vault.
pub const MAX_KEEPER_HOOKS_TOTAL: u32 = 20;

fn hook_event_key(event_type: &HookEventType) -> FeatureKey {
    FeatureKey::KeeperHooks(event_type.clone() as u32)
}

/// Return all registered hooks for a given event type (empty vec if none).
pub fn get_keeper_hooks(env: &Env, event_type: &HookEventType) -> Vec<HookRegistration> {
    let key = hook_event_key(event_type);
    env.storage()
        .persistent()
        .get::<_, Vec<HookRegistration>>(&key)
        .unwrap_or_else(|| Vec::new(env))
}

/// Persist the hooks vec for an event type and extend its TTL.
pub fn set_keeper_hooks(env: &Env, event_type: &HookEventType, hooks: &Vec<HookRegistration>) {
    let key = hook_event_key(event_type);
    env.storage().persistent().set(&key, hooks);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

/// Get the total number of keeper hooks registered across all event types.
pub fn get_keeper_hook_count(env: &Env) -> u32 {
    env.storage()
        .persistent()
        .get::<_, u32>(&FeatureKey::KeeperHookCount)
        .unwrap_or(0)
}

/// Set the total number of keeper hooks.
pub fn set_keeper_hook_count(env: &Env, count: u32) {
    env.storage()
        .persistent()
        .set(&FeatureKey::KeeperHookCount, &count);
    env.storage().persistent().extend_ttl(
        &FeatureKey::KeeperHookCount,
        PERSISTENT_TTL_THRESHOLD,
        PERSISTENT_TTL,
    );
}
