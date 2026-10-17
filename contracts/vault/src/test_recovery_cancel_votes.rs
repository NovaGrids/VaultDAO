//! Tests for Issue #1936: cancel votes are tracked apart from approvals.
//!
//! Cancelling an Approved recovery needs `threshold` distinct cancel votes.
//! Any guardian may cast one, including a guardian who approved. The proposal
//! only moves to Cancelled when the threshold is reached.

use crate::errors::VaultError;
use crate::types::{
    InitConfig, RecoveryConfig, RecoveryStatus, RetryConfig, StakingConfig, ThresholdStrategy,
    VelocityConfig, VoteWeight,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

// ---------------------------------------------------------------------------
// Shared setup helper
// ---------------------------------------------------------------------------

/// Vault with three guardians and a recovery threshold of two.
fn setup<'a>() -> (Env, VaultDAOClient<'a>, [Address; 3]) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer = Address::generate(&env);
    let guardians = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    let mut guardian_list = Vec::new(&env);
    for g in guardians.iter() {
        guardian_list.push_back(g.clone());
    }

    let config = InitConfig {
        signers,
        threshold: 2,
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
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        proposal_id_prefix: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
            max_retry_delay: 0,
        },
        recovery_config: RecoveryConfig {
            guardians: guardian_list,
            threshold: 2,
            delay: 0,
            recovery_ttl_ledgers: 0,
        },
        staking_config: StakingConfig::default(),
    };

    client.initialize(&admin, &config);

    (env, client, guardians)
}

fn new_signers(env: &Env) -> Vec<Address> {
    let mut signers = Vec::new(env);
    signers.push_back(Address::generate(env));
    signers
}

/// Initiate a recovery and approve it with the first two guardians, which
/// reaches the threshold of two and leaves the proposal Approved.
fn approved_recovery(env: &Env, client: &VaultDAOClient, guardians: &[Address; 3]) -> u64 {
    let proposal_id = client.initiate_recovery(&guardians[0], &new_signers(env), &1);
    client.approve_recovery(&guardians[0], &proposal_id);
    client.approve_recovery(&guardians[1], &proposal_id);
    proposal_id
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_approver_can_cancel_approved_recovery() {
    let (env, client, guardians) = setup();
    let proposal_id = approved_recovery(&env, &client, &guardians);

    // guardians[0] approved, and approvals no longer block its cancel vote.
    client.cancel_recovery(&guardians[0], &proposal_id);

    let proposal = client.get_recovery_proposal(&proposal_id);
    assert_eq!(proposal.status, RecoveryStatus::Approved);
    assert_eq!(proposal.cancel_votes.len(), 1);
    assert_eq!(proposal.approvals.len(), 2);
}

#[test]
fn test_partial_cancel_vote_leaves_recovery_executable() {
    let (env, client, guardians) = setup();
    let proposal_id = approved_recovery(&env, &client, &guardians);

    client.cancel_recovery(&guardians[2], &proposal_id);

    // One cancel vote is below the threshold of two, so execution still works.
    let proposal = client.get_recovery_proposal(&proposal_id);
    assert_eq!(proposal.status, RecoveryStatus::Approved);

    client.execute_recovery(&proposal_id);
    let executed = client.get_recovery_proposal(&proposal_id);
    assert_eq!(executed.status, RecoveryStatus::Executed);
}

#[test]
fn test_final_cancel_vote_cancels_approved_recovery() {
    let (env, client, guardians) = setup();
    let proposal_id = approved_recovery(&env, &client, &guardians);

    client.cancel_recovery(&guardians[1], &proposal_id);
    client.cancel_recovery(&guardians[2], &proposal_id);

    let proposal = client.get_recovery_proposal(&proposal_id);
    assert_eq!(proposal.status, RecoveryStatus::Cancelled);

    // A cancelled recovery can no longer be executed.
    let result = client.try_execute_recovery(&proposal_id);
    assert_eq!(result, Err(Ok(VaultError::ProposalNotApproved)));
}

#[test]
fn test_guardian_cannot_cast_cancel_vote_twice() {
    let (env, client, guardians) = setup();
    let proposal_id = approved_recovery(&env, &client, &guardians);

    client.cancel_recovery(&guardians[2], &proposal_id);

    let result = client.try_cancel_recovery(&guardians[2], &proposal_id);
    assert_eq!(result, Err(Ok(VaultError::AlreadyCancelVoted)));

    // The duplicate vote must not have counted toward the threshold.
    let proposal = client.get_recovery_proposal(&proposal_id);
    assert_eq!(proposal.status, RecoveryStatus::Approved);
}
