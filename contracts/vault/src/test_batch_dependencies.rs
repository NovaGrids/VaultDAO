//! Tests for Issue #1363: Proposal Batch Dependency Validation
//!
//! A batch used to execute in list order, so a batch listing a dependent before
//! its dependency would fail part-way through. Dependencies are now validated up
//! front and the batch is topologically sorted before anything moves.
#![cfg(test)]

use super::*;
use crate::types::{
    BatchStatus, ConditionLogic, Priority, RetryConfig, StakingConfig, ThresholdStrategy,
    VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    token::StellarAssetClient,
    Address, Env, Symbol, TryFromVal, Vec,
};

/// Returns (client, admin, proposer, token, contract_id).
fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address, Address) {
    env.mock_all_auths();
    env.ledger().set_sequence_number(1_000);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let proposer = Address::generate(env);
    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(proposer.clone());

    client.initialize(
        &admin,
        &InitConfig {
            veto_window_ledgers: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: crate::types::VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers,
            threshold: 1,
            quorum: 0,
            quorum_percentage: 0,
            default_voting_deadline: 0,
            spending_limit: 10_000_000,
            daily_limit: 50_000_000,
            weekly_limit: 100_000_000,
            timelock_threshold: 9_999_999,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 1000,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            veto_addresses: Vec::new(env),
            retry_config: RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(env),
            staking_config: StakingConfig::default(),
            proposal_id_prefix: 0,
        },
    );

    client.set_role(&admin, &proposer, &Role::Treasurer);
    StellarAssetClient::new(env, &token).mint(&contract_id, &10_000_000);

    (client, admin, proposer, token, contract_id)
}

