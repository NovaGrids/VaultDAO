//! Tests for Issue #1523: Enforce Minimum Threshold of 2 at Vault Initialization
//!
//! `threshold = 1` reduces the vault to a single-signer wallet — any one
//! compromised key can drain it. `initialize` must reject that with
//! `VaultError::ThresholdTooLow`.
#![cfg(test)]

use super::*;
use crate::types::{InitConfig, ThresholdStrategy, VelocityConfig, VoteWeight};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

fn config_with_threshold(env: &Env, signers: Vec<Address>, threshold: u32) -> InitConfig {
    InitConfig {
        veto_window_ledgers: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1_000_000,
        daily_limit: 5_000_000,
        weekly_limit: 10_000_000,
        timelock_threshold: 0,
        timelock_delay: 0,
        velocity_limit: VelocityConfig {
            limit: 100_000,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        retry_config: crate::types::RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
    }
}

#[test]
fn test_single_signer_threshold_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = config_with_threshold(&env, signers, 1);

    let result = client.try_initialize(&admin, &config);
    assert_eq!(result, Err(Ok(VaultError::ThresholdTooLow)));
}

#[test]
fn test_threshold_of_two_is_accepted() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = config_with_threshold(&env, signers, 2);

    let result = client.try_initialize(&admin, &config);
    assert!(result.is_ok());
}
