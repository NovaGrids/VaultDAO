//! Tests for Issue #1345: Spending limit refunds must credit the original
//! day/week buckets where the spend was reserved, not the current buckets.
#![cfg(test)]

use crate::types::{ConditionLogic, Priority, RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};

const DAY_SECS: u64 = 86_400;
const WEEK_SECS: u64 = 604_800;

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address, Address) {
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

    (client, admin, signer, token, contract_id)
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

#[test]
fn test_cancel_across_day_boundary_refunds_original_day_bucket() {
    let env = Env::default();
    env.mock_all_auths();

    // Start mid-epoch so day numbers are non-trivial
    env.ledger().set_timestamp(DAY_SECS * 10);
    let (client, admin, _signer, token, _contract) = setup(&env);

    let amount: i128 = 25_000;
    let creation_day = env.ledger().timestamp() / DAY_SECS;
    let proposal_id = propose(&client, &admin, &token, amount);

    assert_eq!(client.get_pending_reserved(&creation_day), amount);
    let proposal = client.get_proposal(&proposal_id);
    assert!(proposal.has_spend_buckets);
    assert_eq!(proposal.spend_day, creation_day);

    // Advance past the day boundary
    env.ledger().set_timestamp(DAY_SECS * 11);
    let cancel_day = env.ledger().timestamp() / DAY_SECS;
    assert_ne!(creation_day, cancel_day);

    client.cancel_proposal(&admin, &proposal_id, &Symbol::new(&env, "late"));

    // Original bucket's pending reservation must be fully released
    assert_eq!(
        client.get_pending_reserved(&creation_day),
        0,
        "cancel must release the creation-day pending reservation"
    );
    // Current day must not receive an unearned reservation
    assert_eq!(
        client.get_pending_reserved(&cancel_day),
        0,
        "cancel-day bucket must not be credited"
    );
    // Executed spend must remain zero in both buckets
    assert_eq!(client.get_daily_spent(&creation_day), 0);
    assert_eq!(client.get_daily_spent(&cancel_day), 0);
}

#[test]
fn test_cancel_across_week_boundary_refunds_original_week_bucket() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set_timestamp(WEEK_SECS * 3);
    let (client, admin, _signer, token, _contract) = setup(&env);

    let amount: i128 = 40_000;
    let creation_week = env.ledger().timestamp() / WEEK_SECS;
    let creation_day = env.ledger().timestamp() / DAY_SECS;
    let proposal_id = propose(&client, &admin, &token, amount);

    assert_eq!(client.get_pending_reserved(&creation_week), amount);

    // Jump into the next week
    env.ledger().set_timestamp(WEEK_SECS * 4);
    let cancel_week = env.ledger().timestamp() / WEEK_SECS;
    assert_ne!(creation_week, cancel_week);

    client.cancel_proposal(&admin, &proposal_id, &Symbol::new(&env, "nextwk"));

    assert_eq!(
        client.get_pending_reserved(&creation_week),
        0,
        "cancel must release the creation-week pending reservation"
    );
    assert_eq!(
        client.get_pending_reserved(&cancel_week),
        0,
        "cancel-week bucket must not be credited"
    );
    // Day bucket from creation must also be clean
    assert_eq!(client.get_pending_reserved(&creation_day), 0);
    assert_eq!(client.get_daily_spent(&creation_day), 0);
    assert_eq!(client.get_weekly_spent(&creation_week), 0);
}

#[test]
fn test_multi_day_cancel_does_not_inflate_new_day_capacity() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set_timestamp(DAY_SECS * 20);
    let (client, admin, _signer, token, _contract) = setup(&env);

    let amount: i128 = 15_000;
    let day_n = env.ledger().timestamp() / DAY_SECS;
    let id1 = propose(&client, &admin, &token, amount);
    assert_eq!(client.get_pending_reserved(&day_n), amount);

    // Next day: create another proposal, then cancel the day-N proposal
    env.ledger().set_timestamp(DAY_SECS * 21);
    let day_n1 = env.ledger().timestamp() / DAY_SECS;
    let id2 = propose(&client, &admin, &token, amount);
    assert_eq!(client.get_pending_reserved(&day_n1), amount);

    client.cancel_proposal(&admin, &id1, &Symbol::new(&env, "old"));

    assert_eq!(client.get_pending_reserved(&day_n), 0);
    assert_eq!(
        client.get_pending_reserved(&day_n1),
        amount,
        "cancelling day-N proposal must not reduce day-N+1 reservation"
    );

    // Cancelling day-N+1 proposal clears only that bucket
    client.cancel_proposal(&admin, &id2, &Symbol::new(&env, "new"));
    assert_eq!(client.get_pending_reserved(&day_n1), 0);
}

