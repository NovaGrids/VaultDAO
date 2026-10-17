//! Tests for Issue #1935: `initiate_recovery` validates the proposed signer set.
//!
//! Duplicate addresses and oversized lists are rejected with the same checks
//! that `update_config_signers` uses, so the recovered vault always has a
//! reachable threshold of distinct approvers.

use crate::errors::VaultError;
use crate::types::{
    InitConfig, RecoveryConfig, RetryConfig, StakingConfig, ThresholdStrategy, VelocityConfig,
    VoteWeight,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

// ---------------------------------------------------------------------------
// Shared setup helper
// ---------------------------------------------------------------------------

fn setup<'a>() -> (Env, VaultDAOClient<'a>, Address) {
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
            recovery_ttl_ledgers: 0,
        },
        staking_config: StakingConfig::default(),
    };

    client.initialize(&admin, &config);

    (env, client, guardian)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_initiate_rejects_all_duplicate_signers() {
    let (env, client, guardian) = setup();
    let a = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(a.clone());
    signers.push_back(a.clone());
    signers.push_back(a.clone());

    // Without the duplicate check this would yield a vault that can never
    // reach threshold 3 with distinct approvers.
    let result = client.try_initiate_recovery(&guardian, &signers, &3);
    assert_eq!(result, Err(Ok(VaultError::SignerAlreadyExists)));
}

#[test]
fn test_initiate_rejects_duplicate_among_distinct_signers() {
    let (env, client, guardian) = setup();
    let a = Address::generate(&env);
    let b = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(a.clone());
    signers.push_back(b.clone());
    signers.push_back(a.clone());

    let result = client.try_initiate_recovery(&guardian, &signers, &2);
    assert_eq!(result, Err(Ok(VaultError::SignerAlreadyExists)));
}

#[test]
fn test_initiate_rejects_oversized_signer_set() {
    let (env, client, guardian) = setup();

    let mut signers = Vec::new(&env);
    for _ in 0..=crate::MAX_SIGNERS {
        signers.push_back(Address::generate(&env));
    }

    let result = client.try_initiate_recovery(&guardian, &signers, &1);
    assert_eq!(result, Err(Ok(VaultError::TooManySigners)));
}

#[test]
fn test_initiate_accepts_signer_set_at_maximum_size() {
    let (env, client, guardian) = setup();

    let mut signers = Vec::new(&env);
    for _ in 0..crate::MAX_SIGNERS {
        signers.push_back(Address::generate(&env));
    }

    let result = client.try_initiate_recovery(&guardian, &signers, &1);
    assert!(matches!(result, Ok(Ok(_))));
}

#[test]
fn test_initiate_rejects_empty_signer_set() {
    let (env, client, guardian) = setup();

    let signers: Vec<Address> = Vec::new(&env);

    let result = client.try_initiate_recovery(&guardian, &signers, &1);
    assert_eq!(result, Err(Ok(VaultError::NoSigners)));
}
