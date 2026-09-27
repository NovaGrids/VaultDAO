//! Tests for Issue #1694: trigger_stream_payment must enforce accrual bounds.
//!
//! ## Vulnerability (before this fix)
//! `trigger_stream_payment` checked only that:
//!  - `caller == stream.recipient`
//!  - stream is Active
//!  - `amount >= 10` (dust threshold)
//!
//! It never compared `amount` against the actually accrued claimable balance
//! (`rate * active_seconds - claimed_amount`), so a recipient could withdraw
//! the entire vault balance instantly — far more than the stream had earned.
//! It also updated `last_update_timestamp` without rolling `accumulated_seconds`
//! first, corrupting subsequent `claim_stream` calls.
//!
//! ## What these tests verify
//! 1. Claiming before any time has elapsed is rejected with `StreamClaimExceedsAccrued`.
//! 2. Claiming more than the current claimable balance is rejected.
//! 3. Claiming more than `total_amount` (the stream's cap) is rejected.
//! 4. Claiming exactly the accrued amount succeeds.
//! 5. After a `trigger_stream_payment`, a subsequent `claim_stream` accrues
//!    correctly (i.e. `accumulated_seconds` was rolled properly).
//! 6. Multiple partial triggers never exceed `total_amount` in aggregate.
//! 7. Claiming the full `total_amount` marks the stream Completed.
//! 8. Mixed interleave of `claim_stream` + `trigger_stream_payment` stays correct.

#![cfg(test)]

use crate::errors::VaultError;
use crate::types::{
    RecoveryConfig, RetryConfig, StakingConfig, StreamStatus, ThresholdStrategy, VelocityConfig,
    VoteWeight,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{Address, Env, Vec};

// ============================================================================
// Constants
// ============================================================================

/// 1 token per second — trivial expected-value arithmetic.
const RATE: i128 = 1;
/// Total stream commitment.
const TOTAL: i128 = 10_000;
/// Stream duration in seconds (longer than any individual test needs).
const DURATION: u64 = 20_000;

// ============================================================================
// Helpers
// ============================================================================

fn make_config(env: &Env, signers: Vec<Address>) -> InitConfig {
    InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1_000_000,
        daily_limit: 10_000_000,
        weekly_limit: 50_000_000,
        timelock_threshold: 0,
        timelock_delay: 0,
        velocity_limit: VelocityConfig {
            limit: 1_000,
            window: 3_600,
            per_token_limit: 0,
        },
        // stream_max_window_amount defaults to 0 → rate-limiter disabled,
        // so it doesn't interfere with the accrual tests.
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
        recovery_config: RecoveryConfig::default(env),
        staking_config: StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
    }
}

/// Set up a vault with a single funded active stream.
///
/// Returns `(client, admin, recipient, token, stream_id)`.
fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address, u64) {
    env.mock_all_auths();
    env.ledger().set_timestamp(0);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let recipient = Address::generate(env);
    let token_admin = Address::generate(env);

    let mut signers: Vec<Address> = Vec::new(env);
    signers.push_back(admin.clone());

    client.initialize(&admin, &make_config(env, signers));

    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    StellarAssetClient::new(env, &token).mint(&admin, &TOTAL);

    let stream_id =
        client.create_stream(&admin, &recipient, &token, &RATE, &TOTAL, &DURATION);

    (client, admin, recipient, token, stream_id)
}

// ============================================================================
// 1. Claim before any time has elapsed → rejected
// ============================================================================

/// At t=0 no seconds have elapsed, so claimable = 0. Any positive claim must
/// be rejected — the old code allowed any amount >= 10 (dust threshold).
#[test]
fn test_trigger_no_accrual_yet_is_rejected() {
    let env = Env::default();
    let (client, _admin, recipient, _token, stream_id) = setup(&env);

    // Still at timestamp 0 — nothing has accrued.
    let result = client.try_trigger_stream_payment(&recipient, &stream_id, &10i128);

    assert_eq!(
        result,
        Err(Ok(VaultError::StreamClaimExceedsAccrued)),
        "claiming before any accrual must return StreamClaimExceedsAccrued"
    );
}

// ============================================================================
// 2. Claim above current claimable → rejected
// ============================================================================

/// After 100 s, claimable = 100. Requesting 101 must be rejected.
#[test]
fn test_trigger_amount_above_claimable_is_rejected() {
    let env = Env::default();
    let (client, _admin, recipient, _token, stream_id) = setup(&env);

    // Advance 100 s → 100 tokens accrued.
    env.ledger().set_timestamp(100);

    let result = client.try_trigger_stream_payment(&recipient, &stream_id, &101i128);

    assert_eq!(
        result,
        Err(Ok(VaultError::StreamClaimExceedsAccrued)),
        "requesting more than accrued must return StreamClaimExceedsAccrued"
    );
}

// ============================================================================
// 3. Claim above total_amount → rejected
// ============================================================================

/// Even after the full duration has elapsed, requesting more than `total_amount`
/// must be rejected.  Previously this drained treasury funds beyond the stream.
#[test]
fn test_trigger_amount_above_total_amount_is_rejected() {
    let env = Env::default();
    let (client, _admin, recipient, _token, stream_id) = setup(&env);

    // Advance past the full duration so all TOTAL tokens have accrued.
    env.ledger().set_timestamp(DURATION + 100);

    let result = client.try_trigger_stream_payment(&recipient, &stream_id, &(TOTAL + 1));

    assert_eq!(
        result,
        Err(Ok(VaultError::StreamClaimExceedsAccrued)),
        "requesting more than total_amount must return StreamClaimExceedsAccrued"
    );
}

