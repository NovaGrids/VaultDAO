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
    Bounty, BountyClaim, Comment, Config, CrossVaultConfig, CrossVaultProposal, Dispute, Escrow,
    GasConfig, InsuranceConfig, ListMode, MatchDirection, MatchingCriteria,
    NotificationPreferences, Proposal, ProposalAmendment, ProposalMatch, ProposalTemplate,
    RecoveryProposal, Reputation, RetryState, Role, VaultMetrics, VelocityConfig,
};

/// Storage key definitions
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
    /// Insurance configuration -> InsuranceConfig
    InsuranceConfig,
    /// Per-user notification preferences -> NotificationPreferences
    NotificationPrefs(Address),
    /// Gas execution limit configuration -> GasConfig
    GasConfig,
    /// Vault-wide performance metrics -> VaultMetrics
    Metrics,
    /// Retry state for a proposal -> RetryState
    RetryState(u64),
    /// Cross-vault proposal by ID -> CrossVaultProposal
    CrossVaultProposal(u64),
    /// Cross-vault configuration -> CrossVaultConfig
    CrossVaultConfig,
    /// Arbitrator addresses -> Vec<Address>
    Arbitrators,
    /// Insurance pool accumulated slashed funds (Token Address) -> i128
    InsurancePool(Address),
    /// Child proposal IDs for a parent proposal -> Vec<u64>
    ProposalChildren(u64),
    /// Inheritance chain for a proposal (list of ancestor IDs) -> Vec<u64>
    InheritanceChain(u64),
    /// Matching-related data (sub-key, id) -> various types
    Matching(MatchingDataKey, u64),
    /// Bounty-related data (sub-key, id) -> various types
    Bounty(BountyDataKey, u64),
    /// Batch transaction data (sub-key, id) -> various types
    Batch(BatchDataKey, u64),
    /// DEX and swap-related data (sub-key, id) -> various types
    Dex(DexDataKey, u64),
    /// Template-related data (sub-key, id) -> various types
    Template(TemplateDataKey, u64),
    /// Template name to ID mapping (name) -> u64
    TemplateByName(soroban_sdk::Symbol),
    /// Escrow-related data (sub-key, id) -> various types
    Escrow(EscrowDataKey, u64),
    /// Escrow lists by address (sub-key, address) -> Vec<u64>
    EscrowByAddress(EscrowDataKey, Address),
    /// Dispute-related data (sub-key, id) -> various types
    Dispute(DisputeDataKey, u64),
    /// Recovery-related data (sub-key, id) -> various types
    Recovery(RecoveryDataKey, u64),
}

/// Sub-keys for matching-related data
#[contracttype]
#[derive(Clone)]
pub enum MatchingDataKey {
    /// Proposal match by ID -> ProposalMatch
    Match,
    /// Next match ID counter -> u64
    NextMatchId,
    /// Matching queue by direction -> Vec<u64>
    Queue,
    /// Matches for a proposal -> Vec<u64>
    ProposalMatches,
    /// Matching criteria for a proposal -> MatchingCriteria
    Criteria,
}

/// Sub-keys for bounty-related data
#[contracttype]
#[derive(Clone)]
pub enum BountyDataKey {
    /// Bounty by ID -> Bounty
    Bounty,
    /// Next bounty ID counter -> u64
    NextBountyId,
    /// Claim by ID -> BountyClaim
    Claim,
    /// Next claim ID counter -> u64
    NextClaimId,
    /// Claims for a bounty -> Vec<u64>
    BountyClaims,
    /// Active bounties list -> Vec<u64>
    ActiveBounties,
    /// Bounties by creator -> Vec<u64>
    CreatorBounties,
}

/// Sub-keys for batch transaction data
#[contracttype]
#[derive(Clone)]
pub enum BatchDataKey {
    /// Batch transaction by ID
    Batch,
    /// Next batch ID counter
    NextBatchId,
    /// Batch result
    Result,
    /// Batch rollback state
    Rollback,
}

