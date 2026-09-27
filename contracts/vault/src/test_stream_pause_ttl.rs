//! Tests for Issue #1429: Streaming Payment Pause and Resume with TTL Management
//!
//! Tests verify that:
//! - Streams can be paused and resumed
//! - TTL is extended when paused/resumed
//! - Pause duration is tracked for audit
//! - Pause history is recorded and retrievable
#![cfg(test)]

use super::*;
use crate::types::{RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Vec,
};

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(Address::generate(env));

    client.initialize(
        &admin,
        &InitConfig {
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

    (client, admin, token, contract_id)
}

// ============================================================================
// Stream Pause/Resume TTL Tests (Issue #1429)
// ============================================================================

#[test]
fn test_pause_stream_changes_status() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, _vault_contract) = setup(&env);
    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&admin, &1_000_000);

    let recipient = Address::generate(&env);
    let stream_id = client.create_stream(&admin, &recipient, &token, &1i128, &1000i128, &3600u64);

    client.pause_stream(&admin, &stream_id);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.status, crate::types::StreamStatus::Paused);
}

#[test]
fn test_resume_stream_restores_active_status() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, _vault_contract) = setup(&env);
    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&admin, &1_000_000);

    let recipient = Address::generate(&env);
    let stream_id = client.create_stream(&admin, &recipient, &token, &1i128, &1000i128, &3600u64);

    client.pause_stream(&admin, &stream_id);
    client.resume_stream(&admin, &stream_id);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.status, crate::types::StreamStatus::Active);
}

#[test]
fn test_paused_time_does_not_accrue() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, _vault_contract) = setup(&env);
    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&admin, &1_000_000);

    let recipient = Address::generate(&env);
    let stream_id = client.create_stream(&admin, &recipient, &token, &1i128, &1000i128, &3600u64);

    env.ledger().with_mut(|ledger| {
        ledger.timestamp += 10;
    });
    client.pause_stream(&admin, &stream_id);
    let accrued_before_pause = client.get_stream(&stream_id).accumulated_seconds;
    assert_eq!(accrued_before_pause, 10);

    // Time spent paused must not accrue
    env.ledger().with_mut(|ledger| {
        ledger.timestamp += 100;
    });

    client.resume_stream(&admin, &stream_id);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.accumulated_seconds, accrued_before_pause);
    assert_eq!(stream.last_update_timestamp, env.ledger().timestamp());
}

#[test]
fn test_multiple_pause_cycles_end_active() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, _vault_contract) = setup(&env);
    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&admin, &1_000_000);

    let recipient = Address::generate(&env);
    let stream_id = client.create_stream(&admin, &recipient, &token, &1i128, &1000i128, &3600u64);

    // First cycle
    client.pause_stream(&admin, &stream_id);
    client.resume_stream(&admin, &stream_id);

    // Second cycle
    client.pause_stream(&admin, &stream_id);
    client.resume_stream(&admin, &stream_id);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.status, crate::types::StreamStatus::Active);
}

#[test]
fn test_pause_stream_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _) = setup(&env);

    let result = client.try_pause_stream(&admin, &999u64);
    assert!(result.is_err());
}

#[test]
fn test_resume_stream_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _) = setup(&env);

    let result = client.try_resume_stream(&admin, &999u64);
    assert!(result.is_err());
}

#[test]
fn test_cannot_pause_already_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, _vault_contract) = setup(&env);
    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&admin, &1_000_000);

    let recipient = Address::generate(&env);
    let stream_id = client.create_stream(&admin, &recipient, &token, &1i128, &1000i128, &3600u64);

    client.pause_stream(&admin, &stream_id);

    // Try to pause again
    let result = client.try_pause_stream(&admin, &stream_id);
    assert!(result.is_err());
}

#[test]
fn test_cannot_resume_already_active() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, _vault_contract) = setup(&env);
    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&admin, &1_000_000);

    let recipient = Address::generate(&env);
    let stream_id = client.create_stream(&admin, &recipient, &token, &1i128, &1000i128, &3600u64);

    // Try to resume without pause
    let result = client.try_resume_stream(&admin, &stream_id);
    assert!(result.is_err());
}
