//! Tests for Issue #2055: unified streaming invariants across pause, pause
//! TTL policy, clawback and burst caps.
//!
//! 1. Accrued never exceeds `streamed - clawed` (property test).
//! 2. A pause across a long ledger gap mints nothing extra.
//! 3. Pause TTL: AutoResume caps the schedule extension; AutoCancel settles.
//! 4. Clawback never recalls already-withdrawable accrual.
//! 5. Burst excess is rejected with the stable `StreamRateLimitExceeded`, and
//!    burst usage emits `stream_burst_used`.
#![cfg(test)]

use crate::errors::VaultError;
use crate::test_spending_limit_invariants_proptest::setup;
use crate::types::{PauseExpiryAction, Role, StreamPausePolicy, StreamStatus};
use crate::VaultDAOClient;
use proptest::collection::vec as prop_vec;
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Symbol, TryFromVal, Val,
};

const RATE: i128 = 10;
const TOTAL: i128 = 10_000;
const DURATION: u64 = 1_000;

struct Fixture<'a> {
    client: VaultDAOClient<'a>,
    admin: Address,
    recipient: Address,
    token: TokenClient<'a>,
    stream_id: u64,
}

fn fixture(env: &Env) -> Fixture<'_> {
    let (client, admin, token_addr) = setup(env);
    StellarAssetClient::new(env, &token_addr).mint(&admin, &TOTAL);
    let recipient = Address::generate(env);
    let stream_id = client.create_stream(&admin, &recipient, &token_addr, &RATE, &TOTAL, &DURATION);
    Fixture {
        client,
        admin,
        recipient,
        token: TokenClient::new(env, &token_addr),
        stream_id,
    }
}

fn advance(env: &Env, secs: u64) {
    env.ledger().with_mut(|l| l.timestamp += secs);
}

/// Request a clawback as Admin and approve it with two Treasurer votes.
fn clawback(f: &Fixture<'_>, env: &Env, amount: i128) -> Result<(), VaultError> {
    let id = match f.client.try_request_stream_clawback(
        &f.admin,
        &f.stream_id,
        &amount,
        &Symbol::new(env, "recall"),
    ) {
        Ok(Ok(id)) => id,
        Err(Ok(e)) => return Err(e),
        _ => panic!("unexpected clawback request result"),
    };
    for _ in 0..2 {
        let voter = Address::generate(env);
        f.client.set_role(&f.admin, &voter, &Role::Treasurer);
        f.client.vote_clawback(&voter, &id, &true);
    }
    match f.client.try_execute_clawback(&f.admin, &id) {
        Ok(Ok(())) => Ok(()),
        Err(Ok(e)) => Err(e),
        _ => panic!("unexpected clawback result"),
    }
}

fn set_policy(f: &Fixture<'_>, max_pause_secs: u64, action: PauseExpiryAction) {
    f.client.set_stream_pause_policy(
        &f.admin,
        &StreamPausePolicy {
            max_pause_secs,
            action,
        },
    );
}

fn has_event(env: &Env, name: &str) -> bool {
    let wanted = Symbol::new(env, name);
    env.events().all().iter().any(|(_, topics, _)| {
        topics
            .get(0)
            .and_then(|t: Val| Symbol::try_from_val(env, &t).ok())
            .map(|s| s == wanted)
            .unwrap_or(false)
    })
}

// ---------------------------------------------------------------------------
// Pause across ledger gaps
// ---------------------------------------------------------------------------

#[test]
fn test_pause_across_ledger_gap_mints_nothing_extra() {
    let env = Env::default();
    env.mock_all_auths();
    let f = fixture(&env);

    advance(&env, 100);
    f.client.pause_stream(&f.admin, &f.stream_id);

    // A huge gap while paused: nothing accrues.
    advance(&env, 5_000_000);
    let claimed = f.client.claim_stream(&f.recipient, &f.stream_id);
    assert_eq!(claimed, 100 * RATE);

    // Nothing more to claim while still paused.
    assert_eq!(
        f.client.try_claim_stream(&f.recipient, &f.stream_id),
        Err(Ok(VaultError::InvalidAmount))
    );

    // After resuming, the remaining schedule pays out exactly once.
    f.client.resume_stream(&f.admin, &f.stream_id);
    advance(&env, 10_000_000);
    let rest = f.client.claim_stream(&f.recipient, &f.stream_id);
    assert_eq!(claimed + rest, TOTAL);
    assert_eq!(f.token.balance(&f.recipient), TOTAL);
}

#[test]
fn test_claim_during_pause_keeps_pause_extension() {
    let env = Env::default();
    env.mock_all_auths();
    let f = fixture(&env);

    advance(&env, 100);
    let original_end = f.client.get_stream(&f.stream_id).end_timestamp;
    f.client.pause_stream(&f.admin, &f.stream_id);
    advance(&env, 200);
    f.client.claim_stream(&f.recipient, &f.stream_id);
    advance(&env, 100);
    f.client.resume_stream(&f.admin, &f.stream_id);

    // The whole 300 s pause is credited, despite the claim in the middle.
    assert_eq!(f.client.get_stream(&f.stream_id).end_timestamp, original_end + 300);
}

