//! Regression tests for Issue #2225: budgeted catch-up, missed-cycle policy,
//! and deterministic, keeper-recomputable jitter.
#![cfg(test)]

use crate::test_spending_limit_invariants_proptest::setup;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::Client as TokenClient,
    Address, Symbol,
};

const INTERVAL: u64 = 1_000;
const AMOUNT: i128 = 1_000_000;

#[test]
fn test_deterministic_jitter_golden_values() {
    let env = soroban_sdk::Env::default();
    // Golden vectors: sha256(u64_le(id) || u64_le(creation_ledger))[0..4] % window.
    assert_eq!(crate::helpers::deterministic_jitter_offset(&env, 1, 1_000, 72), 8);
    assert_eq!(crate::helpers::deterministic_jitter_offset(&env, 7, 86_400, 50), 32);
    assert_eq!(crate::helpers::deterministic_jitter_offset(&env, 42, 1_234_567, 10), 0);
    assert_eq!(crate::helpers::deterministic_jitter_offset(&env, 9, 10, 0), 0);
}

#[test]
fn test_catch_up_budget_caps_burst() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let id = client.schedule_payment(
        &admin,
        &Address::generate(&env),
        &token,
        &AMOUNT,
        &Symbol::new(&env, "payroll"),
        &INTERVAL,
        &0u32,
        &0u32,
        &0u32,
    );

    client.set_recurring_catch_up_controls(
        &admin,
        &id,
        &(2 * AMOUNT),
        &crate::types::MissedCyclePolicy::PayUpToBudget,
    );

    let due = client.get_recurring_payment(&id).next_payment_ledger;
    env.ledger().with_mut(|li| {
        li.sequence_number = (due + 6 * INTERVAL) as u32;
    });

    let token_client = TokenClient::new(&env, &token);
    let recipient = client.get_recurring_payment(&id).recipient;
    let before = token_client.balance(&recipient);
    client.execute_recurring_payment(&id);
    let paid = token_client.balance(&recipient) - before;

    assert_eq!(paid, 2 * AMOUNT, "budget must cap catch-up to two periods");
    assert!(client.get_recurring_payment(&id).next_payment_ledger > due);
}

#[test]
fn test_skip_policy_pays_one_cycle_and_drops_missed_window() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let id = client.schedule_payment(
        &admin,
        &Address::generate(&env),
        &token,
        &AMOUNT,
        &Symbol::new(&env, "payroll"),
        &INTERVAL,
        &0u32,
        &0u32,
        &0u32,
    );

    client.set_recurring_catch_up_controls(
        &admin,
        &id,
        &(10 * AMOUNT),
        &crate::types::MissedCyclePolicy::Skip,
    );

    let due = client.get_recurring_payment(&id).next_payment_ledger;
    let current = due + 6 * INTERVAL;
    env.ledger().with_mut(|li| {
        li.sequence_number = current as u32;
    });

    let token_client = TokenClient::new(&env, &token);
    let recipient = client.get_recurring_payment(&id).recipient;
    let before = token_client.balance(&recipient);
    client.execute_recurring_payment(&id);

    assert_eq!(token_client.balance(&recipient) - before, AMOUNT);
    assert_eq!(
        client.get_recurring_payment(&id).next_payment_ledger,
        current + INTERVAL,
        "skipped cycles must not remain payable later"
    );
}