/// Sub-keys for DEX and swap-related data
#[contracttype]
#[derive(Clone)]
pub enum DexDataKey {
    /// DEX configuration
    Config,
    /// Swap proposal by ID
    SwapProposal,
    /// Swap result by proposal ID
    SwapResult,
}

/// Sub-keys for template-related data
#[contracttype]
#[derive(Clone)]
pub enum TemplateDataKey {
    /// Proposal template by ID
    Template,
    /// Next template ID counter
    NextTemplateId,
}

/// Sub-keys for escrow-related data
#[contracttype]
#[derive(Clone)]
pub enum EscrowDataKey {
    /// Escrow agreement by ID
    Escrow,
    /// Next escrow ID counter
    NextEscrowId,
    /// Escrow IDs by funder address
    FunderEscrows,
    /// Escrow IDs by recipient address
    RecipientEscrows,
}

/// Sub-keys for dispute-related data
#[contracttype]
#[derive(Clone)]
pub enum DisputeDataKey {
    /// Dispute by ID
    Dispute,
    /// Dispute ID for a proposal
    ProposalDispute,
    /// Next dispute ID counter
    NextDisputeId,
}

/// Sub-keys for recovery-related data
#[contracttype]
#[derive(Clone)]
pub enum RecoveryDataKey {
    /// Recovery proposal by ID
    RecoveryProposal,
    /// Next recovery proposal ID counter
    NextRecoveryId,
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
        .unwrap_or_else(Reputation::default)
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
        .get(&DataKey::InsuranceConfig)
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
        .set(&DataKey::InsuranceConfig, config);
}

pub fn get_insurance_pool(env: &Env, token_addr: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::InsurancePool(token_addr.clone()))
        .unwrap_or(0)
}

pub fn add_to_insurance_pool(env: &Env, token_addr: &Address, amount: i128) {
    let current = get_insurance_pool(env, token_addr);
    let key = DataKey::InsurancePool(token_addr.clone());
    env.storage().persistent().set(&key, &(current + amount));
    // extend TTL
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PERSISTENT_TTL); // Keeps pool persistent
}

#[allow(dead_code)]
pub fn subtract_from_insurance_pool(env: &Env, token_addr: &Address, amount: i128) {
    let current = get_insurance_pool(env, token_addr);
    let key = DataKey::InsurancePool(token_addr.clone());
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
        .get(&DataKey::NotificationPrefs(addr.clone()))
        .unwrap_or_else(NotificationPreferences::default)
}

pub fn set_notification_prefs(env: &Env, addr: &Address, prefs: &NotificationPreferences) {
    let key = DataKey::NotificationPrefs(addr.clone());
    env.storage().persistent().set(&key, prefs);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

// ============================================================================
// DEX/AMM Integration (Issue: feature/amm-integration)
// ============================================================================

use crate::types::{DexConfig, SwapProposal, SwapResult};

pub fn set_dex_config(env: &Env, config: &DexConfig) {
    env.storage()
        .instance()
        .set(&DataKey::Dex(DexDataKey::Config, 0), config);
}

pub fn get_dex_config(env: &Env) -> Option<DexConfig> {
    env.storage()
        .instance()
        .get(&DataKey::Dex(DexDataKey::Config, 0))
}

pub fn set_swap_proposal(env: &Env, proposal_id: u64, swap: &SwapProposal) {
    let key = DataKey::Dex(DexDataKey::SwapProposal, proposal_id);
    env.storage().persistent().set(&key, swap);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PROPOSAL_TTL);
}

pub fn get_swap_proposal(env: &Env, proposal_id: u64) -> Option<SwapProposal> {
    env.storage()
        .persistent()
        .get(&DataKey::Dex(DexDataKey::SwapProposal, proposal_id))
}

pub fn set_swap_result(env: &Env, proposal_id: u64, result: &SwapResult) {
    let key = DataKey::Dex(DexDataKey::SwapResult, proposal_id);
    env.storage().persistent().set(&key, result);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PROPOSAL_TTL);
}

