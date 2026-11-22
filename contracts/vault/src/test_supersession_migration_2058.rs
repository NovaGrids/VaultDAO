//! Tests for Issue #2058: supersession chain integrity, conflict detection and
//! vote migration.
//!
//! 1. A parent can be superseded once; a competing supersession is rejected.
//! 2. Executed (and otherwise finished) proposals cannot be superseded.
//! 3. Vote migration policy: `Reset`, `Carry` and `Weighted`, including the
//!    fallback to `Reset` on recipient/token changes.
//! 4. Supersession emits an auditor event and releases the parent's
//!    reservation and spending-limit buckets.
#![cfg(test)]

use crate::errors::VaultError;
use crate::test_treasury_risk_2061::{approve, setup_vault, Ctx};
use crate::types::{ConditionLogic, Priority, ProposalStatus, VoteMigrationPolicy};
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    Address, Env, Symbol, TryFromVal, Vec,
};

fn propose_to(env: &Env, ctx: &Ctx, recipient: &Address, amount: i128) -> u64 {
    ctx.client.propose_transfer(
        &ctx.admin,
        recipient,
        &ctx.token,
        &amount,
        &Symbol::new(env, "orig"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    )
}

fn supersede(
    env: &Env,
    ctx: &Ctx,
    old_id: u64,
    recipient: &Address,
    amount: i128,
) -> Result<u64, VaultError> {
    match ctx.client.try_supersede_proposal(
        &ctx.admin,
        &old_id,
        recipient,
        &ctx.token,
        &amount,
        &Symbol::new(env, "amended"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    ) {
        Ok(Ok(id)) => Ok(id),
        Err(Ok(e)) => Err(e),
        other => panic!("unexpected result: {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Chain integrity and conflicts
// ---------------------------------------------------------------------------

#[test]
fn test_conflicting_supersession_rejected() {
    let env = Env::default();
    let ctx = setup_vault(&env, 100_000, 0);
    let recipient = Address::generate(&env);

    let parent = propose_to(&env, &ctx, &recipient, 1_000);
    let first = supersede(&env, &ctx, parent, &recipient, 1_100).unwrap();

    // A competing amendment of the same parent is a conflict.
    assert_eq!(
        supersede(&env, &ctx, parent, &recipient, 1_200),
        Err(VaultError::SupersessionConflict)
    );

    // The winning branch is unaffected and can itself be superseded.
    assert_eq!(ctx.client.get_superseded_by(&parent), Some(first));
    let second = supersede(&env, &ctx, first, &recipient, 1_300).unwrap();
    assert_eq!(ctx.client.get_superseded_by(&first), Some(second));
    assert_eq!(ctx.client.get_supercession_chain(&second).len(), 2);
}

#[test]
fn test_executed_proposal_cannot_be_superseded() {
    let env = Env::default();
    let ctx = setup_vault(&env, 100_000, 0);
    let recipient = Address::generate(&env);

    let id = propose_to(&env, &ctx, &recipient, 1_000);
    approve(&ctx, id);
    ctx.client.execute_proposal(&ctx.admin, &id);
    assert_eq!(ctx.client.get_proposal(&id).status, ProposalStatus::Executed);

    assert_eq!(
        supersede(&env, &ctx, id, &recipient, 1_100),
        Err(VaultError::ProposalAlreadyExecuted)
    );
    assert_eq!(ctx.client.get_superseded_by(&id), None);
}

#[test]
fn test_cancelled_proposal_cannot_be_superseded() {
    let env = Env::default();
    let ctx = setup_vault(&env, 100_000, 0);
    let recipient = Address::generate(&env);

    let id = propose_to(&env, &ctx, &recipient, 1_000);
    ctx.client
        .cancel_proposal(&ctx.admin, &id, &Symbol::new(&env, "drop"));
    assert_eq!(
        supersede(&env, &ctx, id, &recipient, 1_100),
        Err(VaultError::ProposalAlreadyCancelled)
    );
}

#[test]
fn test_approved_proposal_supersession_releases_reservation() {
    let env = Env::default();
    let ctx = setup_vault(&env, 100_000, 0);
    let recipient = Address::generate(&env);

    let id = propose_to(&env, &ctx, &recipient, 1_000);
    approve(&ctx, id);
    assert_eq!(ctx.client.get_treasury_risk_snapshot(&ctx.token).pending, 1_000);

    let new_id = supersede(&env, &ctx, id, &recipient, 900).unwrap();
    assert_eq!(ctx.client.get_proposal(&id).status, ProposalStatus::Cancelled);
    assert_eq!(ctx.client.get_pending_reservation(&id), None);
    // Default policy is Reset: the replacement starts Pending, unreserved.
    assert_eq!(ctx.client.get_proposal(&new_id).status, ProposalStatus::Pending);
    assert_eq!(ctx.client.get_treasury_risk_snapshot(&ctx.token).pending, 0);
}

#[test]
fn test_supersession_emits_audit_event() {
    let env = Env::default();
    let ctx = setup_vault(&env, 100_000, 0);
    let recipient = Address::generate(&env);

    let id = propose_to(&env, &ctx, &recipient, 1_000);
    let new_id = supersede(&env, &ctx, id, &recipient, 1_100).unwrap();

    let topic = Symbol::new(&env, "proposal_superseded");
    let found = env.events().all().iter().any(|(_, topics, _)| {
        let name = topics
            .get(0)
            .and_then(|t| Symbol::try_from_val(&env, &t).ok());
        let old = topics.get(1).and_then(|t| u64::try_from_val(&env, &t).ok());
        let new = topics.get(2).and_then(|t| u64::try_from_val(&env, &t).ok());
        name == Some(topic.clone()) && old == Some(id) && new == Some(new_id)
    });
    assert!(found, "expected proposal_superseded(old, new) event");
}

// ---------------------------------------------------------------------------
// Vote migration policy
// ---------------------------------------------------------------------------

/// Proposal approved by one signer (threshold 2, so still Pending).
fn half_approved(env: &Env, ctx: &Ctx, recipient: &Address, amount: i128) -> u64 {
    let id = propose_to(env, ctx, recipient, amount);
    ctx.client.approve_proposal(&ctx.admin, &id);
    assert_eq!(ctx.client.get_proposal(&id).status, ProposalStatus::Pending);
    id
}

#[test]
fn test_default_policy_is_reset() {
    let env = Env::default();
    let ctx = setup_vault(&env, 100_000, 0);
    assert_eq!(ctx.client.get_vote_migration_policy(), VoteMigrationPolicy::Reset);

    let recipient = Address::generate(&env);
    let id = half_approved(&env, &ctx, &recipient, 1_000);
    let new_id = supersede(&env, &ctx, id, &recipient, 1_000 - 1).unwrap();
    assert_eq!(ctx.client.get_proposal(&new_id).approvals.len(), 0);
}

#[test]
fn test_policy_requires_admin() {
    let env = Env::default();
    let ctx = setup_vault(&env, 100_000, 0);
    assert_eq!(
        ctx.client
            .try_set_vote_migration_policy(&ctx.s1, &VoteMigrationPolicy::Carry),
        Err(Ok(VaultError::InsufficientRole))
    );
    ctx.client
        .set_vote_migration_policy(&ctx.admin, &VoteMigrationPolicy::Carry);
    assert_eq!(ctx.client.get_vote_migration_policy(), VoteMigrationPolicy::Carry);
}

#[test]
fn test_carry_keeps_votes_for_same_target_and_lower_amount() {
    let env = Env::default();
    let ctx = setup_vault(&env, 100_000, 0);
    ctx.client
        .set_vote_migration_policy(&ctx.admin, &VoteMigrationPolicy::Carry);

    let recipient = Address::generate(&env);
    let id = half_approved(&env, &ctx, &recipient, 1_000);
    let new_id = supersede(&env, &ctx, id, &recipient, 800).unwrap();

    let p = ctx.client.get_proposal(&new_id);
    assert_eq!(p.approvals.len(), 1);
    assert!(p.approvals.contains(&ctx.admin));
    assert_eq!(p.status, ProposalStatus::Pending);

    // One fresh approval completes the threshold as usual.
    ctx.client.approve_proposal(&ctx.s1, &new_id);
    assert_eq!(ctx.client.get_proposal(&new_id).status, ProposalStatus::Approved);
}

#[test]
fn test_carry_resets_on_amount_increase() {
    let env = Env::default();
    let ctx = setup_vault(&env, 100_000, 0);
    ctx.client
        .set_vote_migration_policy(&ctx.admin, &VoteMigrationPolicy::Carry);

    let recipient = Address::generate(&env);
    let id = half_approved(&env, &ctx, &recipient, 1_000);
    let new_id = supersede(&env, &ctx, id, &recipient, 1_001).unwrap();
    assert_eq!(ctx.client.get_proposal(&new_id).approvals.len(), 0);
}

#[test]
fn test_carry_resets_on_recipient_change() {
    let env = Env::default();
    let ctx = setup_vault(&env, 100_000, 0);
    ctx.client
        .set_vote_migration_policy(&ctx.admin, &VoteMigrationPolicy::Carry);

    let recipient = Address::generate(&env);
    let id = half_approved(&env, &ctx, &recipient, 1_000);
    let new_id = supersede(&env, &ctx, id, &Address::generate(&env), 1_000).unwrap();
    assert_eq!(ctx.client.get_proposal(&new_id).approvals.len(), 0);
}

#[test]
fn test_carry_can_reach_threshold_and_reserve() {
    let env = Env::default();
    let ctx = setup_vault(&env, 100_000, 0);
    ctx.client
        .set_vote_migration_policy(&ctx.admin, &VoteMigrationPolicy::Carry);

    let recipient = Address::generate(&env);
    let id = propose_to(&env, &ctx, &recipient, 1_000);
    approve(&ctx, id);
    assert_eq!(ctx.client.get_proposal(&id).status, ProposalStatus::Approved);

    // Lowering the amount keeps both approvals: the replacement is approved
    // straight away and takes over the reservation.
    let new_id = supersede(&env, &ctx, id, &recipient, 900).unwrap();
    let p = ctx.client.get_proposal(&new_id);
    assert_eq!(p.approvals.len(), 2);
    assert_eq!(p.status, ProposalStatus::Approved);
    assert_eq!(ctx.client.get_pending_reservation(&id), None);
    assert_eq!(
        ctx.client.get_pending_reservation(&new_id),
        Some((ctx.token.clone(), 900))
    );
    assert_eq!(ctx.client.get_treasury_risk_snapshot(&ctx.token).pending, 900);
}

#[test]
fn test_weighted_scales_votes_on_amount_increase() {
    let env = Env::default();
    let ctx = setup_vault(&env, 100_000, 0);
    ctx.client
        .set_vote_migration_policy(&ctx.admin, &VoteMigrationPolicy::Weighted);

    let recipient = Address::generate(&env);
    let id = propose_to(&env, &ctx, &recipient, 1_000);
    approve(&ctx, id); // 2 approvals

    // Doubling the amount keeps floor(2 * 1000 / 2000) = 1 approval.
    let doubled = supersede(&env, &ctx, id, &recipient, 2_000).unwrap();
    let p = ctx.client.get_proposal(&doubled);
    assert_eq!(p.approvals.len(), 1);
    assert_eq!(p.approvals.get(0).unwrap(), ctx.admin);
    assert_eq!(p.status, ProposalStatus::Pending);

    // More than doubling with a single carried approval keeps none.
    let tripled = supersede(&env, &ctx, doubled, &recipient, 6_000).unwrap();
    assert_eq!(ctx.client.get_proposal(&tripled).approvals.len(), 0);
}

#[test]
fn test_weighted_keeps_all_votes_on_decrease() {
    let env = Env::default();
    let ctx = setup_vault(&env, 100_000, 0);
    ctx.client
        .set_vote_migration_policy(&ctx.admin, &VoteMigrationPolicy::Weighted);

    let recipient = Address::generate(&env);
    let id = half_approved(&env, &ctx, &recipient, 1_000);
    let new_id = supersede(&env, &ctx, id, &recipient, 500).unwrap();
    assert_eq!(ctx.client.get_proposal(&new_id).approvals.len(), 1);
}

#[test]
fn test_migrated_votes_skip_removed_signers() {
    let env = Env::default();
    let ctx = setup_vault(&env, 100_000, 0);
    ctx.client
        .set_vote_migration_policy(&ctx.admin, &VoteMigrationPolicy::Carry);

    let recipient = Address::generate(&env);
    let id = propose_to(&env, &ctx, &recipient, 1_000);
    ctx.client.approve_proposal(&ctx.s2, &id);

    // s2 leaves the signer set before the supersession.
    env.as_contract(&ctx.contract_id, || {
        let mut config = crate::storage::get_config(&env).unwrap();
        let mut signers = Vec::new(&env);
        for s in config.signers.iter() {
            if s != ctx.s2 {
                signers.push_back(s);
            }
        }
        config.signers = signers;
        crate::storage::set_config(&env, &config);
    });

    let new_id = supersede(&env, &ctx, id, &recipient, 1_000 - 1).unwrap();
    assert_eq!(ctx.client.get_proposal(&new_id).approvals.len(), 0);
}
