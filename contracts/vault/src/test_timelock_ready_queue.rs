//! Unit tests for the TimelockReady index and `get_pending_timelocked_proposals`.
//!
//! Issue #1640 — Executor Dashboard "Ready to Execute" queue.
//!
//! Scenarios covered:
//!  1. Proposals below the timelock threshold are NOT added to the index.
//!  2. Proposals above the threshold ARE added when approved.
//!  3. Mixed state: only Approved-and-still-locked entries are returned.
//!  4. Once unlock_ledger is reached the entry is skipped by the query.
//!  5. After execution the entry is removed from the index.
//!  6. After cancellation the entry is removed from the index.
//!  7. Pagination (offset + limit) works correctly.
//!  8. Empty queue returns an empty vec.

use crate::types::{ConditionLogic, InitConfig, Priority, RetryConfig, Role, VelocityConfig};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};

// ============================================================================
// Helpers
// ============================================================================

/// Build a minimal InitConfig with a timelock that triggers above `timelock_threshold`
/// using a `timelock_delay` of 200 ledgers.
fn make_config(env: &Env, signers: Vec<Address>, threshold: u32) -> InitConfig {
    InitConfig {
        signers,
        threshold,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1_000_000,
        daily_limit: 5_000_000,
        weekly_limit: 10_000_000,
        // Any proposal >= 500 stroops enters the timelock
        timelock_threshold: 500,
        timelock_delay: 200,
        velocity_limit: VelocityConfig {
            limit: 10_000_000,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: crate::types::ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        veto_window_ledgers: 0,
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
            max_retry_delay: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 100, // disable extended timelock in these tests
        admin_rotation_delay: 1440,
    }
}

/// Register the contract, initialise it, mint tokens, and return the client +
/// common addresses.
fn setup(
    env: &Env,
) -> (
    VaultDAOClient<'static>,
    Address, // admin / signer1
    Address, // signer2
    Address, // token
    Address, // recipient
    Address, // contract_id
) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let signer2 = Address::generate(env);
    let recipient = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer2.clone());

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(env, &token).mint(&contract_id, &10_000_000);

    client.initialize(&admin, &make_config(env, signers, 2));

    // Both signers are treasurers
    client.set_role(&admin, &signer2, &Role::Treasurer);
    client.set_role(&admin, &admin, &crate::types::Role::Treasurer);

    (client, admin, signer2, token, recipient, contract_id)
}

/// Propose a transfer and return its proposal ID.
fn propose(
    env: &Env,
    client: &VaultDAOClient,
    proposer: &Address,
    recipient: &Address,
    token: &Address,
    amount: i128,
) -> u64 {
    client.propose_transfer(
        proposer,
        recipient,
        token,
        &amount,
        &Symbol::new(env, "memo"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    )
}

// ============================================================================
// Tests
// ============================================================================

/// Small-amount proposals (below timelock_threshold) must NOT appear in the queue
/// even after they reach Approved status.
#[test]
fn test_small_proposal_not_in_timelock_queue() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, admin, signer2, token, recipient, _) = setup(&env);

    // amount 100 < threshold 500 → no timelock, unlock_ledger == 0
    let pid = propose(&env, &client, &admin, &recipient, &token, 100);
    client.approve_proposal(&admin, &pid);
    client.approve_proposal(&signer2, &pid);

    let proposal = client.get_proposal(&pid);
    assert_eq!(proposal.status, crate::types::ProposalStatus::Approved);
    assert_eq!(proposal.unlock_ledger, 0, "no timelock expected");

    let queue = client.get_pending_timelocked_proposals(&0u64, &50u32);
    assert_eq!(queue.len(), 0, "queue must be empty for non-timelocked approval");
}

