//! Regression tests for Issue #1916: a long outage must not produce a catch-up
//! lump sum that exceeds the daily spending limit and wedges the payment.
#![cfg(test)]

use crate::test_spending_limit_invariants_proptest::setup;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::Client as TokenClient,
    Address, Symbol,
};

const INTERVAL: u64 = 1_000;
const AMOUNT: i128 = 1_000_000;
const DAILY_LIMIT: i128 = 5_000_000;

#[test]
fn test_long_outage_catch_up_is_bounded_by_daily_limit() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &AMOUNT,
        &Symbol::new(&env, "payroll"),
        &INTERVAL,
        &0u32, // max_missed_payments: unlimited
        &0u32, // jitter_window
        &0u32, // grace_executions
    );
    let due_ledger = client.get_recurring_payment(&payment_id).next_payment_ledger;

    // Six missed periods plus the current one would be 7 * AMOUNT, above the daily limit
    env.ledger().with_mut(|li| {
        li.sequence_number = (due_ledger + 6 * INTERVAL) as u32;
    });

    let token_client = TokenClient::new(&env, &token);
    let balance_before = token_client.balance(&recipient);

    let result = client.try_execute_recurring_payment(&payment_id);
    assert!(result.is_ok(), "catch-up must not be rejected wholesale");

    let paid = token_client.balance(&recipient) - balance_before;
    assert!(paid > 0, "at least one due period should be paid");
    assert!(paid <= DAILY_LIMIT, "catch-up must respect the daily limit");
}

#[test]
fn test_catch_up_advances_next_payment_ledger_past_paid_periods() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &AMOUNT,
        &Symbol::new(&env, "payroll"),
        &INTERVAL,
        &0u32,
        &0u32,
        &0u32,
    );
    let due_ledger = client.get_recurring_payment(&payment_id).next_payment_ledger;
    let current = due_ledger + 6 * INTERVAL;

    env.ledger().with_mut(|li| {
        li.sequence_number = current as u32;
    });

    let _ = client.try_execute_recurring_payment(&payment_id);

    // Whatever is paid, the schedule must move forward rather than stay wedged
    let updated = client.get_recurring_payment(&payment_id);
    assert!(updated.next_payment_ledger > due_ledger);
}
