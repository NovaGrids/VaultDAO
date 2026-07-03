//! Audit chain integrity tests

#![cfg(test)]

use super::*;
use crate::types::{
    RetryConfig, ThresholdStrategy, VelocityConfig,
};
use crate::{InitConfig, VaultDAO};
use soroban_sdk::{
    testutils::Address as _,
    Address, Env, Vec,
};

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
        threshold: 1,
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

