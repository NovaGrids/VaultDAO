//! Tests for pending reservation accounting in the vault contract.
//!
//! These tests cover the scenario where a proposer fills the daily budget with
//! pending proposals, cancels them, and a second proposer can then propose
//! successfully. They also cover the per-proposer cap and the
//! `get_pending_reserved` getter.

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

use crate::{VaultContract, VaultContractClient};

fn create_token_contract<'a>(
    env: &Env,
    admin: &Address,
) -> (token::Client<'a>, token::StellarAssetClient<'a>) {
    let contract_address = env.register_stellar_asset_contract_v2(admin.clone());
    (
        token::Client::new(env, &contract_address.address()),
        token::StellarAssetClient::new(env, &contract_address.address()),
    )
}

fn setup<'a>() -> (
    Env,
    VaultContractClient<'a>,
    token::Client<'a>,
    token::StellarAssetClient<'a>,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_client, token_admin) = create_token_contract(&env, &admin);

    let vault_id = env.register(VaultContract, ());
    let vault = VaultContractClient::new(&env, &vault_id);

    vault.initialize(&admin, &token_client.address);

    (env, vault, token_client, token_admin, admin)
}

#[test]
fn test_cancelled_pending_proposals_free_daily_budget_for_second_proposer() {
    let (env, vault, _token_client, token_admin, _admin) = setup();

    let proposer_one = Address::generate(&env);
    let proposer_two = Address::generate(&env);

    // Fund both proposers so they can cover any required deposits.
    token_admin.mint(&proposer_one, &1_000_000);
    token_admin.mint(&proposer_two, &1_000_000);

    // Determine the daily budget and per-proposer cap from the contract.
    let daily_budget = vault.get_daily_budget();
    let per_proposer_cap = vault.get_per_proposer_cap();

    assert!(daily_budget > 0, "daily budget must be positive");
    assert!(per_proposer_cap > 0, "per-proposer cap must be positive");

    // Proposer one fills the daily budget with pending proposals.
    let mut filled: i128 = 0;
    let mut proposal_ids: soroban_sdk::Vec<u64> = soroban_sdk::Vec::new(&env);
    while filled + per_proposer_cap <= daily_budget {
        let id = vault.propose(&proposer_one, &per_proposer_cap);
        proposal_ids.push_back(id);
        filled += per_proposer_cap;
    }

    // The budget is now fully reserved by proposer one's pending proposals.
    assert_eq!(vault.get_pending_reserved(), daily_budget);
    assert_eq!(vault.get_pending_reserved_for(&proposer_one), daily_budget);

    // Proposer two cannot propose while the budget is reserved.
    let result = vault.try_propose(&proposer_two, &per_proposer_cap);
    assert!(
        result.is_err(),
        "second proposer should be blocked while budget is reserved"
    );

    // Proposer one cancels all pending proposals, freeing the budget.
    for id in proposal_ids.iter() {
        vault.cancel(&proposer_one, &id);
    }

    assert_eq!(vault.get_pending_reserved(), 0);
    assert_eq!(vault.get_pending_reserved_for(&proposer_one), 0);

    // Proposer two can now propose successfully.
    let id = vault.propose(&proposer_two, &per_proposer_cap);
    assert!(id > 0, "second proposer should receive a valid proposal id");
    assert_eq!(vault.get_pending_reserved(), per_proposer_cap);
    assert_eq!(
        vault.get_pending_reserved_for(&proposer_two),
        per_proposer_cap
    );
    assert_eq!(vault.get_pending_reserved_for(&proposer_one), 0);
}

