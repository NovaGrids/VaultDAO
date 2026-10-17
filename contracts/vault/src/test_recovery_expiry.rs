//! Tests for Issue #1933: recovery proposals must expire.
//!
//! A recovery proposal stays live for `recovery_ttl_ledgers` ledgers after it
//! is created. Past that point approve and execute are rejected with
//! `ProposalExpired`, and the getter reports the status as `Expired`.

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
fn test_approve_after_expiry_is_rejected() {
    let (env, client, guardian) = setup(10);

    let proposal_id = client.initiate_recovery(&guardian, &new_signers(&env), &1);

    // expires_at = 0 + 10, so ledger 11 is past expiry.
    env.ledger().set_sequence_number(11);

    let result = client.try_approve_recovery(&guardian, &proposal_id);
    assert_eq!(result, Err(Ok(VaultError::ProposalExpired)));
}

#[test]
fn test_execute_after_expiry_is_rejected() {
    let (env, client, guardian) = setup(10);

    let proposal_id = client.initiate_recovery(&guardian, &new_signers(&env), &1);

    // Approve while still live; the threshold of 1 moves it to Approved.
    env.ledger().set_sequence_number(5);
    client.approve_recovery(&guardian, &proposal_id);

    env.ledger().set_sequence_number(11);

    let result = client.try_execute_recovery(&proposal_id);
    assert_eq!(result, Err(Ok(VaultError::ProposalExpired)));
}

#[test]
fn test_expired_proposal_reports_expired_status() {
    let (env, client, guardian) = setup(10);

    let proposal_id = client.initiate_recovery(&guardian, &new_signers(&env), &1);

    env.ledger().set_sequence_number(11);

    let proposal = client.get_recovery_proposal(&proposal_id);
    assert_eq!(proposal.status, RecoveryStatus::Expired);
}

#[test]
fn test_approve_on_expiry_ledger_is_allowed() {
    let (env, client, guardian) = setup(10);

    let proposal_id = client.initiate_recovery(&guardian, &new_signers(&env), &1);

    // expires_at is inclusive: the last live ledger is 10.
    env.ledger().set_sequence_number(10);

    client.approve_recovery(&guardian, &proposal_id);

    let proposal = client.get_recovery_proposal(&proposal_id);
    assert_eq!(proposal.status, RecoveryStatus::Approved);
}

#[test]
fn test_zero_ttl_never_expires() {
    let (env, client, guardian) = setup(0);

    let proposal_id = client.initiate_recovery(&guardian, &new_signers(&env), &1);

    env.ledger().set_sequence_number(1_000_000);

    client.approve_recovery(&guardian, &proposal_id);

    let proposal = client.get_recovery_proposal(&proposal_id);
    assert_eq!(proposal.status, RecoveryStatus::Approved);
}
