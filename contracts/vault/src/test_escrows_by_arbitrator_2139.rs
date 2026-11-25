//! Tests for Issue #2139: escrow lookup by arbitrator.
#![cfg(test)]

use crate::test_spending_limit_invariants_proptest::setup;
use crate::types::Milestone;
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Vec};

fn milestone(id: u64) -> Milestone {
    Milestone {
        amount: 1_000,
        id,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    }
}

#[test]
fn test_get_escrows_by_arbitrator_single_and_multiple() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    client.add_supported_token(&admin, &token, &1_000_000_000, &1_000_000_000);
    StellarAssetClient::new(&env, &token).mint(&admin, &10_000);

    let recipient = Address::generate(&env);
    let arb1 = Address::generate(&env);
    let arb2 = Address::generate(&env);
    let mut milestones = Vec::new(&env);
    milestones.push_back(milestone(1));

    let id1 = client.create_escrow(&admin, &recipient, &token, &1_000, &milestones, &1_000, &arb1);
    assert_eq!(client.get_escrows_by_arbitrator(&arb1), vec![&env, id1]);

    let id2 = client.create_escrow(&admin, &recipient, &token, &1_000, &milestones, &1_000, &arb1);
    let id3 = client.create_escrow(&admin, &recipient, &token, &1_000, &milestones, &1_000, &arb2);
    assert_eq!(
        client.get_escrows_by_arbitrator(&arb1),
        vec![&env, id1, id2]
    );
    assert_eq!(client.get_escrows_by_arbitrator(&arb2), vec![&env, id3]);
}
