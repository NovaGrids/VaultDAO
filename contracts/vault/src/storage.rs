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
    DexConfig, Escrow, ExecutionFeeEstimate, ExecutionSnapshot, FeeStructure, FundingRound,
    FundingRoundConfig, GasConfig, InsuranceConfig, ListMode, NotificationPreferences,
    PermissionGrant, Proposal, ProposalAmendment, ProposalTemplate, RecoveryProposal, Reputation,
    RetryState, Role, RoleAssignment, StakeRecord, StakingConfig, SwapProposal, SwapResult,
    TimeWeightedConfig, TokenLock, VaultMetrics, VelocityConfig, VotingStrategy,
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
    /// Recovery proposal by ID -> RecoveryProposal
    RecoveryProposal(u64),
    /// Next recovery ID counter -> u64
    NextRecoveryId,
    /// Insurance pool accumulated slashed funds (Token Address) -> i128
    /// Funding round by ID -> FundingRound
    FundingRound(u64),
    /// Next funding round ID counter -> u64
    NextFundingRoundId,
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
    // Stream payment storage (nested with StreamKey)
    // Stream(StreamKey), // Feature incomplete
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

// pub fn get_next_stream_id(env: &Env) -> u64 {
//     env.storage()
//         .instance()
//         .get::<DataKey, u64>(&DataKey::Stream(StreamKey::Counter))
//         .unwrap_or(1)
// }

// pub fn increment_stream_id(env: &Env) -> u64 {
//     let id = get_next_stream_id(env);
//     env.storage()
//         .instance()
//         .set(&DataKey::Stream(StreamKey::Counter), &(id + 1));
//     extend_instance_ttl(env);
//     id
// }

// pub fn set_streaming_payment(env: &Env, stream: &crate::types::StreamingPayment) {
//     let key = DataKey::Stream(StreamKey::Payment(stream.id));
//     env.storage().persistent().set(&key, stream);
//     env.storage()
//         .persistent()
//         .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
// }

// #[allow(dead_code)]
// pub fn get_streaming_payment(
//     env: &Env,
//     id: u64,
// ) -> Result<crate::types::StreamingPayment, VaultError> {
//     let key = DataKey::Stream(StreamKey::Payment(id));
//     env.storage()
//         .persistent()
//         .get(&key)
//         .flatten()
//         .ok_or(VaultError::ProposalNotFound)
// }

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

#[allow(dead_code)]
pub fn validate_recipient_list(env: &Env, recipient: &Address) -> Result<(), VaultError> {
    let mode = get_list_mode(env);
    match mode {
        ListMode::Disabled => Ok(()),
        ListMode::Whitelist => {
            if !is_whitelisted(env, recipient) {
                return Err(VaultError::RecipientNotWhitelisted);
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

#[allow(dead_code)]
pub fn get_execution_snapshot(env: &Env, proposal_id: u64) -> Option<ExecutionSnapshot> {
    env.storage()
        .temporary()
        .get(&DataKey::ExecutionSnapshot(proposal_id))
}

#[allow(dead_code)]
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
}

pub fn metrics_on_rejection(env: &Env) {
    let mut metrics = get_metrics(env);
    metrics.rejected_count = metrics.rejected_count.saturating_add(1);
    metrics.last_updated_ledger = env.ledger().sequence() as u64;
    set_metrics(env, &metrics);
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

pub fn compute_audit_hash(
    _env: &Env,
    action: &crate::types::AuditAction,
    actor: &Address,
    target: u64,
    timestamp: u64,
    prev_hash: u64,
) -> u64 {
    let mut hash = prev_hash;
    hash = hash.wrapping_mul(31).wrapping_add(action.clone() as u64);
    hash = hash
        .wrapping_mul(31)
        .wrapping_add(actor.to_string().len() as u64);
    hash = hash.wrapping_mul(31).wrapping_add(target);
    hash = hash.wrapping_mul(31).wrapping_add(timestamp);
    hash
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
    let hash = compute_audit_hash(env, &action, actor, target, timestamp, prev_hash);

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
// Streaming Payments
// ============================================================================

pub fn get_next_stream_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextStreamId)
        .unwrap_or(1)
}

pub fn increment_stream_id(env: &Env) -> u64 {
    let id = get_next_stream_id(env);
    env.storage()
        .instance()
        .set(&DataKey::NextStreamId, &(id + 1));
    id
}

pub fn set_streaming_payment(env: &Env, stream: &crate::types::StreamingPayment) {
    let key = DataKey::Stream(stream.id);
    env.storage().persistent().set(&key, stream);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL);
}

#[allow(dead_code)]
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
// Escrow
// ============================================================================

fn get_next_escrow_id(env: &Env) -> u64 {
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
// Batch Transactions
// ============================================================================

fn get_next_batch_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&FeatureKey::BatchIdCounter)
        .unwrap_or(0)
}

pub fn increment_batch_id(env: &Env) -> u64 {
    let next = get_next_batch_id(env) + 1;
    env.storage()
        .instance()
        .set(&FeatureKey::BatchIdCounter, &next);
    next
}

pub fn set_batch(env: &Env, batch: &BatchTransaction) {
    let key = FeatureKey::Batch(batch.id);
    env.storage().persistent().set(&key, batch);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

pub fn get_batch(env: &Env, batch_id: u64) -> Result<BatchTransaction, VaultError> {
    env.storage()
        .persistent()
        .get(&FeatureKey::Batch(batch_id))
        .ok_or(VaultError::ProposalNotFound)
}

pub fn set_batch_result(env: &Env, result: &BatchExecutionResult) {
    let key = FeatureKey::BatchResult(result.batch_id);
    env.storage().persistent().set(&key, result);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

pub fn get_batch_result(env: &Env, batch_id: u64) -> Option<BatchExecutionResult> {
    env.storage()
        .persistent()
        .get(&FeatureKey::BatchResult(batch_id))
}

pub fn set_rollback_state(env: &Env, batch_id: u64, state: &Vec<(Address, i128)>) {
    let key = FeatureKey::BatchRollback(batch_id);
    env.storage().persistent().set(&key, state);
    env.storage()
        .persistent()
        .extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL);
}

#[allow(dead_code)]
pub fn get_rollback_state(env: &Env, batch_id: u64) -> Vec<(Address, i128)> {
    env.storage()
        .persistent()
        .get(&FeatureKey::BatchRollback(batch_id))
        .unwrap_or_else(|| Vec::new(env))
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
        .get(&FeatureKey::NextFundingRoundId)
        .unwrap_or(1)
}

pub fn bump_funding_round_id(env: &Env) -> u64 {
    let id = get_next_funding_round_id(env);
    env.storage()
        .instance()
        .set(&FeatureKey::NextFundingRoundId, &(id + 1));
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

// ============================================================================
// Delegation (compatibility helpers)
// ============================================================================

#[allow(dead_code)]
pub fn get_delegation(_env: &Env, _delegator: &Address) -> Option<crate::types::Delegation> {
    None
}

#[allow(dead_code)]
pub fn set_delegation(_env: &Env, _delegation: &crate::types::Delegation) {}