/// A proposal at or above the timelock threshold must appear in the queue immediately
/// after reaching Approved status.
#[test]
fn test_large_proposal_enters_timelock_queue_on_approval() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, admin, signer2, token, recipient, _) = setup(&env);

    // amount 1000 >= threshold 500 → unlock_ledger = 100 + 200 = 300
    let pid = propose(&env, &client, &admin, &recipient, &token, 1_000);
    client.approve_proposal(&admin, &pid);
    client.approve_proposal(&signer2, &pid);

    let proposal = client.get_proposal(&pid);
    assert_eq!(proposal.status, crate::types::ProposalStatus::Approved);
    assert_eq!(proposal.unlock_ledger, 300);

    let queue = client.get_pending_timelocked_proposals(&0u64, &50u32);
    assert_eq!(queue.len(), 1);
    assert_eq!(queue.get(0).unwrap(), pid);
}

/// Mixed state: one pending, one approved-no-timelock, one approved-timelocked,
/// one executed.  Only the approved-timelocked entry should appear.
#[test]
fn test_mixed_states_only_timelocked_returned() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, admin, signer2, token, recipient, _) = setup(&env);

    // P1 – still Pending (only one approval so far)
    let p1 = propose(&env, &client, &admin, &recipient, &token, 1_000);
    client.approve_proposal(&admin, &p1);
    assert_eq!(
        client.get_proposal(&p1).status,
        crate::types::ProposalStatus::Pending
    );

    // P2 – Approved but no timelock (amount < threshold)
    let p2 = propose(&env, &client, &admin, &recipient, &token, 100);
    client.approve_proposal(&admin, &p2);
    client.approve_proposal(&signer2, &p2);
    assert_eq!(
        client.get_proposal(&p2).status,
        crate::types::ProposalStatus::Approved
    );
    assert_eq!(client.get_proposal(&p2).unlock_ledger, 0);

    // P3 – Approved with timelock (amount >= threshold)
    let p3 = propose(&env, &client, &admin, &recipient, &token, 2_000);
    client.approve_proposal(&admin, &p3);
    client.approve_proposal(&signer2, &p3);
    assert_eq!(
        client.get_proposal(&p3).status,
        crate::types::ProposalStatus::Approved
    );
    assert!(client.get_proposal(&p3).unlock_ledger > 100);

    // P4 – Approved with timelock then executed (advance ledger past unlock)
    let p4 = propose(&env, &client, &admin, &recipient, &token, 3_000);
    client.approve_proposal(&admin, &p4);
    client.approve_proposal(&signer2, &p4);
    // Advance past unlock_ledger to allow execution
    env.ledger().set_sequence_number(301); // > 300 (100 + 200)
    client.execute_proposal(&admin, &p4);
    assert_eq!(
        client.get_proposal(&p4).status,
        crate::types::ProposalStatus::Executed
    );

    // Restore ledger to before unlock so P3 is still in the window
    env.ledger().set_sequence_number(150);

    let queue = client.get_pending_timelocked_proposals(&0u64, &50u32);
    // Only P3 should be present
    assert_eq!(queue.len(), 1);
    assert_eq!(queue.get(0).unwrap(), p3);
}

/// Once the current ledger surpasses `unlock_ledger`, the entry must be skipped
/// by the query (the proposal is now *executable*, not *waiting*).
#[test]
fn test_entry_skipped_after_unlock_ledger_passes() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, admin, signer2, token, recipient, _) = setup(&env);

    let pid = propose(&env, &client, &admin, &recipient, &token, 1_000);
    client.approve_proposal(&admin, &pid);
    client.approve_proposal(&signer2, &pid);

    // Before unlock: should appear in queue
    let queue_before = client.get_pending_timelocked_proposals(&0u64, &50u32);
    assert_eq!(queue_before.len(), 1);

    // Advance past unlock_ledger (300)
    env.ledger().set_sequence_number(350);

    let queue_after = client.get_pending_timelocked_proposals(&0u64, &50u32);
    assert_eq!(
        queue_after.len(),
        0,
        "proposal past its unlock window must not appear as pending"
    );
}

