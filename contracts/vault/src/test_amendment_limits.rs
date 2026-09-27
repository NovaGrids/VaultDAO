//! Tests for Issue #1356: Proposal Amendment Limits
//!
//! Each amendment clears every approval, so an unbounded amend loop lets a
//! treasurer churn a proposal faster than signers can review it. These tests pin
//! the ceiling, the counter, and the admin-configurable limit.
#![cfg(test)]

use super::*;
use crate::types::{
    ConditionLogic, Priority, RetryConfig, StakingConfig, ThresholdStrategy, VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    token::StellarAssetClient,
    Address, Env, Symbol, TryFromVal, Vec,
};

/// Returns (client, admin, proposer, token, recipient).
fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address, Address) {
    env.mock_all_auths();

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
            threshold: 2,
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

    let recipient = Address::generate(env);
    StellarAssetClient::new(env, &token).mint(&contract_id, &1_000_000);

    (client, admin, proposer, token, recipient)
}

fn propose(
    env: &Env,
    client: &VaultDAOClient<'_>,
    proposer: &Address,
    token: &Address,
    recipient: &Address,
) -> u64 {
    propose_amount(env, client, proposer, token, recipient, 1_000)
}

/// Duplicate-proposal detection keys off the transfer details, so tests that need
/// two live proposals must vary the amount.
fn propose_amount(
    env: &Env,
    client: &VaultDAOClient<'_>,
    proposer: &Address,
    token: &Address,
    recipient: &Address,
    amount: i128,
) -> u64 {
    client.propose_transfer(
        proposer,
        recipient,
        token,
        &amount,
        &Symbol::new(env, "orig"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    )
}

fn amend(
    env: &Env,
    client: &VaultDAOClient<'_>,
    proposer: &Address,
    proposal_id: u64,
    amount: i128,
    recipient: &Address,
) {
    client.amend_proposal(
        proposer,
        &proposal_id,
        recipient,
        &amount,
        &Symbol::new(env, "amended"),
        &Symbol::new(env, "reason"),
    );
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
// Default limit
// ============================================================================

#[test]
fn test_default_max_amendments_is_three() {
    let env = Env::default();
    let (client, _admin, _proposer, _token, _recipient) = setup(&env);

    assert_eq!(client.get_max_amendments(), 3);
}

#[test]
fn test_amendment_count_starts_at_zero() {
    let env = Env::default();
    let (client, _admin, proposer, token, recipient) = setup(&env);

    let id = propose(&env, &client, &proposer, &token, &recipient);
    assert_eq!(client.get_amendment_count(&id), 0);
}

#[test]
fn test_amendments_up_to_limit_succeed() {
    let env = Env::default();
    let (client, _admin, proposer, token, recipient) = setup(&env);

    let id = propose(&env, &client, &proposer, &token, &recipient);

    for i in 1..=3i128 {
        amend(&env, &client, &proposer, id, 1_000 + i, &recipient);
        assert_eq!(client.get_amendment_count(&id), i as u32);
    }
}

#[test]
fn test_amendment_beyond_limit_is_rejected() {
    let env = Env::default();
    let (client, _admin, proposer, token, recipient) = setup(&env);

    let id = propose(&env, &client, &proposer, &token, &recipient);

    for i in 1..=3i128 {
        amend(&env, &client, &proposer, id, 1_000 + i, &recipient);
    }

    let res = client.try_amend_proposal(
        &proposer,
        &id,
        &recipient,
        &2_000i128,
        &Symbol::new(&env, "fourth"),
        &Symbol::new(&env, "reason"),
    );
    assert_eq!(res.err(), Some(Ok(VaultError::AmendmentLimitExceeded)));
}

#[test]
fn test_rejected_amendment_leaves_proposal_untouched() {
    let env = Env::default();
    let (client, _admin, proposer, token, recipient) = setup(&env);

    let id = propose(&env, &client, &proposer, &token, &recipient);
    for i in 1..=3i128 {
        amend(&env, &client, &proposer, id, 1_000 + i, &recipient);
    }

    let before = client.get_proposal(&id);
    let _ = client.try_amend_proposal(
        &proposer,
        &id,
        &recipient,
        &9_999i128,
        &Symbol::new(&env, "fourth"),
        &Symbol::new(&env, "reason"),
    );
    let after = client.get_proposal(&id);

    assert_eq!(after.amount, before.amount);
    assert_eq!(client.get_amendment_count(&id), 3);
    assert_eq!(client.get_proposal_amendments(&id).len(), 3);
}

// ============================================================================
// Configurable limit
// ============================================================================

#[test]
fn test_admin_can_raise_limit() {
    let env = Env::default();
    let (client, admin, proposer, token, recipient) = setup(&env);

    client.set_max_amendments(&admin, &5u32);
    assert_eq!(client.get_max_amendments(), 5);

    let id = propose(&env, &client, &proposer, &token, &recipient);
    for i in 1..=5i128 {
        amend(&env, &client, &proposer, id, 1_000 + i, &recipient);
    }
    assert_eq!(client.get_amendment_count(&id), 5);
}

#[test]
fn test_admin_can_lower_limit() {
    let env = Env::default();
    let (client, admin, proposer, token, recipient) = setup(&env);

    client.set_max_amendments(&admin, &1u32);

    let id = propose(&env, &client, &proposer, &token, &recipient);
    amend(&env, &client, &proposer, id, 1_500, &recipient);

    let res = client.try_amend_proposal(
        &proposer,
        &id,
        &recipient,
        &2_000i128,
        &Symbol::new(&env, "second"),
        &Symbol::new(&env, "reason"),
    );
    assert_eq!(res.err(), Some(Ok(VaultError::AmendmentLimitExceeded)));
}

#[test]
fn test_set_max_amendments_admin_only() {
    let env = Env::default();
    let (client, _admin, proposer, _token, _recipient) = setup(&env);

    let res = client.try_set_max_amendments(&proposer, &10u32);
    assert_eq!(res.err(), Some(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_set_max_amendments_rejects_zero() {
    let env = Env::default();
    let (client, admin, _proposer, _token, _recipient) = setup(&env);

    let res = client.try_set_max_amendments(&admin, &0u32);
    assert_eq!(res.err(), Some(Ok(VaultError::InvalidAmount)));
}

// ============================================================================
// Counters are per-proposal
// ============================================================================

#[test]
fn test_limit_is_tracked_per_proposal() {
    let env = Env::default();
    let (client, _admin, proposer, token, recipient) = setup(&env);

    let first = propose_amount(&env, &client, &proposer, &token, &recipient, 1_000);
    let second = propose_amount(&env, &client, &proposer, &token, &recipient, 2_000);

    for i in 1..=3i128 {
        amend(&env, &client, &proposer, first, 1_000 + i, &recipient);
    }

    assert_eq!(client.get_amendment_count(&first), 3);
    assert_eq!(client.get_amendment_count(&second), 0);

    // The second proposal still has its full allowance.
    amend(&env, &client, &proposer, second, 2_500, &recipient);
    assert_eq!(client.get_amendment_count(&second), 1);
}

// ============================================================================
// Warning events
// ============================================================================

#[test]
fn test_warning_emitted_as_limit_approaches() {
    let env = Env::default();
    let (client, _admin, proposer, token, recipient) = setup(&env);

    let id = propose(&env, &client, &proposer, &token, &recipient);

    // First amendment leaves 2 remaining — no warning yet.
    amend(&env, &client, &proposer, id, 1_100, &recipient);
    assert!(
        !emitted(&env, "amendment_limit_warn"),
        "no warning while 2 amendments remain"
    );

    // Second amendment leaves 1 remaining — warning fires.
    amend(&env, &client, &proposer, id, 1_200, &recipient);
    assert!(
        emitted(&env, "amendment_limit_warn"),
        "warning expected when 1 amendment remains"
    );
}
