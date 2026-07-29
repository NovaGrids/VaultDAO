//! Tests for Issue #1360: Graduated Staking Slashing
//!
//! 0% on execution, `slash_percentage` on rejection, `cancellation_slash_percentage`
//! on cancellation. Without the cancellation tier a proposer could spam proposals
//! and withdraw them for free.
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

fn staking_config(rejection_pct: u32, cancellation_pct: u32, to_insurance: bool) -> StakingConfig {
    StakingConfig {
        enabled: true,
        min_amount: 1,
        base_stake_bps: 1000, // 10% of the proposal amount
        max_stake_amount: i128::MAX,
        reputation_discount_threshold: 1000, // unreachable — no discount
        reputation_discount_percentage: 0,
        slash_percentage: rejection_pct,
        cancellation_slash_percentage: cancellation_pct,
        slash_to_insurance_pool: to_insurance,
        compound_lock_period: 17280,
        compound_epoch: 17280,
        reward_bps_per_execution: 0,
    }
}

/// Returns (client, admin, proposer, token, contract_id).
fn setup(
    env: &Env,
    config: StakingConfig,
) -> (VaultDAOClient<'_>, Address, Address, Address, Address) {
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
            staking_config: config.clone(),
            proposal_id_prefix: 0,
        },
    );

    client.set_role(&admin, &proposer, &Role::Treasurer);
    // initialize() stores the staking config on Config; the slashing path reads it
    // from its own key, so persist it explicitly.
    client.update_staking_config(&admin, &config);

    (client, admin, proposer, token, contract_id)
}