#[test]
fn test_pause_after_schedule_end_earns_no_extension() {
    let env = Env::default();
    env.mock_all_auths();
    let f = fixture(&env);

    advance(&env, DURATION + 50);
    let end = f.client.get_stream(&f.stream_id).end_timestamp;
    f.client.pause_stream(&f.admin, &f.stream_id);
    advance(&env, 1_000);
    f.client.resume_stream(&f.admin, &f.stream_id);

    assert_eq!(f.client.get_stream(&f.stream_id).end_timestamp, end);
    assert_eq!(f.client.claim_stream(&f.recipient, &f.stream_id), TOTAL);
}

// ---------------------------------------------------------------------------
// Pause TTL policy
// ---------------------------------------------------------------------------

#[test]
fn test_auto_resume_caps_schedule_extension() {
    let env = Env::default();
    env.mock_all_auths();
    let f = fixture(&env);
    set_policy(&f, 300, PauseExpiryAction::AutoResume);

    advance(&env, 100);
    let original_end = f.client.get_stream(&f.stream_id).end_timestamp;
    f.client.pause_stream(&f.admin, &f.stream_id);

    // Paused for 1 000 s, but only 300 s are credited; accrual restarted at
    // pause_start + 300, so 700 s of accrual happened since then.
    advance(&env, 1_000);
    let claimed = f.client.claim_stream(&f.recipient, &f.stream_id);
    assert!(has_event(&env, "stream_pause_expired"));
    assert_eq!(claimed, (100 + 700) * RATE);

    let stream = f.client.get_stream(&f.stream_id);
    assert_eq!(stream.status, StreamStatus::Active);
    assert_eq!(stream.end_timestamp, original_end + 300);
    assert_eq!(stream.pause_duration, 300);
}

#[test]
fn test_enforce_auto_resume_is_permissionless() {
    let env = Env::default();
    env.mock_all_auths();
    let f = fixture(&env);
    set_policy(&f, 60, PauseExpiryAction::AutoResume);

    f.client.pause_stream(&f.admin, &f.stream_id);
    assert_eq!(
        f.client.try_enforce_stream_pause_policy(&f.stream_id),
        Err(Ok(VaultError::TimelockNotExpired))
    );
    advance(&env, 61);
    assert_eq!(
        f.client.enforce_stream_pause_policy(&f.stream_id),
        StreamStatus::Active
    );
    assert_eq!(
        f.client.try_enforce_stream_pause_policy(&f.stream_id),
        Err(Ok(VaultError::ProposalNotPending))
    );
}

#[test]
fn test_auto_cancel_settles_and_blocks_resume() {
    let env = Env::default();
    env.mock_all_auths();
    let f = fixture(&env);
    set_policy(&f, 300, PauseExpiryAction::AutoCancel);

    advance(&env, 100);
    f.client.pause_stream(&f.admin, &f.stream_id);
    advance(&env, 301);

    assert_eq!(
        f.client.try_resume_stream(&f.admin, &f.stream_id),
        Err(Ok(VaultError::StreamPauseExpired))
    );

    assert_eq!(
        f.client.enforce_stream_pause_policy(&f.stream_id),
        StreamStatus::Cancelled
    );
    // Recipient got exactly what accrued before the pause; sender the rest.
    assert_eq!(f.token.balance(&f.recipient), 100 * RATE);
    assert_eq!(f.token.balance(&f.admin), TOTAL - 100 * RATE);
    assert_eq!(f.client.get_stream(&f.stream_id).status, StreamStatus::Cancelled);
}

#[test]
fn test_pause_policy_is_admin_only() {
    let env = Env::default();
    env.mock_all_auths();
    let f = fixture(&env);
    let outsider = Address::generate(&env);
    assert_eq!(
        f.client.try_set_stream_pause_policy(
            &outsider,
            &StreamPausePolicy {
                max_pause_secs: 10,
                action: PauseExpiryAction::AutoCancel,
            },
        ),
        Err(Ok(VaultError::Unauthorized))
    );
}

// ---------------------------------------------------------------------------
// Clawback respects withdrawable accrual
// ---------------------------------------------------------------------------

#[test]
fn test_clawback_never_takes_withdrawable_accrual() {
    let env = Env::default();
    env.mock_all_auths();
    let f = fixture(&env);

    advance(&env, 400);
    // Ask for everything: only the unvested 6 000 is recalled.
    clawback(&f, &env, TOTAL).unwrap();
    assert_eq!(f.client.get_stream_clawed_amount(&f.stream_id), TOTAL - 400 * RATE);

    let claimed = f.client.claim_stream(&f.recipient, &f.stream_id);
    assert_eq!(claimed, 400 * RATE);
    let stream = f.client.get_stream(&f.stream_id);
    assert!(stream.claimed_amount <= TOTAL - f.client.get_stream_clawed_amount(&f.stream_id));
}

