//! Tests for Issue #1693: Single Admin Cannot Lower Threshold to 1 via update_threshold
//!
//! ## Attack vector
//! `initialize` enforces a minimum threshold of 2 (Issue #1523), but before
//! this fix `update_threshold` only required `threshold >= 1` and a single
//! Admin signature. A single compromised admin key could therefore:
//!
//!  1. Call `update_threshold(1)` — no quorum needed.
//!  2. Propose a transfer to themselves.
//!  3. Approve it alone (threshold is now 1).
//!  4. Execute and drain the vault.
//!
//! ## Fixes verified here
//! 1. `update_threshold(< 2)` is rejected immediately with `ThresholdTooLow`.
//! 2. A reduction (threshold going down) is not applied immediately; it is
//!    routed through `propose_vault_config_change_with_timelock` and returns
//!    `Some(proposal_id)`.
//! 3. A single admin cannot self-execute that proposal: execution before
//!    collecting `threshold`-of-N approvals fails with `ProposalNotApproved`.
//! 4. Threshold *increases* are still applied immediately (returns `None`).
//! 5. A second simultaneous reduction attempt is rejected with
//!    `ConfigChangeInProgress`.
//! 6. Once the governance proposal for a reduction collects enough approvals
//!    and the timelock has elapsed, it *can* be executed — the governance
//!    path works end-to-end.

#![cfg(test)]

use super::*;
use crate::errors::VaultError;
use crate::types::{
    InitConfig, ProposalStatus, RetryConfig, ThresholdStrategy, VelocityConfig, VoteWeight,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Vec,
};

// ============================================================================
// Helpers
// ============================================================================

