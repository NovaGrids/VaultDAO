//! Property-based tests for the spending limit system.
//!
//! The daily, weekly, per-proposal and per-token limits interact in ways
//! that are easy to get right for the specific scenarios covered by unit
//! tests but wrong for some interleaving of proposal creation and
//! cancellation nobody thought to write a test for. Proptest explores the
//! space of possible action sequences instead of a handful of fixed ones.
#![cfg(test)]

use crate::storage;
use crate::types::{
    ConditionLogic, InitConfig, Priority, RecoveryConfig, RetryConfig, StakingConfig,
    ThresholdStrategy, VelocityConfig, VoteWeight,
};
use crate::{VaultDAO, VaultDAOClient};
use proptest::collection::vec as prop_vec;
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};
use std::collections::VecDeque;

const DAY_SECS: u64 = 86_400;
const WEEK_SECS: u64 = 604_800;
const DAILY_LIMIT: i128 = 5_000_000;
const WEEKLY_LIMIT: i128 = 10_000_000;
const SPENDING_LIMIT: i128 = 2_000_000;

/// A single step in a randomly generated proposal-lifecycle sequence.
#[derive(Clone, Debug)]
enum Action {
    /// Propose a transfer of the given amount.
    Propose(i128),
    /// Cancel the oldest still-pending proposal, if any.
    CancelOldest,
    /// Advance the ledger timestamp, possibly crossing a day/week boundary.
    AdvanceTime(u64),
}

fn action_strategy() -> impl Strategy<Value = Action> {
    prop_oneof![
        4 => (1i128..=(SPENDING_LIMIT * 2)).prop_map(Action::Propose),
        2 => Just(Action::CancelOldest),
        1 => (0u64..=200_000u64).prop_map(Action::AdvanceTime),
    ]
}

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(env, &token).mint(&contract_id, &1_000_000_000);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    client.initialize(
        &admin,
        &InitConfig {
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers,
            threshold: 1,
            quorum: 0,
            quorum_percentage: 0,
            default_voting_deadline: 0,
            spending_limit: SPENDING_LIMIT,
            daily_limit: DAILY_LIMIT,
            weekly_limit: WEEKLY_LIMIT,
            // Keep timelocks out of the picture: this property is only about
            // the spend counters, which are reserved at proposal-creation
            // time regardless of when/if the proposal is later executed.
            timelock_threshold: 999_999_999,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 1_000_000_000,
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
            recovery_config: RecoveryConfig::default(env),
            staking_config: StakingConfig::default(),
            proposal_id_prefix: 0,
        },
    );

    (client, admin, token)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// Property: daily (and weekly) spent never exceeds the configured,
    /// reputation-adjusted limit, no matter the order of proposal creation,
    /// cancellation, and day/week boundary crossings.
    #[test]
    fn daily_and_weekly_spent_never_exceed_limits(
        actions in prop_vec(action_strategy(), 1..40),
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin, token) = setup(&env);
        let recipient = Address::generate(&env);

        let mut pending: VecDeque<u64> = VecDeque::new();

        for action in actions {
            match action {
                Action::Propose(amount) => {
                    if let Ok(Ok(id)) = client.try_propose_transfer(
                        &admin,
                        &recipient,
                        &token,
                        &amount,
                        &Symbol::new(&env, "p"),
                        &Priority::Normal,
                        &Vec::new(&env),
                        &ConditionLogic::And,
                        &0i128,
                    ) {
                        pending.push_back(id);
                    }
                }
                Action::CancelOldest => {
                    if let Some(id) = pending.pop_front() {
                        let _ =
                            client.try_cancel_proposal(&admin, &id, &Symbol::new(&env, "c"));
                    }
                }
                Action::AdvanceTime(delta) => {
                    let now = env.ledger().timestamp();
                    env.ledger().set_timestamp(now + delta);
                }
            }

            // Re-derive the same reputation-adjusted limits the contract
            // itself applies (see `propose_transfer_internal`), so the
            // invariant holds even once an address's reputation crosses the
            // 750 boost threshold.
            let rep = storage::get_reputation(&env, &admin);
            let adjusted_daily_limit = if rep.score >= 750 {
                (DAILY_LIMIT * 3) / 2
            } else {
                DAILY_LIMIT
            };
            let adjusted_weekly_limit = if rep.score >= 750 {
                (WEEKLY_LIMIT * 3) / 2
            } else {
                WEEKLY_LIMIT
            };

            let today = env.ledger().timestamp() / DAY_SECS;
            let week = env.ledger().timestamp() / WEEK_SECS;
            let spent_today = client.get_daily_spent(&today);
            let spent_week = client.get_weekly_spent(&week);

            prop_assert!(spent_today >= 0, "daily spent must never go negative");
            prop_assert!(spent_week >= 0, "weekly spent must never go negative");
            prop_assert!(
                spent_today <= adjusted_daily_limit,
                "daily spent {} exceeded adjusted daily limit {}",
                spent_today,
                adjusted_daily_limit
            );
            prop_assert!(
                spent_week <= adjusted_weekly_limit,
                "weekly spent {} exceeded adjusted weekly limit {}",
                spent_week,
                adjusted_weekly_limit
            );
        }
    }
}
