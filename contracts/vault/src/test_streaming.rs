//! Unit tests for streaming payment functions.
//!
//! Covers: create_stream, claim_stream, pause_stream, resume_stream, cancel_stream.

use crate::types::{RetryConfig, StreamStatus, VelocityConfig};
use crate::{InitConfig, Role, ThresholdStrategy, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Vec,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn setup(env: &Env) -> (VaultDAOClient<'static>, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let treasurer = Address::generate(env);
    let recipient = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());

    client.initialize(
        &admin,
        &InitConfig {
            signers,
            threshold: 1,
            quorum: 0,
            quorum_percentage: 0,
            spending_limit: 1_000_000_000,
            daily_limit: 10_000_000_000,
            weekly_limit: 50_000_000_000,
            timelock_threshold: 0,
            timelock_delay: 0,
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
            staking_config: crate::types::StakingConfig::default(),
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
        },
    );

    // Grant Treasurer role to treasurer address
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    (client, admin, treasurer, recipient)
}

/// Mint tokens to `to` and return the token address.
fn mint_token(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let sac = StellarAssetClient::new(env, &token);
    sac.mint(to, &amount);
    token
}

// ---------------------------------------------------------------------------
// create_stream
// ---------------------------------------------------------------------------

#[test]
fn test_create_stream_happy_path() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, treasurer, recipient) = setup(&env);

    // 100 tokens at 1 token/sec for 100 seconds
    let rate: i128 = 1_000_0000; // 1 token (7 decimals)
    let duration_secs: u64 = 100;
    let total_amount = rate * duration_secs as i128;

    let token = mint_token(&env, &treasurer, &treasurer, total_amount);

    let stream_id = client.create_stream(
        &treasurer,
        &recipient,
        &token,
        &rate,
        &total_amount,
        &duration_secs,
    );

    assert_eq!(stream_id, 1);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.rate, rate);
    assert_eq!(stream.total_amount, total_amount);
    assert_eq!(stream.claimed_amount, 0);
    assert_eq!(stream.status, StreamStatus::Active);
}

#[test]
#[should_panic]
fn test_create_stream_zero_rate_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, treasurer, recipient) = setup(&env);
    let token = mint_token(&env, &treasurer, &treasurer, 1000);

    // rate = 0 must be rejected
    client.create_stream(&treasurer, &recipient, &token, &0, &1000, &100);
}

#[test]
#[should_panic]
fn test_create_stream_zero_total_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, treasurer, recipient) = setup(&env);
    let token = mint_token(&env, &treasurer, &treasurer, 1000);

    client.create_stream(&treasurer, &recipient, &token, &10, &0, &100);
}

#[test]
#[should_panic]
fn test_create_stream_zero_duration_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, treasurer, recipient) = setup(&env);
    let token = mint_token(&env, &treasurer, &treasurer, 1000);

    client.create_stream(&treasurer, &recipient, &token, &10, &1000, &0);
}

#[test]
#[should_panic]
fn test_create_stream_insufficient_role_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _treasurer, recipient) = setup(&env);
    // `recipient` has Member role — must be rejected
    let token = mint_token(&env, &recipient, &recipient, 1000);

    client.create_stream(&recipient, &recipient, &token, &10, &1000, &100);
}

// ---------------------------------------------------------------------------
// claim_stream
// ---------------------------------------------------------------------------

#[test]
fn test_claim_stream_calculates_correctly() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, treasurer, recipient) = setup(&env);

    let rate: i128 = 10;
    let duration_secs: u64 = 100;
    let total_amount = rate * duration_secs as i128; // 1000

    let token = mint_token(&env, &treasurer, &treasurer, total_amount);

    // Set ledger timestamp to T=0
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let stream_id =
        client.create_stream(&treasurer, &recipient, &token, &rate, &total_amount, &duration_secs);

    // Advance time by 30 seconds
    env.ledger().with_mut(|l| l.timestamp = 1030);

    let claimed = client.claim_stream(&recipient, &stream_id);
    // 30 seconds × 10 tokens/sec = 300
    assert_eq!(claimed, 300);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.claimed_amount, 300);
    assert_eq!(stream.status, StreamStatus::Active);
}

#[test]
#[should_panic]
fn test_claim_stream_zero_elapsed_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, treasurer, recipient) = setup(&env);

    let rate: i128 = 10;
    let total_amount: i128 = 1000;
    let token = mint_token(&env, &treasurer, &treasurer, total_amount);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let stream_id =
        client.create_stream(&treasurer, &recipient, &token, &rate, &total_amount, &100);

    // No time has passed — nothing to claim, must panic
    client.claim_stream(&recipient, &stream_id);
}

#[test]
fn test_claim_stream_caps_at_total_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, treasurer, recipient) = setup(&env);

    let rate: i128 = 10;
    let duration_secs: u64 = 100;
    let total_amount = rate * duration_secs as i128; // 1000

    let token = mint_token(&env, &treasurer, &treasurer, total_amount);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let stream_id =
        client.create_stream(&treasurer, &recipient, &token, &rate, &total_amount, &duration_secs);

    // Advance well past end_timestamp
    env.ledger().with_mut(|l| l.timestamp = 2000);

    let claimed = client.claim_stream(&recipient, &stream_id);
    // Should be capped at total_amount
    assert_eq!(claimed, total_amount);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.status, StreamStatus::Completed);
}