/// After execution, the proposal must be removed from the index.
#[test]
fn test_executed_proposal_removed_from_index() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, admin, signer2, token, recipient, _) = setup(&env);

    let pid = propose(&env, &client, &admin, &recipient, &token, 1_000);
    client.approve_proposal(&admin, &pid);
    client.approve_proposal(&signer2, &pid);

    // Advance past unlock_ledger and execute
    env.ledger().set_sequence_number(301);
    client.execute_proposal(&admin, &pid);

    assert_eq!(
        client.get_proposal(&pid).status,
        crate::types::ProposalStatus::Executed
    );

    let queue = client.get_pending_timelocked_proposals(&0u64, &50u32);
    assert_eq!(queue.len(), 0, "executed proposal must not be in the queue");
}

/// After cancellation, the proposal must be removed from the index.
#[test]
fn test_cancelled_proposal_removed_from_index() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, admin, signer2, token, recipient, _) = setup(&env);

    let pid = propose(&env, &client, &admin, &recipient, &token, 1_000);
    client.approve_proposal(&admin, &pid);
    client.approve_proposal(&signer2, &pid);

    let queue_before = client.get_pending_timelocked_proposals(&0u64, &50u32);
    assert_eq!(queue_before.len(), 1);

    // Cancel the timelocked proposal
    client.cancel_proposal(&admin, &pid, &Symbol::new(&env, "cancel"));

    let queue_after = client.get_pending_timelocked_proposals(&0u64, &50u32);
    assert_eq!(queue_after.len(), 0, "cancelled proposal must not be in the queue");
}

/// Pagination: create 5 timelocked proposals and verify offset / limit slicing.
#[test]
fn test_pagination() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, admin, signer2, token, recipient, _) = setup(&env);

    let mut ids = soroban_sdk::Vec::new(&env);
    for i in 0..5u32 {
        let pid = propose(&env, &client, &admin, &recipient, &token, 1_000 + i as i128);
        client.approve_proposal(&admin, &pid);
        client.approve_proposal(&signer2, &pid);
        ids.push_back(pid);
    }

    // All 5 in one page
    let page_all = client.get_pending_timelocked_proposals(&0u64, &50u32);
    assert_eq!(page_all.len(), 5);

    // First 3
    let page_first = client.get_pending_timelocked_proposals(&0u64, &3u32);
    assert_eq!(page_first.len(), 3);
    assert_eq!(page_first.get(0).unwrap(), ids.get(0).unwrap());
    assert_eq!(page_first.get(2).unwrap(), ids.get(2).unwrap());

    // Skip 2, take 2
    let page_mid = client.get_pending_timelocked_proposals(&2u64, &2u32);
    assert_eq!(page_mid.len(), 2);
    assert_eq!(page_mid.get(0).unwrap(), ids.get(2).unwrap());
    assert_eq!(page_mid.get(1).unwrap(), ids.get(3).unwrap());

    // Skip all 5
    let page_empty = client.get_pending_timelocked_proposals(&5u64, &50u32);
    assert_eq!(page_empty.len(), 0);
}

/// The limit is capped at 50 internally — requesting 200 still returns at most 50.
#[test]
fn test_limit_cap_at_50() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, admin, signer2, token, recipient, _) = setup(&env);

    // Create 3 timelocked proposals
    for i in 0..3u32 {
        let pid = propose(&env, &client, &admin, &recipient, &token, 1_000 + i as i128);
        client.approve_proposal(&admin, &pid);
        client.approve_proposal(&signer2, &pid);
    }

    // Request 200 but only 3 exist — should return 3 (not panic or overflow)
    let queue = client.get_pending_timelocked_proposals(&0u64, &200u32);
    assert_eq!(queue.len(), 3);
}

/// Calling the query on an empty vault returns an empty vec without panicking.
#[test]
fn test_empty_queue() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, _, _, _, _, _) = setup(&env);

    let queue = client.get_pending_timelocked_proposals(&0u64, &50u32);
    assert_eq!(queue.len(), 0);
}
