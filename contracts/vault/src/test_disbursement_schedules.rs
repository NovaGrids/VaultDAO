//! Regression tests for Issue #2224: dependency-gated phased disbursements.
#![cfg(test)]

use crate::test_spending_limit_invariants_proptest::setup;
use soroban_sdk::{testutils::Address as _, token::Client as TokenClient, Address, Vec};

fn tranche(id: u32, amount: i128, unlock: u64, dep: Option<u64>) -> crate::types::DisbursementTranche {
    crate::types::DisbursementTranche {
        id,
        amount,
        unlock_ledger: unlock,
        depends_on_proposal: dep,
        depends_on_escrow: None,
        status: crate::types::TrancheStatus::Pending,
    }
}

#[test]
fn test_over_commit_rejected_at_create() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let tranches = Vec::from_array(
        &env,
        [
            tranche(1, 20_000_000, 0, None),
            tranche(2, 20_000_000, 0, None),
        ],
    );

    let result = client.try_create_disbursement_schedule(
        &admin,
        &recipient,
        &token,
        &tranches,
        &crate::types::PartialFailPolicy::Abort,
    );
    assert!(result.is_err(), "schedule above the spending limit must be rejected");
}

#[test]
fn test_dependency_gate_aborts_and_releases_reservation() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let tranches = Vec::from_array(
        &env,
        [
            tranche(1, 1_000_000, 0, None),
            tranche(2, 1_000_000, 0, Some(9_999)),
        ],
    );
    let id = client.create_disbursement_schedule(
        &admin,
        &recipient,
        &token,
        &tranches,
        &crate::types::PartialFailPolicy::Abort,
    );

    client.execute_disbursement_tranche(&admin, &id, &2);
    let schedule = client.get_disbursement_schedule(&id);
    assert_eq!(schedule.cancelled, true);
    assert_eq!(schedule.reservation_released, true);
    assert_eq!(
        schedule.tranches.get(1).unwrap().status,
        crate::types::TrancheStatus::Blocked
    );
    assert_eq!(
        schedule.tranches.get(0).unwrap().status,
        crate::types::TrancheStatus::Blocked
    );
    assert_eq!(TokenClient::new(&env, &token).balance(&recipient), 0);
}

#[test]
fn test_continue_policy_only_fails_gated_tranche() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let tranches = Vec::from_array(
        &env,
        [
            tranche(1, 1_000_000, 10_000, None),
            tranche(2, 1_000_000, 0, None),
        ],
    );
    let id = client.create_disbursement_schedule(
        &admin,
        &recipient,
        &token,
        &tranches,
        &crate::types::PartialFailPolicy::Continue,
    );

    client.execute_disbursement_tranche(&admin, &id, &1);
    let schedule = client.get_disbursement_schedule(&id);
    assert_eq!(schedule.cancelled, false);
    assert_eq!(schedule.reservation_released, false);
    assert_eq!(
        schedule.tranches.get(0).unwrap().status,
        crate::types::TrancheStatus::Failed
    );
    assert_eq!(
        schedule.tranches.get(1).unwrap().status,
        crate::types::TrancheStatus::Pending
    );

    // The independent tranche can still execute once its unlock ledger passes.
    env.ledger().with_mut(|li| li.sequence_number = 10_000);
    client.execute_disbursement_tranche(&admin, &id, &2);
    assert_eq!(
        client.get_disbursement_schedule(&id).tranches.get(1).unwrap().status,
        crate::types::TrancheStatus::Executed
    );
}

#[test]
fn test_cancel_releases_reservation_exactly_once() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let tranches = Vec::from_array(&env, [tranche(1, 1_000_000, 0, None)]);
    let id = client.create_disbursement_schedule(
        &admin,
        &recipient,
        &token,
        &tranches,
        &crate::types::PartialFailPolicy::Continue,
    );

    client.cancel_disbursement_schedule(&admin, &id);
    let schedule = client.get_disbursement_schedule(&id);
    assert_eq!(schedule.reservation_released, true);
    assert_eq!(schedule.cancelled, true);
    assert!(
        client.try_cancel_disbursement_schedule(&admin, &id).is_err(),
        "second cancel must fail and not release twice"
    );
}
