//! VaultDAO - Event Publishing
//!
//! Standardized events for proposal lifecycle and admin actions.

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