/// Create a vault with `signer_count` signers (admin at index 0) and the
/// given `threshold`.  All calls are mock-authorized.
///
/// Returns `(client, admin, all_signers)`.
fn make_vault(
    env: &Env,
    threshold: u32,
    signer_count: u32,
) -> (VaultDAOClient<'static>, Address, Vec<Address>) {
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let mut signers: Vec<Address> = Vec::new(env);
    signers.push_back(admin.clone());
    for _ in 1..signer_count {
        signers.push_back(Address::generate(env));
    }

    client.initialize(
        &admin,
        &InitConfig {
            signers: signers.clone(),
            threshold,
            quorum: 0,
            quorum_percentage: 0,
            spending_limit: 1_000_000,
            daily_limit: 5_000_000,
            weekly_limit: 10_000_000,
            timelock_threshold: 0,
            // Non-zero so the reduction path always generates a real timelock.
            timelock_delay: 10,
            velocity_limit: VelocityConfig {
                limit: 1_000_000,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            default_voting_deadline: 0,
            veto_addresses: Vec::new(env),
            veto_window_ledgers: 0,
            retry_config: RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(env),
            staking_config: crate::types::StakingConfig::default(),
            proposal_id_prefix: 0,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
        },
    );

    (client, admin, signers)
}

// ============================================================================
// 1. Minimum threshold invariant: update_threshold rejects < 2
// ============================================================================

/// Setting threshold to 1 via update_threshold must be rejected with
/// `ThresholdTooLow`, the same error produced by `initialize`.
#[test]
fn test_update_threshold_rejects_threshold_below_two() {
    let env = Env::default();
    let (client, admin, _signers) = make_vault(&env, 3, 4);

    let result = client.try_update_threshold(&admin, &1u32);
    assert_eq!(
        result,
        Err(Ok(VaultError::ThresholdTooLow)),
        "threshold of 1 must be rejected with ThresholdTooLow"
    );
}

/// Setting threshold to 0 must also be rejected with `ThresholdTooLow`.
#[test]
fn test_update_threshold_rejects_threshold_zero() {
    let env = Env::default();
    let (client, admin, _signers) = make_vault(&env, 3, 4);

    let result = client.try_update_threshold(&admin, &0u32);
    assert_eq!(
        result,
        Err(Ok(VaultError::ThresholdTooLow)),
        "threshold of 0 must be rejected with ThresholdTooLow"
    );
}

// ============================================================================
// 2. Reduction is routed to governance, not applied immediately
// ============================================================================

/// Calling update_threshold with a lower value must NOT change the config
/// immediately; it returns `Some(proposal_id)` and leaves the current
/// threshold unchanged until the proposal is approved and executed.
#[test]
fn test_update_threshold_reduction_creates_proposal_not_immediate() {
    let env = Env::default();
    // 4 signers, threshold = 3
    let (client, admin, _signers) = make_vault(&env, 3, 4);

    let before = client.get_config().threshold;
    assert_eq!(before, 3);

    // Attempt to reduce from 3 → 2 (still meets min-2 invariant, but is a reduction).
    let result = client.update_threshold(&admin, &2u32);

    // Must return Some(proposal_id), not None.
    assert!(
        result.is_some(),
        "reducing the threshold must create a governance proposal"
    );

    // The live config threshold must still be the original value.
    let after = client.get_config().threshold;
    assert_eq!(
        after, before,
        "threshold must NOT change until the proposal is executed"
    );
}

// ============================================================================
// 3. Single admin cannot execute the reduction without multisig approval
// ============================================================================

/// A single Admin that proposes the reduction and then immediately tries to
/// execute it must be blocked by `ProposalNotApproved` — even with
/// mock_all_auths, the proposal approval count check is an invariant.
#[test]
fn test_single_admin_cannot_execute_threshold_reduction_unilaterally() {
    let env = Env::default();
    // 4 signers, threshold = 3 — all three non-admin signers must approve.
    let (client, admin, _signers) = make_vault(&env, 3, 4);

    // Propose reduction 3 → 2.
    let proposal_id = client
        .update_threshold(&admin, &2u32)
        .expect("reduction must create a proposal");

    // The proposal should be Pending (no approvals yet).
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending);

    // Admin approves — only 1 of 3 required approvals.
    client.approve_proposal(&admin, &proposal_id);

    // Attempt immediate execution: must fail because threshold = 3 approvals
    // are needed but only 1 has been collected.
    let exec_result = client.try_execute_proposal(&admin, &proposal_id);
    assert_eq!(
        exec_result,
        Err(Ok(VaultError::ProposalNotApproved)),
        "single-admin approval must not be sufficient to execute a threshold reduction"
    );

    // The live threshold must still be 3.
    assert_eq!(client.get_config().threshold, 3);
}

// ============================================================================
// 4. Increase is still applied immediately
// ============================================================================

/// Raising the threshold is strictly safer and must still take effect at once
/// (returns `None`).
#[test]
fn test_update_threshold_increase_applied_immediately() {
    let env = Env::default();
    // 4 signers, threshold = 2
    let (client, admin, _signers) = make_vault(&env, 2, 4);

    // Increase from 2 → 3: must return None (no proposal created).
    let result = client.update_threshold(&admin, &3u32);
    assert!(
        result.is_none(),
        "threshold increase must be applied immediately and return None"
    );

    // The live config must reflect the new, higher threshold.
    assert_eq!(client.get_config().threshold, 3);
}

/// Keeping the threshold at the same value must also return None (no-op).
#[test]
fn test_update_threshold_unchanged_applied_immediately() {
    let env = Env::default();
    let (client, admin, _signers) = make_vault(&env, 2, 3);

    let result = client.update_threshold(&admin, &2u32);
    assert!(
        result.is_none(),
        "unchanged threshold must return None (no proposal created)"
    );

    assert_eq!(client.get_config().threshold, 2);
}

// ============================================================================
// 5. Concurrent reduction attempts are blocked
// ============================================================================