// ============================================================================
// 4. Claim exactly the accrued amount → succeeds
// ============================================================================

/// After 500 s, claimable = 500. Requesting exactly 500 must succeed and
/// the stream must remain Active with 500 tokens claimed.
#[test]
fn test_trigger_exact_accrued_amount_succeeds() {
    let env = Env::default();
    let (client, _admin, recipient, _token, stream_id) = setup(&env);

    env.ledger().set_timestamp(500);
    client.trigger_stream_payment(&recipient, &stream_id, &500i128);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.claimed_amount, 500);
    assert_eq!(stream.status, StreamStatus::Active);
}

// ============================================================================
// 5. accumulated_seconds is rolled — claim_stream after trigger is correct
// ============================================================================

/// Trigger 500 at t=500, then advance to t=1000 and call claim_stream.
/// claim_stream should see exactly 500 more accrued (not 1000 from t=0),
/// proving that `accumulated_seconds` was snapshotted at the trigger.
#[test]
fn test_trigger_then_claim_stream_accrues_correctly() {
    let env = Env::default();
    let (client, _admin, recipient, _token, stream_id) = setup(&env);

    // t=500: trigger 500 tokens.
    env.ledger().set_timestamp(500);
    client.trigger_stream_payment(&recipient, &stream_id, &500i128);

    // Verify intermediate state.
    let stream_mid = client.get_stream(&stream_id);
    assert_eq!(stream_mid.accumulated_seconds, 500,
        "accumulated_seconds must be rolled to 500 after trigger");
    assert_eq!(stream_mid.claimed_amount, 500);

    // t=1000: another 500 s have elapsed since the trigger.
    env.ledger().set_timestamp(1000);

    // claim_stream must only credit the 500 tokens from t=500..t=1000.
    let claimed = client.claim_stream(&recipient, &stream_id);
    assert_eq!(
        claimed, 500,
        "claim_stream must only see the 500 s since the last trigger, not 1000 s total"
    );

    let stream_final = client.get_stream(&stream_id);
    assert_eq!(stream_final.claimed_amount, 1000);
}

// ============================================================================
// 6. Multiple partial triggers never exceed total_amount
// ============================================================================

/// Three sequential triggers each claiming 300 tokens at t=300, 600, 900.
/// A fourth request for 300 at t=1000 (when only 100 is left) must be rejected.
#[test]
fn test_multiple_partial_triggers_respect_total_amount() {
    let env = Env::default();
    let (client, _admin, recipient, _token, stream_id) = setup(&env);

    for i in 1u64..=3 {
        env.ledger().set_timestamp(i * 300);
        client.trigger_stream_payment(&recipient, &stream_id, &300i128);
    }

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.claimed_amount, 900);

    // At t=1000 only 100 more have accrued (total 1000 earned − 900 claimed).
    env.ledger().set_timestamp(1000);

    // Requesting 300 (more than 100 available) must be rejected.
    let result = client.try_trigger_stream_payment(&recipient, &stream_id, &300i128);
    assert_eq!(
        result,
        Err(Ok(VaultError::StreamClaimExceedsAccrued)),
        "claiming 300 when only 100 is claimable must be rejected"
    );

    // Requesting exactly 100 must succeed.
    client.trigger_stream_payment(&recipient, &stream_id, &100i128);

    let final_stream = client.get_stream(&stream_id);
    assert_eq!(final_stream.claimed_amount, 1000);
}

// ============================================================================
// 7. Claiming full total_amount marks stream Completed
// ============================================================================

/// After the full duration, a single trigger for `TOTAL` must succeed and
/// transition the stream to `Completed`.
#[test]
fn test_trigger_full_total_marks_stream_completed() {
    let env = Env::default();
    let (client, _admin, recipient, _token, stream_id) = setup(&env);

    env.ledger().set_timestamp(DURATION);
    client.trigger_stream_payment(&recipient, &stream_id, &TOTAL);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.claimed_amount, TOTAL);
    assert_eq!(
        stream.status,
        StreamStatus::Completed,
        "stream must be Completed after claiming the full total_amount"
    );
}

// ============================================================================
// 8. Mixed interleave: claim_stream then trigger_stream_payment
// ============================================================================

/// Use `claim_stream` for the first 300 s, then `trigger_stream_payment` for
/// the next 300 s.  Each call sees only its own accrual window.
#[test]
fn test_claim_stream_then_trigger_interleave_correctly() {
    let env = Env::default();
    let (client, _admin, recipient, _token, stream_id) = setup(&env);

    // t=300: claim_stream takes 300 tokens.
    env.ledger().set_timestamp(300);
    let claimed = client.claim_stream(&recipient, &stream_id);
    assert_eq!(claimed, 300);

    // t=600: only 300 more tokens have accrued since t=300.
    env.ledger().set_timestamp(600);

    // Requesting 301 (one too many) must be rejected.
    let over = client.try_trigger_stream_payment(&recipient, &stream_id, &301i128);
    assert_eq!(
        over,
        Err(Ok(VaultError::StreamClaimExceedsAccrued)),
        "trigger must see only the 300 tokens accrued since claim_stream, not 301"
    );

    // Requesting exactly 300 must succeed.
    client.trigger_stream_payment(&recipient, &stream_id, &300i128);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.claimed_amount, 600);
    assert_eq!(stream.status, StreamStatus::Active);
}
