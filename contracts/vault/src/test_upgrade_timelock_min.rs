//! Unit tests for MIN_UPGRADE_TIMELOCK enforcement at contract initialization.
//!
//! Issue #1616 — Enforce Minimum Upgrade Timelock Duration at Contract Init.
//!
//! Scenarios covered:
//!  1. `upgrade_timelock_delay` below MIN_UPGRADE_TIMELOCK (17_280) is rejected
//!     with `VaultError::UpgradeTimelockTooShort`.
//!  2. `upgrade_timelock_delay` equal to MIN_UPGRADE_TIMELOCK is accepted.
//!  3. `upgrade_timelock_delay` above MIN_UPGRADE_TIMELOCK is accepted.
//!  4. Zero `upgrade_timelock_delay` is rejected (0 < MIN_UPGRADE_TIMELOCK).
//!  5. A value just below the minimum (17_279) is rejected.

#![cfg(test)]

use crate::errors::VaultError;
use crate::types::{InitConfig, RetryConfig, VelocityConfig};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

/// Mirrors `MIN_UPGRADE_TIMELOCK` in lib.rs (17_280 ledgers ≈ 24 h at 5 s/ledger).
const MIN_UPGRADE_TIMELOCK: u64 = 17_280;

// ============================================================================
// Helper
// ============================================================================

fn make_init_config(
    env: &Env,
    signers: Vec<Address>,
    upgrade_timelock_delay: u64,
) -> InitConfig {
    InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1_000,
        daily_limit: 5_000,
        weekly_limit: 10_000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
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
        high_impact_threshold: 70,
        admin_rotation_delay: 1_440,
        upgrade_timelock_delay,
    }
}

// ============================================================================
// Tests
// ============================================================================

/// Any delay strictly below MIN_UPGRADE_TIMELOCK must be rejected.
#[test]
fn test_upgrade_timelock_below_minimum_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let result = client.try_initialize(
        &admin,
        &make_init_config(&env, signers, MIN_UPGRADE_TIMELOCK - 1),
    );

    assert_eq!(result.err(), Some(Ok(VaultError::UpgradeTimelockTooShort)));
}

/// Zero delay must be rejected.
#[test]
fn test_upgrade_timelock_zero_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let result = client.try_initialize(&admin, &make_init_config(&env, signers, 0));

    assert_eq!(result.err(), Some(Ok(VaultError::UpgradeTimelockTooShort)));
}

/// 17_279 (one below minimum) must be rejected.
#[test]
fn test_upgrade_timelock_one_below_minimum_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let result = client.try_initialize(
        &admin,
        &make_init_config(&env, signers, MIN_UPGRADE_TIMELOCK - 1),
    );

    assert_eq!(result.err(), Some(Ok(VaultError::UpgradeTimelockTooShort)));
}

/// Exactly MIN_UPGRADE_TIMELOCK must be accepted and stored verbatim.
#[test]
fn test_upgrade_timelock_at_minimum_is_accepted() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    client.initialize(
        &admin,
        &make_init_config(&env, signers, MIN_UPGRADE_TIMELOCK),
    );

    let stored = client.get_config().unwrap();
    assert_eq!(stored.upgrade_timelock_delay, MIN_UPGRADE_TIMELOCK);
}

/// A delay above MIN_UPGRADE_TIMELOCK must be accepted and stored verbatim.
#[test]
fn test_upgrade_timelock_above_minimum_is_accepted() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    // 7 days ≈ 7 × 17_280 ledgers.
    let seven_days = MIN_UPGRADE_TIMELOCK * 7;
    client.initialize(&admin, &make_init_config(&env, signers, seven_days));

    let stored = client.get_config().unwrap();
    assert_eq!(stored.upgrade_timelock_delay, seven_days);
}
