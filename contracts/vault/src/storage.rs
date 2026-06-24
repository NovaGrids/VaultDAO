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

use soroban_sdk::{contracttype, Address, Env, String, Vec};

use crate::errors::VaultError;
use crate::types::{
    AuditEntry, BatchExecutionResult, BatchTransaction, Comment, Config, DelegatedPermission,
    Delegation, DelegationHistory, DexConfig, Escrow, ExecutionFeeEstimate, ExecutionSnapshot,
    FeeStructure, FundingRound, FundingRoundConfig, GasConfig, GovernanceProposal, InsuranceConfig,
    ListMode, NotificationPreferences, PermissionGrant, Proposal, ProposalAmendment, ProposalStatus,
    ProposalTemplate, RecoveryProposal, Reputation, ReputationConfig, RetryState, Role,
    HolidayCalendar, RoleAssignment, SignerTier, StakeRecord, StakingConfig, Subscription,
    SwapProposal, SwapResult, VestingSchedule,
    TimeWeightedConfig, TokenLock, VaultMetrics, VelocityConfig, VotingStrategy, BridgeConfig,
    CrossChainProposal, DeadLetterRecord,
};
use crate::types_balance_snapshot::BalanceSnapshot;

/// Core storage key definitions (kept minimal to avoid size limits)
#[contracttype]
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
    /// Execution snapshot for rollback
    ExecutionSnapshot(u64),
    /// Execution fee estimate
    ExecutionFeeEstimate(u64),
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
}

#[contracttype]
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

#[contracttype]
#[derive(Clone)]
pub enum VestingKey {
    Schedule(u64),
    NextId,
    ActiveCount,
    Reserved(Address),
}

#[contracttype]
#[derive(Clone)]
pub enum CalendarKey {
    Holidays,
}

/// Feature-specific storage keys (split to avoid enum size limits)
#[contracttype]
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
    /// Moderator flag for an address -> bool
    Moderator(Address),
    /// Comment rate tracking: (proposal_id, author, day_number) -> u32
    CommentRateCount(u64, Address, u64),
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
    env.storage().instance().set(&VestingKey::ActiveCount, &count);
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
    env.storage().persistent().set(&CalendarKey::Holidays, calendar);
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
}

pub fn get_next_proposal_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextProposalId)
        .unwrap_or_else(|| {
            // Start from prefix + 1 if prefix is set
            let cfg: Option<crate::types::Config> = env.storage().instance().get(&DataKey::Config);
            if let Some(c) = cfg {
                if c.proposal_id_prefix > 0 { c.proposal_id_prefix + 1 } else { 1 }
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
        env.storage().persistent().set(&DataKey::WhitelistIndex, &index);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::WhitelistIndex, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
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
        if a != *addr { new_index.push_back(a); }
    }
    env.storage().persistent().set(&DataKey::WhitelistIndex, &new_index);
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
        env.storage().persistent().set(&DataKey::BlacklistIndex, &index);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::BlacklistIndex, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
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
        if a != *addr { new_index.push_back(a); }
    }
    env.storage().persistent().set(&DataKey::BlacklistIndex, &new_index);
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
            if skipped < offset { skipped += 1; continue; }
            result.push_back(addr);
            if result.len() as u64 >= cap { break; }
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
            if skipped < offset { skipped += 1; continue; }
            result.push_back(addr);
            if result.len() as u64 >= cap { break; }
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
            if !env.storage().persistent().has(&DataKey::Proposal(id)) { continue; }
            if skipped < offset { skipped += 1; continue; }
            result.push_back(id);
            if result.len() as u64 >= cap { break; }
        }
    }
    result
}

pub fn get_proposals_by_ledger_range(env: &Env, from_ledger: u64, to_ledger: u64, offset: u64, limit: u64) -> Vec<u64> {
    let cap: u64 = if limit > 50 { 50 } else { limit };
    let next_id = get_next_proposal_id(env);
    let mut result: Vec<u64> = Vec::new(env);
    let mut skipped: u64 = 0;
    // Determine start ID: for prefixed vaults, scan from prefix+1
    let cfg: Option<crate::types::Config> = env.storage().instance().get(&DataKey::Config);
    let start_id = if let Some(c) = cfg {
        if c.proposal_id_prefix > 0 { c.proposal_id_prefix + 1 } else { 1 }
    } else { 1 };
    for id in start_id..next_id {
        if result.len() as u64 >= cap { break; }
        if !env.storage().persistent().has(&DataKey::Proposal(id)) { continue; }
        let proposal: crate::types::Proposal = match env.storage().persistent().get(&DataKey::Proposal(id)) {
            Some(p) => p,
            None => continue,
        };
        if proposal.created_at >= from_ledger && proposal.created_at <= to_ledger {
            if skipped < offset { skipped += 1; continue; }
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
                if id != proposal_id { new_ids.push_back(id); }
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

/// Refund spending limits when a proposal is cancelled
pub fn refund_spending_limits(env: &Env, amount: i128) {
    // Use atomic try_deduct helpers to ensure counters never go negative.
    // Each helper reads, validates, and writes in a single storage call,
    // preventing double-refund if two cancellations land in the same ledger.
    let today = get_day_number(env);
    try_deduct_daily_spent(env, today, amount);

    let week = get_week_number(env);
    try_deduct_weekly_spent(env, week, amount);
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
    env.storage().persistent().get(&FeatureKey::BatchResult(batch_id))
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

pub fn get_bridge_record(env: &Env, bridge_id: soroban_sdk::BytesN<32>) -> Option<crate::types::BridgeRecord> {
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

pub fn get_audit_entry(env: &Env, id: u64) -> Result<AuditEntry, VaultError> {
    env.storage()
        .persistent()
        .get(&DataKey::AuditEntry(id))
        .ok_or(VaultError::ProposalNotFound)
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
    
    // actor: Address bytes (32 bytes)
    data.extend_from_slice(&actor.to_bytes());
    
    // target: u64 (8 bytes, little-endian)
    data.extend_from_array(&target.to_le_bytes());
    
    // timestamp: u64 (8 bytes, little-endian)
    data.extend_from_array(&timestamp.to_le_bytes());
    
    // prev_hash: u64 (8 bytes, little-endian)
    data.extend_from_array(&prev_hash.to_le_bytes());
    
    // Compute SHA256 hash
    let hash_bytes = env.crypto().sha256(&data);
    
    // Convert first 8 bytes of hash to u64 (little-endian)
    let mut hash_array = [0u8; 8];
    hash_array.copy_from_slice(&hash_bytes.slice(0..8).to_array());
    u64::from_le_bytes(hash_array)
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
    if env.storage().temporary().get::<_, bool>(&key).unwrap_or(false) {
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
        })
}

pub fn set_delegation(env: &Env, delegation: &Delegation) {
    env.storage()
        .instance()
        .set(&DataKey::Delegation(delegation.delegator.clone()), delegation);
}

pub fn remove_delegation(env: &Env, delegator: &Address) {
    env.storage()
        .instance()
        .remove(&DataKey::Delegation(delegator.clone()));
}

pub fn get_delegators_for(env: &Env, delegate: &Address) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::DelegatorsFor(delegate.clone()))
        .unwrap_or(Vec::new(env))
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
    let mut list: Vec<Address> = env
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
        .get(&FeatureKey::CommentRateCount(proposal_id, author.clone(), day))
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
