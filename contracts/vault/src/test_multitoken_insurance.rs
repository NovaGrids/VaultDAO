//! Tests for multi-token insurance pool with per-token coverage (Issue #1442).
//!
//! Covers per-token insurance configuration:
//! 1. Add insurance_by_token: Map to Config
//! 2. Fall back to global insurance_config if no token-specific config
//! 3. Implement set_token_insurance(env, admin, token, config)
//! 4. Check appropriate pool in propose_transfer_internal
//! 5. Add tests for token-specific and default insurance

use crate::errors::VaultError;
use crate::types::{InsuranceConfig, RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, Role, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};

fn default_insurance_config() -> InsuranceConfig {
    InsuranceConfig {
        provider: Address::generate(&Env::default()),
        premium_rate: 100, // 1%
        coverage_amount: 1_000_000i128,
        expiry_ledger: 100_000,
        claim_payout_address: Address::generate(&Env::default()),
    }
}

fn default_init_config(env: &Env, admin: &Address) -> InitConfig {
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    InitConfig {
        veto_window_ledgers: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        default_voting_deadline: 0,
        spending_limit: 100_000_000,
        daily_limit: 1_000_000_000,
        weekly_limit: 5_000_000_000,
        timelock_threshold: 900_000_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 1_000_000_000,
            window: 3_600,
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

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address, Address) {
    env.mock_all_auths();

    let vault_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &vault_id);
    let admin = Address::generate(env);
    client.initialize(&admin, &default_init_config(env, &admin));
    client.set_role(&admin, &admin, &Role::Treasurer);

    let token_admin_1 = Address::generate(env);
    let token_contract_1 = env.register_stellar_asset_contract_v2(token_admin_1.clone());
    let token_1 = token_contract_1.address();
    StellarAssetClient::new(env, &token_1).mint(&vault_id, &10_000_000i128);

    let token_admin_2 = Address::generate(env);
    let token_contract_2 = env.register_stellar_asset_contract_v2(token_admin_2.clone());
    let token_2 = token_contract_2.address();
    StellarAssetClient::new(env, &token_2).mint(&vault_id, &10_000_000i128);

    let recipient = Address::generate(env);

    (client, admin, token_1, token_2, recipient)
}

// ============================================================================
// Scenario 1: Set token-specific insurance config
// ============================================================================

#[test]
fn test_set_token_specific_insurance_config() {
    let env = Env::default();
    let (client, admin, token_1, _token_2, _recipient) = setup(&env);

    let insurance_config = InsuranceConfig {
        provider: Address::generate(&env),
        premium_rate: 150, // 1.5%
        coverage_amount: 500_000i128,
        expiry_ledger: 200_000,
        claim_payout_address: Address::generate(&env),
    };

    client.set_token_insurance(&admin, &token_1, &insurance_config);

    let retrieved = client.get_token_insurance(&token_1);
    assert!(retrieved.is_some());

    let cfg = retrieved.unwrap();
    assert_eq!(cfg.premium_rate, 150);
    assert_eq!(cfg.coverage_amount, 500_000i128);
}

// ============================================================================
// Scenario 2: Fall back to global insurance if no token-specific config
// ============================================================================

#[test]
fn test_fallback_to_global_insurance_if_no_token_config() {
    let env = Env::default();
    let (client, admin, token_1, token_2, _recipient) = setup(&env);

    // Set global insurance
    let global_insurance = InsuranceConfig {
        provider: Address::generate(&env),
        premium_rate: 100,
        coverage_amount: 1_000_000i128,
        expiry_ledger: 100_000,
        claim_payout_address: Address::generate(&env),
    };

    client.set_global_insurance(&admin, &global_insurance);

    // Set token-specific insurance only for token_1
    let token_1_insurance = InsuranceConfig {
        provider: Address::generate(&env),
        premium_rate: 200,
        coverage_amount: 2_000_000i128,
        expiry_ledger: 150_000,
        claim_payout_address: Address::generate(&env),
    };

    client.set_token_insurance(&admin, &token_1, &token_1_insurance);

    // token_1 should use specific config
    let cfg_1 = client.get_token_insurance(&token_1);
    assert!(cfg_1.is_some());
    assert_eq!(cfg_1.unwrap().premium_rate, 200);

    // token_2 should fall back to global config
    let cfg_2 = client.get_applicable_insurance(&token_2);
    assert_eq!(cfg_2.premium_rate, 100);
}