/// Creates a staked proposal worth `amount`; the stake is 10% of it.
/// Returns (proposal_id, stake_amount).
fn staked_proposal(
    env: &Env,
    client: &VaultDAOClient<'_>,
    proposer: &Address,
    token: &Address,
    contract_id: &Address,
    amount: i128,
) -> (u64, i128) {
    let stake = amount / 10;
    StellarAssetClient::new(env, token).mint(contract_id, &amount);
    StellarAssetClient::new(env, token).mint(proposer, &stake);

    let recipient = Address::generate(env);
    let id = client.propose_transfer(
        proposer,
        &recipient,
        token,
        &amount,
        &Symbol::new(env, "test"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    );

    (id, stake)
}

fn balance(env: &Env, token: &Address, who: &Address) -> i128 {
    soroban_sdk::token::TokenClient::new(env, token).balance(who)
}

// ============================================================================
// Defaults
// ============================================================================

#[test]
fn test_default_graduated_rates() {
    let cfg = StakingConfig::default();
    assert_eq!(cfg.slash_percentage, 10, "rejection slashes 10%");
    assert_eq!(
        cfg.cancellation_slash_percentage, 50,
        "cancellation slashes 50%"
    );
}

#[test]
fn test_graduated_rates_persist() {
    let env = Env::default();
    let (client, _admin, _proposer, _token, _cid) = setup(&env, staking_config(10, 50, false));

    let stored = client.get_staking_config();
    assert_eq!(stored.slash_percentage, 10);
    assert_eq!(stored.cancellation_slash_percentage, 50);
    assert!(!stored.slash_to_insurance_pool);
}

// ============================================================================
// Rejection: 10%
// ============================================================================

#[test]
fn test_rejection_slashes_ten_percent() {
    let env = Env::default();
    let (client, admin, proposer, token, cid) = setup(&env, staking_config(10, 50, false));
    let (id, stake) = staked_proposal(&env, &client, &proposer, &token, &cid, 1_000);
    assert_eq!(stake, 100);

    let before = balance(&env, &token, &proposer);

    // Admin cancelling someone else's proposal takes the rejection path.
    client.cancel_proposal(&admin, &id, &Symbol::new(&env, "bad"));

    assert_eq!(client.get_stake_pool_balance(&token), 10);
    assert_eq!(
        balance(&env, &token, &proposer) - before,
        90,
        "90% of the stake returns to the proposer"
    );
}

#[test]
fn test_rejection_slash_is_recorded_on_the_stake_record() {
    let env = Env::default();
    let (client, admin, proposer, token, cid) = setup(&env, staking_config(10, 50, false));
    let (id, _stake) = staked_proposal(&env, &client, &proposer, &token, &cid, 1_000);

    client.cancel_proposal(&admin, &id, &Symbol::new(&env, "bad"));

    let record = client.get_stake_record(&id).unwrap();
    assert!(record.slashed);
    assert_eq!(record.slashed_amount, 10);
}

// ============================================================================
// Cancellation: 50%
// ============================================================================

#[test]
fn test_cancellation_slashes_fifty_percent() {
    let env = Env::default();
    let (client, _admin, proposer, token, cid) = setup(&env, staking_config(10, 50, false));
    let (id, stake) = staked_proposal(&env, &client, &proposer, &token, &cid, 1_000);
    assert_eq!(stake, 100);

    let before = balance(&env, &token, &proposer);

    // Proposer cancelling their own proposal takes the cancellation path.
    client.cancel_proposal(&proposer, &id, &Symbol::new(&env, "changed_mind"));

    assert_eq!(
        client.get_stake_pool_balance(&token),
        50,
        "cancellation costs more than rejection"
    );
    assert_eq!(balance(&env, &token, &proposer) - before, 50);

    let record = client.get_stake_record(&id).unwrap();
    assert!(record.slashed);
    assert_eq!(record.slashed_amount, 50);
}

#[test]
fn test_cancellation_costs_more_than_rejection() {
    let env = Env::default();
    let (client, admin, proposer, token, cid) = setup(&env, staking_config(10, 50, false));

    let (rejected, _) = staked_proposal(&env, &client, &proposer, &token, &cid, 1_000);
    let (cancelled, _) = staked_proposal(&env, &client, &proposer, &token, &cid, 1_000);

    client.cancel_proposal(&admin, &rejected, &Symbol::new(&env, "bad"));
    let after_rejection = client.get_stake_pool_balance(&token);

    client.cancel_proposal(&proposer, &cancelled, &Symbol::new(&env, "withdrawn"));
    let cancellation_slash = client.get_stake_pool_balance(&token) - after_rejection;

    assert!(
        cancellation_slash > after_rejection,
        "spamming and withdrawing must not be the cheap option"
    );
}

// ============================================================================
// Execution: 0%
// ============================================================================

#[test]
fn test_execution_does_not_slash() {
    let env = Env::default();
    let (client, admin, proposer, token, cid) = setup(&env, staking_config(10, 50, false));
    let (id, stake) = staked_proposal(&env, &client, &proposer, &token, &cid, 1_000);

    let before = balance(&env, &token, &proposer);

    client.approve_proposal(&admin, &id);
    client.execute_proposal(&admin, &id);

    assert_eq!(client.get_stake_pool_balance(&token), 0);
    assert_eq!(
        balance(&env, &token, &proposer) - before,
        stake,
        "an executed proposal returns the stake in full"
    );
}

// ============================================================================
// Slash destination
// ============================================================================

#[test]
fn test_slash_can_be_routed_to_insurance_pool() {
    let env = Env::default();
    let (client, _admin, proposer, token, cid) = setup(&env, staking_config(10, 50, true));
    let (id, _stake) = staked_proposal(&env, &client, &proposer, &token, &cid, 1_000);

    client.cancel_proposal(&proposer, &id, &Symbol::new(&env, "withdrawn"));

    assert_eq!(client.get_insurance_pool_balance(&token), 50);
    assert_eq!(client.get_stake_pool_balance(&token), 0);
}

// ============================================================================
// Disabled staking
// ============================================================================

#[test]
fn test_no_slash_when_staking_disabled() {
    let env = Env::default();
    let (client, admin, proposer, token, cid) = setup(&env, staking_config(10, 50, false));
    let (id, stake) = staked_proposal(&env, &client, &proposer, &token, &cid, 1_000);

    let mut disabled = staking_config(10, 50, false);
    disabled.enabled = false;
    client.update_staking_config(&admin, &disabled);

    let before = balance(&env, &token, &proposer);
    client.cancel_proposal(&proposer, &id, &Symbol::new(&env, "withdrawn"));

    assert_eq!(client.get_stake_pool_balance(&token), 0);
    assert_eq!(balance(&env, &token, &proposer) - before, stake);
}

// ============================================================================
// Events
// ============================================================================

#[test]
fn test_slash_event_carries_a_reason() {
    let env = Env::default();
    let (client, _admin, proposer, token, cid) = setup(&env, staking_config(10, 50, false));
    let (id, _stake) = staked_proposal(&env, &client, &proposer, &token, &cid, 1_000);

    client.cancel_proposal(&proposer, &id, &Symbol::new(&env, "withdrawn"));

    let slashed_topic = Symbol::new(&env, "stake_slashed");
    let found = env.events().all().iter().any(|(_, topics, data)| {
        let is_slash = topics
            .first()
            .and_then(|t| Symbol::try_from_val(&env, &t).ok())
            .map(|s| s == slashed_topic)
            .unwrap_or(false);
        if !is_slash {
            return false;
        }
        match <(Address, i128, i128, Symbol)>::try_from_val(&env, &data) {
            Ok((_, slashed, returned, reason)) => {
                slashed == 50 && returned == 50 && reason == Symbol::new(&env, "cancelled")
            }
            Err(_) => false,
        }
    });

    assert!(found, "expected a stake_slashed event tagged 'cancelled'");
}
