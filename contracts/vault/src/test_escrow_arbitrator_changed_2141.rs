//! Tests for Issue #2141: arbitrator replacement must emit an event.
#![cfg(test)]

use crate::test_spending_limit_invariants_proptest::setup;
use crate::types::Milestone;
use soroban_sdk::{
    testutils::Address as _, token::StellarAssetClient, Address, IntoVal, Symbol, Val, Vec,
};

#[test]
fn test_replace_escrow_arbitrator_emits_event() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    client.add_supported_token(&admin, &token, &1_000_000_000, &1_000_000_000);
    StellarAssetClient::new(&env, &token).mint(&admin, &10_000);

    let recipient = Address::generate(&env);
    let old_arbitrator = Address::generate(&env);
    let new_arbitrator = Address::generate(&env);
    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        amount: 1_000,
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    let escrow_id = client.create_escrow(
        &admin,
        &recipient,
        &token,
        &1_000,
        &milestones,
        &1_000,
        &old_arbitrator,
    );

    client.replace_escrow_arbitrator(&admin, &escrow_id, &new_arbitrator);

    let expected = Symbol::new(&env, "escrow_arbitrator_changed");
    let found = env
        .events()
        .all()
        .iter()
        .any(|(_, topics, data): (_, Vec<Val>, Val)| {
            let Some(first) = topics.first() else {
                return false;
            };
            let Ok(sym) = Symbol::try_from_val(&env, &first) else {
                return false;
            };
            let expected_data: Val =
                (old_arbitrator.clone(), new_arbitrator.clone()).into_val(&env);
            sym == expected && data == expected_data
        });
    assert!(found, "escrow_arbitrator_changed event not emitted");
    assert_eq!(client.get_escrow(&escrow_id).arbitrator, new_arbitrator);
}