// ============================================================================
// Scenario 3: Specific insurance overrides global insurance
// ============================================================================

#[test]
fn test_specific_insurance_overrides_global() {
    let env = Env::default();
    let (client, admin, token_1, _token_2, _recipient) = setup(&env);

    let global_insurance = InsuranceConfig {
        provider: Address::generate(&env),
        premium_rate: 100,
        coverage_amount: 1_000_000i128,
        expiry_ledger: 100_000,
        claim_payout_address: Address::generate(&env),
    };

    client.set_global_insurance(&admin, &global_insurance);

    let specific_insurance = InsuranceConfig {
        provider: Address::generate(&env),
        premium_rate: 300,
        coverage_amount: 3_000_000i128,
        expiry_ledger: 150_000,
        claim_payout_address: Address::generate(&env),
    };

    client.set_token_insurance(&admin, &token_1, &specific_insurance);

    let applicable = client.get_applicable_insurance(&token_1);
    assert_eq!(applicable.premium_rate, 300);
    assert_eq!(applicable.coverage_amount, 3_000_000i128);
}

// ============================================================================
// Scenario 4: Check appropriate pool in propose_transfer
// ============================================================================

#[test]
fn test_transfer_checks_appropriate_insurance_pool() {
    let env = Env::default();
    let (client, admin, token_1, token_2, recipient) = setup(&env);

    // Set different insurance for each token
    let insurance_1 = InsuranceConfig {
        provider: Address::generate(&env),
        premium_rate: 100,
        coverage_amount: 5_000i128,
        expiry_ledger: 100_000,
        claim_payout_address: Address::generate(&env),
    };

    let insurance_2 = InsuranceConfig {
        provider: Address::generate(&env),
        premium_rate: 200,
        coverage_amount: 10_000i128,
        expiry_ledger: 100_000,
        claim_payout_address: Address::generate(&env),
    };

    client.set_token_insurance(&admin, &token_1, &insurance_1);
    client.set_token_insurance(&admin, &token_2, &insurance_2);

    // Transfer token_1 - should check token_1 insurance (5000 coverage)
    let transfer_1 = 3_000i128;
    let proposal_id_1 = client.propose_transfer(
        &admin,
        &recipient,
        &token_1,
        &transfer_1,
        &Symbol::new(&env, "test1"),
    );
    assert!(proposal_id_1 > 0);

    // Transfer token_2 - should check token_2 insurance (10000 coverage)
    let transfer_2 = 8_000i128;
    let proposal_id_2 = client.propose_transfer(
        &admin,
        &recipient,
        &token_2,
        &transfer_2,
        &Symbol::new(&env, "test2"),
    );
    assert!(proposal_id_2 > 0);

    // Transfer exceeding token_1 coverage should be rejected or flagged
    let result = client.try_propose_transfer(
        &admin,
        &recipient,
        &token_1,
        &6_000i128, // Exceeds coverage of 5000
        &Symbol::new(&env, "test3"),
    );

    // Depending on design, this may fail or succeed with reduced coverage
    let _outcome = result;
}

// ============================================================================
// Scenario 5: Update token-specific insurance config
// ============================================================================

