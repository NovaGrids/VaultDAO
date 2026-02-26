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
    Comment, Config, CrossVaultConfig, CrossVaultProposal, Dispute, Escrow, FeeStructure,
    GasConfig, InsuranceConfig, ListMode, NotificationPreferences, Proposal, ProposalAmendment,
    ProposalTemplate, RecoveryProposal, Reputation, RetryState, Role, VaultMetrics, VelocityConfig,
};

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
    /// Cancellation record for a proposal -> CancellationRecord
    CancellationRecord(u64),
    /// List of all cancelled proposal IDs -> Vec<u64>
    CancellationHistory,
    /// Amendment history for a proposal -> Vec<ProposalAmendment>
    AmendmentHistory(u64),
    /// Recipient list mode -> ListMode
    ListMode,
    /// Whitelist flag for address -> bool
    Whitelist(Address),
    /// Blacklist flag for address -> bool
    Blacklist(Address),
    /// Comment by ID -> Comment
    Comment(u64),
    /// Next comment ID counter -> u64
    NextCommentId,
    /// Comment IDs per proposal -> Vec<u64>
    ProposalComments(u64),
    /// Proposal IPFS attachment hashes -> Vec<String>
    Attachments(u64),
    /// Reputation record per address -> Reputation
    Reputation(Address),
}

/// Feature-specific storage keys (split to avoid enum size limits)
#[contracttype]
#[derive(Clone)]
pub enum FeatureKey {
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
    /// Next template ID counter -> u64
    NextTemplateId,
    /// Template name to ID mapping -> u64
    TemplateName(soroban_sdk::Symbol),
    /// Retry state for a proposal -> RetryState
    RetryState(u64),
    /// Escrow agreement by ID -> Escrow
    Escrow(u64),
    /// Next escrow ID counter -> u64
    NextEscrowId,
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
    /// Dispute by ID -> Dispute
    Dispute(u64),
    /// Next dispute ID counter -> u64
    NextDisputeId,
    /// Disputes for a proposal -> Vec<u64>
    ProposalDisputes(u64),
    /// Batch transaction by ID -> BatchTransaction
    Batch(u64),
    /// Batch ID counter -> u64
    BatchIdCounter,
    /// Batch execution result -> BatchExecutionResult
    BatchResult(u64),
    /// Batch rollback state -> Vec<(Address, i128)>
    BatchRollback(u64),
    /// Next batch ID counter -> u64
    BatchIdCounter,
    /// Recovery proposal by ID -> RecoveryProposal
    RecoveryProposal(u64),
    /// Next recovery ID counter -> u64
    NextRecoveryId,
    /// Insurance pool accumulated slashed funds (Token Address) -> i128
    InsurancePool(Address),
    /// Fee structure configuration -> FeeStructure
    FeeStructure,
    /// Total fees collected per token -> i128
    FeesCollected(Address),
    /// User's total transaction volume per token -> i128
    UserVolume(Address, Address),
}

/// TTL constants (in ledgers, ~5 seconds each)
pub const DAY_IN_LEDGERS: u32 = 17_280; // ~24 hours
pub const PROPOSAL_TTL: u32 = DAY_IN_LEDGERS * 7; // 7 days
pub const INSTANCE_TTL: u32 = DAY_IN_LEDGERS * 30; // 30 days
pub const INSTANCE_TTL_THRESHOLD: u32 = DAY_IN_LEDGERS * 7; // Extend when below 7 days
pub const PERSISTENT_TTL: u32 = DAY_IN_LEDGERS * 30; // 30 days
pub const PERSISTENT_TTL_THRESHOLD: u32 = DAY_IN_LEDGERS * 7; // Extend when below 7 days

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
}

pub fn get_next_proposal_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextProposalId)
        .unwrap_or(1)
}

pub fn increment_proposal_id(env: &Env) -> u64 {
    let id = get_next_proposal_id(env);
    env.storage()
        .instance()
        .set(&DataKey::NextProposalId, &(id + 1));
    id
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
    let current = get_daily_spent(env, day);
    let key = DataKey::DailySpent(day);
    env.storage().temporary().set(&key, &(current + amount));
    env.storage()
        .temporary()
        .extend_ttl(&key, DAY_IN_LEDGERS * 2, DAY_IN_LEDGERS * 2);
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
    let current = get_weekly_spent(env, week);
    let key = DataKey::WeeklySpent(week);
    env.storage().temporary().set(&key, &(current + amount));
    env.storage()
        .temporary()
        .extend_ttl(&key, DAY_IN_LEDGERS * 14, DAY_IN_LEDGERS * 14);
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
// Streaming Payments
// ============================================================================

pub fn get_next_stream_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get::<DataKey, u64>(&DataKey::Stream(StreamKey::Counter))
        .unwrap_or(1)
}

