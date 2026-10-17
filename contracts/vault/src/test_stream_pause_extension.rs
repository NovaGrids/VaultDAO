//! Regression tests for Issue #1915: pausing a stream must not cost the
//! recipient the paused time. `resume_stream` should extend `end_timestamp`
//! by the pause length and maintain `pause_duration` and `pause_cycles`.
#![cfg(test)]

use crate::test_spending_limit_invariants_proptest::setup;
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address};

const RATE: i128 = 1;
const DURATION: u64 = 1_000;
const TOTAL: i128 = RATE * DURATION as i128;

#[test]
fn test_pause_for_half_duration_still_vests_full_amount() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    let stream_id = client.create_stream(&admin, &recipient, &token, &RATE, &TOTAL, &DURATION);

    // Accrue half the duration, pause for the other half's worth of time
    env.ledger().with_mut(|li| li.timestamp += 500);
    client.pause_stream(&admin, &stream_id);
    env.ledger().with_mut(|li| li.timestamp += 500);
    client.resume_stream(&admin, &stream_id);

    // Accrue the remaining active half
    env.ledger().with_mut(|li| li.timestamp += 500);

    let claimed = client.claim_stream(&recipient, &stream_id);
    assert_eq!(claimed, TOTAL);
}

#[test]
fn test_resume_extends_end_timestamp_by_pause_length() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    let stream_id = client.create_stream(&admin, &recipient, &token, &RATE, &TOTAL, &DURATION);
    let original_end = client.get_stream(&stream_id).end_timestamp;

    env.ledger().with_mut(|li| li.timestamp += 500);
    client.pause_stream(&admin, &stream_id);
    env.ledger().with_mut(|li| li.timestamp += 300);
    client.resume_stream(&admin, &stream_id);

    let stream = client.get_stream(&stream_id);
    assert_eq!(stream.end_timestamp, original_end + 300);
    assert_eq!(stream.pause_duration, 300);
    assert_eq!(stream.pause_cycles, 1);
}

#[test]
fn test_accrual_never_exceeds_total_after_long_wait() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    let stream_id = client.create_stream(&admin, &recipient, &token, &RATE, &TOTAL, &DURATION);

    env.ledger().with_mut(|li| li.timestamp += 500);
    client.pause_stream(&admin, &stream_id);
    env.ledger().with_mut(|li| li.timestamp += 10_000);
    client.resume_stream(&admin, &stream_id);
    env.ledger().with_mut(|li| li.timestamp += 10_000);

    let claimed = client.claim_stream(&recipient, &stream_id);
    assert!(claimed <= TOTAL);
    assert_eq!(client.get_stream(&stream_id).claimed_amount, claimed);
}