#[test]
fn test_per_proposer_cap_is_enforced() {
    let (env, vault, _token_client, token_admin, _admin) = setup();

    let proposer = Address::generate(&env);
    token_admin.mint(&proposer, &1_000_000);

    let per_proposer_cap = vault.get_per_proposer_cap();
    assert!(per_proposer_cap > 0, "per-proposer cap must be positive");

    // First proposal up to the cap succeeds.
    let id = vault.propose(&proposer, &per_proposer_cap);
    assert!(id > 0);
    assert_eq!(vault.get_pending_reserved_for(&proposer), per_proposer_cap);

    // A second proposal that would exceed the per-proposer cap must fail.
    let result = vault.try_propose(&proposer, &1);
    assert!(
        result.is_err(),
        "proposal exceeding per-proposer cap should be rejected"
    );

    // Cancelling the first proposal frees the per-proposer allowance.
    vault.cancel(&proposer, &id);
    assert_eq!(vault.get_pending_reserved_for(&proposer), 0);

    let id = vault.propose(&proposer, &per_proposer_cap);
    assert!(id > 0);
    assert_eq!(vault.get_pending_reserved_for(&proposer), per_proposer_cap);
}

#[test]
fn test_get_pending_reserved_tracks_multiple_proposers() {
    let (env, vault, _token_client, token_admin, _admin) = setup();

    let proposer_one = Address::generate(&env);
    let proposer_two = Address::generate(&env);

    token_admin.mint(&proposer_one, &1_000_000);
    token_admin.mint(&proposer_two, &1_000_000);

    let per_proposer_cap = vault.get_per_proposer_cap();
    let daily_budget = vault.get_daily_budget();
    assert!(per_proposer_cap > 0);
    assert!(daily_budget >= per_proposer_cap);

    assert_eq!(vault.get_pending_reserved(), 0);
    assert_eq!(vault.get_pending_reserved_for(&proposer_one), 0);
    assert_eq!(vault.get_pending_reserved_for(&proposer_two), 0);

    let id_one = vault.propose(&proposer_one, &per_proposer_cap);
    assert!(id_one > 0);
    assert_eq!(vault.get_pending_reserved(), per_proposer_cap);
    assert_eq!(vault.get_pending_reserved_for(&proposer_one), per_proposer_cap);
    assert_eq!(vault.get_pending_reserved_for(&proposer_two), 0);

    // Only add a second proposer if the daily budget allows it.
    if daily_budget >= per_proposer_cap * 2 {
        let id_two = vault.propose(&proposer_two, &per_proposer_cap);
        assert!(id_two > 0);
        assert_eq!(vault.get_pending_reserved(), per_proposer_cap * 2);
        assert_eq!(
            vault.get_pending_reserved_for(&proposer_two),
            per_proposer_cap
        );

        vault.cancel(&proposer_two, &id_two);
        assert_eq!(vault.get_pending_reserved(), per_proposer_cap);
        assert_eq!(vault.get_pending_reserved_for(&proposer_two), 0);
    }

    vault.cancel(&proposer_one, &id_one);
    assert_eq!(vault.get_pending_reserved(), 0);
    assert_eq!(vault.get_pending_reserved_for(&proposer_one), 0);
}

#[test]
fn test_pending_reservations_reset_after_day_rollover() {
    let (env, vault, _token_client, token_admin, _admin) = setup();

    let proposer = Address::generate(&env);
    token_admin.mint(&proposer, &1_000_000);

    let per_proposer_cap = vault.get_per_proposer_cap();
    let daily_budget = vault.get_daily_budget();
    assert!(per_proposer_cap > 0);

    // Fill the daily budget with pending proposals.
    let mut filled: i128 = 0;
    let mut proposal_ids: soroban_sdk::Vec<u64> = soroban_sdk::Vec::new(&env);
    while filled + per_proposer_cap <= daily_budget {
        let id = vault.propose(&proposer, &per_proposer_cap);
        proposal_ids.push_back(id);
        filled += per_proposer_cap;
    }
    assert_eq!(vault.get_pending_reserved(), daily_budget);

    // Advance the ledger past the daily window.
    env.ledger().with_mut(|l| {
        l.timestamp += 86_400 + 1;
    });

    // The pending reservations should no longer block new proposals.
    let id = vault.propose(&proposer, &per_proposer_cap);
    assert!(id > 0, "proposal should succeed after day rollover");
}
