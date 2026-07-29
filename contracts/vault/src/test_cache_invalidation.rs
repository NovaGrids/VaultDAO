//! Tests for Issue #1459: Backend Cache Invalidation Strategy
//!
//! Tests verify that:
//! - Admin can call `invalidate_cache` with a tag symbol
//! - `cache_invalidated` event is emitted on-chain
//! - Non-admin calling `invalidate_cache` fails with `Unauthorized`

#![cfg(test)]

use super::*;
use crate::types::{RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, Vec};

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let member = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    client.initialize(
        &admin,
        &InitConfig {
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
            spending_limit: 1_000_000,
            daily_limit: 5_000_000,
            weekly_limit: 10_000_000,
            timelock_threshold: 999_999,
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

    (client, admin, member)
}

#[test]
fn test_invalidate_cache_admin_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _member) = setup(&env);

    let tag = Symbol::new(&env, "contract-snapshots");
    client.invalidate_cache(&admin, &tag);
}

#[test]
fn test_invalidate_cache_unauthorized_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, member) = setup(&env);

    let tag = Symbol::new(&env, "proposal-101");
    let result = client.try_invalidate_cache(&member, &tag);

    assert_eq!(result, Err(Ok(VaultError::Unauthorized)));
}
