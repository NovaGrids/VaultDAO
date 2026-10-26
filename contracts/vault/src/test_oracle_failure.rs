//! Tests for oracle failure handling (#1931).
//!
//! `get_asset_price` must not abort the caller when the oracle misbehaves.
//! A trapping oracle and a missing price both surface as `VaultError::OracleError`.

use crate::types::{
    RetryConfig, ThresholdStrategy, VaultOracleConfig, VaultPriceData, VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient, VaultError};
use soroban_sdk::{
    contract, contractimpl, testutils::Address as _, token::StellarAssetClient, Address, Env,
    Symbol, Vec,
};

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
        // Threshold floor is 2 (#1523): single-signer vaults are rejected.
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

mod trapping_oracle {
    use super::*;

    /// Oracle whose `lastprice` always traps.
    #[contract]
    pub struct TrappingOracle;

    #[contractimpl]
    impl TrappingOracle {
        pub fn lastprice(_env: Env, _asset: Address) -> Option<VaultPriceData> {
            panic!("oracle is down");
        }
    }
}

mod empty_oracle {
    use super::*;

    /// Oracle that has no price for any asset.
    #[contract]
    pub struct EmptyOracle;

    #[contractimpl]
    impl EmptyOracle {
        pub fn lastprice(_env: Env, _asset: Address) -> Option<VaultPriceData> {
            None
        }
    }
}

use empty_oracle::EmptyOracle;
use trapping_oracle::TrappingOracle;

/// Returns (env, vault client, admin, funded token address).
fn setup_vault(env: &Env) -> (VaultDAOClient<'_>, Address, Address) {
    env.mock_all_auths();
    let vault_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &vault_id);
    let admin = Address::generate(env);
    client.initialize(&admin, &default_init_config(env, &admin));

    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    StellarAssetClient::new(env, &token).mint(&vault_id, &1_000_000i128);

    (client, admin, token)
}

fn configure_oracle(
    client: &VaultDAOClient<'_>,
    env: &Env,
    admin: &Address,
    oracle: Address,
) {
    client.set_oracle_config(
        admin,
        &VaultOracleConfig {
            address: oracle,
            base_symbol: Symbol::new(env, "USD"),
            max_staleness: 1_000,
        },
    );
}

#[test]
fn test_trapping_oracle_returns_oracle_error() {
    let env = Env::default();
    let (client, admin, token) = setup_vault(&env);
    let oracle = env.register(TrappingOracle, ());
    configure_oracle(&client, &env, &admin, oracle);

    let mut assets = Vec::new(&env);
    assets.push_back(token);

    let result = client.try_get_portfolio_valuation(&assets);
    assert_eq!(result, Err(Ok(VaultError::OracleError)));
}

#[test]
fn test_missing_price_returns_oracle_error() {
    let env = Env::default();
    let (client, admin, token) = setup_vault(&env);
    let oracle = env.register(EmptyOracle, ());
    configure_oracle(&client, &env, &admin, oracle);

    let mut assets = Vec::new(&env);
    assets.push_back(token);

    let result = client.try_get_portfolio_valuation(&assets);
    assert_eq!(result, Err(Ok(VaultError::OracleError)));
}