#[test]
#[should_panic]
fn test_claim_stream_wrong_recipient_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, treasurer, recipient) = setup(&env);
    let attacker = Address::generate(&env);

    let token = mint_token(&env, &treasurer, &treasurer, 1000);
    env.ledger().with_mut(|l| l.timestamp = 1000);
    let stream_id = client.create_stream(&treasurer, &recipient, &token, &10, &1000, &100);

    env.ledger().with_mut(|l| l.timestamp = 1050);
    // attacker is not the recipient
    client.claim_stream(&attacker, &stream_id);
}

// ---------------------------------------------------------------------------
// pause_stream / resume_stream
// ---------------------------------------------------------------------------

#[test]
fn test_pause_stream_stops_accumulation() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, treasurer, recipient) = setup(&env);

    let rate: i128 = 10;
    let total_amount: i128 = 1000;
    let token = mint_token(&env, &treasurer, &treasurer, total_amount);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let stream_id =
        client.create_stream(&treasurer, &recipient, &token, &rate, &total_amount, &100);

    // Advance 20 seconds, then pause
    env.ledger().with_mut(|l| l.timestamp = 1020);
    client.pause_stream(&treasurer, &stream_id);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.status, StreamStatus::Paused);
    // 20 seconds accumulated before pause
    assert_eq!(stream.accumulated_seconds, 20);

    // Advance another 30 seconds while paused — should NOT accumulate
    env.ledger().with_mut(|l| l.timestamp = 1050);

    // Claim while paused: only 20 seconds worth = 200 tokens
    let claimed = client.claim_stream(&recipient, &stream_id);
    assert_eq!(claimed, 200);
}

#[test]
fn test_resume_stream_resumes_accumulation() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, treasurer, recipient) = setup(&env);

    let rate: i128 = 10;
    let total_amount: i128 = 1000;
    let token = mint_token(&env, &treasurer, &treasurer, total_amount);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let stream_id =
        client.create_stream(&treasurer, &recipient, &token, &rate, &total_amount, &100);

    // Pause at T=1020 (20 active seconds)
    env.ledger().with_mut(|l| l.timestamp = 1020);
    client.pause_stream(&treasurer, &stream_id);

    // Resume at T=1050 (30 seconds of dead time, not counted)
    env.ledger().with_mut(|l| l.timestamp = 1050);
    client.resume_stream(&treasurer, &stream_id);

    // Advance 10 more active seconds
    env.ledger().with_mut(|l| l.timestamp = 1060);

    // Total active = 20 + 10 = 30 seconds → 300 tokens
    let claimed = client.claim_stream(&recipient, &stream_id);
    assert_eq!(claimed, 300);
}

#[test]
#[should_panic]
fn test_pause_already_paused_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, treasurer, recipient) = setup(&env);
    let token = mint_token(&env, &treasurer, &treasurer, 1000);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let stream_id = client.create_stream(&treasurer, &recipient, &token, &10, &1000, &100);

    client.pause_stream(&treasurer, &stream_id);
    // Second pause must fail
    client.pause_stream(&treasurer, &stream_id);
}

// ---------------------------------------------------------------------------
// cancel_stream
// ---------------------------------------------------------------------------

#[test]
fn test_cancel_stream_returns_unclaimed_to_sender() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, treasurer, recipient) = setup(&env);

    let rate: i128 = 10;
    let total_amount: i128 = 1000;
    let token = mint_token(&env, &treasurer, &treasurer, total_amount);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let stream_id =
        client.create_stream(&treasurer, &recipient, &token, &rate, &total_amount, &100);

    // Advance 30 seconds (300 tokens earned by recipient)
    env.ledger().with_mut(|l| l.timestamp = 1030);

    let refund = client.cancel_stream(&treasurer, &stream_id);
    // 1000 total − 300 earned = 700 refunded
    assert_eq!(refund, 700);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.status, StreamStatus::Cancelled);
}

#[test]
fn test_cancel_stream_at_start_refunds_all() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, treasurer, recipient) = setup(&env);

    let rate: i128 = 10;
    let total_amount: i128 = 1000;
    let token = mint_token(&env, &treasurer, &treasurer, total_amount);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let stream_id =
        client.create_stream(&treasurer, &recipient, &token, &rate, &total_amount, &100);

    // Cancel immediately (no time elapsed)
    let refund = client.cancel_stream(&treasurer, &stream_id);
    assert_eq!(refund, total_amount);
}

#[test]
#[should_panic]
fn test_double_cancel_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, treasurer, recipient) = setup(&env);
    let token = mint_token(&env, &treasurer, &treasurer, 1000);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let stream_id = client.create_stream(&treasurer, &recipient, &token, &10, &1000, &100);

    client.cancel_stream(&treasurer, &stream_id);
    // Second cancel must fail
    client.cancel_stream(&treasurer, &stream_id);
}

#[test]
#[should_panic]
fn test_cancel_stream_unauthorized_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, treasurer, recipient) = setup(&env);
    let token = mint_token(&env, &treasurer, &treasurer, 1000);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let stream_id = client.create_stream(&treasurer, &recipient, &token, &10, &1000, &100);

    // recipient is not the sender and not an Admin
    client.cancel_stream(&recipient, &stream_id);
}

#[test]
#[should_panic]
fn test_claim_after_cancel_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, treasurer, recipient) = setup(&env);

    let rate: i128 = 10;
    let total_amount: i128 = 1000;
    let token = mint_token(&env, &treasurer, &treasurer, total_amount);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    let stream_id =
        client.create_stream(&treasurer, &recipient, &token, &rate, &total_amount, &100);

    env.ledger().with_mut(|l| l.timestamp = 1030);
    client.cancel_stream(&treasurer, &stream_id);

    // Claiming from a cancelled stream must panic
    client.claim_stream(&recipient, &stream_id);
}