pub fn increment_stream_id(env: &Env) -> u64 {
    let id = get_next_stream_id(env);
    env.storage()
        .instance()
        .set(&DataKey::Stream(StreamKey::Counter), &(id + 1));
    extend_instance_ttl(env);
    id
}

pub fn set_streaming_payment(env: &Env, stream: &crate::types::StreamingPayment) {
    let key = DataKey::Stream(StreamKey::Payment(stream.id));
    env.storage().persistent().set(&key, stream);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_streaming_payment(
    env: &Env,
    id: u64,
) -> Result<crate::types::StreamingPayment, VaultError> {
    let key = DataKey::Stream(StreamKey::Payment(id));
    env.storage()
        .persistent()
        .get(&key)
        .flatten()
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
}

pub fn remove_from_whitelist(env: &Env, addr: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Whitelist(addr.clone()));
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
}

pub fn remove_from_blacklist(env: &Env, addr: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Blacklist(addr.clone()));
}

// ============================================================================
// Velocity Checking (Sliding Window)
// ============================================================================

pub fn check_and_update_velocity(env: &Env, addr: &Address, config: &VelocityConfig) -> bool {
    let now = env.ledger().timestamp();
    let key = DataKey::VelocityHistory(addr.clone());

    let history: Vec<u64> = env
        .storage()
        .temporary()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));

    let window_start = now.saturating_sub(config.window);

    let mut updated_history: Vec<u64> = Vec::new(env);
    for ts in history.iter() {
        if ts > window_start {
            updated_history.push_back(ts);
        }
    }

    if updated_history.len() >= config.limit {
        return false;
    }

    updated_history.push_back(now);
    env.storage().temporary().set(&key, &updated_history);
    env.storage()
        .temporary()
        .extend_ttl(&key, DAY_IN_LEDGERS, DAY_IN_LEDGERS);

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
    // Refund daily
    let today = get_day_number(env);
    let spent_today = get_daily_spent(env, today);
    let refunded_daily = spent_today.saturating_sub(amount).max(0);
    let key_daily = DataKey::DailySpent(today);
    env.storage().temporary().set(&key_daily, &refunded_daily);
    env.storage()
        .temporary()
        .extend_ttl(&key_daily, DAY_IN_LEDGERS * 2, DAY_IN_LEDGERS * 2);

    // Refund weekly
    let week = get_week_number(env);
    let spent_week = get_weekly_spent(env, week);
    let refunded_weekly = spent_week.saturating_sub(amount).max(0);
    let key_weekly = DataKey::WeeklySpent(week);
    env.storage().temporary().set(&key_weekly, &refunded_weekly);
    env.storage()
        .temporary()
        .extend_ttl(&key_weekly, DAY_IN_LEDGERS * 14, DAY_IN_LEDGERS * 14);
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

pub fn is_in_priority_queue(env: &Env, priority: u32, proposal_id: u64) -> bool {
    get_proposals_by_priority(env, priority).contains(proposal_id)
}

// ============================================================================
// Execution Snapshot Management
// ============================================================================

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