pub fn get_swap_result(env: &Env, proposal_id: u64) -> Option<SwapResult> {
    env.storage()
        .persistent()
        .get(&DataKey::Dex(DexDataKey::SwapResult, proposal_id))
}

// ============================================================================
// Gas Config (Issue: feature/gas-limits)
// ============================================================================

pub fn get_gas_config(env: &Env) -> GasConfig {
    env.storage()
        .instance()
        .get(&DataKey::GasConfig)
        .unwrap_or_else(GasConfig::default)
}

pub fn set_gas_config(env: &Env, config: &GasConfig) {
    env.storage().instance().set(&DataKey::GasConfig, config);
}

// ============================================================================
// Performance Metrics (Issue: feature/performance-metrics)
// ============================================================================

pub fn get_metrics(env: &Env) -> VaultMetrics {
    env.storage()
        .instance()
        .get(&DataKey::Metrics)
        .unwrap_or_else(VaultMetrics::default)
}

pub fn set_metrics(env: &Env, metrics: &VaultMetrics) {
    env.storage().instance().set(&DataKey::Metrics, metrics);
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
        .get(&DataKey::Template(TemplateDataKey::NextTemplateId, 0))
        .unwrap_or(1)
}

/// Increment and return the next template ID
pub fn increment_template_id(env: &Env) -> u64 {
    let id = get_next_template_id(env);
    env.storage().instance().set(
        &DataKey::Template(TemplateDataKey::NextTemplateId, 0),
        &(id + 1),
    );
    id
}

/// Store a proposal template
pub fn set_template(env: &Env, template: &ProposalTemplate) {
    let key = DataKey::Template(TemplateDataKey::Template, template.id);
    env.storage().persistent().set(&key, template);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

/// Get a proposal template by ID
pub fn get_template(env: &Env, id: u64) -> Result<ProposalTemplate, VaultError> {
    env.storage()
        .persistent()
        .get(&DataKey::Template(TemplateDataKey::Template, id))
        .ok_or(VaultError::TemplateNotFound)
}

/// Check if a template exists
#[allow(dead_code)]
pub fn template_exists(env: &Env, id: u64) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Template(TemplateDataKey::Template, id))
}

/// Get template ID by name
pub fn get_template_id_by_name(env: &Env, name: &soroban_sdk::Symbol) -> Option<u64> {
    env.storage()
        .instance()
        .get(&DataKey::TemplateByName(name.clone()))
}

/// Set template name to ID mapping
pub fn set_template_name_mapping(env: &Env, name: &soroban_sdk::Symbol, id: u64) {
    env.storage()
        .instance()
        .set(&DataKey::TemplateByName(name.clone()), &id);
}

/// Remove template name mapping
#[allow(dead_code)]
pub fn remove_template_name_mapping(env: &Env, name: &soroban_sdk::Symbol) {
    env.storage()
        .instance()
        .remove(&DataKey::TemplateByName(name.clone()));
}

/// Check if a template name already exists
pub fn template_name_exists(env: &Env, name: &soroban_sdk::Symbol) -> bool {
    env.storage()
        .instance()
        .has(&DataKey::TemplateByName(name.clone()))
}

// ============================================================================
// Execution Retry (Issue: feature/execution-retry)
// ============================================================================

pub fn get_retry_state(env: &Env, proposal_id: u64) -> Option<RetryState> {
    env.storage()
        .persistent()
        .get(&DataKey::RetryState(proposal_id))
}

