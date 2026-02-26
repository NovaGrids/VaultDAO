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

// ============================================================================
// Oracle Events (feature/oracle-integration)
// ============================================================================

/// Emit when oracle configuration is updated by admin
pub fn emit_oracle_config_updated(env: &Env, admin: &Address, oracle: &Address) {
    env.events().publish(
        (Symbol::new(env, "oracle_cfg_updated"),),
        (admin.clone(), oracle.clone()),
    );
}

/// Emit when quorum configuration is updated by admin
pub fn emit_quorum_updated(env: &Env, admin: &Address, old_quorum: u32, new_quorum: u32) {
    env.events().publish(
        (Symbol::new(env, "quorum_updated"),),
        (admin.clone(), old_quorum, new_quorum),
    );
}

/// Emit when a proposal reaches quorum participation threshold.
pub fn emit_quorum_reached(env: &Env, proposal_id: u64, quorum_votes: u32, required_quorum: u32) {
    env.events().publish(
        (Symbol::new(env, "quorum_reached"), proposal_id),
        (quorum_votes, required_quorum),
    );
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
// Staking Events (feature/proposal-staking)
// ============================================================================

/// Emit when stake is locked on proposal creation
pub fn emit_stake_locked(
    env: &Env,
    proposal_id: u64,
    proposer: &Address,
    amount: i128,
    token: &Address,
) {
    env.events().publish(
        (Symbol::new(env, "stake_locked"), proposal_id),
        (proposer.clone(), amount, token.clone()),
    );
}

/// Emit when stake is slashed for malicious proposal
pub fn emit_stake_slashed(
    env: &Env,
    proposal_id: u64,
    proposer: &Address,
    slashed_amount: i128,
    returned_amount: i128,
) {
    env.events().publish(
        (Symbol::new(env, "stake_slashed"), proposal_id),
        (proposer.clone(), slashed_amount, returned_amount),
    );
}

/// Emit when stake is refunded on successful execution
pub fn emit_stake_refunded(env: &Env, proposal_id: u64, proposer: &Address, amount: i128) {
    env.events().publish(
        (Symbol::new(env, "stake_refunded"), proposal_id),
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

/// Emit when a hook is registered
pub fn emit_hook_registered(env: &Env, hook: &Address, is_pre: bool) {
    env.events().publish(
        (Symbol::new(env, "hook_registered"),),
        (hook.clone(), is_pre),
    );
}

/// Emit when a hook is removed
pub fn emit_hook_removed(env: &Env, hook: &Address, is_pre: bool) {
    env.events().publish(
        (Symbol::new(env, "hook_removed"),),
        (hook.clone(), is_pre),
    );
}

/// Emit when a hook is executed
pub fn emit_hook_executed(env: &Env, hook: &Address, proposal_id: u64, is_pre: bool) {
    env.events().publish(
        (Symbol::new(env, "hook_executed"), proposal_id),
        (hook.clone(), is_pre),
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

/// Emit when execution fee estimate is calculated/refreshed for a proposal.
pub fn emit_execution_fee_estimated(
    env: &Env,
    proposal_id: u64,
    base_fee: u64,
    resource_fee: u64,
    total_fee: u64,
) {
    env.events().publish(
        (Symbol::new(env, "exec_fee_estimated"), proposal_id),
        (base_fee, resource_fee, total_fee),
    );
}

/// Emit when a proposal execution consumes its estimated fee.
pub fn emit_execution_fee_used(env: &Env, proposal_id: u64, total_fee: u64) {
    env.events()
        .publish((Symbol::new(env, "exec_fee_used"), proposal_id), total_fee);
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
        (Symbol::new(env, "voting_deadline_ext"), proposal_id),
        (old_deadline, new_deadline, admin.clone()),
    );
}

// ============================================================================
// Proposal Template Events (feature/contract-templates)
// ============================================================================

/// Emit when a new template is created
#[allow(dead_code)]
pub fn emit_template_created(
    env: &Env,
    template_id: u64,
    name: &soroban_sdk::Symbol,
    creator: &Address,
) {
    env.events().publish(
        (Symbol::new(env, "template_created"), template_id),
        (name.clone(), creator.clone()),
    );
}

/// Emit when a template is updated
#[allow(dead_code)]
pub fn emit_template_updated(
    env: &Env,
    template_id: u64,
    name: &soroban_sdk::Symbol,
    version: u32,
    updater: &Address,
) {
    env.events().publish(
        (Symbol::new(env, "template_updated"), template_id),
        (name.clone(), version, updater.clone()),
    );
}

/// Emit when a template's active status changes
#[allow(dead_code)]
pub fn emit_template_status_changed(
    env: &Env,
    template_id: u64,
    name: &soroban_sdk::Symbol,
    is_active: bool,
    admin: &Address,
) {
    env.events().publish(
        (Symbol::new(env, "template_status"), template_id),
        (name.clone(), is_active, admin.clone()),
    );
}

/// Emit when a proposal is created from a template
pub fn emit_proposal_from_template(
    env: &Env,
    proposal_id: u64,
    template_id: u64,
    template_name: &soroban_sdk::Symbol,
    proposer: &Address,
) {
    env.events().publish(
        (Symbol::new(env, "proposal_from_template"), proposal_id),
        (template_id, template_name.clone(), proposer.clone()),
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
// Subscription Events (feature/subscription-system)
// ============================================================================

/// Emit when a new subscription is created
#[allow(dead_code)]
pub fn emit_subscription_created(
    env: &Env,
    subscription_id: u64,
    subscriber: &Address,
    tier: u32,
    amount: i128,
) {
    env.events().publish(
        (Symbol::new(env, "subscription_created"), subscription_id),
        (subscriber.clone(), tier, amount),
    );
}

/// Emit when a subscription is renewed
#[allow(dead_code)]
pub fn emit_subscription_renewed(
    env: &Env,
    subscription_id: u64,
    payment_number: u32,
    amount: i128,
) {
    env.events().publish(
        (Symbol::new(env, "subscription_renewed"), subscription_id),
        (payment_number, amount),
    );
}

/// Emit when a subscription is cancelled
#[allow(dead_code)]
pub fn emit_subscription_cancelled(env: &Env, subscription_id: u64, cancelled_by: &Address) {
    env.events().publish(
        (Symbol::new(env, "subscription_cancelled"), subscription_id),
        cancelled_by.clone(),
    );
}

/// Emit when a subscription tier is upgraded
#[allow(dead_code)]
pub fn emit_subscription_upgraded(
    env: &Env,
    subscription_id: u64,
    old_tier: u32,
    new_tier: u32,
    new_amount: i128,
) {
    env.events().publish(
        (Symbol::new(env, "subscription_upgraded"), subscription_id),
        (old_tier, new_tier, new_amount),
    );
}

/// Emit when a subscription expires
#[allow(dead_code)]
pub fn emit_subscription_expired(env: &Env, subscription_id: u64) {
    env.events()
        .publish((Symbol::new(env, "subscription_expired"),), subscription_id);
}

// ============================================================================
// Escrow Events (feature/escrow-system)
// ============================================================================

/// Emit when an escrow agreement is created
pub fn emit_escrow_created(
    env: &Env,
    escrow_id: u64,
    funder: &Address,
    recipient: &Address,
    token: &Address,
    amount: i128,
    duration_ledgers: u64,
) {
    env.events().publish(
        (Symbol::new(env, "escrow_created"), escrow_id),
        (
            funder.clone(),
            recipient.clone(),
            token.clone(),
            amount,
            duration_ledgers,
        ),
    );
}

/// Emit when a milestone is completed
pub fn emit_milestone_completed(env: &Env, escrow_id: u64, milestone_id: u64, completer: &Address) {
    env.events().publish(
        (Symbol::new(env, "milestone_complete"), escrow_id),
        (milestone_id, completer.clone()),
    );
}

/// Emit when escrow funds are released
pub fn emit_escrow_released(
    env: &Env,
    escrow_id: u64,
    recipient: &Address,
    amount: i128,
    is_refund: bool,
) {
    env.events().publish(
        (Symbol::new(env, "escrow_released"), escrow_id),
        (recipient.clone(), amount, is_refund),
    );
}

/// Emit when an escrow is disputed
pub fn emit_escrow_disputed(env: &Env, escrow_id: u64, disputer: &Address, reason: &Symbol) {
    env.events().publish(
        (Symbol::new(env, "escrow_disputed"), escrow_id),
        (disputer.clone(), reason.clone()),
    );
}

/// Emit when an escrow dispute is resolved
pub fn emit_escrow_dispute_resolved(
    env: &Env,
    escrow_id: u64,
    arbitrator: &Address,
    released_to_recipient: bool,
) {
    env.events().publish(
        (Symbol::new(env, "escrow_resolved"), escrow_id),
        (arbitrator.clone(), released_to_recipient),
    );
}

// ============================================================================
// Time-Weighted Voting Events
// ============================================================================

/// Emit when tokens are locked for voting power
pub fn emit_tokens_locked(
    env: &Env,
    owner: &Address,
    amount: i128,
    duration: u64,
    power_multiplier_bps: u32,
) {
    env.events().publish(
        (Symbol::new(env, "tokens_locked"),),
        (owner.clone(), amount, duration, power_multiplier_bps),
    );
}

/// Emit when a token lock is extended
pub fn emit_lock_extended(
    env: &Env,
    owner: &Address,
    new_duration: u64,
    power_multiplier_bps: u32,
) {
    env.events().publish(
        (Symbol::new(env, "lock_extended"),),
        (owner.clone(), new_duration, power_multiplier_bps),
    );
}

/// Emit when tokens are unlocked after lock period
pub fn emit_tokens_unlocked(env: &Env, owner: &Address, amount: i128) {
    env.events().publish(
        (Symbol::new(env, "tokens_unlocked"),),
        (owner.clone(), amount),
    );
}

/// Emit when tokens are unlocked early with penalty
pub fn emit_early_unlock(env: &Env, owner: &Address, returned_amount: i128, penalty: i128) {
    env.events().publish(
        (Symbol::new(env, "early_unlock"),),
        (owner.clone(), returned_amount, penalty),
    );
}

// ============================================================================
// Recovery Events
// ============================================================================

/// Emit when recovery configuration is updated
pub fn emit_recovery_config_updated(env: &Env, admin: &Address) {
    env.events()
        .publish((Symbol::new(env, "recovery_config"),), admin.clone());
}

/// Emit when a recovery proposal is created
pub fn emit_recovery_proposed(env: &Env, proposal_id: u64, new_threshold: u32) {
    env.events().publish(
        (Symbol::new(env, "recovery_proposed"), proposal_id),
        new_threshold,
    );
}

/// Emit when a recovery proposal is approved
pub fn emit_recovery_approved(env: &Env, proposal_id: u64, guardian: &Address) {
    env.events().publish(
        (Symbol::new(env, "recovery_approved"), proposal_id),
        guardian.clone(),
    );
}

/// Emit when a recovery proposal is executed
pub fn emit_recovery_executed(env: &Env, proposal_id: u64) {
    env.events()
        .publish((Symbol::new(env, "recovery_executed"), proposal_id), ());
}

/// Emit when a recovery proposal is cancelled
pub fn emit_recovery_cancelled(env: &Env, proposal_id: u64, canceller: &Address) {
    env.events().publish(
        (Symbol::new(env, "recovery_cancelled"), proposal_id),
        canceller.clone(),
    );
}

/// Emit when recovery configuration is updated
pub fn emit_recovery_config_updated(env: &Env, admin: &Address) {
    env.events()
        .publish((Symbol::new(env, "recovery_cfg_updated"),), admin.clone());
}

/// Emit when fee structure is updated
pub fn emit_fee_structure_updated(env: &Env, admin: &Address, enabled: bool) {
    env.events().publish(
        (Symbol::new(env, "fee_structure_updated"),),
        (admin.clone(), enabled),
    );
}

/// Emit when a fee is collected from a transaction
pub fn emit_fee_collected(
    env: &Env,
    user: &Address,
    token: &Address,
    amount: i128,
    fee: i128,
    fee_bps: u32,
    reputation_discount_applied: bool,
) {
    env.events().publish(
        (Symbol::new(env, "fee_collected"),),
        (
            user.clone(),
            token.clone(),
            amount,
            fee,
            fee_bps,
            reputation_discount_applied,
        ),
    );
}

// ============================================================================
// Stream Events (feature/token-streaming)
// ============================================================================

/// Emit when a stream status is updated (paused, resumed, or cancelled)
pub fn emit_stream_status_updated(env: &Env, stream_id: u64, status: u32, updated_by: &Address) {
    env.events().publish(
        (Symbol::new(env, "stream_status"), stream_id),
        (status, updated_by.clone()),
    );
}

/// Emit when tokens are claimed from a stream
pub fn emit_stream_claimed(env: &Env, stream_id: u64, recipient: &Address, amount: i128) {
    env.events().publish(
        (Symbol::new(env, "stream_claimed"), stream_id),
        (recipient.clone(), amount),
    );
}

// ============================================================================
// Proposal Scheduling Events (feature/proposal-scheduling)
// ============================================================================

/// Emit when a proposal is scheduled for future execution
pub fn emit_proposal_scheduled(env: &Env, proposal_id: u64, execution_time: u64, scheduled_at: u64) {
    env.events().publish(
        (Symbol::new(env, "proposal_scheduled"), proposal_id),
        (execution_time, scheduled_at),
    );
}

/// Emit when a scheduled proposal is cancelled
pub fn emit_scheduled_proposal_cancelled(env: &Env, proposal_id: u64, cancelled_at: u64) {
    env.events().publish(
        (Symbol::new(env, "scheduled_cancelled"), proposal_id),
        cancelled_at,
    );
}