#[test]
fn test_rejection_across_day_boundary_refunds_original_day_bucket() {
    let env = Env::default();
    env.mock_all_auths();

    // Start mid-epoch so day numbers are non-trivial
    env.ledger().set_timestamp(DAY_SECS * 10);
    let (client, admin, _signer, token, _contract) = setup(&env);

    let amount: i128 = 25_000;
    let creation_day = env.ledger().timestamp() / DAY_SECS;
    let proposal_id = propose(&client, &admin, &token, amount);

    assert_eq!(client.get_daily_spent(&creation_day), amount);
    let proposal = client.get_proposal(&proposal_id);
    assert!(proposal.has_spend_buckets);
    assert_eq!(proposal.spend_day, creation_day);

    // Advance past the day boundary
    env.ledger().set_timestamp(DAY_SECS * 11);
    let rejection_day = env.ledger().timestamp() / DAY_SECS;
    assert_ne!(creation_day, rejection_day);

    client.reject_proposal(&admin, &proposal_id, &Symbol::new(&env, "nope"));

    // Original bucket must be fully credited back
    assert_eq!(
        client.get_daily_spent(&creation_day),
        0,
        "refund must credit the creation-day bucket"
    );
    // Current day must not receive an unearned credit
    assert_eq!(
        client.get_daily_spent(&rejection_day),
        0,
        "rejection-day bucket must not be credited"
    );
}

#[test]
fn test_rejection_across_week_boundary_refunds_original_week_bucket() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set_timestamp(WEEK_SECS * 3);
    let (client, admin, _signer, token, _contract) = setup(&env);

    let amount: i128 = 40_000;
    let creation_week = env.ledger().timestamp() / WEEK_SECS;
    let creation_day = env.ledger().timestamp() / DAY_SECS;
    let proposal_id = propose(&client, &admin, &token, amount);

    assert_eq!(client.get_weekly_spent(&creation_week), amount);

    // Jump into the next week
    env.ledger().set_timestamp(WEEK_SECS * 4);
    let rejection_week = env.ledger().timestamp() / WEEK_SECS;
    assert_ne!(creation_week, rejection_week);

    client.reject_proposal(&admin, &proposal_id, &Symbol::new(&env, "nextwk"));

    assert_eq!(
        client.get_weekly_spent(&creation_week),
        0,
        "refund must credit the creation-week bucket"
    );
    assert_eq!(
        client.get_weekly_spent(&rejection_week),
        0,
        "rejection-week bucket must not be credited"
    );
    // Day bucket from creation must also be clean
    assert_eq!(client.get_daily_spent(&creation_day), 0);
}

#[test]
fn test_auto_expire_across_day_boundary_refunds_original_day_bucket() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set_timestamp(DAY_SECS * 30);
    let (client, admin, _signer, token, _contract) = setup(&env);

    let amount: i128 = 30_000;
    let creation_day = env.ledger().timestamp() / DAY_SECS;
    let creation_week = env.ledger().timestamp() / WEEK_SECS;
    let proposal_id = propose(&client, &admin, &token, amount);

    assert_eq!(client.get_daily_spent(&creation_day), amount);
    assert_eq!(client.get_weekly_spent(&creation_week), amount);
    let proposal = client.get_proposal(&proposal_id);
    assert!(proposal.has_spend_buckets);
    assert_eq!(proposal.spend_day, creation_day);
    assert_eq!(proposal.spend_week, creation_week);

    // Advance past the approval timeout
    env.ledger().set_timestamp(DAY_SECS * 31);
    let expire_day = env.ledger().timestamp() / DAY_SECS;
    assert_ne!(creation_day, expire_day);

    client.auto_expire_proposals(&admin, &10u32);

    // Original buckets must be fully credited back
    assert_eq!(
        client.get_daily_spent(&creation_day),
        0,
        "auto-expire must credit the creation-day bucket"
    );
    assert_eq!(
        client.get_weekly_spent(&creation_week),
        0,
        "auto-expire must credit the creation-week bucket"
    );
    // Current buckets must not receive an unearned credit
    assert_eq!(
        client.get_daily_spent(&expire_day),
        0,
        "expire-day bucket must not be credited"
    );
}

#[test]
fn test_deadline_rejection_refunds_original_day_bucket() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set_timestamp(DAY_SECS * 30);
    let (client, admin, _signer, token, _contract) = setup(&env);

    let amount: i128 = 30_000;
    let creation_day = env.ledger().timestamp() / DAY_SECS;
    let proposal_id = propose(&client, &admin, &token, amount);

    assert_eq!(client.get_daily_spent(&creation_day), amount);

    // Advance past the day boundary and beyond the voting deadline
    env.ledger().set_timestamp(DAY_SECS * 31);
    let reject_day = env.ledger().timestamp() / DAY_SECS;
    assert_ne!(creation_day, reject_day);

    client.reject_proposal(&admin, &proposal_id, &Symbol::new(&env, "expired"));

    assert_eq!(
        client.get_daily_spent(&creation_day),
        0,
        "deadline rejection must credit the creation-day bucket"
    );
    assert_eq!(
        client.get_daily_spent(&reject_day),
        0,
        "reject-day bucket must not be credited"
    );
}