pub fn set_retry_state(env: &Env, proposal_id: u64, state: &RetryState) {
    let key = DataKey::RetryState(proposal_id);
    env.storage().persistent().set(&key, state);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

// ============================================================================
// Cross-Vault Coordination (Issue: feature/cross-vault-coordination)
// ============================================================================

pub fn get_cross_vault_config(env: &Env) -> Option<CrossVaultConfig> {
    env.storage().instance().get(&DataKey::CrossVaultConfig)
}

pub fn set_cross_vault_config(env: &Env, config: &CrossVaultConfig) {
    env.storage()
        .instance()
        .set(&DataKey::CrossVaultConfig, config);
}

pub fn get_cross_vault_proposal(env: &Env, proposal_id: u64) -> Option<CrossVaultProposal> {
    env.storage()
        .persistent()
        .get(&DataKey::CrossVaultProposal(proposal_id))
}

pub fn set_cross_vault_proposal(env: &Env, proposal_id: u64, proposal: &CrossVaultProposal) {
    let key = DataKey::CrossVaultProposal(proposal_id);
    env.storage().persistent().set(&key, proposal);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

// ============================================================================
// Dispute Resolution (Issue: feature/dispute-resolution)
// ============================================================================

pub fn get_arbitrators(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Arbitrators)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_arbitrators(env: &Env, arbitrators: &Vec<Address>) {
    env.storage()
        .instance()
        .set(&DataKey::Arbitrators, arbitrators);
}

pub fn get_next_dispute_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::Dispute(DisputeDataKey::NextDisputeId, 0))
        .unwrap_or(1)
}

pub fn increment_dispute_id(env: &Env) -> u64 {
    let id = get_next_dispute_id(env);
    env.storage().instance().set(
        &DataKey::Dispute(DisputeDataKey::NextDisputeId, 0),
        &(id + 1),
    );
    id
}

pub fn get_dispute(env: &Env, id: u64) -> Option<Dispute> {
    env.storage()
        .persistent()
        .get(&DataKey::Dispute(DisputeDataKey::Dispute, id))
}

pub fn set_dispute(env: &Env, dispute: &Dispute) {
    let key = DataKey::Dispute(DisputeDataKey::Dispute, dispute.id);
    env.storage().persistent().set(&key, dispute);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

pub fn get_proposal_dispute(env: &Env, proposal_id: u64) -> Option<u64> {
    env.storage().persistent().get(&DataKey::Dispute(
        DisputeDataKey::ProposalDispute,
        proposal_id,
    ))
}

pub fn set_proposal_dispute(env: &Env, proposal_id: u64, dispute_id: u64) {
    let key = DataKey::Dispute(DisputeDataKey::ProposalDispute, proposal_id);
    env.storage().persistent().set(&key, &dispute_id);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}
// ============================================================================
// Escrow (Issue: feature/escrow-system)
// ============================================================================

pub fn get_next_escrow_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::Escrow(EscrowDataKey::NextEscrowId, 0))
        .unwrap_or(1)
}

pub fn increment_escrow_id(env: &Env) -> u64 {
    let id = get_next_escrow_id(env);
    env.storage()
        .instance()
        .set(&DataKey::Escrow(EscrowDataKey::NextEscrowId, 0), &(id + 1));
    id
}

pub fn get_escrow(env: &Env, id: u64) -> Result<Escrow, VaultError> {
    env.storage()
        .persistent()
        .get(&DataKey::Escrow(EscrowDataKey::Escrow, id))
        .ok_or(VaultError::ProposalNotFound)
}

