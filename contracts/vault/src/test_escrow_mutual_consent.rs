//! Tests for escrow release by mutual consent without an arbitrator (Issue #2142).
//!
//! Covered scenarios:
//!  1. Full consent: both parties agree on the full remaining amount, recipient is paid
//!  2. Partial consent: recipient gets the agreed amount, remainder returns to funder
//!  3. Mismatched amounts are rejected and the first consent stays recorded
//!  4. A party cannot consent twice
//!  5. Third parties cannot consent
//!  6. Amounts outside the remaining balance are rejected
//!  7. Disputed escrows cannot be released by consent

use crate::errors::VaultError;
use crate::test_escrow_milestone_auth::setup;
use crate::types::{EscrowStatus, Milestone};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Symbol, Vec};

fn single_milestone(env: &Env) -> Vec<Milestone> {
    let mut milestones = Vec::new(env);
    milestones.push_back(Milestone {
        amount: 0,
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    milestones
}

/// Creates an active escrow of `amount` tokens funded by a fresh funder.
/// Returns (client, token, funder, recipient, arbitrator, escrow_id).
fn create_escrow(
    env: &Env,
    amount: i128,
) -> (
    crate::VaultDAOClient<'_>,
    Address,
    Address,
    Address,
    Address,
    u64,
) {
    // The admin doubles as funder: only admins may call add_supported_token.
    let (client, funder, _token) = setup(env);

    let token = env
        .register_stellar_asset_contract_v2(Address::generate(env))
        .address();
    let recipient = Address::generate(env);
    let arbitrator = Address::generate(env);

    StellarAssetClient::new(env, &token).mint(&funder, &10_000);
    client.add_supported_token(&funder, &token, &100_000, &1_000_000);

    let escrow_id = client.create_escrow(
        &funder,
        &recipient,
        &token,
        &amount,
        &single_milestone(env),
        &100_000u64,
        &arbitrator,
    );

    (client, token, funder, recipient, arbitrator, escrow_id)
}

fn balance(env: &Env, token: &Address, who: &Address) -> i128 {
    soroban_sdk::token::Client::new(env, token).balance(who)
}

#[test]
fn test_full_mutual_consent_pays_recipient_in_full() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token, funder, recipient, _arb, escrow_id) = create_escrow(&env, 5000);

    client.consent_release_escrow(&funder, &escrow_id, &5000i128);
    // One consent alone must not move funds.
    assert_eq!(balance(&env, &token, &recipient), 0);
    assert_eq!(
        client.get_escrow_info(&escrow_id).status,
        EscrowStatus::Active
    );

    client.consent_release_escrow(&recipient, &escrow_id, &5000i128);

    assert_eq!(balance(&env, &token, &recipient), 5000);
    assert_eq!(balance(&env, &token, &funder), 10_000 - 5000);
    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Released);
    assert_eq!(escrow.released_amount, 5000);
}

#[test]
fn test_partial_mutual_consent_returns_remainder_to_funder() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token, funder, recipient, _arb, escrow_id) = create_escrow(&env, 5000);

    client.consent_release_escrow(&recipient, &escrow_id, &3000i128);
    client.consent_release_escrow(&funder, &escrow_id, &3000i128);

    assert_eq!(balance(&env, &token, &recipient), 3000);
    // Funder started with 10_000, escrowed 5_000, gets back the 2_000 remainder.
    assert_eq!(balance(&env, &token, &funder), 10_000 - 5000 + 2000);
    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Released);
    assert_eq!(escrow.released_amount, 5000);
}

#[test]
fn test_mismatched_amounts_rejected_and_first_consent_kept() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token, funder, recipient, _arb, escrow_id) = create_escrow(&env, 5000);

    client.consent_release_escrow(&funder, &escrow_id, &3000i128);

    let res = client.try_consent_release_escrow(&recipient, &escrow_id, &4000i128);
    assert_eq!(res, Err(Ok(VaultError::InvalidAmount)));
    assert_eq!(balance(&env, &token, &recipient), 0);
    assert_eq!(
        client.get_escrow_info(&escrow_id).status,
        EscrowStatus::Active
    );

    // The recipient can still settle by agreeing to the funder's amount.
    client.consent_release_escrow(&recipient, &escrow_id, &3000i128);
    assert_eq!(balance(&env, &token, &recipient), 3000);
    assert_eq!(
        client.get_escrow_info(&escrow_id).status,
        EscrowStatus::Released
    );
}

#[test]
fn test_same_party_cannot_consent_twice() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, token, funder, _recipient, _arb, escrow_id) = create_escrow(&env, 5000);

    client.consent_release_escrow(&funder, &escrow_id, &5000i128);
    let res = client.try_consent_release_escrow(&funder, &escrow_id, &5000i128);
    assert_eq!(res, Err(Ok(VaultError::AlreadyApproved)));
    assert_eq!(balance(&env, &token, &funder), 10_000 - 5000);
}

#[test]
fn test_third_party_cannot_consent() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, _funder, _recipient, arbitrator, escrow_id) = create_escrow(&env, 5000);

    // Neither the arbitrator nor a random address may take part in mutual consent.
    let res = client.try_consent_release_escrow(&arbitrator, &escrow_id, &5000i128);
    assert_eq!(res, Err(Ok(VaultError::Unauthorized)));
    let stranger = Address::generate(&env);
    let res = client.try_consent_release_escrow(&stranger, &escrow_id, &5000i128);
    assert_eq!(res, Err(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_amount_outside_remaining_balance_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, funder, recipient, _arb, escrow_id) = create_escrow(&env, 5000);

    let over = client.try_consent_release_escrow(&funder, &escrow_id, &5001i128);
    assert_eq!(over, Err(Ok(VaultError::InvalidAmount)));
    let negative = client.try_consent_release_escrow(&recipient, &escrow_id, &-1i128);
    assert_eq!(negative, Err(Ok(VaultError::InvalidAmount)));
}

#[test]
fn test_disputed_escrow_cannot_be_released_by_consent() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _token, funder, recipient, _arb, escrow_id) = create_escrow(&env, 5000);

    client.dispute_escrow(&funder, &escrow_id, &Symbol::new(&env, "dispute"));

    let res = client.try_consent_release_escrow(&funder, &escrow_id, &5000i128);
    assert_eq!(res, Err(Ok(VaultError::ProposalNotPending)));
    let res = client.try_consent_release_escrow(&recipient, &escrow_id, &5000i128);
    assert_eq!(res, Err(Ok(VaultError::ProposalNotPending)));
}
