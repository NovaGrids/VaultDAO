//! Tests for milestone completion taking precedence over escrow expiry (escrow security fix).
//!
//! `release_escrow` used to check expiry before completion, so an escrow whose milestones
//! were all complete was refunded to the funder once it expired.
//!
//! Covered scenarios:
//!  1. All milestones complete, then expiry: the recipient receives the full amount
//!  2. Partial completion, then expiry: the recipient receives completed milestones and
//!     the funder receives only the unreleased remainder

use crate::test_escrow_milestone_auth::setup;
use crate::types::{EscrowStatus, Milestone};
use soroban_sdk::{testutils::{Address as _, Ledger}, token::TokenClient, Address, Env, Vec};

const FUNDING: i128 = 5_000_000;

#[test]
fn test_completed_milestones_paid_to_recipient_after_expiry() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, funder, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    let escrow_id = client.create_escrow(
        &funder,
        &recipient,
        &token,
        &2000i128,
        &milestones,
        &100u64,
        &arbitrator,
    );

    client.complete_milestone(&funder, &escrow_id, &1u64);

    // Advance past expiration before the recipient releases
    env.ledger().with_mut(|li| li.sequence_number += 150);

    let released = client.release_escrow(&recipient, &escrow_id);
    assert_eq!(released, 2000);

    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&recipient), 2000);
    assert_eq!(token_client.balance(&funder), FUNDING - 2000);

    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Released);
    assert_eq!(escrow.released_amount, 2000);
}

#[test]
fn test_partial_completion_then_expiry_splits_funds() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, funder, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 60,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    milestones.push_back(Milestone {
        id: 2,
        percentage: 40,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    let escrow_id = client.create_escrow(
        &funder,
        &recipient,
        &token,
        &5000i128,
        &milestones,
        &100u64,
        &arbitrator,
    );

    // Only the first milestone (60%) is completed
    client.complete_milestone(&funder, &escrow_id, &1u64);

    env.ledger().with_mut(|li| li.sequence_number += 150);

    let released = client.release_escrow(&funder, &escrow_id);
    assert_eq!(released, 5000);

    // Recipient is paid for the completed 60%; funder recovers the unfinished 40%
    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&recipient), 3000);
    assert_eq!(token_client.balance(&funder), FUNDING - 5000 + 2000);

    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(escrow.released_amount, 5000);
    assert_eq!(escrow.status, EscrowStatus::Refunded);
}
