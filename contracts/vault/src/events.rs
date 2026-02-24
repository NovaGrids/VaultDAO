//! VaultDAO - Event Publishing
//!
//! Standardized events for proposal lifecycle and admin actions.

use crate::types::ProposalAmendment;
use soroban_sdk::{Address, Env, Symbol};

/// Emit when contract is initialized
pub fn emit_initialized(env: &Env, admin: &Address, threshold: u32) {
    env.events().publish(
        (Symbol::new(env, "initialized"),),
        (admin.clone(), threshold),
    );
}

/// Emit when a new proposal is created (enhanced: includes token and insurance)
pub fn emit_proposal_created(
    env: &Env,
    proposal_id: u64,
    proposer: &Address,
    recipient: &Address,
    token: &Address,
    amount: i128,
    insurance_amount: i128,
) {
    env.events().publish(
        (Symbol::new(env, "proposal_created"), proposal_id),
        (
            proposer.clone(),
            recipient.clone(),
            token.clone(),
            amount,
            insurance_amount,
        ),
    );
}

/// Emit when a proposal is approved by a signer
pub fn emit_proposal_approved(
    env: &Env,
    proposal_id: u64,
    approver: &Address,
    approval_count: u32,
    threshold: u32,
) {
    env.events().publish(
        (Symbol::new(env, "proposal_approved"), proposal_id),
        (approver.clone(), approval_count, threshold),
    );
}

/// Emit when a signer explicitly abstains from a proposal.
///
/// # Arguments
/// * `proposal_id` - The proposal being abstained from.
/// * `abstainer` - The signer recording an abstention.
/// * `abstention_count` - Total abstentions recorded so far (after this one).
/// * `quorum_votes` - Combined approvals + abstentions after this vote (quorum progress).
pub fn emit_proposal_abstained(
    env: &Env,
    proposal_id: u64,
    abstainer: &Address,
    abstention_count: u32,
    quorum_votes: u32,
) {
    env.events().publish(
        (Symbol::new(env, "proposal_abstained"), proposal_id),
        (abstainer.clone(), abstention_count, quorum_votes),
    );
}

/// Emit when a proposal reaches threshold and is ready for execution
pub fn emit_proposal_ready(env: &Env, proposal_id: u64, unlock_ledger: u64) {
    env.events().publish(
        (Symbol::new(env, "proposal_ready"), proposal_id),
        unlock_ledger,
    );
}

/// Emit when a proposal is executed (enhanced: includes token and ledger)
pub fn emit_proposal_executed(
    env: &Env,
    proposal_id: u64,
    executor: &Address,
    recipient: &Address,
    token: &Address,
    amount: i128,
    ledger: u64,
) {
    env.events().publish(
        (Symbol::new(env, "proposal_executed"), proposal_id),
        (
            executor.clone(),
            recipient.clone(),
            token.clone(),
            amount,
            ledger,
        ),
    );
}

/// Emit when a proposal is rejected (enhanced: includes proposer)
pub fn emit_proposal_rejected(env: &Env, proposal_id: u64, rejector: &Address, proposer: &Address) {
    env.events().publish(
        (Symbol::new(env, "proposal_rejected"), proposal_id),
        (rejector.clone(), proposer.clone()),
    );
}

/// Emit when a proposal is cancelled with a refund
pub fn emit_proposal_cancelled(
    env: &Env,
    proposal_id: u64,
    cancelled_by: &Address,
    reason: &Symbol,
    refunded_amount: i128,
) {
    env.events().publish(
        (Symbol::new(env, "proposal_cancelled"), proposal_id),
        (cancelled_by.clone(), reason.clone(), refunded_amount),
    );
}

/// Emit when a proposal is amended.
pub fn emit_proposal_amended(env: &Env, amendment: &ProposalAmendment) {
    env.events().publish(
        (Symbol::new(env, "proposal_amended"), amendment.proposal_id),
        (
            amendment.amended_by.clone(),
            amendment.old_recipient.clone(),
            amendment.new_recipient.clone(),
            amendment.old_amount,
            amendment.new_amount,
            amendment.old_memo.clone(),
            amendment.new_memo.clone(),
            amendment.amended_at_ledger,
        ),
    );
}

