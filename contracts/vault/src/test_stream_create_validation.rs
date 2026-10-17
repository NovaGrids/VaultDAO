//! Regression tests for Issue #1914: `create_stream` must validate the
//! relationship between `rate`, `duration_secs` and `total_amount`, accept
//! only supported tokens, honour the pause switch, and write an audit entry.
#![cfg(test)]

use crate::test_spending_limit_invariants_proptest::setup;
use soroban_sdk::{testutils::Address as _, Address, Symbol};

const RATE: i128 = 10;
const DURATION: u64 = 1_000;
const TOTAL: i128 = RATE * DURATION as i128;

#[test]
fn test_create_stream_accepts_matching_rate_and_duration() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    client.add_supported_token(&admin, &token, &1_000_000_000, &1_000_000_000);

    let result = client.try_create_stream(&admin, &recipient, &token, &RATE, &TOTAL, &DURATION);
    assert!(result.is_ok());
}

#[test]
fn test_create_stream_rejects_total_above_rate_times_duration() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    client.add_supported_token(&admin, &token, &1_000_000_000, &1_000_000_000);

    // rate * duration = 10_000 but total = 20_000: stream would finish early
    let result =
        client.try_create_stream(&admin, &recipient, &token, &RATE, &(TOTAL * 2), &DURATION);
    assert!(result.is_err());
}

#[test]
fn test_create_stream_rejects_total_below_rate_times_duration() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    client.add_supported_token(&admin, &token, &1_000_000_000, &1_000_000_000);

    // rate * duration = 10_000 but total = 5_000: funds could never fully vest
    let result =
        client.try_create_stream(&admin, &recipient, &token, &RATE, &(TOTAL / 2), &DURATION);
    assert!(result.is_err());
}

#[test]
fn test_create_stream_rejects_unsupported_token() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    client.add_supported_token(&admin, &token, &1_000_000_000, &1_000_000_000);

    let other_token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let result =
        client.try_create_stream(&admin, &recipient, &other_token, &RATE, &TOTAL, &DURATION);
    assert!(result.is_err());
}

#[test]
fn test_create_stream_is_blocked_while_vault_paused() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    client.add_supported_token(&admin, &token, &1_000_000_000, &1_000_000_000);

    client.pause_vault(&admin, &Symbol::new(&env, "test_pause"));

    let result = client.try_create_stream(&admin, &recipient, &token, &RATE, &TOTAL, &DURATION);
    assert!(result.is_err());
}

#[test]
fn test_create_stream_writes_audit_entry() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    client.add_supported_token(&admin, &token, &1_000_000_000, &1_000_000_000);

    let before = client.get_audit_entry_count();
    client.create_stream(&admin, &recipient, &token, &RATE, &TOTAL, &DURATION);
    let after = client.get_audit_entry_count();

    assert!(after > before);
}
