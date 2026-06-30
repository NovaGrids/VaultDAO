//! Tests for Issue #1064: Streaming Payment Rate Limiter with Burst Allowance
#![cfg(test)]

use super::*;
use crate::types::{RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Env, Symbol, Vec};

fn make_config(env: &Env, signers: Vec<Address>) -> InitConfig {
    InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 10_000,
        daily_limit: 100_000,
        weekly_limit: 500_000,
        timelock_threshold: 9_000,
        timelock_delay: 10,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: types::StakingConfig::default(),
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
    }
}

// Test 1: Normal stream flow within rate limit succeeds
#[test]
fn test_stream_normal_flow_within_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &100_000);
    token_client.mint(&sender, &50_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    // Set rate limit: 10_000 per window, burst 1.5x
    client.update_stream_rate_config(&admin, &10_000i128, &150u32);

    // Create stream: 20_000 total over 200 seconds
    let stream_id = client.create_stream(&sender, &recipient, &token, &20_000i128, &200u64);

    // Claim 5_000 — within the 10_000 limit -> should succeed
    client.trigger_stream_payment(&recipient, &stream_id, &5_000i128);
}

// Test 2: Stream dust payment rejected
#[test]
fn test_stream_dust_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&contract_id, &100_000);
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&sender, &50_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));
    client.update_stream_rate_config(&admin, &10_000i128, &150u32);

    let stream_id = client.create_stream(&sender, &recipient, &token, &20_000i128, &200u64);

    // Claim 5 stroops — below dust threshold
    let res = client.try_trigger_stream_payment(&recipient, &stream_id, &5i128);
    assert_eq!(res.err(), Some(Ok(VaultError::StreamDustRejected)));
}

// Test 3: Burst allowed within burst window
#[test]
fn test_stream_burst_allowed() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&contract_id, &100_000);
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&sender, &50_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    // base: 10_000, burst factor 200 (2x) -> effective cap 20_000
    client.update_stream_rate_config(&admin, &10_000i128, &200u32);

    let stream_id = client.create_stream(&sender, &recipient, &token, &50_000i128, &500u64);

    // Claim 15_000 — above base (10_000) but within burst cap (20_000) -> should succeed
    client.trigger_stream_payment(&recipient, &stream_id, &15_000i128);
}

// Test 4: Burst denied after exhaustion
#[test]
fn test_stream_burst_denied_after_exhaustion() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&contract_id, &100_000);
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&sender, &50_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    // base: 10_000, burst 1.5x -> cap 15_000
    client.update_stream_rate_config(&admin, &10_000i128, &150u32);

    let stream_id = client.create_stream(&sender, &recipient, &token, &50_000i128, &500u64);

    // First claim: 14_000 — within cap -> ok
    client.trigger_stream_payment(&recipient, &stream_id, &14_000i128);

    // Second claim: 2_000 — would exceed cap (14_000 + 2_000 > 15_000)
    let res = client.try_trigger_stream_payment(&recipient, &stream_id, &2_000i128);
    assert_eq!(res.err(), Some(Ok(VaultError::StreamRateLimitExceeded)));
}

// Test 5: Rate limiter disabled when stream_max_window_amount = 0
#[test]
fn test_stream_rate_limit_disabled() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&contract_id, &100_000);
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&sender, &50_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));
    // Rate limit disabled (0)
    client.update_stream_rate_config(&admin, &0i128, &150u32);

    let stream_id = client.create_stream(&sender, &recipient, &token, &30_000i128, &300u64);

    // Claim large amount — no rate check -> should succeed
    client.trigger_stream_payment(&recipient, &stream_id, &20_000i128);
}

// Test 6: Only recipient can trigger stream payment
#[test]
fn test_stream_only_recipient_can_trigger() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let attacker = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&contract_id, &100_000);
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&sender, &50_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));
    client.update_stream_rate_config(&admin, &0i128, &150u32);

    let stream_id = client.create_stream(&sender, &recipient, &token, &10_000i128, &100u64);

    let res = client.try_trigger_stream_payment(&attacker, &stream_id, &500i128);
    assert_eq!(res.err(), Some(Ok(VaultError::Unauthorized)));
}

// Test 7: Admin can update rate config
#[test]
fn test_update_stream_rate_config() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    // Set new rate config
    client.update_stream_rate_config(&admin, &50_000i128, &200u32);

    let config = client.get_config();
    assert_eq!(config.stream_max_window_amount, 50_000i128);
    assert_eq!(config.burst_factor, 200u32);
}
