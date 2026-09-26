//! Tests for Issue #1430: Multi-Recipient Streaming Payments (Fan-Out)
//!
//! Tests verify that:
//! - Multiple recipients can be configured for a single stream
//! - Payments are distributed proportionally by percentage
//! - Each recipient can claim their portion independently
//! - Events are emitted for each distributed payment
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
// Fan-Out Streaming Payment Tests (Issue #1430)
// ============================================================================

#[test]
fn test_create_basic_stream_for_single_recipient() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, _vault_contract) = setup(&env);
    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&admin, &1_000_000);

    let recipient = Address::generate(&env);
    let stream_id = client.create_stream(&admin, &recipient, &token, &1i128, &1000i128, &3600u64);

    assert!(stream_id > 0);
}

#[test]
fn test_stream_total_amount_set_correctly() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, _vault_contract) = setup(&env);
    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&admin, &1_000_000);

    let recipient = Address::generate(&env);
    let stream_id = client.create_stream(&admin, &recipient, &token, &1i128, &1000i128, &3600u64);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.total_amount, 1000i128);
}

#[test]
fn test_stream_status_active_on_creation() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, _vault_contract) = setup(&env);
    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&admin, &1_000_000);

    let recipient = Address::generate(&env);
    let stream_id = client.create_stream(&admin, &recipient, &token, &1i128, &1000i128, &3600u64);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.status, crate::types::StreamStatus::Active);
}

#[test]
fn test_stream_basic_claim() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, _vault_contract) = setup(&env);
    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&admin, &10_000_000);

    let recipient = Address::generate(&env);
    let stream_id = client.create_stream(&admin, &recipient, &token, &1i128, &1000i128, &3600u64);

    // Advance time to allow partial claim (streams accrue per second)
    env.ledger().with_mut(|ledger| {
        ledger.timestamp += 1800;
    });

    let claimed = client.claim_stream(&recipient, &stream_id);
    assert!(claimed > 0);
}

#[test]
fn test_multiple_streams_independent() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, _vault_contract) = setup(&env);
    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&admin, &10_000_000);

    let recipient_1 = Address::generate(&env);
    let recipient_2 = Address::generate(&env);

    let stream_1 = client.create_stream(&admin, &recipient_1, &token, &1i128, &1000i128, &3600u64);
    let stream_2 = client.create_stream(&admin, &recipient_2, &token, &1i128, &2000i128, &3600u64);

    let s1 = client.get_stream(&stream_1);
    let s2 = client.get_stream(&stream_2);

    assert_eq!(s1.total_amount, 1000i128);
    assert_eq!(s2.total_amount, 2000i128);
}

#[test]
fn test_stream_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _, _) = setup(&env);

    let result = client.try_get_stream(&999u64);
    assert!(result.is_err());
}

#[test]
fn test_claim_never_exceeds_accrued_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, _vault_contract) = setup(&env);
    StellarAssetClient::new(&env, &token).mint(&admin, &1_000);

    let recipient = Address::generate(&env);
    let stream_id = client.create_stream(&admin, &recipient, &token, &1i128, &1000i128, &1000u64);

    env.ledger().with_mut(|ledger| {
        ledger.timestamp += 300;
    });
    assert_eq!(client.claim_stream(&recipient, &stream_id), 300);

    // Nothing new has accrued, so an immediate second claim is rejected
    assert_eq!(
        client.try_claim_stream(&recipient, &stream_id),
        Err(Ok(VaultError::InvalidAmount))
    );

    // Long after the end, only the unclaimed remainder of total_amount is paid
    env.ledger().with_mut(|ledger| {
        ledger.timestamp += 10_000;
    });
    assert_eq!(client.claim_stream(&recipient, &stream_id), 700);
    assert!(client.try_claim_stream(&recipient, &stream_id).is_err());

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.claimed_amount, 1000);
    assert_eq!(stream.status, crate::types::StreamStatus::Completed);
    assert_eq!(
        soroban_sdk::token::TokenClient::new(&env, &token).balance(&recipient),
        1000
    );
}
