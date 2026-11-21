//! Tests for Issue #2132: `list_proposals_by_status` cursor-based queries.
//!
//! Covers each status reached through the public flows, status transitions
//! moving proposals between indexes, cursor pagination, and the 50-item cap.

#![cfg(test)]

use crate::types::{ConditionLogic, Priority, RetryConfig, ThresholdStrategy, VelocityConfig, ProposalStatus};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::Address as _,
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let signer = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(env, &token).mint(&contract_id, &10_000_000);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    client.initialize(
        &admin,
        &InitConfig {
            upgrade_timelock_delay: 17_280,
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
            spending_limit: 1_000_000,
            daily_limit: 5_000_000,
            weekly_limit: 10_000_000,
            timelock_threshold: 999_999_999,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 100,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            veto_addresses: Vec::new(env),
            veto_window_ledgers: 0,
            retry_config: RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(env),
            staking_config: crate::types::StakingConfig::default(),
            proposal_id_prefix: 0,
        },
    );

    (client, admin, signer, token)
}

fn propose(client: &VaultDAOClient<'_>, admin: &Address, token: &Address, amount: i128) -> u64 {
    let recipient = Address::generate(&client.env);
    client.propose_transfer(
        admin,
        &recipient,
        token,
        &amount,
        &Symbol::new(&client.env, "pay"),
        &Priority::Normal,
        &Vec::new(&client.env),
        &ConditionLogic::And,
        &0i128,
    )
}

fn ids(env: &Env, proposals: &Vec<crate::types::Proposal>) -> Vec<u64> {
    let mut out = Vec::new(env);
    for p in proposals.iter() {
        out.push_back(p.id);
    }
    out
}

#[test]
fn test_status_lists_are_empty_on_fresh_vault() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _signer, _token) = setup(&env);

    let pending = client.list_proposals_by_status(&ProposalStatus::Pending, &0u64, &50u32);
    assert_eq!(pending.len(), 0);
    let executed = client.list_proposals_by_status(&ProposalStatus::Executed, &0u64, &50u32);
    assert_eq!(executed.len(), 0);
}

#[test]
fn test_pending_and_cancelled_lists_split_on_cancel() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer, token) = setup(&env);

    let p1 = propose(&client, &admin, &token, 100);
    let p2 = propose(&client, &admin, &token, 100);
    let p3 = propose(&client, &admin, &token, 100);
    client.cancel_proposal(&admin, &p2, &Symbol::new(&env, "stop"));

    let pending = client.list_proposals_by_status(&ProposalStatus::Pending, &0u64, &50u32);
    assert_eq!(ids(&env, &pending), Vec::from_array(&env, [p1, p3]));

    let cancelled = client.list_proposals_by_status(&ProposalStatus::Cancelled, &0u64, &50u32);
    assert_eq!(ids(&env, &cancelled), Vec::from_array(&env, [p2]));
    assert_eq!(cancelled.get(0).unwrap().status, ProposalStatus::Cancelled);
}

#[test]
fn test_approved_list_contains_only_approved_proposals() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, signer, token) = setup(&env);

    let p1 = propose(&client, &admin, &token, 100);
    let p2 = propose(&client, &admin, &token, 100);
    client.approve_proposal(&signer, &p1);
    client.approve_proposal(&admin, &p1);

    let approved = client.list_proposals_by_status(&ProposalStatus::Approved, &0u64, &50u32);
    assert_eq!(ids(&env, &approved), Vec::from_array(&env, [p1]));

    let pending = client.list_proposals_by_status(&ProposalStatus::Pending, &0u64, &50u32);
    assert_eq!(ids(&env, &pending), Vec::from_array(&env, [p2]));
}

#[test]
fn test_executed_transition_moves_proposal_out_of_approved() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, signer, token) = setup(&env);

    let p1 = propose(&client, &admin, &token, 100);
    client.approve_proposal(&signer, &p1);
    client.approve_proposal(&admin, &p1);
    client.execute_proposal(&admin, &p1);

    let executed = client.list_proposals_by_status(&ProposalStatus::Executed, &0u64, &50u32);
    assert_eq!(ids(&env, &executed), Vec::from_array(&env, [p1]));

    // No stale entry may remain under the previous status.
    let approved = client.list_proposals_by_status(&ProposalStatus::Approved, &0u64, &50u32);
    assert_eq!(approved.len(), 0);
}

#[test]
fn test_rejected_list_contains_rejected_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, signer, token) = setup(&env);

    let p1 = propose(&client, &admin, &token, 100);
    client.reject_proposal(&signer, &p1);
    client.reject_proposal(&admin, &p1);

    let rejected = client.list_proposals_by_status(&ProposalStatus::Rejected, &0u64, &50u32);
    assert_eq!(ids(&env, &rejected), Vec::from_array(&env, [p1]));
    let pending = client.list_proposals_by_status(&ProposalStatus::Pending, &0u64, &50u32);
    assert_eq!(pending.len(), 0);
}

#[test]
fn test_cursor_pagination_walks_all_pending_proposals() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer, token) = setup(&env);

    for _ in 0..5 {
        propose(&client, &admin, &token, 100);
    }

    let page1 = client.list_proposals_by_status(&ProposalStatus::Pending, &0u64, &2u32);
    assert_eq!(ids(&env, &page1), Vec::from_array(&env, [1u64, 2]));

    let page2 = client.list_proposals_by_status(&ProposalStatus::Pending, &2u64, &2u32);
    assert_eq!(ids(&env, &page2), Vec::from_array(&env, [3u64, 4]));

    let page3 = client.list_proposals_by_status(&ProposalStatus::Pending, &4u64, &2u32);
    assert_eq!(ids(&env, &page3), Vec::from_array(&env, [5u64]));

    let page4 = client.list_proposals_by_status(&ProposalStatus::Pending, &5u64, &2u32);
    assert_eq!(page4.len(), 0);
}

#[test]
fn test_cursor_skips_proposals_in_other_statuses() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer, token) = setup(&env);

    propose(&client, &admin, &token, 100); // 1 pending
    let p2 = propose(&client, &admin, &token, 100);
    propose(&client, &admin, &token, 100); // 3 pending
    client.cancel_proposal(&admin, &p2, &Symbol::new(&env, "stop"));

    let page = client.list_proposals_by_status(&ProposalStatus::Pending, &0u64, &50u32);
    assert_eq!(ids(&env, &page), Vec::from_array(&env, [1u64, 3]));
    let after_first = client.list_proposals_by_status(&ProposalStatus::Pending, &1u64, &50u32);
    assert_eq!(ids(&env, &after_first), Vec::from_array(&env, [3u64]));
}

#[test]
fn test_limit_is_capped_at_fifty() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer, token) = setup(&env);

    for _ in 0..55 {
        propose(&client, &admin, &token, 100);
    }

    let page = client.list_proposals_by_status(&ProposalStatus::Pending, &0u64, &500u32);
    assert_eq!(page.len(), 50);
    assert_eq!(page.get(49).unwrap().id, 50);

    let rest = client.list_proposals_by_status(&ProposalStatus::Pending, &50u64, &50u32);
    assert_eq!(ids(&env, &rest), Vec::from_array(&env, [51u64, 52, 53, 54, 55]));
}