/// Apply time-based decay to a reputation score.
/// Every 30 days without activity, score drifts toward the neutral 500 by 5%.
pub fn apply_reputation_decay(env: &Env, rep: &mut Reputation) {
    let current_ledger = env.ledger().sequence() as u64;
    // ~30 days in ledgers
    const DECAY_INTERVAL: u64 = 17_280 * 30;
    if rep.last_decay_ledger == 0 {
        rep.last_decay_ledger = current_ledger;
        return;
    }
    let elapsed = current_ledger.saturating_sub(rep.last_decay_ledger);
    let periods = elapsed / DECAY_INTERVAL;
    if periods == 0 {
        return;
    }
    // Move score toward neutral (500) by 5% per period
    for _ in 0..periods {
        match rep.score.cmp(&500) {
            core::cmp::Ordering::Greater => {
                let diff = rep.score - 500;
                rep.score = rep.score.saturating_sub(diff / 20 + 1);
            }
            core::cmp::Ordering::Less => {
                let diff = 500 - rep.score;
                rep.score = rep.score.saturating_add(diff / 20 + 1);
            }
            core::cmp::Ordering::Equal => {}
        }
    }
    rep.last_decay_ledger = current_ledger;
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

pub fn get_notification_prefs(env: &Env, addr: &Address) -> NotificationPreferences {
    env.storage()
        .persistent()
        .get(&FeatureKey::NotificationPrefs(addr.clone()))
        .unwrap_or_else(NotificationPreferences::default)
}

pub fn set_notification_prefs(env: &Env, addr: &Address, prefs: &NotificationPreferences) {
    let key = FeatureKey::NotificationPrefs(addr.clone());
    env.storage().persistent().set(&key, prefs);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

// ============================================================================
// DEX/AMM Integration (Issue: feature/amm-integration)
// ============================================================================

use crate::types::{SwapProposal, SwapResult};

pub fn set_dex_config(env: &Env, config: &DexConfig) {
    env.storage().instance().set(&FeatureKey::DexConfig, config);
}

pub fn get_dex_config(env: &Env) -> Option<DexConfig> {
    env.storage().instance().get(&FeatureKey::DexConfig)
}

// ============================================================================
// Oracle Config
// ============================================================================

pub fn set_oracle_config(env: &Env, config: &crate::OptionalVaultOracleConfig) {
    env.storage()
        .instance()
        .set(&DataKey::VaultOracleConfig, config);
}

pub fn set_swap_proposal(env: &Env, proposal_id: u64, swap: &SwapProposal) {
    let key = FeatureKey::SwapProposal(proposal_id);
    env.storage().persistent().set(&key, swap);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PROPOSAL_TTL);
}

pub fn get_swap_proposal(env: &Env, proposal_id: u64) -> Option<SwapProposal> {
    env.storage()
        .persistent()
        .get(&FeatureKey::SwapProposal(proposal_id))
}

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

/// Increment proposal counter in metrics
pub fn metrics_on_proposal(env: &Env) {
    let mut m = get_metrics(env);
    m.total_proposals += 1;
    m.last_updated_ledger = env.ledger().sequence() as u64;
    set_metrics(env, &m);
}

/// Record a successful execution in metrics
pub fn metrics_on_execution(env: &Env, gas_used: u64, execution_time_ledgers: u64) {
    let mut m = get_metrics(env);
    m.executed_count += 1;
    m.total_gas_used += gas_used;
    m.total_execution_time_ledgers += execution_time_ledgers;
    m.last_updated_ledger = env.ledger().sequence() as u64;
    set_metrics(env, &m);
}

/// Record a rejection in metrics
pub fn metrics_on_rejection(env: &Env) {
    let mut m = get_metrics(env);
    m.rejected_count += 1;
    m.last_updated_ledger = env.ledger().sequence() as u64;
    set_metrics(env, &m);
}

/// Record an expiry in metrics
pub fn metrics_on_expiry(env: &Env) {
    let mut m = get_metrics(env);
    m.expired_count += 1;
    m.last_updated_ledger = env.ledger().sequence() as u64;
    set_metrics(env, &m);
}

// ============================================================================
// Proposal Templates (Issue: feature/contract-templates)
// ============================================================================

/// Get the next template ID counter
pub fn get_next_template_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&FeatureKey::NextTemplateId)
        .unwrap_or(1)
}

/// Increment and return the next template ID
pub fn increment_template_id(env: &Env) -> u64 {
    let id = get_next_template_id(env);
    env.storage()
        .instance()
        .set(&FeatureKey::NextTemplateId, &(id + 1));
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

/// Set template name to ID mapping
pub fn set_template_name_mapping(env: &Env, name: &soroban_sdk::Symbol, id: u64) {
    env.storage()
        .instance()
        .set(&FeatureKey::TemplateName(name.clone()), &id);
}

/// Remove template name mapping
#[allow(dead_code)]
pub fn remove_template_name_mapping(env: &Env, name: &soroban_sdk::Symbol) {
    env.storage()
        .instance()
        .remove(&FeatureKey::TemplateName(name.clone()));
}

/// Check if a template name already exists
pub fn template_name_exists(env: &Env, name: &soroban_sdk::Symbol) -> bool {
    env.storage()
        .instance()
        .has(&FeatureKey::TemplateName(name.clone()))
}

// ============================================================================
// Execution Retry (Issue: feature/execution-retry)
// ============================================================================

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

/*
// ============================================================================
// Subscription System (Issue: feature/subscription-system)
// ============================================================================

pub fn get_next_subscription_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&FeatureKey::NextSubscriptionId)
        .unwrap_or(1)
}

pub fn increment_subscription_id(env: &Env) -> u64 {
    let id = get_next_subscription_id(env);
    env.storage()
        .instance()
        .set(&FeatureKey::NextSubscriptionId, &(id + 1));
    id
}

pub fn get_subscription(env: &Env, id: u64) -> Result<Subscription, VaultError> {
    env.storage()
        .persistent()
        .get(&FeatureKey::Subscription(id))
        .ok_or(VaultError::ProposalNotFound)
}

pub fn set_subscription(env: &Env, subscription: &Subscription) {
    let key = FeatureKey::Subscription(subscription.id);
    env.storage().persistent().set(&key, subscription);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

pub fn get_subscription_payments(env: &Env, subscription_id: u64) -> Vec<SubscriptionPayment> {
    env.storage()
        .persistent()
        .get(&FeatureKey::SubscriptionPayments(subscription_id))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_subscription_payment(env: &Env, payment: &SubscriptionPayment) {
    let mut payments = get_subscription_payments(env, payment.subscription_id);
    payments.push_back(payment.clone());
    let key = FeatureKey::SubscriptionPayments(payment.subscription_id);
    env.storage().persistent().set(&key, &payments);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

pub fn get_subscriber_subscriptions(env: &Env, subscriber: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&FeatureKey::SubscriberSubscriptions(subscriber.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_subscriber_subscription(env: &Env, subscriber: &Address, subscription_id: u64) {
    let mut subs = get_subscriber_subscriptions(env, subscriber);
    subs.push_back(subscription_id);
    let key = FeatureKey::SubscriberSubscriptions(subscriber.clone());
    env.storage().persistent().set(&key, &subs);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}
*/

// ============================================================================
// Escrow (Issue: feature/escrow-system)
// ============================================================================

pub fn get_next_escrow_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&FeatureKey::NextEscrowId)
        .unwrap_or(1)
}