pub fn set_escrow(env: &Env, escrow: &Escrow) {
    let key = DataKey::Escrow(EscrowDataKey::Escrow, escrow.id);
    env.storage().persistent().set(&key, escrow);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

pub fn get_funder_escrows(env: &Env, funder: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::EscrowByAddress(
            EscrowDataKey::FunderEscrows,
            funder.clone(),
        ))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_funder_escrow(env: &Env, funder: &Address, escrow_id: u64) {
    let mut escrows = get_funder_escrows(env, funder);
    escrows.push_back(escrow_id);
    let key = DataKey::EscrowByAddress(EscrowDataKey::FunderEscrows, funder.clone());
    env.storage().persistent().set(&key, &escrows);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

pub fn get_recipient_escrows(env: &Env, recipient: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::EscrowByAddress(
            EscrowDataKey::RecipientEscrows,
            recipient.clone(),
        ))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_recipient_escrow(env: &Env, recipient: &Address, escrow_id: u64) {
    let mut escrows = get_recipient_escrows(env, recipient);
    escrows.push_back(escrow_id);
    let key = DataKey::EscrowByAddress(EscrowDataKey::RecipientEscrows, recipient.clone());
    env.storage().persistent().set(&key, &escrows);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}

// ============================================================================
// Batch Transactions
// ============================================================================

pub fn get_next_batch_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get::<DataKey, u64>(&DataKey::Batch(BatchDataKey::NextBatchId, 0))
        .unwrap_or(0)
}

pub fn increment_batch_id(env: &Env) -> u64 {
    let current = get_next_batch_id(env);
    let next = current + 1;
    env.storage()
        .instance()
        .set(&DataKey::Batch(BatchDataKey::NextBatchId, 0), &next);
    extend_instance_ttl(env);
    next
}

pub fn set_batch(env: &Env, batch: &crate::types::BatchTransaction) {
    let key = DataKey::Batch(BatchDataKey::Batch, batch.id);
    env.storage().persistent().set(&key, batch);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_batch(env: &Env, batch_id: u64) -> Result<crate::types::BatchTransaction, VaultError> {
    let key = DataKey::Batch(BatchDataKey::Batch, batch_id);
    env.storage()
        .persistent()
        .get(&key)
        .flatten()
        .ok_or(VaultError::BatchNotFound)
}

pub fn set_batch_result(env: &Env, result: &crate::types::BatchExecutionResult) {
    let key = DataKey::Batch(BatchDataKey::Result, result.batch_id);
    env.storage().persistent().set(&key, result);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_batch_result(env: &Env, batch_id: u64) -> Option<crate::types::BatchExecutionResult> {
    let key = DataKey::Batch(BatchDataKey::Result, batch_id);
    env.storage().persistent().get(&key).flatten()
}

#[allow(dead_code)]
pub fn get_rollback_state(env: &Env, batch_id: u64) -> Vec<(Address, i128)> {
    let key = DataKey::Batch(BatchDataKey::Rollback, batch_id);
    env.storage()
        .persistent()
        .get(&key)
        .flatten()
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_rollback_state(env: &Env, batch_id: u64, state: &Vec<(Address, i128)>) {
    let key = DataKey::Batch(BatchDataKey::Rollback, batch_id);
    env.storage().persistent().set(&key, state);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

// ============================================================================
// Wallet Recovery (Issue: feature/wallet-recovery)
// ============================================================================

pub fn get_recovery_proposal(env: &Env, id: u64) -> Result<RecoveryProposal, VaultError> {
    env.storage()
        .persistent()
        .get(&DataKey::Recovery(RecoveryDataKey::RecoveryProposal, id))
        .ok_or(VaultError::ProposalNotFound)
}

pub fn set_recovery_proposal(env: &Env, proposal: &RecoveryProposal) {
    let key = DataKey::Recovery(RecoveryDataKey::RecoveryProposal, proposal.id);
    env.storage().persistent().set(&key, proposal);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn get_next_recovery_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::Recovery(RecoveryDataKey::NextRecoveryId, 0))
        .unwrap_or(1)
}

pub fn increment_recovery_id(env: &Env) -> u64 {
    let id = get_next_recovery_id(env);
    env.storage().instance().set(
        &DataKey::Recovery(RecoveryDataKey::NextRecoveryId, 0),
        &(id + 1),
    );
    id
}
// ============================================================================
// Proposal Inheritance and Forking (Issue: feature/proposal-inheritance)
// ============================================================================

/// Get child proposal IDs for a parent proposal
pub fn get_proposal_children(env: &Env, parent_id: u64) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::ProposalChildren(parent_id))
        .unwrap_or_else(|| Vec::new(env))
}

/// Add a child proposal to a parent's children list
pub fn add_proposal_child(env: &Env, parent_id: u64, child_id: u64) {
    let mut children = get_proposal_children(env, parent_id);
    children.push_back(child_id);
    let key = DataKey::ProposalChildren(parent_id);
    env.storage().persistent().set(&key, &children);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

/// Get the full inheritance chain for a proposal (list of ancestor IDs from oldest to newest)
pub fn get_inheritance_chain(env: &Env, proposal_id: u64) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::InheritanceChain(proposal_id))
        .unwrap_or_else(|| Vec::new(env))
}

/// Set the inheritance chain for a proposal
pub fn set_inheritance_chain(env: &Env, proposal_id: u64, chain: &Vec<u64>) {
    let key = DataKey::InheritanceChain(proposal_id);
    env.storage().persistent().set(&key, chain);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

// ============================================================================
// Proposal Matching and Pairing (Issue: feature/proposal-matching)
// ============================================================================

/// Get matching criteria for a proposal
pub fn get_matching_criteria(env: &Env, proposal_id: u64) -> Option<MatchingCriteria> {
    env.storage()
        .persistent()
        .get(&DataKey::Matching(MatchingDataKey::Criteria, proposal_id))
}

/// Set matching criteria for a proposal
pub fn set_matching_criteria(env: &Env, proposal_id: u64, criteria: &MatchingCriteria) {
    let key = DataKey::Matching(MatchingDataKey::Criteria, proposal_id);
    env.storage().persistent().set(&key, criteria);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

/// Get the next match ID counter
pub fn get_next_match_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::Matching(MatchingDataKey::NextMatchId, 0))
        .unwrap_or(1)
}

/// Increment and return the next match ID
pub fn increment_match_id(env: &Env) -> u64 {
    let id = get_next_match_id(env);
    env.storage().instance().set(
        &DataKey::Matching(MatchingDataKey::NextMatchId, 0),
        &(id + 1),
    );
    id
}

/// Get a proposal match by ID
pub fn get_proposal_match(env: &Env, match_id: u64) -> Option<ProposalMatch> {
    env.storage()
        .persistent()
        .get(&DataKey::Matching(MatchingDataKey::Match, match_id))
}

/// Store a proposal match
pub fn set_proposal_match(env: &Env, proposal_match: &ProposalMatch) {
    let key = DataKey::Matching(MatchingDataKey::Match, proposal_match.id);
    env.storage().persistent().set(&key, proposal_match);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

/// Get the matching queue for a specific direction
pub fn get_matching_queue(env: &Env, direction: MatchDirection) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::Matching(MatchingDataKey::Queue, direction as u64))
        .unwrap_or_else(|| Vec::new(env))
}