#[test]
fn test_clawback_during_pause_keeps_pause_clock() {
    let env = Env::default();
    env.mock_all_auths();
    let f = fixture(&env);
    set_policy(&f, 300, PauseExpiryAction::AutoCancel);

    advance(&env, 100);
    f.client.pause_stream(&f.admin, &f.stream_id);
    advance(&env, 200);
    clawback(&f, &env, 1_000).unwrap();
    advance(&env, 101);

    // The clawback did not restart the 300 s pause TTL.
    assert_eq!(
        f.client.try_resume_stream(&f.admin, &f.stream_id),
        Err(Ok(VaultError::StreamPauseExpired))
    );
}

// ---------------------------------------------------------------------------
// Burst caps
// ---------------------------------------------------------------------------

#[test]
fn test_creation_does_not_consume_window() {
    let env = Env::default();
    env.mock_all_auths();
    let f = fixture(&env);
    let window = f.client.get_stream_rate_window(&f.stream_id).unwrap();
    assert_eq!(window.total_streamed_in_window, 0);
}

#[test]
fn test_burst_excess_rejected_with_stable_error() {
    let env = Env::default();
    env.mock_all_auths();
    let f = fixture(&env);
    // Base cap 1 000 per window, burst 1.5x => 1 500 effective.
    f.client.update_stream_rate_config(&f.admin, &1_000i128, &150u32);

    advance(&env, 500); // 5 000 accrued
    f.client.trigger_stream_payment(&f.recipient, &f.stream_id, &1_200);
    assert!(has_event(&env, "stream_burst_used"));

    assert_eq!(
        f.client.try_trigger_stream_payment(&f.recipient, &f.stream_id, &400),
        Err(Ok(VaultError::StreamRateLimitExceeded))
    );
    // claim_stream is capped by the same window.
    assert_eq!(
        f.client.try_claim_stream(&f.recipient, &f.stream_id),
        Err(Ok(VaultError::StreamRateLimitExceeded))
    );

    // Up to the effective cap still goes through.
    f.client.trigger_stream_payment(&f.recipient, &f.stream_id, &300);
    assert_eq!(f.token.balance(&f.recipient), 1_500);

    // A new window resets the budget.
    env.ledger().with_mut(|l| l.sequence_number += 17_280);
    f.client.trigger_stream_payment(&f.recipient, &f.stream_id, &1_000);
    assert_eq!(f.token.balance(&f.recipient), 2_500);
}

// ---------------------------------------------------------------------------
// Property: accrued <= streamed - clawed
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
enum Op {
    Advance(u64),
    Pause,
    Resume,
    Claim,
    Clawback(i128),
    Enforce,
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        3 => (1u64..=400).prop_map(Op::Advance),
        1 => Just(Op::Pause),
        1 => Just(Op::Resume),
        3 => Just(Op::Claim),
        1 => (1i128..=4_000).prop_map(Op::Clawback),
        1 => Just(Op::Enforce),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(32))]

    #[test]
    fn accrued_never_exceeds_streamed_minus_clawed(
        auto_cancel in any::<bool>(),
        max_pause in 0u64..=500,
        ops in prop_vec(op_strategy(), 1..30),
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let f = fixture(&env);
        let action = if auto_cancel { PauseExpiryAction::AutoCancel } else { PauseExpiryAction::AutoResume };
        set_policy(&f, max_pause, action);

        for op in ops {
            match op {
                Op::Advance(s) => advance(&env, s),
                Op::Pause => { let _ = f.client.try_pause_stream(&f.admin, &f.stream_id); }
                Op::Resume => { let _ = f.client.try_resume_stream(&f.admin, &f.stream_id); }
                Op::Claim => { let _ = f.client.try_claim_stream(&f.recipient, &f.stream_id); }
                Op::Clawback(a) => {
                    let s = f.client.get_stream(&f.stream_id);
                    if s.status == StreamStatus::Active || s.status == StreamStatus::Paused {
                        let _ = clawback(&f, &env, a);
                    }
                }
                Op::Enforce => { let _ = f.client.try_enforce_stream_pause_policy(&f.stream_id); }
            }

            let s = f.client.get_stream(&f.stream_id);
            let clawed = f.client.get_stream_clawed_amount(&f.stream_id);
            // Reduced total is exactly original - clawed.
            prop_assert_eq!(s.total_amount, TOTAL - clawed);
            // Paid to recipient never exceeds streamed - clawed.
            prop_assert!(s.claimed_amount <= TOTAL - clawed);
            prop_assert_eq!(f.token.balance(&f.recipient), s.claimed_amount);
            // Tokens are conserved between recipient, sender and vault.
            prop_assert_eq!(
                f.token.balance(&f.recipient) + f.token.balance(&f.admin) + f.token.balance(&f.client.address),
                TOTAL + 1_000_000_000
            );
        }
    }
}