/// Emit when a role is assigned
pub fn emit_role_assigned(env: &Env, addr: &Address, role: u32) {
    env.events()
        .publish((Symbol::new(env, "role_assigned"),), (addr.clone(), role));
}

/// Emit when config is updated
pub fn emit_config_updated(env: &Env, updater: &Address) {
    env.events()
        .publish((Symbol::new(env, "config_updated"),), updater.clone());
}

/// Emit when a signer is added
pub fn emit_signer_added(env: &Env, signer: &Address, total_signers: u32) {
    env.events().publish(
        (Symbol::new(env, "signer_added"),),
        (signer.clone(), total_signers),
    );
}

/// Emit when a signer is removed
pub fn emit_signer_removed(env: &Env, signer: &Address, total_signers: u32) {
    env.events().publish(
        (Symbol::new(env, "signer_removed"),),
        (signer.clone(), total_signers),
    );
}

// ============================================================================
// Insurance Events (feature/proposal-insurance)
// ============================================================================

/// Emit when insurance stake is locked on proposal creation
pub fn emit_insurance_locked(
    env: &Env,
    proposal_id: u64,
    proposer: &Address,
    amount: i128,
    token: &Address,
) {
    env.events().publish(
        (Symbol::new(env, "insurance_locked"), proposal_id),
        (proposer.clone(), amount, token.clone()),
    );
}

/// Emit when insurance stake is slashed on rejection
pub fn emit_insurance_slashed(
    env: &Env,
    proposal_id: u64,
    proposer: &Address,
    slashed_amount: i128,
    returned_amount: i128,
) {
    env.events().publish(
        (Symbol::new(env, "insurance_slashed"), proposal_id),
        (proposer.clone(), slashed_amount, returned_amount),
    );
}

/// Emit when insurance stake is fully returned on successful execution
pub fn emit_insurance_returned(env: &Env, proposal_id: u64, proposer: &Address, amount: i128) {
    env.events().publish(
        (Symbol::new(env, "insurance_returned"), proposal_id),
        (proposer.clone(), amount),
    );
}

// ============================================================================
// Reputation Events (feature/reputation-system)
// ============================================================================

/// Emit when a user's reputation score is updated
pub fn emit_reputation_updated(
    env: &Env,
    addr: &Address,
    old_score: u32,
    new_score: u32,
    reason: Symbol,
) {
    env.events().publish(
        (Symbol::new(env, "reputation_updated"),),
        (addr.clone(), old_score, new_score, reason),
    );
}

// ============================================================================
// Batch Execution Events (feature/batch-optimization)
// ============================================================================

/// Emit when a batch execution completes
pub fn emit_batch_executed(env: &Env, executor: &Address, executed_count: u32, failed_count: u32) {
    env.events().publish(
        (Symbol::new(env, "batch_executed"),),
        (executor.clone(), executed_count, failed_count),
    );
}

// ============================================================================
// Notification Events (feature/execution-notifications)
// ============================================================================

/// Emit when notification preferences are updated
pub fn emit_notification_prefs_updated(env: &Env, addr: &Address) {
    env.events()
        .publish((Symbol::new(env, "notif_prefs_updated"),), addr.clone());
}

/// Emit when insurance config is updated by admin
pub fn emit_insurance_config_updated(env: &Env, admin: &Address) {
    env.events()
        .publish((Symbol::new(env, "insurance_cfg_updated"),), admin.clone());
}

/// Emit when a comment is added
pub fn emit_comment_added(env: &Env, comment_id: u64, proposal_id: u64, author: &Address) {
    env.events().publish(
        (Symbol::new(env, "comment_added"), comment_id),
        (proposal_id, author.clone()),
    );
}

/// Emit when a comment is edited
pub fn emit_comment_edited(env: &Env, comment_id: u64, author: &Address) {
    env.events().publish(
        (Symbol::new(env, "comment_edited"), comment_id),
        author.clone(),
    );
}

