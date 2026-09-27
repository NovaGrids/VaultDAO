//! Tests for Issue #1526: Require Multisig Proposal for Signer Removal to
//! Prevent Threshold Breach.
//!
//! `remove_signer` must never let a single Admin key reduce the signer set
//! below the configured threshold, and signer removal can also be routed
//! through the multisig proposal workflow via `ProposalOperation::RemoveSigner`.
#![cfg(test)]

use super::*;
use crate::types::{
    InitConfig, OptionalProposalOperation, ProposalOperation, ProposalPhase, ProposalPhaseStatus,
    ThresholdStrategy, VelocityConfig, VoteWeight,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

fn init_config(env: &Env, signers: Vec<Address>, threshold: u32) -> InitConfig {
    InitConfig {
        veto_window_ledgers: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1_000_000,
        daily_limit: 5_000_000,
        weekly_limit: 10_000_000,
        timelock_threshold: 0,
        timelock_delay: 0,
        velocity_limit: VelocityConfig {
            limit: 100_000,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        retry_config: crate::types::RetryConfig {
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
    }
}

/// Direct Admin-only `remove_signer` must reject a removal that would drop
/// the signer count below the configured threshold.
#[test]
fn test_direct_remove_signer_rejected_when_it_would_break_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    // 2 signers, threshold 2: removing either signer would leave 1 < 2.
    client.initialize(&admin, &init_config(&env, signers, 2));

    let result = client.try_remove_signer(&admin, &signer1);
    assert_eq!(result, Err(Ok(VaultError::CannotRemoveSigner)));

    // Signer set must be untouched.
    assert!(client.is_signer(&signer1));
}

/// Direct removal that keeps the signer count at or above threshold still
/// succeeds (sanity check the guard isn't overly strict).
#[test]
fn test_direct_remove_signer_allowed_when_threshold_still_met() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    // 3 signers, threshold 2: removing one leaves 2, still meeting threshold.
    client.initialize(&admin, &init_config(&env, signers, 2));

    client.remove_signer(&admin, &signer2);
    assert!(!client.is_signer(&signer2));
}

/// Signer removal routed through the multisig proposal workflow: a single
/// Admin call to `create_multi_phase_proposal` is not enough to remove a
/// signer — it takes `threshold` approvals before `execute_multi_phase_proposal`
/// will apply the `ProposalOperation::RemoveSigner` phase.
#[test]
fn test_remove_signer_via_proposal_operation_requires_multisig_approval() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    client.initialize(&admin, &init_config(&env, signers, 2));

    let mut phases = Vec::new(&env);
    phases.push_back(ProposalPhase {
        operation: ProposalOperation::RemoveSigner(signer2.clone()),
        rollback_operation: OptionalProposalOperation::None,
        status: ProposalPhaseStatus::Pending,
    });

    let proposal_id = client.create_multi_phase_proposal(&admin, &phases);

    // Only one approval so far (the admin's proposer approval is separate from
    // voting) — the base proposal must not yet be Approved, so execution fails.
    let before = client.get_proposal(&proposal_id);
    assert_eq!(before.status, crate::types::ProposalStatus::Pending);
    let premature = client.try_execute_multi_phase_proposal(&admin, &proposal_id);
    assert_eq!(premature, Err(Ok(VaultError::ProposalNotApproved)));
    assert!(client.is_signer(&signer2));

    // Collect threshold approvals.
    client.approve_proposal(&admin, &proposal_id);
    client.approve_proposal(&signer1, &proposal_id);

    let approved = client.get_proposal(&proposal_id);
    assert_eq!(approved.status, crate::types::ProposalStatus::Approved);

    client.execute_multi_phase_proposal(&admin, &proposal_id);

    assert!(!client.is_signer(&signer2));
    let executed = client.get_proposal(&proposal_id);
    assert_eq!(executed.status, crate::types::ProposalStatus::Executed);
}

/// A `ProposalOperation::RemoveSigner` phase that would breach the threshold
/// still fails at execution time, even once the base proposal is approved.
#[test]
fn test_remove_signer_via_proposal_operation_still_enforces_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    // 2 signers, threshold 2: removing either would leave 1 < 2.
    client.initialize(&admin, &init_config(&env, signers, 2));

    let mut phases = Vec::new(&env);
    phases.push_back(ProposalPhase {
        operation: ProposalOperation::RemoveSigner(signer1.clone()),
        rollback_operation: OptionalProposalOperation::None,
        status: ProposalPhaseStatus::Pending,
    });

    let proposal_id = client.create_multi_phase_proposal(&admin, &phases);
    client.approve_proposal(&admin, &proposal_id);
    client.approve_proposal(&signer1, &proposal_id);

    let approved = client.get_proposal(&proposal_id);
    assert_eq!(approved.status, crate::types::ProposalStatus::Approved);

    let result = client.try_execute_multi_phase_proposal(&admin, &proposal_id);
    assert_eq!(result, Err(Ok(VaultError::PhaseExecutionFailed)));
    assert!(client.is_signer(&signer1));

    let rejected = client.get_proposal(&proposal_id);
    assert_eq!(rejected.status, crate::types::ProposalStatus::Rejected);
}
