use crate::errors::VaultError;
use crate::types::{RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{storage, InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Symbol, Vec};

const GLOBAL_MIN_INTERVAL: u64 = 720;

fn default_init_config(env: &Env, admin: &Address) -> InitConfig {
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(Address::generate(env));

    InitConfig {
        upgrade_timelock_delay: 17_280,
        veto_window_ledgers: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 2,
        quorum: 0,
        quorum_percentage: 0,
        default_voting_deadline: 0,
        spending_limit: 1000,
        daily_limit: 50000,
        weekly_limit: 100000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        veto_addresses: Vec::new(env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
        proposal_id_prefix: 0,
    }
}

/// Returns (client, admin, token_a, token_b). Both tokens are supported.
fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address) {
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.initialize(&admin, &default_init_config(env, &admin));

    let token_admin = Address::generate(env);
    let token_a = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let token_b = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    StellarAssetClient::new(env, &token_a).mint(&contract_id, &100_000);
    StellarAssetClient::new(env, &token_b).mint(&contract_id, &100_000);
    client.add_supported_token(&admin, &token_a, &1_000_000, &5_000_000);
    client.add_supported_token(&admin, &token_b, &1_000_000, &5_000_000);

    (client, admin, token_a, token_b)
}

/// Install a per-token interval override directly in vault config storage.
fn set_token_override(env: &Env, contract_id: &Address, token: &Address, interval: u64) {
    env.as_contract(contract_id, || {
        let mut config = storage::get_config(env).unwrap();
        config
            .min_interval_per_token
            .set(token.clone(), interval);
        storage::set_config(env, &config);
    });
}

#[test]
fn test_token_override_tightens_minimum_interval() {
    let env = Env::default();
    let (client, admin, token_a, _token_b) = setup(&env);
    let recipient = Address::generate(&env);
    set_token_override(&env, &client.address, &token_a, 1_440);

    // Below the per-token override, even though it clears the global minimum.
    let result = client.try_schedule_payment(
        &admin,
        &recipient,
        &token_a,
        &100i128,
        &Symbol::new(&env, "payroll"),
        &GLOBAL_MIN_INTERVAL,
        &0u32,
        &0u32,
        &0u32,
    );
    assert_eq!(result.err(), Some(Ok(VaultError::IntervalTooShort)));

    // At the override it is accepted.
    let ok = client.try_schedule_payment(
        &admin,
        &recipient,
        &token_a,
        &100i128,
        &Symbol::new(&env, "payroll"),
        &1_440u64,
        &0u32,
        &0u32,
        &0u32,
    );
    assert!(ok.is_ok());
}

#[test]
fn test_override_is_scoped_to_its_token() {
    let env = Env::default();
    let (client, admin, token_a, token_b) = setup(&env);
    let recipient = Address::generate(&env);
    set_token_override(&env, &client.address, &token_a, 1_440);

    // token_b has no override, so the global minimum applies.
    let result = client.try_schedule_payment(
        &admin,
        &recipient,
        &token_b,
        &100i128,
        &Symbol::new(&env, "payroll"),
        &GLOBAL_MIN_INTERVAL,
        &0u32,
        &0u32,
        &0u32,
    );
    assert!(result.is_ok());
}

#[test]
fn test_global_minimum_still_enforced_without_override() {
    let env = Env::default();
    let (client, admin, token_a, _token_b) = setup(&env);
    let recipient = Address::generate(&env);

    let result = client.try_schedule_payment(
        &admin,
        &recipient,
        &token_a,
        &100i128,
        &Symbol::new(&env, "payroll"),
        &(GLOBAL_MIN_INTERVAL - 1),
        &0u32,
        &0u32,
        &0u32,
    );
    assert_eq!(result.err(), Some(Ok(VaultError::IntervalTooShort)));
}

#[test]
fn test_config_change_rejects_override_below_global_minimum() {
    let env = Env::default();
    let (client, admin, token_a, _token_b) = setup(&env);

    let mut config = env.as_contract(&client.address, || storage::get_config(&env).unwrap());
    config
        .min_interval_per_token
        .set(token_a.clone(), GLOBAL_MIN_INTERVAL - 1);

    let result = client.try_propose_vault_config_change(&admin, &config);
    assert_eq!(result.err(), Some(Ok(VaultError::IntervalTooShort)));
}