pub fn increment_escrow_id(env: &Env) -> u64 {
    let id = get_next_escrow_id(env);
    env.storage()
        .instance()
        .set(&FeatureKey::NextEscrowId, &(id + 1));
    id
}

pub fn get_escrow(env: &Env, id: u64) -> Result<Escrow, VaultError> {
    env.storage()
        .persistent()
        .get(&FeatureKey::Escrow(id))
        .ok_or(VaultError::ProposalNotFound)
}

pub fn set_escrow(env: &Env, escrow: &Escrow) {
    let key = FeatureKey::Escrow(escrow.id);
    env.storage().persistent().set(&key, escrow);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
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
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
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
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

// ============================================================================
// Time-Weighted Voting (Issue: feature/time-weighted-voting)
// ============================================================================

use crate::types::{TimeWeightedConfig, TokenLock};

/// Get time-weighted voting configuration
pub fn get_time_weighted_config(env: &Env) -> TimeWeightedConfig {
    env.storage()
        .instance()
        .get(&DataKey::TimeWeightedConfig)
        .unwrap_or_else(TimeWeightedConfig::default)
}

/// Set time-weighted voting configuration
pub fn set_time_weighted_config(env: &Env, config: &TimeWeightedConfig) {
    env.storage()
        .instance()
        .set(&DataKey::TimeWeightedConfig, config);
}

/// Get token lock for an address
pub fn get_token_lock(env: &Env, owner: &Address) -> Option<TokenLock> {
    env.storage()
        .persistent()
        .get(&DataKey::TokenLock(owner.clone()))
}

/// Set token lock for an address
pub fn set_token_lock(env: &Env, lock: &TokenLock) {
    let key = DataKey::TokenLock(lock.owner.clone());
    env.storage().persistent().set(&key, lock);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

/// Remove token lock for an address
#[allow(dead_code)]
pub fn remove_token_lock(env: &Env, owner: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::TokenLock(owner.clone()));
}

/// Get total locked tokens for an address
#[allow(dead_code)]
pub fn get_total_locked(env: &Env, owner: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::TotalLocked(owner.clone()))
        .unwrap_or(0)
}

/// Set total locked tokens for an address
pub fn set_total_locked(env: &Env, owner: &Address, amount: i128) {
    let key = DataKey::TotalLocked(owner.clone());
    env.storage().persistent().set(&key, &amount);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

/// Calculate voting power for an address including time-weighted locks
pub fn calculate_voting_power(env: &Env, addr: &Address) -> i128 {
    let config = get_time_weighted_config(env);

    if !config.enabled {
        // If time-weighted voting is disabled, return 1 (equal voting power)
        return 1;
    }

    if let Some(lock) = get_token_lock(env, addr) {
        let current_ledger = env.ledger().sequence() as u64;

        if config.apply_decay {
            let power = lock.calculate_decayed_power(current_ledger);
            if power > 0 {
                power
            } else {
                1 // Base voting power when lock expired or inactive
            }
        } else {
            let power = lock.calculate_voting_power();
            if power > 0 {
                power
            } else {
                1 // Base voting power when lock inactive
            }
        }
    } else {
        // No lock = base voting power of 1
        1
    }
}

// ============================================================================
// Batch Transactions
// ============================================================================

pub fn get_next_batch_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::BatchIdCounter)
        .get::<FeatureKey, u64>(&FeatureKey::BatchIdCounter)
        .unwrap_or(0)
}

