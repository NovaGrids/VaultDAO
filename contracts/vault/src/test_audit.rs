//! Audit chain integrity tests

#![cfg(test)]

use super::*;
use crate::types::{RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

fn make_audit_config(env: &Env, signers: Vec<Address>, threshold: u32) -> InitConfig {
    InitConfig {
        admin_rotation_delay: 1440,
        signers,
        threshold,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
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
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 80,
    }
}

// ============================================================================
// Issue #1087: Audit Trail Compression Tests
// ============================================================================

fn make_checkpoint_config(env: &Env) -> (Address, crate::VaultDAOClient<'_>, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let mut signers = soroban_sdk::Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(Address::generate(env));

    let contract_id = env.register(VaultDAO, ());
    let client = crate::VaultDAOClient::new(env, &contract_id);

    let config = InitConfig {
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
        spending_limit: 100_000_000,
        daily_limit: 500_000_000,
        weekly_limit: 1_000_000_000,
        timelock_threshold: 50_000_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 1000,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: RecoveryConfig::default(env),
        staking_config: StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: soroban_sdk::Vec::new(env),
        post_execution_hooks: soroban_sdk::Vec::new(env),
        veto_addresses: soroban_sdk::Vec::new(env),
    };

    client.initialize(&admin, &config);
    (admin.clone(), client, contract_id)
}

/// Generate N audit entries by repeatedly updating the threshold.
fn generate_audit_entries(client: &crate::VaultDAOClient, admin: &Address, count: u32) {
    for i in 0..count {
        client.update_threshold(admin, &{ i % 10 + 1 });
    }
}

#[test]
fn test_checkpoint_with_nonexistent_id_fails() {
    let env = Env::default();
    let (_, client, _) = make_checkpoint_config(&env);

    // No checkpoint created yet; trying to get checkpoint 1 should fail
    let result = client.try_get_audit_checkpoint(&1u64);
    assert!(
        result.is_err(),
        "Should fail when checkpoint does not exist"
    );
}

// ============================================================================
// Issue #1938: configuration setters write audit entries
// ============================================================================

/// Assert the most recent audit entry matches `expected` and `actor`, and that
/// the chain still verifies from the first entry.
fn assert_latest_audit(client: &crate::VaultDAOClient, expected: AuditAction, actor: &Address) {
    let count = client.get_audit_entry_count();
    let entry = client.get_audit_entry(&count);
    assert_eq!(entry.action, expected);
    assert_eq!(&entry.actor, actor);
    client.verify_audit_chain(&1u64, &count);
}

#[test]
fn test_1938_token_setters_write_audit_entries() {
    let env = Env::default();
    let (admin, client, _) = make_checkpoint_config(&env);
    let token = Address::generate(&env);

    client.add_supported_token(&admin, &token, &1_000, &5_000);
    assert_latest_audit(&client, AuditAction::TokenConfigUpdated, &admin);

    client.set_token_limits(&admin, &token, &2_000, &6_000);
    assert_latest_audit(&client, AuditAction::TokenConfigUpdated, &admin);

    client.remove_supported_token(&admin, &token);
    assert_latest_audit(&client, AuditAction::TokenConfigUpdated, &admin);
}

#[test]
fn test_1938_insurance_and_fee_setters_write_audit_entries() {
    let env = Env::default();
    let (admin, client, _) = make_checkpoint_config(&env);

    client.set_insurance_config(
        &admin,
        &crate::types::InsuranceConfig {
            enabled: true,
            min_amount: 100,
            min_insurance_bps: 100,
            slash_percentage: 50,
        },
    );
    assert_latest_audit(&client, AuditAction::InsuranceConfigUpdated, &admin);

    client.set_fee_structure(
        &admin,
        &crate::types::FeeStructure {
            tiers: Vec::new(&env),
            base_fee_bps: 10,
            reputation_discount_threshold: 0,
            reputation_discount_percentage: 0,
            treasury: Address::generate(&env),
            enabled: true,
        },
    );
    assert_latest_audit(&client, AuditAction::FeeConfigUpdated, &admin);
}

#[test]
fn test_1938_quorum_and_strategy_setters_write_audit_entries() {
    let env = Env::default();
    let (admin, client, _) = make_checkpoint_config(&env);

    client.update_quorum(&admin, &1);
    assert_latest_audit(&client, AuditAction::QuorumUpdated, &admin);

    client.update_voting_strategy(&admin, &crate::types::VotingStrategy::Weighted);
    assert_latest_audit(&client, AuditAction::VotingStrategyUpdated, &admin);

    client.set_threshold_strategy(&admin, &ThresholdStrategy::Percentage(50));
    assert_latest_audit(&client, AuditAction::ThresholdStrategyUpdated, &admin);
}

#[test]
fn test_1938_dex_and_time_weighted_setters_write_audit_entries() {
    let env = Env::default();
    let (admin, client, _) = make_checkpoint_config(&env);

    client.set_dex_config(
        &admin,
        &crate::types::DexConfig {
            enabled_dexs: Vec::new(&env),
            max_slippage_bps: 100,
            max_price_impact_bps: 500,
            min_liquidity: 1_000,
        },
    );
    assert_latest_audit(&client, AuditAction::DexConfigUpdated, &admin);

    client.set_time_weighted_config(
        &admin,
        &crate::types::TimeWeightedConfig {
            enabled: false,
            min_lock_duration: 0,
            max_lock_duration: 0,
            apply_decay: false,
            early_unlock_penalty_bps: 0,
            governance_token: None,
        },
    );
    assert_latest_audit(&client, AuditAction::TimeWeightedConfigUpdated, &admin);
}

#[test]
fn test_1938_permission_and_signer_tier_setters_write_audit_entries() {
    let env = Env::default();
    let (admin, client, _) = make_checkpoint_config(&env);
    let target = Address::generate(&env);

    client.grant_permission(
        &admin,
        &target,
        &crate::types::Permission::ViewMetrics,
        &None,
    );
    assert_latest_audit(&client, AuditAction::PermissionGranted, &admin);

    client.revoke_permission(&admin, &target, &crate::types::Permission::ViewMetrics);
    assert_latest_audit(&client, AuditAction::PermissionRevoked, &admin);

    client.set_signer_tier(&admin, &admin, &crate::types::SignerTier::Principal);
    assert_latest_audit(&client, AuditAction::SignerTierUpdated, &admin);
}

#[test]
fn test_1938_hook_setters_write_audit_entries() {
    let env = Env::default();
    let (admin, client, _) = make_checkpoint_config(&env);
    let hook = Address::generate(&env);

    client.register_pre_hook(&admin, &hook);
    assert_latest_audit(&client, AuditAction::HookRegistered, &admin);

    client.remove_pre_hook(&admin, &hook);
    assert_latest_audit(&client, AuditAction::HookRemoved, &admin);

    client.register_post_hook(&admin, &hook);
    assert_latest_audit(&client, AuditAction::HookRegistered, &admin);

    client.remove_post_hook(&admin, &hook);
    assert_latest_audit(&client, AuditAction::HookRemoved, &admin);
}

#[test]
fn test_1938_keeper_hook_setters_write_audit_entries() {
    let env = Env::default();
    let (admin, client, _) = make_checkpoint_config(&env);
    let keeper = Address::generate(&env);
    let callback = Address::generate(&env);

    client.register_keeper_hook(
        &admin,
        &keeper,
        &crate::types::HookEventType::StreamDue,
        &callback,
        &100,
    );
    assert_latest_audit(&client, AuditAction::KeeperHookRegistered, &admin);

    client.deregister_keeper_hook(
        &admin,
        &keeper,
        &crate::types::HookEventType::StreamDue,
    );
    assert_latest_audit(&client, AuditAction::KeeperHookRemoved, &admin);
}
