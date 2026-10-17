//! Regression tests for Issue #1913: `adjust_stream_rate` must not apply the
//! new rate retroactively to seconds that already accrued at the old rate.
//!
//! Tests verify that:
//! - Accrual before an adjustment is settled at the old rate
//! - Lowering the rate never pushes claimable value below what was already
//!   claimed
//! - Any sequence of adjustments keeps `claimed <= total`
#![cfg(test)]

use crate::test_spending_limit_invariants_proptest::setup;
use proptest::collection::vec as prop_vec;
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

const OLD_RATE: i128 = 10;
const NEW_RATE: i128 = 1;
const TOTAL: i128 = 100_000;
const DURATION: u64 = 10_000;

#[test]
fn test_adjust_rate_settles_accrual_at_old_rate() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    let stream_id = client.create_stream(&admin, &recipient, &token, &OLD_RATE, &TOTAL, &DURATION);

    // 100 seconds accrue at the old rate: 100 * 10 = 1_000 tokens earned
    env.ledger().with_mut(|li| li.timestamp += 100);

    client.adjust_stream_rate(&admin, &stream_id, &NEW_RATE);

    // The 100 pre-adjustment seconds must still be worth 10 per second,
    // not be re-priced at the new rate of 1 per second.
    let claimed = client.claim_stream(&recipient, &stream_id);
    assert_eq!(claimed, OLD_RATE * 100);
}

#[test]
fn test_lowering_rate_after_claim_does_not_fail_claims() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    let stream_id = client.create_stream(&admin, &recipient, &token, &OLD_RATE, &TOTAL, &DURATION);

    env.ledger().with_mut(|li| li.timestamp += 100);
    let first_claim = client.claim_stream(&recipient, &stream_id);
    assert_eq!(first_claim, OLD_RATE * 100);

    // Lowering the rate must not make already-earned value unclaimable
    client.adjust_stream_rate(&admin, &stream_id, &NEW_RATE);
    env.ledger().with_mut(|li| li.timestamp += 10);

    let second_claim = client.try_claim_stream(&recipient, &stream_id);
    assert!(second_claim.is_ok());
}

#[test]
fn test_raising_rate_does_not_reprice_past_seconds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    let stream_id = client.create_stream(&admin, &recipient, &token, &NEW_RATE, &TOTAL, &DURATION);

    env.ledger().with_mut(|li| li.timestamp += 100);
    client.adjust_stream_rate(&admin, &stream_id, &OLD_RATE);

    // 100 seconds at rate 1 is 100 tokens; the raised rate must not apply to them
    let claimed = client.claim_stream(&recipient, &stream_id);
    assert_eq!(claimed, NEW_RATE * 100);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(16))]

    #[test]
    fn adjustment_sequences_keep_claimed_within_total(
        steps in prop_vec((1i128..=50, 1u64..=500), 1..12)
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);
        let recipient = Address::generate(&env);
        let stream_id =
            client.create_stream(&admin, &recipient, &token, &OLD_RATE, &TOTAL, &DURATION);

        for (rate, dt) in steps {
            env.ledger().with_mut(|li| li.timestamp += dt);
            let _ = client.try_adjust_stream_rate(&admin, &stream_id, &rate);
            let _ = client.try_claim_stream(&recipient, &stream_id);

            let stream = client.get_stream(&stream_id);
            prop_assert!(stream.claimed_amount <= stream.total_amount);
            prop_assert!(stream.claimed_amount <= TOTAL);
        }
    }
}
