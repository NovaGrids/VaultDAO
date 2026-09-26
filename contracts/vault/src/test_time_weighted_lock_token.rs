//! Issue #1705: time-weighted locks must only accept the governance token.
//!
//! Before the fix `lock_tokens` accepted any token, so an attacker could lock a
//! worthless self-minted token and receive large voting power.

use crate::errors::VaultError;
use crate::types::{
    InitConfig, RetryConfig, ThresholdStrategy, TimeWeightedConfig, VelocityConfig,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Vec};

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

fn new_token(env: &Env) -> Address {
    env.register_stellar_asset_contract_v2(Address::generate(env))
        .address()
}

/// Vault with time-weighted voting enabled for a supported governance token.
fn setup(env: &Env) -> (VaultDAOClient<'static>, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(Address::generate(env));
    client.initialize(&admin, &init_config(env, signers));

    let gov_token = new_token(env);
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

#[test]
fn test_fake_self_minted_token_cannot_be_locked() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _gov_token) = setup(&env);

    let attacker = Address::generate(&env);
    let fake_token = new_token(&env);
    StellarAssetClient::new(&env, &fake_token).mint(&attacker, &i128::MAX);

    let result = client.try_lock_tokens(&attacker, &fake_token, &1_000_000_000, &LOCK_DURATION);
    assert_eq!(result, Err(Ok(VaultError::TokenNotSupported)));
    assert!(client.get_token_lock(&attacker).is_none());
    // Attacker has only the baseline power of an address with no lock
    let baseline = client.get_voting_power(&Address::generate(&env));
    assert_eq!(client.get_voting_power(&attacker), baseline);
}

#[test]
fn test_supported_non_governance_token_cannot_be_locked() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _gov_token) = setup(&env);

    let other = new_token(&env);
    client.add_supported_token(&admin, &other, &1_000_000, &5_000_000);
    let owner = Address::generate(&env);
    StellarAssetClient::new(&env, &other).mint(&owner, &1_000);

    let result = client.try_lock_tokens(&owner, &other, &1_000, &LOCK_DURATION);
    assert_eq!(result, Err(Ok(VaultError::TokenNotSupported)));
}

#[test]
fn test_unsupported_governance_token_cannot_be_locked() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _gov_token) = setup(&env);

    // Governance token pointed at a token the vault does not support
    let unsupported = new_token(&env);
    client.set_time_weighted_config(
        &admin,
        &TimeWeightedConfig {
            enabled: true,
            governance_token: Some(unsupported.clone()),
            ..TimeWeightedConfig::default()
        },
    );
    let owner = Address::generate(&env);
    StellarAssetClient::new(&env, &unsupported).mint(&owner, &1_000);

    let result = client.try_lock_tokens(&owner, &unsupported, &1_000, &LOCK_DURATION);
    assert_eq!(result, Err(Ok(VaultError::TokenNotSupported)));
}

#[test]
fn test_no_governance_token_rejects_all_locks() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, gov_token) = setup(&env);

    client.set_time_weighted_config(
        &admin,
        &TimeWeightedConfig {
            enabled: true,
            ..TimeWeightedConfig::default()
        },
    );
    let owner = Address::generate(&env);
    StellarAssetClient::new(&env, &gov_token).mint(&owner, &1_000);

    let result = client.try_lock_tokens(&owner, &gov_token, &1_000, &LOCK_DURATION);
    assert_eq!(result, Err(Ok(VaultError::TokenNotSupported)));
}

#[test]
fn test_governance_token_lock_grants_voting_power() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, gov_token) = setup(&env);

    let owner = Address::generate(&env);
    StellarAssetClient::new(&env, &gov_token).mint(&owner, &1_000);

    client.lock_tokens(&owner, &gov_token, &1_000, &LOCK_DURATION);

    let lock = client.get_token_lock(&owner).unwrap();
    assert_eq!(lock.token, gov_token);
    let baseline = client.get_voting_power(&Address::generate(&env));
    assert!(client.get_voting_power(&owner) > baseline);
}