/// If a threshold-reduction proposal is already pending, a second call to
/// update_threshold with another reduction must fail with
/// `ConfigChangeInProgress`.
#[test]
fn test_concurrent_reduction_blocked_with_config_change_in_progress() {
    let env = Env::default();
    // 4 signers, threshold = 3
    let (client, admin, _signers) = make_vault(&env, 3, 4);

    // First reduction: 3 → 2, creates proposal.
    let first = client.try_update_threshold(&admin, &2u32);
    assert!(first.is_ok(), "first reduction must succeed in creating a proposal");

    // Second reduction attempt while first proposal is still pending.
    let second = client.try_update_threshold(&admin, &2u32);
    assert_eq!(
        second,
        Err(Ok(VaultError::ConfigChangeInProgress)),
        "second reduction while first is pending must return ConfigChangeInProgress"
    );
}

// ============================================================================
// 6. Non-admin caller is rejected
// ============================================================================

/// A signer that holds only the Member role must not be able to call
/// update_threshold at all.
#[test]
fn test_update_threshold_rejects_non_admin_caller() {
    let env = Env::default();
    // 3 signers; signers[1] has no elevated role (Member by default).
    let (client, _admin, signers) = make_vault(&env, 2, 3);
    let plain_member = signers.get(1).unwrap();

    let result = client.try_update_threshold(&plain_member, &3u32);
    assert_eq!(
        result,
        Err(Ok(VaultError::Unauthorized)),
        "non-admin caller must be rejected with Unauthorized"
    );
}

// ============================================================================
// 7. Governance path works end-to-end when threshold approvals are collected
// ============================================================================

/// After collecting `threshold` approvals on the reduction proposal AND
/// waiting for the timelock, the proposal can be executed and the new
/// (lower) threshold takes effect.
#[test]
fn test_threshold_reduction_succeeds_after_governance_and_timelock() {
    let env = Env::default();
    env.ledger().set_sequence_number(1000);

    // 4 signers, threshold = 3, timelock_delay = 10 ledgers (set in make_vault).
    let (client, admin, signers) = make_vault(&env, 3, 4);
    let signer1 = signers.get(1).unwrap();
    let signer2 = signers.get(2).unwrap();

    // Propose reduction 3 → 2.
    let proposal_id = client
        .update_threshold(&admin, &2u32)
        .expect("reduction must create a governance proposal");

    // Verify proposal is pending.
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending);

    // Collect the required 3 approvals.
    client.approve_proposal(&admin, &proposal_id);
    client.approve_proposal(&signer1, &proposal_id);
    client.approve_proposal(&signer2, &proposal_id);

    let approved = client.get_proposal(&proposal_id);
    assert_eq!(
        approved.status,
        ProposalStatus::Approved,
        "proposal must be Approved after threshold approvals"
    );

    // Advance past the timelock (timelock_delay = 10 ledgers).
    env.ledger().set_sequence_number(1011);

    // Now execute.
    client.execute_proposal(&admin, &proposal_id);

    let executed = client.get_proposal(&proposal_id);
    assert_eq!(
        executed.status,
        ProposalStatus::Executed,
        "proposal must be Executed after timelock elapses"
    );

    // The live threshold must now be 2.
    assert_eq!(
        client.get_config().threshold,
        2,
        "threshold must be 2 after the reduction proposal is executed"
    );
}

// ============================================================================
// 8. Reduction below 2 is still blocked even via the governance path
// ============================================================================

/// Attempting to route a threshold-1 reduction through update_threshold must
/// fail at the pre-check, before any proposal is created, because < 2 is
/// unconditionally invalid.
#[test]
fn test_threshold_reduction_to_one_is_blocked_before_proposal_creation() {
    let env = Env::default();
    let (client, admin, _signers) = make_vault(&env, 3, 4);

    // Attempting to reduce to 1 (below minimum) must fail immediately.
    let result = client.try_update_threshold(&admin, &1u32);
    assert_eq!(
        result,
        Err(Ok(VaultError::ThresholdTooLow)),
        "threshold of 1 must be rejected before any proposal is created"
    );

    // No config-change proposal should have been created.
    // A subsequent reduction to 2 must succeed (not blocked by ConfigChangeInProgress).
    let follow_up = client.try_update_threshold(&admin, &2u32);
    assert!(
        follow_up.is_ok(),
        "a valid reduction after a rejected one must still be allowed"
    );
}
