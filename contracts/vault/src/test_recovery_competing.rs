//! Tests for Issue #1934: competing recovery proposals.
//!
//! While one recovery is Pending or Approved, `initiate_recovery` is rejected.
//! Executing a recovery cancels every other open proposal so a stale one
//! cannot later overwrite a newer signer set.

use crate::errors::VaultError;
use crate::types::{
    InitConfig, RecoveryConfig, RecoveryStatus, RetryConfig, StakingConfig, ThresholdStrategy,
    VelocityConfig, VoteWeight,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, Env, Vec};

// ---------------------------------------------------------------------------
// Shared setup helper
// ---------------------------------------------------------------------------

fn setup<'a>(ttl_ledgers: u64) -> (Env, VaultDAOClient<'a>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer = Address::generate(&env);
    let guardian = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    let mut guardians = Vec::new(&env);
    guardians.push_back(guardian.clone());

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
            guardians,
            threshold: 1,
            delay: 0,
            recovery_ttl_ledgers: ttl_ledgers,
        },
        staking_config: StakingConfig::default(),
    };

    client.initialize(&admin, &config);

    (env, client, guardian)
}

fn new_signers(env: &Env) -> Vec<Address> {
    let mut signers = Vec::new(env);
    signers.push_back(Address::generate(env));
    signers
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_initiate_rejected_while_recovery_pending() {
    let (env, client, guardian) = setup(0);

    client.initiate_recovery(&guardian, &new_signers(&env), &1);

    let result = client.try_initiate_recovery(&guardian, &new_signers(&env), &1);
    assert_eq!(result, Err(Ok(VaultError::RecoveryAlreadyActive)));
}

#[test]
fn test_initiate_rejected_while_recovery_approved() {
    let (env, client, guardian) = setup(0);

    let proposal_id = client.initiate_recovery(&guardian, &new_signers(&env), &1);
    client.approve_recovery(&guardian, &proposal_id);

    let result = client.try_initiate_recovery(&guardian, &new_signers(&env), &1);
    assert_eq!(result, Err(Ok(VaultError::RecoveryAlreadyActive)));
}

#[test]
fn test_initiate_allowed_after_recovery_executed() {
    let (env, client, guardian) = setup(0);

    let proposal_id = client.initiate_recovery(&guardian, &new_signers(&env), &1);
    client.approve_recovery(&guardian, &proposal_id);
    client.execute_recovery(&proposal_id);

    let next_id = client.initiate_recovery(&guardian, &new_signers(&env), &1);
    assert!(next_id > proposal_id);
}

#[test]
fn test_initiate_allowed_after_recovery_cancelled() {
    let (env, client, guardian) = setup(0);

    let proposal_id = client.initiate_recovery(&guardian, &new_signers(&env), &1);
    client.cancel_recovery(&guardian, &proposal_id);

    let next_id = client.initiate_recovery(&guardian, &new_signers(&env), &1);
    assert!(next_id > proposal_id);
}

#[test]
fn test_initiate_allowed_once_active_recovery_expired() {
    let (env, client, guardian) = setup(10);

    client.initiate_recovery(&guardian, &new_signers(&env), &1);

    // The first proposal expires at ledger 10, which releases the lock.
    env.ledger().set_sequence_number(11);

    let next_id = client.initiate_recovery(&guardian, &new_signers(&env), &1);
    assert_eq!(next_id, 2);
}

#[test]
fn test_executing_one_recovery_cancels_competing_proposal() {
    let (env, client, guardian) = setup(10);

    // Proposal 1 is left Pending and then expires, which releases the lock.
    let stale_id = client.initiate_recovery(&guardian, &new_signers(&env), &1);

    env.ledger().set_sequence_number(11);
    let fresh_id = client.initiate_recovery(&guardian, &new_signers(&env), &1);

    client.approve_recovery(&guardian, &fresh_id);
    client.execute_recovery(&fresh_id);

    // The stale proposal is cancelled by the execution, not left Pending.
    let stale = client.get_recovery_proposal(&stale_id);
    assert_eq!(stale.status, RecoveryStatus::Cancelled);

    let approve_result = client.try_approve_recovery(&guardian, &stale_id);
    assert_eq!(approve_result, Err(Ok(VaultError::ProposalNotPending)));

    let execute_result = client.try_execute_recovery(&stale_id);
    assert_eq!(execute_result, Err(Ok(VaultError::ProposalNotApproved)));
}
