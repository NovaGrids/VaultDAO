//! Tests for Issue #1536: Max concurrent streams per recipient cap
//!
//! Validates that proposers cannot bypass per-stream rate limits by creating
//! multiple concurrent streams to the same recipient. Enforces the constraint
//! that the number of concurrent streams to a single recipient cannot exceed
//! a configured maximum.

use crate::errors::VaultError;
use crate::types::{RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, Role, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Vec,
};

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

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address) {
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.initialize(&admin, &default_init_config(env, &admin));
    client.set_role(&admin, &admin, &Role::Treasurer);

    let token_admin = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token_contract.address();
    StellarAssetClient::new(env, &token).mint(&contract_id, &1_000_000);

    let recipient = Address::generate(env);
    (client, admin, token, recipient)
}

// ============================================================================
// Test: Verify that the concurrent streams cap is enforced
// ============================================================================

#[test]
fn test_max_concurrent_streams_to_recipient_enforced() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    // Get the max concurrent streams per recipient config
    let config = client.get_config();
    let max_streams = config.max_concurrent_streams_per_recipient;

    // Create max_streams - 1 streams (should succeed)
    for i in 0..(max_streams - 1) {
        let stream_id = client.create_stream(
            &admin,
            &recipient,
            &token,
            &1_000i128,
            &1_000u64,
            &0u64,
        );
        assert!(stream_id > 0, "Stream {} creation failed", i);
    }

    // Create one more stream (should succeed, reaching the limit)
    let final_stream = client.create_stream(
        &admin,
        &recipient,
        &token,
        &1_000i128,
        &1_000u64,
        &0u64,
    );
    assert!(final_stream > 0);

    // Attempt to create stream beyond the limit (should fail with TooManyStreamsToRecipient)
    let result = client.try_create_stream(
        &admin,
        &recipient,
        &token,
        &1_000i128,
        &1_000u64,
        &0u64,
    );

    assert_eq!(
        result,
        Err(Ok(VaultError::TooManyStreamsToRecipient))
    );
}

// ============================================================================
// Test: Verify that different recipients are not affected by the cap
// ============================================================================

#[test]
fn test_concurrent_streams_limit_per_recipient_only() {
    let env = Env::default();
    let (client, admin, token, _recipient) = setup(&env);

    let config = client.get_config();
    let max_streams = config.max_concurrent_streams_per_recipient;

    // Create max_streams to recipient1 (should all succeed)
    let recipient1 = Address::generate(&env);
    for _i in 0..max_streams {
        let stream_id = client.create_stream(
            &admin,
            &recipient1,
            &token,
            &1_000i128,
            &1_000u64,
            &0u64,
        );
        assert!(stream_id > 0);
    }

    // Create max_streams to recipient2 (should all succeed - different recipient)
    let recipient2 = Address::generate(&env);
    for _i in 0..max_streams {
        let stream_id = client.create_stream(
            &admin,
            &recipient2,
            &token,
            &1_000i128,
            &1_000u64,
            &0u64,
        );
        assert!(stream_id > 0);
    }

    // Verify that we cannot exceed limit for recipient1
    let result = client.try_create_stream(
        &admin,
        &recipient1,
        &token,
        &1_000i128,
        &1_000u64,
        &0u64,
    );
    assert_eq!(
        result,
        Err(Ok(VaultError::TooManyStreamsToRecipient))
    );

    // Verify that we cannot exceed limit for recipient2 either
    let result = client.try_create_stream(
        &admin,
        &recipient2,
        &token,
        &1_000i128,
        &1_000u64,
        &0u64,
    );
    assert_eq!(
        result,
        Err(Ok(VaultError::TooManyStreamsToRecipient))
    );
}

// ============================================================================
// Test: Verify that closing a stream allows creating new ones to same recipient
// ============================================================================

#[test]
fn test_closing_stream_frees_concurrent_slot() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let config = client.get_config();
    let max_streams = config.max_concurrent_streams_per_recipient;

    // Create max_streams streams
    let mut stream_ids = Vec::new(&env);
    for _i in 0..max_streams {
        let stream_id = client.create_stream(
            &admin,
            &recipient,
            &token,
            &1_000i128,
            &1_000u64,
            &0u64,
        );
        stream_ids.push_back(stream_id);
    }

    // Verify we can't create another one
    let result = client.try_create_stream(
        &admin,
        &recipient,
        &token,
        &1_000i128,
        &1_000u64,
        &0u64,
    );
    assert_eq!(
        result,
        Err(Ok(VaultError::TooManyStreamsToRecipient))
    );

    // Close the first stream
    let first_stream_id = stream_ids.get(0).unwrap();
    client.close_stream(&admin, &first_stream_id);

    // Now we should be able to create a new stream
    let new_stream = client.create_stream(
        &admin,
        &recipient,
        &token,
        &1_000i128,
        &1_000u64,
        &0u64,
    );
    assert!(new_stream > 0);
}