/// Create an approved proposal that depends on `deps`.
fn approved_proposal(
    env: &Env,
    client: &VaultDAOClient<'_>,
    admin: &Address,
    proposer: &Address,
    token: &Address,
    deps: Vec<u64>,
) -> u64 {
    let recipient = Address::generate(env);
    let id = client.propose_transfer_with_deps(
        proposer,
        &recipient,
        token,
        &1_000i128,
        &Symbol::new(env, "dep"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
        &deps,
    );
    client.approve_proposal(admin, &id);
    id
}

fn ids(env: &Env, list: &[u64]) -> Vec<u64> {
    let mut v = Vec::new(env);
    for id in list {
        v.push_back(*id);
    }
    v
}

/// Whether an event with `name` as its first topic was published.
fn emitted(env: &Env, name: &str) -> bool {
    let expected = Symbol::new(env, name);
    env.events().all().iter().any(|(_, topics, _)| {
        topics
            .first()
            .and_then(|t| Symbol::try_from_val(env, &t).ok())
            .map(|s| s == expected)
            .unwrap_or(false)
    })
}

// ============================================================================
// Dependency-ordered execution
// ============================================================================

#[test]
fn test_batch_listed_out_of_order_is_reordered_and_executes() {
    let env = Env::default();
    let (client, admin, proposer, token, _cid) = setup(&env);

    let first = approved_proposal(&env, &client, &admin, &proposer, &token, Vec::new(&env));
    let second = approved_proposal(
        &env,
        &client,
        &admin,
        &proposer,
        &token,
        ids(&env, &[first]),
    );

    // Listed dependent-first: the old list-order executor would have failed here.
    let batch_id = client.create_batch(&proposer, &ids(&env, &[second, first]));
    client.execute_batch(&admin, &batch_id);

    let batch = client.get_batch(&batch_id);
    assert_eq!(batch.status, BatchStatus::Completed);
    assert_eq!(batch.executed_count, 2);

    let first_p = client.get_proposal(&first);
    let second_p = client.get_proposal(&second);
    assert_eq!(first_p.status, ProposalStatus::Executed);
    assert_eq!(second_p.status, ProposalStatus::Executed);
}

#[test]
fn test_reorder_emits_event() {
    let env = Env::default();
    let (client, admin, proposer, token, _cid) = setup(&env);

    let first = approved_proposal(&env, &client, &admin, &proposer, &token, Vec::new(&env));
    let second = approved_proposal(
        &env,
        &client,
        &admin,
        &proposer,
        &token,
        ids(&env, &[first]),
    );

    let batch_id = client.create_batch(&proposer, &ids(&env, &[second, first]));
    client.execute_batch(&admin, &batch_id);

    assert!(
        emitted(&env, "batch_reordered"),
        "expected a batch_reordered event"
    );
}

#[test]
fn test_already_ordered_batch_is_not_reordered() {
    let env = Env::default();
    let (client, admin, proposer, token, _cid) = setup(&env);

    let first = approved_proposal(&env, &client, &admin, &proposer, &token, Vec::new(&env));
    let second = approved_proposal(
        &env,
        &client,
        &admin,
        &proposer,
        &token,
        ids(&env, &[first]),
    );

    let batch_id = client.create_batch(&proposer, &ids(&env, &[first, second]));
    client.execute_batch(&admin, &batch_id);

    assert!(
        !emitted(&env, "batch_reordered"),
        "a batch already in dependency order must not report a reorder"
    );
    assert_eq!(client.get_batch(&batch_id).status, BatchStatus::Completed);
}

#[test]
fn test_deep_dependency_chain_is_sorted() {
    let env = Env::default();
    let (client, admin, proposer, token, _cid) = setup(&env);

    let a = approved_proposal(&env, &client, &admin, &proposer, &token, Vec::new(&env));
    let b = approved_proposal(&env, &client, &admin, &proposer, &token, ids(&env, &[a]));
    let c = approved_proposal(&env, &client, &admin, &proposer, &token, ids(&env, &[b]));
    let d = approved_proposal(&env, &client, &admin, &proposer, &token, ids(&env, &[c]));

    // Fully reversed.
    let batch_id = client.create_batch(&proposer, &ids(&env, &[d, c, b, a]));
    client.execute_batch(&admin, &batch_id);

    let batch = client.get_batch(&batch_id);
    assert_eq!(batch.status, BatchStatus::Completed);
    assert_eq!(batch.executed_count, 4);
}

#[test]
fn test_diamond_dependency_is_sorted() {
    let env = Env::default();
    let (client, admin, proposer, token, _cid) = setup(&env);

    let root = approved_proposal(&env, &client, &admin, &proposer, &token, Vec::new(&env));
    let left = approved_proposal(&env, &client, &admin, &proposer, &token, ids(&env, &[root]));
    let right = approved_proposal(&env, &client, &admin, &proposer, &token, ids(&env, &[root]));
    let join = approved_proposal(
        &env,
        &client,
        &admin,
        &proposer,
        &token,
        ids(&env, &[left, right]),
    );

    let batch_id = client.create_batch(&proposer, &ids(&env, &[join, right, left, root]));
    client.execute_batch(&admin, &batch_id);

    assert_eq!(client.get_batch(&batch_id).status, BatchStatus::Completed);
    assert_eq!(client.get_batch(&batch_id).executed_count, 4);
}

// ============================================================================
// Dependencies outside the batch
// ============================================================================

#[test]
fn test_dependency_already_executed_outside_batch_is_accepted() {
    let env = Env::default();
    let (client, admin, proposer, token, _cid) = setup(&env);

    let prereq = approved_proposal(&env, &client, &admin, &proposer, &token, Vec::new(&env));
    client.execute_proposal(&admin, &prereq);

    // Dependency checks require the dependency to have executed in an earlier ledger.
    env.ledger().set_sequence_number(1_100);

    let dependent = approved_proposal(
        &env,
        &client,
        &admin,
        &proposer,
        &token,
        ids(&env, &[prereq]),
    );

    let batch_id = client.create_batch(&proposer, &ids(&env, &[dependent]));
    client.execute_batch(&admin, &batch_id);

    assert_eq!(client.get_batch(&batch_id).status, BatchStatus::Completed);
}

#[test]
fn test_unexecuted_dependency_outside_batch_aborts_batch() {
    let env = Env::default();
    let (client, admin, proposer, token, _cid) = setup(&env);

    // Approved but never executed, and deliberately left out of the batch.
    let prereq = approved_proposal(&env, &client, &admin, &proposer, &token, Vec::new(&env));
    let dependent = approved_proposal(
        &env,
        &client,
        &admin,
        &proposer,
        &token,
        ids(&env, &[prereq]),
    );

    let batch_id = client.create_batch(&proposer, &ids(&env, &[dependent]));
    let res = client.try_execute_batch(&admin, &batch_id);

    assert_eq!(res.err(), Some(Ok(VaultError::BatchDependencyMissing)));

    // The failed call reverts every write it made, so the batch is left untouched
    // and no proposal advanced.
    let batch = client.get_batch(&batch_id);
    assert_eq!(batch.status, BatchStatus::Pending);
    assert_eq!(batch.executed_count, 0);
    assert_eq!(
        client.get_proposal(&dependent).status,
        ProposalStatus::Approved
    );
    assert_eq!(
        client.get_proposal(&prereq).status,
        ProposalStatus::Approved
    );
}

#[test]
fn test_validation_happens_before_any_transfer() {
    let env = Env::default();
    let (client, admin, proposer, token, cid) = setup(&env);

    let safe = approved_proposal(&env, &client, &admin, &proposer, &token, Vec::new(&env));
    let prereq = approved_proposal(&env, &client, &admin, &proposer, &token, Vec::new(&env));
    let dependent = approved_proposal(
        &env,
        &client,
        &admin,
        &proposer,
        &token,
        ids(&env, &[prereq]),
    );

    let vault_before = soroban_sdk::token::TokenClient::new(&env, &token).balance(&cid);

    // `safe` could execute on its own, but the unsatisfiable dependency of
    // `dependent` must abort the whole batch before anything moves.
    let batch_id = client.create_batch(&proposer, &ids(&env, &[safe, dependent]));
    let res = client.try_execute_batch(&admin, &batch_id);

    assert_eq!(res.err(), Some(Ok(VaultError::BatchDependencyMissing)));
    assert_eq!(client.get_proposal(&safe).status, ProposalStatus::Approved);
    assert_eq!(
        soroban_sdk::token::TokenClient::new(&env, &token).balance(&cid),
        vault_before
    );
}

// ============================================================================
// Batch construction
// ============================================================================

#[test]
fn test_create_batch_rejects_unknown_proposal() {
    let env = Env::default();
    let (client, _admin, proposer, _token, _cid) = setup(&env);

    let res = client.try_create_batch(&proposer, &ids(&env, &[999u64]));
    assert_eq!(res.err(), Some(Ok(VaultError::ProposalNotFound)));
}

#[test]
fn test_create_batch_rejects_empty_batch() {
    let env = Env::default();
    let (client, _admin, proposer, _token, _cid) = setup(&env);

    let res = client.try_create_batch(&proposer, &Vec::new(&env));
    assert_eq!(res.err(), Some(Ok(VaultError::InvalidAmount)));
}

#[test]
fn test_create_batch_requires_treasurer() {
    let env = Env::default();
    let (client, admin, proposer, token, _cid) = setup(&env);

    let id = approved_proposal(&env, &client, &admin, &proposer, &token, Vec::new(&env));
    let outsider = Address::generate(&env);

    let res = client.try_create_batch(&outsider, &ids(&env, &[id]));
    assert_eq!(res.err(), Some(Ok(VaultError::InsufficientRole)));
}
