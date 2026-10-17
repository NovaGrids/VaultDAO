//! Issue #1904: `set_time_weighted_config` must reject configurations that would
//! make locks fail, pay out negative amounts, or strand existing locks.

use crate::errors::VaultError;
use crate::types::{InitConfig, RetryConfig, ThresholdStrategy, TimeWeightedConfig, VelocityConfig};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Vec,
};

const LOCK_DURATION: u64 = 30 * 17_280;

fn init_config(env: &Env, signers: Vec<Address>) -> InitConfig {
    InitConfig {
        signers,
        threshold: 2,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1_000_000,
        daily_limit: 5_000_000,
        weekly_limit: 10_000_000,
        timelock_threshold: 1_000_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 10_000_000,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        veto_window_ledgers: 0,
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
            max_retry_delay: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 100,
        admin_rotation_delay: 1440,
    }
}

/// Vault with a supported governance token and time-weighted locks enabled.
fn setup(env: &Env) -> (VaultDAOClient<'static>, Address, Address) {
    env.ledger().set_sequence_number(100);
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(Address::generate(env));
    client.initialize(&admin, &init_config(env, signers));

    let gov_token = env
        .register_stellar_asset_contract_v2(Address::generate(env))
        .address();
    client.add_supported_token(&admin, &gov_token, &1_000_000, &5_000_000);
    client.set_time_weighted_config(
        &admin,
        &TimeWeightedConfig {
            enabled: true,
            governance_token: Some(gov_token.clone()),
            ..TimeWeightedConfig::default()
        },
    );
    (client, admin, gov_token)
}

fn valid_config(gov_token: &Address) -> TimeWeightedConfig {
    TimeWeightedConfig {
        enabled: true,
        governance_token: Some(gov_token.clone()),
        ..TimeWeightedConfig::default()
    }
}

#[test]
fn test_penalty_above_100_percent_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, gov_token) = setup(&env);

    let mut config = valid_config(&gov_token);
    config.early_unlock_penalty_bps = 10_001;
    assert_eq!(
        client.try_set_time_weighted_config(&admin, &config),
        Err(Ok(VaultError::InvalidAmount))
    );

    // Exactly 100% is allowed: the owner receives nothing back on early unlock
    config.early_unlock_penalty_bps = 10_000;
    assert_eq!(client.try_set_time_weighted_config(&admin, &config), Ok(Ok(())));
}

#[test]
fn test_min_duration_above_max_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, gov_token) = setup(&env);

    let mut config = valid_config(&gov_token);
    config.min_lock_duration = 100;
    config.max_lock_duration = 99;
    assert_eq!(
        client.try_set_time_weighted_config(&admin, &config),
        Err(Ok(VaultError::InvalidAmount))
    );
}

#[test]
fn test_zero_durations_are_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, gov_token) = setup(&env);

    let mut config = valid_config(&gov_token);
    config.min_lock_duration = 0;
    assert_eq!(
        client.try_set_time_weighted_config(&admin, &config),
        Err(Ok(VaultError::InvalidAmount))
    );

    let mut config = valid_config(&gov_token);
    config.max_lock_duration = 0;
    assert_eq!(
        client.try_set_time_weighted_config(&admin, &config),
        Err(Ok(VaultError::InvalidAmount))
    );
}

#[test]
fn test_enabling_without_governance_token_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _gov_token) = setup(&env);

    let config = TimeWeightedConfig {
        enabled: true,
        governance_token: None,
        ..TimeWeightedConfig::default()
    };
    assert_eq!(
        client.try_set_time_weighted_config(&admin, &config),
        Err(Ok(VaultError::TokenNotSupported))
    );
}

#[test]
fn test_disabled_config_without_governance_token_is_accepted() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _gov_token) = setup(&env);

    // Disabling without a governance token is fine once no locks are active
    let config = TimeWeightedConfig {
        enabled: false,
        governance_token: None,
        ..TimeWeightedConfig::default()
    };
    assert_eq!(client.try_set_time_weighted_config(&admin, &config), Ok(Ok(())));
}

#[test]
fn test_disabling_is_rejected_while_locks_are_active() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, gov_token) = setup(&env);

    let owner = Address::generate(&env);
    StellarAssetClient::new(&env, &gov_token).mint(&owner, &1_000);
    client.lock_tokens(&owner, &gov_token, &1_000, &LOCK_DURATION);

    // Disabling would block unlock_tokens and unlock_early, stranding the lock
    let disabled = TimeWeightedConfig {
        enabled: false,
        governance_token: Some(gov_token.clone()),
        ..TimeWeightedConfig::default()
    };
    assert_eq!(
        client.try_set_time_weighted_config(&admin, &disabled),
        Err(Ok(VaultError::LockAlreadyActive))
    );

    // Once the lock is withdrawn, disabling is allowed
    env.ledger().set_sequence_number(100 + LOCK_DURATION as u32);
    assert_eq!(client.unlock_tokens(&owner), 1_000);
    assert_eq!(client.try_set_time_weighted_config(&admin, &disabled), Ok(Ok(())));
}