/// Add a proposal to the matching queue
pub fn add_to_matching_queue(env: &Env, direction: MatchDirection, proposal_id: u64) {
    let mut queue = get_matching_queue(env, direction.clone());
    queue.push_back(proposal_id);
    let key = DataKey::Matching(MatchingDataKey::Queue, direction as u64);
    env.storage().persistent().set(&key, &queue);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

/// Remove a proposal from the matching queue
pub fn remove_from_matching_queue(env: &Env, direction: MatchDirection, proposal_id: u64) {
    let queue = get_matching_queue(env, direction.clone());
    let mut new_queue: Vec<u64> = Vec::new(env);
    for i in 0..queue.len() {
        let id = queue.get(i).unwrap();
        if id != proposal_id {
            new_queue.push_back(id);
        }
    }
    let key = DataKey::Matching(MatchingDataKey::Queue, direction as u64);
    env.storage().persistent().set(&key, &new_queue);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

/// Get all matches for a specific proposal
pub fn get_proposal_matches(env: &Env, proposal_id: u64) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::Matching(
            MatchingDataKey::ProposalMatches,
            proposal_id,
        ))
        .unwrap_or_else(|| Vec::new(env))
}

/// Add a match to a proposal's match list
pub fn add_proposal_match(env: &Env, proposal_id: u64, match_id: u64) {
    let mut matches = get_proposal_matches(env, proposal_id);
    matches.push_back(match_id);
    let key = DataKey::Matching(MatchingDataKey::ProposalMatches, proposal_id);
    env.storage().persistent().set(&key, &matches);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

// ============================================================================
// Bounty System (Issue: feature/bounty-system)
// ============================================================================

/// Get the next bounty ID counter
pub fn get_next_bounty_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::Bounty(BountyDataKey::NextBountyId, 0))
        .unwrap_or(1)
}