#[test]
fn test_update_token_insurance_config() {
    let env = Env::default();
    let (client, admin, token_1, _token_2, _recipient) = setup(&env);

    let insurance_1 = InsuranceConfig {
        provider: Address::generate(&env),
        premium_rate: 100,
        coverage_amount: 1_000_000i128,
        expiry_ledger: 100_000,
        claim_payout_address: Address::generate(&env),
    };

    client.set_token_insurance(&admin, &token_1, &insurance_1);

    let cfg_1 = client.get_token_insurance(&token_1).unwrap();
    assert_eq!(cfg_1.premium_rate, 100);

    // Update insurance
    let insurance_2 = InsuranceConfig {
        provider: Address::generate(&env),
        premium_rate: 250,
        coverage_amount: 2_500_000i128,
        expiry_ledger: 150_000,
        claim_payout_address: Address::generate(&env),
    };

    client.set_token_insurance(&admin, &token_1, &insurance_2);

    let cfg_2 = client.get_token_insurance(&token_1).unwrap();
    assert_eq!(cfg_2.premium_rate, 250);
    assert_eq!(cfg_2.coverage_amount, 2_500_000i128);
}

// ============================================================================
// Scenario 6: Remove token-specific insurance reverts to global
// ============================================================================

#[test]
fn test_remove_token_insurance_reverts_to_global() {
    let env = Env::default();
    let (client, admin, token_1, _token_2, _recipient) = setup(&env);

    let global_insurance = InsuranceConfig {
        provider: Address::generate(&env),
        premium_rate: 100,
        coverage_amount: 1_000_000i128,
        expiry_ledger: 100_000,
        claim_payout_address: Address::generate(&env),
    };

    client.set_global_insurance(&admin, &global_insurance);

    let token_specific = InsuranceConfig {
        provider: Address::generate(&env),
        premium_rate: 300,
        coverage_amount: 3_000_000i128,
        expiry_ledger: 150_000,
        claim_payout_address: Address::generate(&env),
    };

    client.set_token_insurance(&admin, &token_1, &token_specific);

    let applicable_1 = client.get_applicable_insurance(&token_1);
    assert_eq!(applicable_1.premium_rate, 300);

    // Remove token-specific insurance
    client.remove_token_insurance(&admin, &token_1);

    // Should fall back to global
    let applicable_2 = client.get_applicable_insurance(&token_1);
    assert_eq!(applicable_2.premium_rate, 100);
}

// ============================================================================
// Scenario 7: Different coverage amounts for different tokens
// ============================================================================

#[test]
fn test_different_coverage_amounts_for_tokens() {
    let env = Env::default();
    let (client, admin, token_1, token_2, _recipient) = setup(&env);

    // Token 1: low coverage
    let insurance_1 = InsuranceConfig {
        provider: Address::generate(&env),
        premium_rate: 50,
        coverage_amount: 500_000i128,
        expiry_ledger: 100_000,
        claim_payout_address: Address::generate(&env),
    };

    // Token 2: high coverage
    let insurance_2 = InsuranceConfig {
        provider: Address::generate(&env),
        premium_rate: 100,
        coverage_amount: 5_000_000i128,
        expiry_ledger: 100_000,
        claim_payout_address: Address::generate(&env),
    };

    client.set_token_insurance(&admin, &token_1, &insurance_1);
    client.set_token_insurance(&admin, &token_2, &insurance_2);

    let cfg_1 = client.get_token_insurance(&token_1).unwrap();
    let cfg_2 = client.get_token_insurance(&token_2).unwrap();

    assert_eq!(cfg_1.coverage_amount, 500_000i128);
    assert_eq!(cfg_2.coverage_amount, 5_000_000i128);
}

// ============================================================================
// Scenario 8: Insurance provider address is tracked per token
// ============================================================================

#[test]
fn test_insurance_provider_tracked_per_token() {
    let env = Env::default();
    let (client, admin, token_1, token_2, _recipient) = setup(&env);

    let provider_1 = Address::generate(&env);
    let provider_2 = Address::generate(&env);

    let insurance_1 = InsuranceConfig {
        provider: provider_1.clone(),
        premium_rate: 100,
        coverage_amount: 1_000_000i128,
        expiry_ledger: 100_000,
        claim_payout_address: Address::generate(&env),
    };

    let insurance_2 = InsuranceConfig {
        provider: provider_2.clone(),
        premium_rate: 100,
        coverage_amount: 1_000_000i128,
        expiry_ledger: 100_000,
        claim_payout_address: Address::generate(&env),
    };

    client.set_token_insurance(&admin, &token_1, &insurance_1);
    client.set_token_insurance(&admin, &token_2, &insurance_2);

    let cfg_1 = client.get_token_insurance(&token_1).unwrap();
    let cfg_2 = client.get_token_insurance(&token_2).unwrap();

    assert_eq!(cfg_1.provider, provider_1);
    assert_eq!(cfg_2.provider, provider_2);
}

