//! Tests for pending reservation accounting in the vault contract.
//!
//! Proposals reserve daily/weekly spend at creation time; cancelling them
//! releases the reservation so other proposers can use the budget, and a new
//! day opens a fresh window.
//!
//! Rewritten against the current spend-bucket APIs. Two pieces of the
//! original suite remain unimplemented upstream and are NOT covered here:
//! the removed `get_pending_reserved` observability getters (use
//! `get_daily_spent` / `get_weekly_spent` instead) and per-proposer pending
//! caps (only the `ExceedsProposerPendingLimit` error variant exists; no
//! enforcement is wired up).

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};

use crate::{
    types::{InitConfig, Priority, RetryConfig, Role, ThresholdStrategy, VelocityConfig},
    VaultDAO, VaultDAOClient,
};

const DAY_SECS: u64 = 86_400;

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(Address::generate(env));

    client.initialize(
        &admin,
        &InitConfig {
            upgrade_timelock_delay: 17_280,
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
            spending_limit: 5_000,
            daily_limit: 10_000,
            weekly_limit: 100_000,
            timelock_threshold: 0,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 1_000_000,
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
            staking_config: crate::types::StakingConfig::default(),
            proposal_id_prefix: 0,
        },
    );
    client.add_supported_token(&admin, &token, &1_000_000, &10_000_000);

    (client, admin, token, contract_id)
}

/// Propose a transfer as `proposer` (granted Treasurer on first use).
fn propose(
    env: &Env,
    client: &VaultDAOClient,
    admin: &Address,
    proposer: &Address,
    token: &Address,
    amount: i128,
) -> u64 {
    client.set_role(admin, proposer, &Role::Treasurer);
    client.propose_transfer(
        proposer,
        &Address::generate(env),
        token,
        &amount,
        &Symbol::new(env, "memo"),
        &Priority::Normal,
        &Vec::new(env),
        &crate::types::ConditionLogic::And,
        &0i128,
    )
}

#[test]
fn test_cancelled_pending_proposals_free_daily_budget_for_second_proposer() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _contract) = setup(&env);

    let proposer_one = Address::generate(&env);
    let proposer_two = Address::generate(&env);

    // Proposer one fills the daily budget (10 x 1000) with pending proposals.
    let mut proposal_ids = Vec::new(&env);
    for _ in 0..10 {
        proposal_ids.push_back(propose(&env, &client, &admin, &proposer_one, &token, 1000));
    }
    let day = env.ledger().timestamp() / DAY_SECS;
    assert_eq!(client.get_daily_spent(&day), 10_000);

    // The budget is exhausted: another proposal must fail.
    assert!(client
        .try_propose_transfer(
            &proposer_one,
            &Address::generate(&env),
            &token,
            &1000i128,
            &Symbol::new(&env, "memo"),
            &Priority::Normal,
            &Vec::new(&env),
            &crate::types::ConditionLogic::And,
            &0i128,
        )
        .is_err());
    assert!(client
        .try_propose_transfer(
            &proposer_two,
            &Address::generate(&env),
            &token,
            &1000i128,
            &Symbol::new(&env, "memo"),
            &Priority::Normal,
            &Vec::new(&env),
            &crate::types::ConditionLogic::And,
            &0i128,
        )
        .is_err());

    // Proposer one cancels everything, freeing the budget...
    for id in proposal_ids.iter() {
        client.cancel_proposal(&proposer_one, &id, &Symbol::new(&env, "c"));
    }
    assert_eq!(client.get_daily_spent(&day), 0);

    // ...so proposer two can now propose successfully.
    let id = propose(&env, &client, &admin, &proposer_two, &token, 1000);
    assert!(id > 0);
    assert_eq!(client.get_daily_spent(&day), 1000);
}

#[test]
fn test_pending_reservations_track_multiple_proposers() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, _contract) = setup(&env);

    let proposer_one = Address::generate(&env);
    let proposer_two = Address::generate(&env);
    let day = env.ledger().timestamp() / DAY_SECS;

    // Proposer one reserves 6000 of the 10_000 daily budget.
    let mut ids_one = Vec::new(&env);
    for _ in 0..6 {
        ids_one.push_back(propose(
            &env, &client, &admin, &proposer_one, &token, 1000,
        ));
    }
    assert_eq!(client.get_daily_spent(&day), 6000);

    // Proposer two fits 4 more; the 5th would exceed the budget.
    for _ in 0..4 {
        propose(&env, &client, &admin, &proposer_two, &token, 1000);
    }
    assert!(client
        .try_propose_transfer(
            &proposer_two,
            &Address::generate(&env),
            &token,
            &1000i128,
            &Symbol::new(&env, "memo"),
            &Priority::Normal,
            &Vec::new(&env),
            &crate::types::ConditionLogic::And,
            &0i128,
        )
        .is_err());

    // Cancelling proposer one's proposals frees exactly their share.
    for id in ids_one.iter() {
        client.cancel_proposal(&proposer_one, &id, &Symbol::new(&env, "c"));
    }
    assert_eq!(client.get_daily_spent(&day), 4000);
}

#[test]
fn test_pending_reservations_reset_after_day_rollover() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = DAY_SECS * 10);
    let (client, admin, token, _contract) = setup(&env);

    let proposer = Address::generate(&env);

    // Fill the daily budget with pending proposals.
    for _ in 0..10 {
        propose(&env, &client, &admin, &proposer, &token, 1000);
    }
    let day = env.ledger().timestamp() / DAY_SECS;
    assert_eq!(client.get_daily_spent(&day), 10_000);

    // Advance past the daily window: the new day starts empty.
    env.ledger().with_mut(|l| l.timestamp = DAY_SECS * 11);
    let next_day = env.ledger().timestamp() / DAY_SECS;
    assert_ne!(day, next_day);
    assert_eq!(client.get_daily_spent(&next_day), 0);

    let id = propose(&env, &client, &admin, &proposer, &token, 1000);
    assert!(id > 0, "proposal should succeed after day rollover");
    assert_eq!(client.get_daily_spent(&next_day), 1000);
}
