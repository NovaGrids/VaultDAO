//! VaultDAO - Storage Layer
//!
//! Storage keys and helper functions for persistent state.

use soroban_sdk::{contracttype, Address, Env};

use crate::errors::VaultError;
use crate::types::{Config, Proposal, Role};

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
    /// Priority queue index (Priority, u64) -> Vec<u64>
    PriorityQueue(u32),
    /// Daily spending tracker (day number) -> i128
    DailySpent(u64),
    /// Weekly spending tracker (week number) -> i128
    WeeklySpent(u64),
    /// Recurring payment configuration -> RecurringPayment
    Recurring(u64),
    /// Next recurring payment ID counter -> u64
    NextRecurringId,
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
    env.storage()
        .persistent()
        .get(&DataKey::Proposal(id))
        .ok_or(VaultError::ProposalNotFound)
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
    // TTL: 2 days (to handle timezone edge cases)
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
    // TTL: 14 days
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
        .ok_or(VaultError::ProposalNotFound) // Reuse code or add new
}

// ============================================================================
// Priority Queue Management
// ============================================================================

pub fn add_to_priority_queue(env: &Env, priority: u32, proposal_id: u64) {
    let key = DataKey::PriorityQueue(priority);
    let mut queue: soroban_sdk::Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(soroban_sdk::Vec::new(env));
    queue.push_back(proposal_id);
    env.storage().persistent().set(&key, &queue);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

pub fn remove_from_priority_queue(env: &Env, priority: u32, proposal_id: u64) {
    let key = DataKey::PriorityQueue(priority);
    if let Some(mut queue) = env
        .storage()
        .persistent()
        .get::<_, soroban_sdk::Vec<u64>>(&key)
    {
        if let Some(idx) = queue.iter().position(|id| id == proposal_id) {
            queue.remove(idx as u32);
            env.storage().persistent().set(&key, &queue);
            env.storage()
                .persistent()
                .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
        }
    }
}

pub fn get_proposals_by_priority(env: &Env, priority: u32) -> soroban_sdk::Vec<u64> {
    let key = DataKey::PriorityQueue(priority);
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or(soroban_sdk::Vec::new(env))
}

// ============================================================================
// TTL Management
// ============================================================================

pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL);
}
