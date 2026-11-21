//! Tests for Issue #2146: Cooldown between consecutive `update_threshold` calls.
//!
//! An admin could previously call `update_threshold` repeatedly in the same
//! window, oscillating the threshold to open a low-threshold approval window.
//! These tests verify that:
//!
//! 1. The first call is never blocked by the cooldown.
//! 2. A second call within `admin_rotation_delay` ledgers is rejected with
//!    `ThresholdChangeCooldown`, on both the increase and reduction paths.
//! 3. The call succeeds once exactly `admin_rotation_delay` ledgers elapsed.
//! 4. Rejected calls do not reset or extend the cooldown window.

#![cfg(test)]

use super::*;
use crate::errors::VaultError;
use crate::types::{
    InitConfig, RetryConfig, ThresholdStrategy, VelocityConfig, VoteWeight,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Vec,
};

/// Ledger delay used for the admin rotation / threshold cooldown in all tests.
const COOLDOWN: u64 = 1440;
const START_LEDGER: u32 = 1_000;

/// Create a vault with `signer_count` signers (admin at index 0) and `threshold`.
fn make_vault(env: &Env, threshold: u32, signer_count: u32) -> (VaultDAOClient<'static>, Address) {
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = START_LEDGER);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let mut signers: Vec<Address> = Vec::new(env);
    signers.push_back(admin.clone());
    for _ in 1..signer_count {
        signers.push_back(Address::generate(env));
    }

    client.initialize(
        &admin,
        &InitConfig {
            upgrade_timelock_delay: 17_280,
            signers,
            threshold,
            quorum: 0,
            quorum_percentage: 0,
            spending_limit: 1_000_000,
            daily_limit: 5_000_000,
            weekly_limit: 10_000_000,
            timelock_threshold: 0,
            timelock_delay: 10,
            velocity_limit: VelocityConfig {
                limit: 1_000_000,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            default_voting_deadline: 0,
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
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: COOLDOWN,
        },
    );

    (client, admin)
}

fn set_ledger(env: &Env, sequence: u32) {
    env.ledger().with_mut(|l| l.sequence_number = sequence);
}

/// The first `update_threshold` call is never throttled.
#[test]
fn test_first_threshold_change_is_not_throttled() {
    let env = Env::default();
    let (client, admin) = make_vault(&env, 2, 4);

    let result = client.try_update_threshold(&admin, &3u32);
    assert!(result.is_ok(), "first update must not be blocked by cooldown");
    assert_eq!(client.get_config().threshold, 3);
}

/// Back-to-back increases in the same window are rejected.
#[test]
fn test_immediate_second_threshold_change_is_rejected() {
    let env = Env::default();
    let (client, admin) = make_vault(&env, 2, 4);

    client.update_threshold(&admin, &3u32);

    let second = client.try_update_threshold(&admin, &4u32);
    assert_eq!(
        second,
        Err(Ok(VaultError::ThresholdChangeCooldown)),
        "second change within cooldown must be rejected"
    );
    assert_eq!(client.get_config().threshold, 3, "rejected change must not apply");
}

/// Oscillation is blocked: a reduction right after an increase is rejected by the
/// cooldown, not allowed to open a low-threshold window.
#[test]
fn test_oscillating_reduction_after_increase_is_rejected() {
    let env = Env::default();
    let (client, admin) = make_vault(&env, 2, 4);

    client.update_threshold(&admin, &4u32);

    let reduction = client.try_update_threshold(&admin, &2u32);
    assert_eq!(
        reduction,
        Err(Ok(VaultError::ThresholdChangeCooldown)),
        "reduction within cooldown must be blocked before a proposal is created"
    );
    assert_eq!(client.get_config().threshold, 4, "rejected reduction must not apply");
}

/// One ledger short of the window is still rejected.
#[test]
fn test_change_one_ledger_before_cooldown_end_is_rejected() {
    let env = Env::default();
    let (client, admin) = make_vault(&env, 2, 4);

    client.update_threshold(&admin, &3u32);
    set_ledger(&env, START_LEDGER + COOLDOWN as u32 - 1);

    let result = client.try_update_threshold(&admin, &4u32);
    assert_eq!(result, Err(Ok(VaultError::ThresholdChangeCooldown)));
}

/// Exactly `admin_rotation_delay` ledgers after the last change, the call is allowed.
#[test]
fn test_change_allowed_after_cooldown_window_elapses() {
    let env = Env::default();
    let (client, admin) = make_vault(&env, 2, 4);

    client.update_threshold(&admin, &3u32);
    set_ledger(&env, START_LEDGER + COOLDOWN as u32);

    let result = client.try_update_threshold(&admin, &4u32);
    assert!(result.is_ok(), "change must be allowed once the window elapsed");
    assert_eq!(client.get_config().threshold, 4);
}

/// Rejected attempts inside the window must not push the window forward.
#[test]
fn test_rejected_attempts_do_not_extend_cooldown() {
    let env = Env::default();
    let (client, admin) = make_vault(&env, 2, 4);

    client.update_threshold(&admin, &3u32);

    // Repeated rejected attempts spread through the window.
    set_ledger(&env, START_LEDGER + 100);
    assert!(client.try_update_threshold(&admin, &4u32).is_err());
    set_ledger(&env, START_LEDGER + 1000);
    assert!(client.try_update_threshold(&admin, &4u32).is_err());

    // The window is still measured from the original successful change.
    set_ledger(&env, START_LEDGER + COOLDOWN as u32);
    let result = client.try_update_threshold(&admin, &4u32);
    assert!(
        result.is_ok(),
        "window must be measured from the last successful change, not rejected attempts"
    );
}

/// A successful reduction (which creates a proposal) also starts the cooldown.
#[test]
fn test_successful_reduction_starts_cooldown() {
    let env = Env::default();
    let (client, admin) = make_vault(&env, 3, 4);

    let proposal = client.update_threshold(&admin, &2u32);
    assert!(proposal.is_some(), "reduction must create a proposal");

    // Clear the pending proposal so only the cooldown can block the next call.
    let proposal_id = proposal.unwrap();
    client.cancel_proposal(&admin, &proposal_id, &soroban_sdk::Symbol::new(&env, "test"));

    let increase = client.try_update_threshold(&admin, &4u32);
    assert_eq!(increase, Err(Ok(VaultError::ThresholdChangeCooldown)));
}