pub fn increment_batch_id(env: &Env) -> u64 {
    let current = get_next_batch_id(env);
    let next = current + 1;
    env.storage()
        .instance()
        .set(&FeatureKey::BatchIdCounter, &next);
    extend_instance_ttl(env);
    next
}

pub fn set_batch(env: &Env, batch: &BatchTransaction) {
    let key = DataKey::Batch(batch.id);
    env.storage().persistent().set(&key, batch);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_batch(env: &Env, batch_id: u64) -> Result<BatchTransaction, VaultError> {
    let key = DataKey::Batch(batch_id);
    env.storage()
        .persistent()
        .get(&key)
        .ok_or(VaultError::ProposalNotFound)
}

pub fn set_batch_result(env: &Env, result: &BatchExecutionResult) {
    let key = DataKey::BatchResult(result.batch_id);
    env.storage().persistent().set(&key, result);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_batch_result(env: &Env, batch_id: u64) -> Option<BatchExecutionResult> {
    let key = DataKey::BatchResult(batch_id);
    env.storage().persistent().get(&key)
pub fn get_batch_result(env: &Env, batch_id: u64) -> Option<crate::types::BatchExecutionResult> {
    let key = FeatureKey::BatchResult(batch_id);
    env.storage().persistent().get(&key).flatten()
}

#[allow(dead_code)]
pub fn get_rollback_state(env: &Env, batch_id: u64) -> Vec<(Address, i128)> {
    let key = FeatureKey::BatchRollback(batch_id);
    env.storage()
        .persistent()
        .get(&key)
        .flatten()
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_rollback_state(env: &Env, batch_id: u64, state: &Vec<(Address, i128)>) {
    let key = FeatureKey::BatchRollback(batch_id);
    env.storage().persistent().set(&key, state);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

// ============================================================================
// Wallet Recovery
// ============================================================================

pub fn get_recovery_proposal(env: &Env, id: u64) -> Result<RecoveryProposal, VaultError> {
    env.storage()
        .persistent()
        .get(&FeatureKey::RecoveryProposal(id))
        .ok_or(VaultError::ProposalNotFound)
}

pub fn set_recovery_proposal(env: &Env, proposal: &RecoveryProposal) {
    let key = FeatureKey::RecoveryProposal(proposal.id);
    env.storage().persistent().set(&key, proposal);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_next_recovery_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&FeatureKey::NextRecoveryId)
        .unwrap_or(1)
}

pub fn increment_recovery_id(env: &Env) -> u64 {
    let id = get_next_recovery_id(env);
    env.storage()
        .instance()
        .set(&FeatureKey::NextRecoveryId, &(id + 1));
    id
}

// ============================================================================
// Dynamic Fee Structure (Issue: feature/dynamic-fees)
// ============================================================================

/// Get the fee structure configuration
pub fn get_fee_structure(env: &Env) -> FeeStructure {
    env.storage()
        .instance()
        .get(&DataKey::FeeStructure)
        .unwrap_or_else(|| FeeStructure::default(env))
}

/// Set the fee structure configuration
pub fn set_fee_structure(env: &Env, fee_structure: &FeeStructure) {
    env.storage()
        .instance()
        .set(&DataKey::FeeStructure, fee_structure);
}

/// Get total fees collected for a specific token
pub fn get_fees_collected(env: &Env, token: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::FeesCollected(token.clone()))
        .unwrap_or(0)
}

/// Add to fees collected for a specific token
pub fn add_fees_collected(env: &Env, token: &Address, amount: i128) {
    let current = get_fees_collected(env, token);
    let key = DataKey::FeesCollected(token.clone());
    env.storage().persistent().set(&key, &(current + amount));
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PERSISTENT_TTL);
}

/// Get user's total transaction volume for a specific token
pub fn get_user_volume(env: &Env, user: &Address, token: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::UserVolume(user.clone(), token.clone()))
        .unwrap_or(0)
}

/// Update user's transaction volume for a specific token
pub fn add_user_volume(env: &Env, user: &Address, token: &Address, amount: i128) {
    let current = get_user_volume(env, user, token);
    let key = DataKey::UserVolume(user.clone(), token.clone());
    env.storage().persistent().set(&key, &(current + amount));
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PERSISTENT_TTL);
}