#[test]
fn test_deadline_rejection_refunds_original_week_bucket() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set_timestamp(WEEK_SECS * 6);
    let (client, admin, _signer, token, _contract) = setup(&env);

    let amount: i128 = 45_000;
    let creation_week = env.ledger().timestamp() / WEEK_SECS;
    let creation_day = env.ledger().timestamp() / DAY_SECS;
    let proposal_id = propose(&client, &admin, &token, amount);

    assert_eq!(client.get_weekly_spent(&creation_week), amount);

    // Jump into the next week
    env.ledger().set_timestamp(WEEK_SECS * 7);
    let reject_week = env.ledger().timestamp() / WEEK_SECS;
    assert_ne!(creation_week, reject_week);

    client.reject_proposal(&admin, &proposal_id, &Symbol::new(&env, "expired"));

    assert_eq!(
        client.get_weekly_spent(&creation_week),
        0,
        "deadline rejection must credit the creation-week bucket"
    );
    assert_eq!(
        client.get_weekly_spent(&reject_week),
        0,
        "reject-week bucket must not be credited"
    );
    assert_eq!(client.get_daily_spent(&creation_day), 0);
}

#[test]
fn test_proposal_records_spend_buckets_at_creation() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(DAY_SECS * 5 + 100);

    let (client, admin, _signer, token, _contract) = setup(&env);
    let day = env.ledger().timestamp() / DAY_SECS;
    let week = env.ledger().timestamp() / WEEK_SECS;
    let proposal_id = propose(&client, &admin, &token, 1_000);

    let proposal = client.get_proposal(&proposal_id);
    assert!(proposal.has_spend_buckets);
    assert_eq!(proposal.spend_day, day);
    assert_eq!(proposal.spend_week, week);
}

#[test]
fn test_execute_after_proposal_expiry_persists_refunds_and_metrics() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|ledger| ledger.sequence_number = 100);

    let (client, admin, signer, token, _contract) = setup(&env);
    let amount = 30_000;
    let day = env.ledger().timestamp() / DAY_SECS;
    let week = env.ledger().timestamp() / WEEK_SECS;
    let proposal_id = propose(&client, &admin, &token, amount);
    client.approve_proposal(&signer, &proposal_id);
    client.approve_proposal(&admin, &proposal_id);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, crate::types::ProposalStatus::Approved);
    assert_eq!(client.get_daily_spent(&day), amount);
    assert_eq!(client.get_weekly_spent(&week), amount);
    assert_eq!(crate::storage::get_token_daily_spent(&env, &token, day), amount);
    assert_eq!(crate::storage::get_token_weekly_spent(&env, &token, week), amount);
    let expired_before = client.get_metrics().expired_count;

    env.ledger().with_mut(|ledger| {
        ledger.sequence_number = proposal.expires_at as u32 + 1;
    });
    let result = client.try_execute_proposal(&signer, &proposal_id);

    assert!(matches!(result, Ok(Ok(()))));
    assert_eq!(
        client.get_proposal(&proposal_id).status,
        crate::types::ProposalStatus::Expired
    );
    assert_eq!(client.get_daily_spent(&day), 0);
    assert_eq!(client.get_weekly_spent(&week), 0);
    assert_eq!(crate::storage::get_token_daily_spent(&env, &token, day), 0);
    assert_eq!(crate::storage::get_token_weekly_spent(&env, &token, week), 0);
    assert_eq!(client.get_metrics().expired_count, expired_before + 1);
}

#[test]
fn test_execute_after_execution_window_persists_refunds_and_metrics() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|ledger| ledger.sequence_number = 100);

    let (client, admin, signer, token, _contract) = setup(&env);
    client.set_exec_window_ledgers(&admin, &10);
    let amount = 30_000;
    let day = env.ledger().timestamp() / DAY_SECS;
    let week = env.ledger().timestamp() / WEEK_SECS;
    let proposal_id = propose(&client, &admin, &token, amount);
    client.approve_proposal(&signer, &proposal_id);
    client.approve_proposal(&admin, &proposal_id);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, crate::types::ProposalStatus::Approved);
    assert_eq!(client.get_daily_spent(&day), amount);
    assert_eq!(client.get_weekly_spent(&week), amount);
    assert_eq!(crate::storage::get_token_daily_spent(&env, &token, day), amount);
    assert_eq!(crate::storage::get_token_weekly_spent(&env, &token, week), amount);
    let expired_before = client.get_metrics().expired_count;

    env.ledger().with_mut(|ledger| ledger.sequence_number = 111);
    let result = client.try_execute_proposal(&signer, &proposal_id);

    assert!(matches!(result, Ok(Ok(()))));
    assert_eq!(
        client.get_proposal(&proposal_id).status,
        crate::types::ProposalStatus::Expired
    );
    assert_eq!(client.get_daily_spent(&day), 0);
    assert_eq!(client.get_weekly_spent(&week), 0);
    assert_eq!(crate::storage::get_token_daily_spent(&env, &token, day), 0);
    assert_eq!(crate::storage::get_token_weekly_spent(&env, &token, week), 0);
    assert_eq!(client.get_metrics().expired_count, expired_before + 1);
}