// ============================================================================
// DEX/AMM Events (feature/amm-integration)
// ============================================================================

/// Emit when DEX configuration is updated
pub fn emit_dex_config_updated(env: &Env, admin: &Address) {
    env.events()
        .publish((Symbol::new(env, "dex_config_updated"),), admin.clone());
}

/// Emit when a swap is executed
pub fn emit_swap_executed(
    env: &Env,
    proposal_id: u64,
    dex: &Address,
    amount_in: i128,
    amount_out: i128,
) {
    env.events().publish(
        (Symbol::new(env, "swap_executed"), proposal_id),
        (dex.clone(), amount_in, amount_out),
    );
}

/// Emit when liquidity is added
pub fn emit_liquidity_added(env: &Env, proposal_id: u64, dex: &Address, lp_tokens: i128) {
    env.events().publish(
        (Symbol::new(env, "liquidity_added"), proposal_id),
        (dex.clone(), lp_tokens),
    );
}

/// Emit when liquidity is removed
pub fn emit_liquidity_removed(env: &Env, proposal_id: u64, dex: &Address, lp_tokens: i128) {
    env.events().publish(
        (Symbol::new(env, "liquidity_removed"), proposal_id),
        (dex.clone(), lp_tokens),
    );
}

/// Emit when LP tokens are staked
pub fn emit_lp_staked(env: &Env, proposal_id: u64, farm: &Address, amount: i128) {
    env.events().publish(
        (Symbol::new(env, "lp_staked"), proposal_id),
        (farm.clone(), amount),
    );
}

/// Emit when rewards are claimed
pub fn emit_rewards_claimed(env: &Env, proposal_id: u64, farm: &Address, amount: i128) {
    env.events().publish(
        (Symbol::new(env, "rewards_claimed"), proposal_id),
        (farm.clone(), amount),
    );
}

// ============================================================================
// Gas Limit Events (feature/gas-limits)
// ============================================================================

/// Emit when a proposal execution is blocked by its gas limit
pub fn emit_gas_limit_exceeded(env: &Env, proposal_id: u64, gas_used: u64, gas_limit: u64) {
    env.events().publish(
        (Symbol::new(env, "gas_limit_exceeded"), proposal_id),
        (gas_used, gas_limit),
    );
}

/// Emit when gas configuration is updated by admin
pub fn emit_gas_config_updated(env: &Env, admin: &Address) {
    env.events()
        .publish((Symbol::new(env, "gas_cfg_updated"),), admin.clone());
}

// ============================================================================
// Performance Metrics Events (feature/performance-metrics)
// ============================================================================

/// Emit when vault-wide metrics are updated
pub fn emit_metrics_updated(
    env: &Env,
    executed: u64,
    rejected: u64,
    expired: u64,
    success_rate_bps: u32,
) {
    env.events().publish(
        (Symbol::new(env, "metrics_updated"),),
        (executed, rejected, expired, success_rate_bps),
    );
}

// ============================================================================
// Voting Deadline Events
// ============================================================================

/// Emit when a proposal's voting deadline is extended
pub fn emit_voting_deadline_extended(
    env: &Env,
    proposal_id: u64,
    old_deadline: u64,
    new_deadline: u64,
    admin: &Address,
) {
    env.events().publish(
        (Symbol::new(env, "deadline_extended"), proposal_id),
        (old_deadline, new_deadline, admin.clone()),
    );
}

/// Emit when a proposal is auto-rejected due to voting deadline
pub fn emit_proposal_deadline_rejected(env: &Env, proposal_id: u64, deadline: u64) {
    env.events().publish(
        (Symbol::new(env, "deadline_rejected"), proposal_id),
        deadline,
    );
}

// ============================================================================
// Retry Events (feature/execution-retry)
// ============================================================================

