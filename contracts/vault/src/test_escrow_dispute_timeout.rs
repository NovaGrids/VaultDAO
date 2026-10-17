//! Tests for measuring the escrow arbitration timeout from the dispute (escrow security fix).
//!
//! `auto_resolve_escrow` previously measured the timeout from `created_at`, so a dispute
//! filed on an old escrow was immediately eligible for a full refund and the arbitrator
//! received no time to act.
//!
//! Covered scenarios:
//!  1. Auto-resolve is rejected until the timeout elapses after the dispute
//!  2. Auto-resolve succeeds once the timeout has elapsed after the dispute
//!  3. Legacy disputed escrows without `disputed_at` fall back to `created_at`

use crate::errors::VaultError;
use crate::test_escrow_milestone_auth::setup;
use crate::types::{EscrowStatus, Milestone};
use crate::storage;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};

const TIMEOUT_LEDGERS: u64 = 1000;

fn single_milestone(env: &Env) -> Vec<Milestone> {
    let mut milestones = Vec::new(env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    milestones
}

#[test]
fn test_auto_resolve_timeout_measured_from_dispute() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, funder) = setup_with_short_timeout(&env);

    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    StellarAssetClient::new(&env, &token).mint(&funder, &10_000);

    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    // Escrow is created at ledger 0
    let escrow_id = client.create_escrow(
        &funder,
        &recipient,
        &token,
        &5000i128,
        &single_milestone(&env),
        &100_000u64,
        &arbitrator,
    );

    // Dispute long after creation, well past the timeout measured from creation
    env.ledger().with_mut(|li| li.sequence_number = 5000);
    client.dispute_escrow(&funder, &escrow_id, &Symbol::new(&env, "late_dispute"));
    assert_eq!(client.get_escrow_info(&escrow_id).disputed_at, 5000);

    // Immediately after the dispute the arbitrator still has the full window
    let res = client.try_auto_resolve_escrow(&escrow_id);
    assert_eq!(res, Err(Ok(VaultError::TimelockNotExpired)));

    // One ledger short of the timeout measured from the dispute: still rejected
    env.ledger()
        .with_mut(|li| li.sequence_number = (5000 + TIMEOUT_LEDGERS - 1) as u32);
    let res = client.try_auto_resolve_escrow(&escrow_id);
    assert_eq!(res, Err(Ok(VaultError::TimelockNotExpired)));
    assert_eq!(
        client.get_escrow_info(&escrow_id).status,
        EscrowStatus::Disputed
    );

    // Exactly at the timeout after the dispute: auto-resolve succeeds
    env.ledger()
        .with_mut(|li| li.sequence_number = (5000 + TIMEOUT_LEDGERS) as u32);
    client.auto_resolve_escrow(&escrow_id);
    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Refunded);
    assert_eq!(escrow.released_amount, 5000i128);

}

#[test]
fn test_legacy_disputed_escrow_falls_back_to_created_at() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, funder) = setup_with_short_timeout(&env);

    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    StellarAssetClient::new(&env, &token).mint(&funder, &10_000);

    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let escrow_id = client.create_escrow(
        &funder,
        &recipient,
        &token,
        &5000i128,
        &single_milestone(&env),
        &100_000u64,
        &arbitrator,
    );

    // Simulate an escrow disputed before `disputed_at` existed: status is Disputed
    // but no dispute ledger was recorded.
    let contract_id = client.address.clone();
    env.as_contract(&contract_id, || {
        let mut escrow = storage::get_escrow(&env, escrow_id).unwrap();
        escrow.status = EscrowStatus::Disputed;
        escrow.disputed_at = 0;
        storage::set_escrow(&env, &escrow);
    });

    // Legacy record is backfilled from created_at (0), so the timeout has elapsed
    env.ledger()
        .with_mut(|li| li.sequence_number = TIMEOUT_LEDGERS as u32);
    client.auto_resolve_escrow(&escrow_id);
    assert_eq!(
        client.get_escrow_info(&escrow_id).status,
        EscrowStatus::Refunded
    );
}

fn setup_with_short_timeout(env: &Env) -> (crate::VaultDAOClient<'_>, Address) {
    let (client, admin, _token) = setup(env);
    let contract_id = client.address.clone();
    env.as_contract(&contract_id, || {
        let mut config = storage::get_config(env).unwrap();
        config.arbitration_timeout_ledgers = TIMEOUT_LEDGERS;
        storage::set_config(env, &config);
    });
    (client, admin)
}
