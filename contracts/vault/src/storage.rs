//! VaultDAO - Storage Layer
//!
//! Storage keys and helper functions for persistent state.

use soroban_sdk::{contracttype, Address, Env, String, Vec};

use crate::errors::VaultError;
use crate::types::{
    Comment, Config, InsuranceConfig, ListMode, NotificationPreferences, Proposal, Reputation,
    Role, VelocityConfig,
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
    /// DEX configuration -> DexConfig
    DexConfig,
    /// Swap proposal by ID -> SwapProposal
    SwapProposal(u64),
    /// Swap result by proposal ID -> SwapResult
    SwapResult(u64),
}

/// TTL constants (in ledgers, ~5 seconds each)
pub const DAY_IN_LEDGERS: u32 = 17_280; // ~24 hours
pub const PROPOSAL_TTL: u32 = DAY_IN_LEDGERS * 7; // 7 days
pub const INSTANCE_TTL: u32 = DAY_IN_LEDGERS * 30; // 30 days
pub const INSTANCE_TTL_THRESHOLD: u32 = DAY_IN_LEDGERS * 7; // Extend when below 7 days

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
        if rep.score > 500 {
            let diff = rep.score - 500;
            rep.score = rep.score.saturating_sub(diff / 20 + 1);
        } else if rep.score < 500 {
            let diff = 500 - rep.score;
            rep.score = rep.score.saturating_add(diff / 20 + 1);
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
    env.storage().instance().set(&DataKey::DexConfig, config);
}

pub fn get_dex_config(env: &Env) -> Option<DexConfig> {
    env.storage().instance().get(&DataKey::DexConfig)
}

pub fn set_swap_proposal(env: &Env, proposal_id: u64, swap: &SwapProposal) {
    let key = DataKey::SwapProposal(proposal_id);
    env.storage().persistent().set(&key, swap);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PROPOSAL_TTL);
}

pub fn get_swap_proposal(env: &Env, proposal_id: u64) -> Option<SwapProposal> {
    env.storage()
        .persistent()
        .get(&DataKey::SwapProposal(proposal_id))
}

pub fn set_swap_result(env: &Env, proposal_id: u64, result: &SwapResult) {
    let key = DataKey::SwapResult(proposal_id);
    env.storage().persistent().set(&key, result);
    env.storage()
        .persistent()
        .extend_ttl(&key, INSTANCE_TTL_THRESHOLD, PROPOSAL_TTL);
}

pub fn get_swap_result(env: &Env, proposal_id: u64) -> Option<SwapResult> {
    env.storage()
        .persistent()
        .get(&DataKey::SwapResult(proposal_id))
}
