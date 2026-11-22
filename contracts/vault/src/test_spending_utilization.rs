//! Tests for Issue #2133: `get_spending_utilization` and
//! `get_token_spending_utilization`.
//!
//! Values returned by the utilization queries must match the underlying
//! daily/weekly counters after proposals are created, cancelled and executed.

#![cfg(test)]

use crate::types::{ConditionLogic, Priority, RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};

const DAY_SECS: u64 = 86_400;

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let signer = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(env, &token).mint(&contract_id, &10_000_000);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    client.initialize(
        &admin,
        &InitConfig {
            upgrade_timelock_delay: 17_280,
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
            spending_limit: 1_000_000,
            daily_limit: 5_000_000,
            weekly_limit: 10_000_000,
            timelock_threshold: 999_999_999,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 100,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            veto_addresses: Vec::new(env),
            veto_window_ledgers: 0,
            retry_config: RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(env),
            staking_config: crate::types::StakingConfig::default(),
            proposal_id_prefix: 0,
        },
    );

    (client, admin, signer, token)
}

fn propose(client: &VaultDAOClient<'_>, admin: &Address, token: &Address, amount: i128) -> u64 {
    let recipient = Address::generate(&client.env);
    client.propose_transfer(
        admin,
        &recipient,
        token,
        &amount,
        &Symbol::new(&client.env, "pay"),
        &Priority::Normal,
        &Vec::new(&client.env),
        &ConditionLogic::And,
        &0i128,
    )
}

#[test]
fn test_utilization_is_zero_on_fresh_vault() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _signer, token) = setup(&env);

    assert_eq!(client.get_spending_utilization(), (0, 0, 0));
    assert_eq!(client.get_token_spending_utilization(&token), (0, 0));
}

#[test]
fn test_utilization_reflects_reserved_proposal_spend() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(DAY_SECS * 10);
    let (client, admin, _signer, token) = setup(&env);

    let amount: i128 = 25_000;
    propose(&client, &admin, &token, amount);

    let day = env.ledger().timestamp() / DAY_SECS;
    let week = env.ledger().timestamp() / (DAY_SECS * 7);

    // One live proposal slot, plus the daily and weekly reservations.
    assert_eq!(client.get_spending_utilization(), (1, amount, amount));
    assert_eq!(client.get_daily_spent(&day), amount);
    assert_eq!(client.get_weekly_spent(&week), amount);

    assert_eq!(client.get_token_spending_utilization(&token), (amount, amount));
    assert_eq!(client.get_token_daily_spent(&token, &day), amount);
    assert_eq!(client.get_token_weekly_spent(&token, &week), amount);
}

#[test]
fn test_utilization_counts_multiple_live_proposals() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(DAY_SECS * 10);
    let (client, admin, _signer, token) = setup(&env);

    propose(&client, &admin, &token, 10_000);
    propose(&client, &admin, &token, 5_000);

    assert_eq!(client.get_spending_utilization(), (2, 15_000, 15_000));
    assert_eq!(client.get_token_spending_utilization(&token), (15_000, 15_000));
}

#[test]
fn test_utilization_releases_reservation_on_cancel() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(DAY_SECS * 10);
    let (client, admin, _signer, token) = setup(&env);

    let proposal_id = propose(&client, &admin, &token, 25_000);
    client.cancel_proposal(&admin, &proposal_id, &Symbol::new(&env, "stop"));

    assert_eq!(client.get_spending_utilization(), (0, 0, 0));
    assert_eq!(client.get_token_spending_utilization(&token), (0, 0));
}

#[test]
fn test_utilization_after_execution_keeps_spend_but_frees_slot() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(DAY_SECS * 10);
    let (client, admin, signer, token) = setup(&env);

    let amount: i128 = 25_000;
    let proposal_id = propose(&client, &admin, &token, amount);
    client.approve_proposal(&signer, &proposal_id);
    client.approve_proposal(&admin, &proposal_id);
    client.execute_proposal(&admin, &proposal_id);

    // The proposal no longer occupies a slot, but its spend stays counted.
    assert_eq!(client.get_spending_utilization(), (0, amount, amount));
    assert_eq!(client.get_token_spending_utilization(&token), (amount, amount));
}

#[test]
fn test_utilization_separates_tokens() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(DAY_SECS * 10);
    let (client, admin, _signer, token) = setup(&env);

    let other = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    propose(&client, &admin, &token, 4_000);

    // A token that was never spent reports zero, even though the vault is spending.
    assert_eq!(client.get_token_spending_utilization(&other), (0, 0));
    assert_eq!(client.get_token_spending_utilization(&token), (4_000, 4_000));
}