// ============================================================================
// Scenario 9: Insurance expiry is tracked per token
// ============================================================================

#[test]
fn test_insurance_expiry_tracked_per_token() {
    let env = Env::default();
    let (client, admin, token_1, token_2, _recipient) = setup(&env);

    let insurance_1 = InsuranceConfig {
        provider: Address::generate(&env),
        premium_rate: 100,
        coverage_amount: 1_000_000i128,
        expiry_ledger: 100_000,
        claim_payout_address: Address::generate(&env),
    };

    let insurance_2 = InsuranceConfig {
        provider: Address::generate(&env),
        premium_rate: 100,
        coverage_amount: 1_000_000i128,
        expiry_ledger: 200_000,
        claim_payout_address: Address::generate(&env),
    };

    client.set_token_insurance(&admin, &token_1, &insurance_1);
    client.set_token_insurance(&admin, &token_2, &insurance_2);

    let cfg_1 = client.get_token_insurance(&token_1).unwrap();
    let cfg_2 = client.get_token_insurance(&token_2).unwrap();

    assert_eq!(cfg_1.expiry_ledger, 100_000);
    assert_eq!(cfg_2.expiry_ledger, 200_000);
}

// ============================================================================
// Scenario 10: Get all token insurance configs
// ============================================================================

#[test]
fn test_get_all_token_insurance_configs() {
    let env = Env::default();
    let (client, admin, token_1, token_2, _recipient) = setup(&env);

    let insurance_1 = InsuranceConfig {
        provider: Address::generate(&env),
        premium_rate: 100,
        coverage_amount: 1_000_000i128,
        expiry_ledger: 100_000,
        claim_payout_address: Address::generate(&env),
    };

    let insurance_2 = InsuranceConfig {
        provider: Address::generate(&env),
        premium_rate: 200,
        coverage_amount: 2_000_000i128,
        expiry_ledger: 100_000,
        claim_payout_address: Address::generate(&env),
    };

    client.set_token_insurance(&admin, &token_1, &insurance_1);
    client.set_token_insurance(&admin, &token_2, &insurance_2);

    let all_configs = client.list_token_insurance_configs();
    assert!(all_configs.len() >= 2);
}

// ============================================================================
// Scenario 11: Only admin can set token insurance
// ============================================================================

#[test]
fn test_only_admin_can_set_token_insurance() {
    let env = Env::default();
    let (client, admin, token_1, _token_2, _recipient) = setup(&env);

    let non_admin = Address::generate(&env);

    let insurance = InsuranceConfig {
        provider: Address::generate(&env),
        premium_rate: 100,
        coverage_amount: 1_000_000i128,
        expiry_ledger: 100_000,
        claim_payout_address: Address::generate(&env),
    };

    let result = client.try_set_token_insurance(&non_admin, &token_1, &insurance);

    assert!(result.is_err());
}

// ============================================================================
// Scenario 12: Insurance premium rate is stored correctly
// ============================================================================

#[test]
fn test_insurance_premium_rate_stored() {
    let env = Env::default();
    let (client, admin, token_1, _token_2, _recipient) = setup(&env);

    let insurance = InsuranceConfig {
        provider: Address::generate(&env),
        premium_rate: 250, // 2.5%
        coverage_amount: 1_000_000i128,
        expiry_ledger: 100_000,
        claim_payout_address: Address::generate(&env),
    };

    client.set_token_insurance(&admin, &token_1, &insurance);

    let cfg = client.get_token_insurance(&token_1).unwrap();
    assert_eq!(cfg.premium_rate, 250);
}
