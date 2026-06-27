//! Tests for Issue #1081: Multi-Token Vault Support with Per-Token Spending Limits
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
        spending_limit: 50_000,
        daily_limit: 200_000,
        weekly_limit: 1_000_000,
        timelock_threshold: 40_000,
        timelock_delay: 10,
        velocity_limit: VelocityConfig { limit: 100, window: 3600 },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        retry_config: RetryConfig { enabled: false, max_retries: 0, initial_backoff_ledgers: 0 },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: types::StakingConfig::default(),
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
    }
}

// Test 1: Add a supported token
#[test]
fn test_add_supported_token() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    client.add_supported_token(&admin, &usdc, &10_000i128, &50_000i128);

    let supported = client.get_supported_tokens();
    assert_eq!(supported.len(), 1);
    let cfg = supported.get(0).unwrap();
    assert_eq!(cfg.token, usdc);
    assert_eq!(cfg.daily_limit, 10_000i128);
    assert_eq!(cfg.weekly_limit, 50_000i128);
}

// Test 2: Cannot add duplicate token
#[test]
fn test_add_duplicate_token_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    client.add_supported_token(&admin, &token, &10_000i128, &50_000i128);
    let res = client.try_add_supported_token(&admin, &token, &10_000i128, &50_000i128);
    assert_eq!(res.err(), Some(Ok(VaultError::TokenAlreadySupported)));
}

// Test 3: is_token_supported returns correct values
#[test]
fn test_is_token_supported() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_a = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_b = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    client.add_supported_token(&admin, &token_a, &10_000i128, &50_000i128);

    assert!(client.is_token_supported(&token_a));
    assert!(!client.is_token_supported(&token_b));
}

// Test 4: Remove a non-default token
#[test]
fn test_remove_non_default_token() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_a = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_b = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    // Add both tokens — first is default
    client.add_supported_token(&admin, &token_a, &10_000i128, &50_000i128);
    client.add_supported_token(&admin, &token_b, &8_000i128, &40_000i128);

    // Remove second token (non-default)
    client.remove_supported_token(&admin, &token_b);

    assert!(!client.is_token_supported(&token_b));
    assert!(client.is_token_supported(&token_a));
}

// Test 5: Cannot remove default token
#[test]
fn test_cannot_remove_default_token() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_a = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    client.add_supported_token(&admin, &token_a, &10_000i128, &50_000i128);

    let res = client.try_remove_supported_token(&admin, &token_a);
    assert_eq!(res.err(), Some(Ok(VaultError::CannotRemoveDefaultToken)));
}

// Test 6: Cannot add more than 10 tokens
#[test]
fn test_max_token_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    // Add 10 tokens
    for _ in 0..10 {
        let tok = env.register_stellar_asset_contract_v2(admin.clone()).address();
        client.add_supported_token(&admin, &tok, &1_000i128, &5_000i128);
    }

    // 11th should fail
    let extra = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let res = client.try_add_supported_token(&admin, &extra, &1_000i128, &5_000i128);
    assert_eq!(res.err(), Some(Ok(VaultError::TooManyTokens)));
}

// Test 7: Remove token with active recurring payment is blocked
#[test]
fn test_remove_token_with_active_payment_blocked() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_a = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_b = env.register_stellar_asset_contract_v2(admin.clone()).address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token_b).mint(&contract_id, &10_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    // Add both (token_a is default, token_b is second)
    client.add_supported_token(&admin, &token_a, &10_000i128, &50_000i128);
    client.add_supported_token(&admin, &token_b, &8_000i128, &40_000i128);

    // Create recurring payment using token_b
    client.schedule_payment(
        &admin, &recipient, &token_b, &100i128,
        &Symbol::new(&env, "salary"), &1000u64,
    );

    // Attempt to remove token_b — should fail
    let res = client.try_remove_supported_token(&admin, &token_b);
    assert_eq!(res.err(), Some(Ok(VaultError::TokenHasActivePayments)));
}

// Test 8: Non-admin cannot add token
#[test]
fn test_non_admin_cannot_add_token() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());
    client.initialize(&admin, &make_config(&env, signers));
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    let res = client.try_add_supported_token(&treasurer, &token, &1_000i128, &5_000i128);
    assert_eq!(res.err(), Some(Ok(VaultError::Unauthorized)));
}

// Test 9: Removing unsupported token returns error
#[test]
fn test_remove_unsupported_token_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    let res = client.try_remove_supported_token(&admin, &token);
    assert_eq!(res.err(), Some(Ok(VaultError::TokenNotSupported)));
}
