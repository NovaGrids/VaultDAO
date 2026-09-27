//! Property-based accounting invariants for streams and vesting (Issue #1729).
//!
//! Over random sequences of create/claim/pause/resume/cancel, asserts that
//! `claimed <= total` for every stream and vesting schedule, and that the sum
//! of reserved balances never exceeds the vault's token balance.
#![cfg(test)]

use crate::storage;
use crate::test_spending_limit_invariants_proptest::setup;
use proptest::collection::vec as prop_vec;
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::TokenClient,
    Address, Env,
};

#[derive(Clone, Debug)]
enum Action {
    CreateStream(i128, u64),
    ClaimStream(usize),
    PauseStream(usize),
    ResumeStream(usize),
    CancelStream(usize),
    CreateVesting(i128, u32),
    ClaimVesting(usize),
    CancelVesting(usize),
    Advance(u64),
}

fn action_strategy() -> impl Strategy<Value = Action> {
    prop_oneof![
        3 => (1_000i128..=500_000, 10u64..=1_000).prop_map(|(t, d)| Action::CreateStream(t, d)),
        3 => (0usize..8).prop_map(Action::ClaimStream),
        1 => (0usize..8).prop_map(Action::PauseStream),
        1 => (0usize..8).prop_map(Action::ResumeStream),
        1 => (0usize..8).prop_map(Action::CancelStream),
        3 => (1_000i128..=500_000, 10u32..=500).prop_map(|(t, d)| Action::CreateVesting(t, d)),
        3 => (0usize..8).prop_map(Action::ClaimVesting),
        1 => (0usize..8).prop_map(Action::CancelVesting),
        2 => (1u64..=600).prop_map(Action::Advance),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(32))]

    #[test]
    fn stream_and_vesting_accounting_invariants(actions in prop_vec(action_strategy(), 1..40)) {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);
        let recipient = Address::generate(&env);
        let mut stream_ids: std::vec::Vec<u64> = std::vec::Vec::new();
        let mut vesting_ids: std::vec::Vec<u64> = std::vec::Vec::new();

        for action in actions {
            match action {
                Action::CreateStream(total, dur) => {
                    let rate = (total / dur as i128).max(1);
                    if let Ok(Ok(id)) =
                        client.try_create_stream(&admin, &recipient, &token, &rate, &total, &dur)
                    {
                        stream_ids.push(id);
                    }
                }
                Action::ClaimStream(i) => {
                    if let Some(id) = stream_ids.get(i) {
                        let _ = client.try_claim_stream(&recipient, id);
                    }
                }
                Action::PauseStream(i) => {
                    if let Some(id) = stream_ids.get(i) {
                        let _ = client.try_pause_stream(&admin, id);
                    }
                }
                Action::ResumeStream(i) => {
                    if let Some(id) = stream_ids.get(i) {
                        let _ = client.try_resume_stream(&admin, id);
                    }
                }
                Action::CancelStream(i) => {
                    if let Some(id) = stream_ids.get(i) {
                        let _ = client.try_cancel_stream(&admin, id);
                    }
                }
                Action::CreateVesting(total, dur) => {
                    let now = env.ledger().sequence();
                    if let Ok(Ok(id)) = client.try_create_vesting_schedule(
                        &admin, &recipient, &token, &total, &now, &now, &(now + dur),
                    ) {
                        vesting_ids.push(id);
                    }
                }
                Action::ClaimVesting(i) => {
                    if let Some(id) = vesting_ids.get(i) {
                        let _ = client.try_claim_vested_tokens(&recipient, id);
                    }
                }
                Action::CancelVesting(i) => {
                    if let Some(id) = vesting_ids.get(i) {
                        let _ = client.try_cancel_vesting(&admin, id);
                    }
                }
                Action::Advance(n) => {
                    env.ledger().with_mut(|l| {
                        l.timestamp += n;
                        l.sequence_number += n as u32;
                    });
                }
            }

            for id in stream_ids.iter() {
                let s = client.get_stream(id);
                prop_assert!(s.claimed_amount >= 0 && s.claimed_amount <= s.total_amount);
            }
            for id in vesting_ids.iter() {
                let v = client.get_vesting_schedule(id).unwrap();
                prop_assert!(v.claimed >= 0 && v.claimed <= v.total);
            }
            let (reserved, balance) = env.as_contract(&client.address, || {
                (storage::get_total_reserved(&env, &token), 0i128)
            });
            let balance = balance + TokenClient::new(&env, &token).balance(&client.address);
            prop_assert!(reserved >= 0 && reserved <= balance);
        }
    }
}
