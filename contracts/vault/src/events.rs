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

/// Emit when a new proposal is created
pub fn emit_proposal_created(
    env: &Env,
    proposal_id: u64,
    proposer: &Address,
    recipient: &Address,
    amount: i128,
) {
    env.events().publish(
        (Symbol::new(env, "proposal_created"), proposal_id),
        (proposer.clone(), recipient.clone(), amount),
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

/// Emit when a signer abstains from a proposal
pub fn emit_proposal_abstained(
    env: &Env,
    proposal_id: u64,
    abstainer: &Address,
    abstention_count: u32,
) {
    env.events().publish(
        (Symbol::new(env, "proposal_abstained"), proposal_id),
        (abstainer.clone(), abstention_count),
    );
}

/// Emit when a proposal reaches threshold and is ready for execution
pub fn emit_proposal_ready(env: &Env, proposal_id: u64) {
    env.events()
        .publish((Symbol::new(env, "proposal_ready"), proposal_id), ());
}

/// Emit when a proposal is executed
pub fn emit_proposal_executed(
    env: &Env,
    proposal_id: u64,
    executor: &Address,
    recipient: &Address,
    amount: i128,
) {
    env.events().publish(
        (Symbol::new(env, "proposal_executed"), proposal_id),
        (executor.clone(), recipient.clone(), amount),
    );
}

/// Emit when a proposal is rejected
pub fn emit_proposal_rejected(env: &Env, proposal_id: u64, rejector: &Address) {
    env.events().publish(
        (Symbol::new(env, "proposal_rejected"), proposal_id),
        rejector.clone(),
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