/// Increment and return the next bounty ID
pub fn increment_bounty_id(env: &Env) -> u64 {
    let id = get_next_bounty_id(env);
    env.storage()
        .instance()
        .set(&DataKey::Bounty(BountyDataKey::NextBountyId, 0), &(id + 1));
    id
}

/// Get a bounty by ID
pub fn get_bounty(env: &Env, bounty_id: u64) -> Option<Bounty> {
    env.storage()
        .persistent()
        .get(&DataKey::Bounty(BountyDataKey::Bounty, bounty_id))
}

/// Store a bounty
pub fn set_bounty(env: &Env, bounty: &Bounty) {
    let key = DataKey::Bounty(BountyDataKey::Bounty, bounty.id);
    env.storage().persistent().set(&key, bounty);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

/// Get the next claim ID counter
pub fn get_next_claim_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::Bounty(BountyDataKey::NextClaimId, 0))
        .unwrap_or(1)
}

/// Increment and return the next claim ID
pub fn increment_claim_id(env: &Env) -> u64 {
    let id = get_next_claim_id(env);
    env.storage()
        .instance()
        .set(&DataKey::Bounty(BountyDataKey::NextClaimId, 0), &(id + 1));
    id
}

/// Get a claim by ID
pub fn get_claim(env: &Env, claim_id: u64) -> Option<BountyClaim> {
    env.storage()
        .persistent()
        .get(&DataKey::Bounty(BountyDataKey::Claim, claim_id))
}

/// Store a claim
pub fn set_claim(env: &Env, claim: &BountyClaim) {
    let key = DataKey::Bounty(BountyDataKey::Claim, claim.id);
    env.storage().persistent().set(&key, claim);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

/// Get all claims for a bounty
pub fn get_bounty_claims(env: &Env, bounty_id: u64) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::Bounty(BountyDataKey::BountyClaims, bounty_id))
        .unwrap_or_else(|| Vec::new(env))
}

/// Add a claim to a bounty's claim list
pub fn add_bounty_claim(env: &Env, bounty_id: u64, claim_id: u64) {
    let mut claims = get_bounty_claims(env, bounty_id);
    claims.push_back(claim_id);
    let key = DataKey::Bounty(BountyDataKey::BountyClaims, bounty_id);
    env.storage().persistent().set(&key, &claims);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

/// Get list of active bounties
pub fn get_active_bounties(env: &Env) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::Bounty(BountyDataKey::ActiveBounties, 0))
        .unwrap_or_else(|| Vec::new(env))
}

/// Add a bounty to active list
pub fn add_active_bounty(env: &Env, bounty_id: u64) {
    let mut bounties = get_active_bounties(env);
    bounties.push_back(bounty_id);
    let key = DataKey::Bounty(BountyDataKey::ActiveBounties, 0);
    env.storage().persistent().set(&key, &bounties);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

/// Remove a bounty from active list
pub fn remove_active_bounty(env: &Env, bounty_id: u64) {
    let bounties = get_active_bounties(env);
    let mut new_bounties: Vec<u64> = Vec::new(env);
    for i in 0..bounties.len() {
        let id = bounties.get(i).unwrap();
        if id != bounty_id {
            new_bounties.push_back(id);
        }
    }
    let key = DataKey::Bounty(BountyDataKey::ActiveBounties, 0);
    env.storage().persistent().set(&key, &new_bounties);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

/// Get bounties created by an address
pub fn get_creator_bounties(env: &Env, creator: &Address) -> Vec<u64> {
    // For now, scan all bounties - can be optimized later
    // This is a simple implementation that works
    let mut result = Vec::new(env);
    let next_id = get_next_bounty_id(env);

    for i in 1..next_id {
        if let Some(bounty) = get_bounty(env, i) {
            if bounty.creator == *creator {
                result.push_back(i);
            }
        }
    }

    result
}

/// Add a bounty to creator's list
pub fn add_creator_bounty(env: &Env, _creator: &Address, _bounty_id: u64) {
    // No-op for now since we scan in get_creator_bounties
    // This keeps the API consistent
    extend_instance_ttl(env);
}