/// Emit when an execution retry is scheduled after a transient failure
pub fn emit_retry_scheduled(
    env: &Env,
    proposal_id: u64,
    retry_count: u32,
    next_retry_ledger: u64,
    error_code: u32,
) {
    env.events().publish(
        (Symbol::new(env, "retry_scheduled"), proposal_id),
        (retry_count, next_retry_ledger, error_code),
    );
}

/// Emit when a retry execution attempt is made
pub fn emit_retry_attempted(env: &Env, proposal_id: u64, retry_count: u32, executor: &Address) {
    env.events().publish(
        (Symbol::new(env, "retry_attempted"), proposal_id),
        (retry_count, executor.clone()),
    );
}

/// Emit when all retry attempts for a proposal have been exhausted
pub fn emit_retries_exhausted(env: &Env, proposal_id: u64, total_attempts: u32) {
    env.events().publish(
        (Symbol::new(env, "retries_exhausted"), proposal_id),
        total_attempts,
    );
}

// ============================================================================
// Cross-Vault Events (feature/cross-vault-coordination)
// ============================================================================

/// Emit when a cross-vault proposal is created
pub fn emit_cross_vault_proposed(
    env: &Env,
    proposal_id: u64,
    proposer: &Address,
    num_actions: u32,
) {
    env.events().publish(
        (Symbol::new(env, "xvault_proposed"), proposal_id),
        (proposer.clone(), num_actions),
    );
}

/// Emit when cross-vault execution starts
pub fn emit_cross_vault_execution_started(
    env: &Env,
    proposal_id: u64,
    executor: &Address,
    num_actions: u32,
) {
    env.events().publish(
        (Symbol::new(env, "xvault_exec_start"), proposal_id),
        (executor.clone(), num_actions),
    );
}

/// Emit when a single cross-vault action is executed
pub fn emit_cross_vault_action_executed(
    env: &Env,
    proposal_id: u64,
    action_index: u32,
    vault_address: &Address,
    amount: i128,
) {
    env.events().publish(
        (Symbol::new(env, "xvault_action"), proposal_id),
        (action_index, vault_address.clone(), amount),
    );
}

/// Emit when all cross-vault actions complete successfully
pub fn emit_cross_vault_executed(
    env: &Env,
    proposal_id: u64,
    executor: &Address,
    num_actions: u32,
) {
    env.events().publish(
        (Symbol::new(env, "xvault_executed"), proposal_id),
        (executor.clone(), num_actions),
    );
}

/// Emit when a participant vault receives and executes a cross-vault action
pub fn emit_cross_vault_action_received(
    env: &Env,
    coordinator: &Address,
    recipient: &Address,
    token: &Address,
    amount: i128,
) {
    env.events().publish(
        (Symbol::new(env, "xvault_received"),),
        (
            coordinator.clone(),
            recipient.clone(),
            token.clone(),
            amount,
        ),
    );
}

/// Emit when cross-vault configuration is updated
pub fn emit_cross_vault_config_updated(env: &Env, admin: &Address) {
    env.events()
        .publish((Symbol::new(env, "xvault_cfg_updated"),), admin.clone());
}

// ============================================================================
// Dispute Resolution Events (feature/dispute-resolution)
// ============================================================================

/// Emit when a dispute is filed against a proposal
pub fn emit_dispute_filed(env: &Env, dispute_id: u64, proposal_id: u64, disputer: &Address) {
    env.events().publish(
        (Symbol::new(env, "dispute_filed"), dispute_id),
        (proposal_id, disputer.clone()),
    );
}

/// Emit when a dispute is resolved by an arbitrator
pub fn emit_dispute_resolved(
    env: &Env,
    dispute_id: u64,
    proposal_id: u64,
    arbitrator: &Address,
    resolution: u32,
) {
    env.events().publish(
        (Symbol::new(env, "dispute_resolved"), dispute_id),
        (proposal_id, arbitrator.clone(), resolution),
    );
}

/// Emit when arbitrator list is updated
pub fn emit_arbitrators_updated(env: &Env, admin: &Address, count: u32) {
    env.events().publish(
        (Symbol::new(env, "arbitrators_updated"),),
        (admin.clone(), count),
    );
}
