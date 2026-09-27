//! Issue #1708: swap price-impact math must not trap on zero prices or overflow.

use crate::errors::VaultError;
use crate::mock_oracle::{MockOracle, MockOracleClient};
use crate::types::{InitConfig, RetryConfig, VelocityConfig};
use crate::{compute_swap_price_impact, VaultDAO, VaultDAOClient, VaultOracleConfig};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Symbol, Vec,
};

#[test]
fn test_price_impact_zero_price_out_returns_oracle_error() {
    assert_eq!(
        compute_swap_price_impact(1_000, 100, 0, 990),
        Err(VaultError::OracleError)
    );
}

#[test]
fn test_price_impact_zero_price_in_returns_oracle_error() {
    assert_eq!(
        compute_swap_price_impact(1_000, 0, 100, 990),
        Err(VaultError::OracleError)
    );
}

#[test]
fn test_price_impact_max_amount_returns_overflow() {
    assert_eq!(
        compute_swap_price_impact(i128::MAX, 2, 1, 0),
        Err(VaultError::ArithmeticOverflow)
    );
}

#[test]
fn test_price_impact_max_expected_out_returns_overflow() {
    // expected_amount_out == i128::MAX, so scaling the difference by 10_000 overflows
    assert_eq!(
        compute_swap_price_impact(i128::MAX, 1, 1, 0),
        Err(VaultError::ArithmeticOverflow)
    );
}

#[test]
fn test_price_impact_normal_values() {
    // expected 10_000, received 9_900 => 1% = 100 bps
    assert_eq!(compute_swap_price_impact(10_000, 1, 1, 9_900), Ok(100));
}

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
        threshold_strategy: crate::types::ThresholdStrategy::Fixed,
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

#[test]
fn test_get_asset_price_rejects_non_positive_price() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(Address::generate(&env));
    client.initialize(&admin, &init_config(&env, signers));

    let oracle_id = env.register(MockOracle, ());
    let oracle = MockOracleClient::new(&env, &oracle_id);
    client.set_oracle_config(
        &admin,
        &VaultOracleConfig {
            address: oracle_id.clone(),
            base_symbol: Symbol::new(&env, "USD"),
            max_staleness: 100,
        },
    );
    let asset = Address::generate(&env);

    oracle.set_price(&0, &100);
    assert_eq!(
        client.try_get_asset_price(&asset),
        Err(Ok(VaultError::OracleError))
    );

    oracle.set_price(&-5, &100);
    assert_eq!(
        client.try_get_asset_price(&asset),
        Err(Ok(VaultError::OracleError))
    );

    oracle.set_price(&42, &100);
    assert_eq!(client.get_asset_price(&asset), 42);
}
