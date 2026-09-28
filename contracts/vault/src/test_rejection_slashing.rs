//! Tests for Issue #1753: the `is_rejection` arm of `cancel_proposal`.
//!
//! The rejection arm applies *two* independent penalties, in this order:
//!   1. `slash_insurance_on_rejection` — burns `InsuranceConfig::slash_percentage`
//!      of the proposer's insurance into the insurance pool.
//!   2. `slash_stake_on_rejection`     — burns `StakingConfig::slash_percentage`
//!      of the proposer's stake into the stake (or insurance) pool.
//!
//! These were only covered indirectly before. `test_staking_slashing` drives the
//! stake tier with `insurance_amount == 0`, so the insurance arm was never
//! entered, and nothing asserted that both penalties compose on one proposal.
//!
//! The insurance tests below run with staking switched off so a balance delta
//! is attributable to exactly one arm. `test_rejection_slashes_both_penalties`
//! then re-enables staking to pin the composition explicitly.
//!
//! This file also pins the arm boundary. The proposer-initiated cancellation
//! arm refunds insurance *in full* (lib.rs, `insurance_amount > 0` branch), so a
//! test that conflates the two arms would pass for the wrong reason;
//! `test_cancellation_refunds_insurance_that_rejection_slashes` holds the two
//! arms side by side on identical escrow.
#![cfg(test)]

use super::*;
use crate::types::{
    ConditionLogic, InsuranceConfig, Priority, RetryConfig, StakingConfig, ThresholdStrategy,
    VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    token::StellarAssetClient,
    Address, Env, Symbol, TryFromVal, Vec,
};

const AMOUNT: i128 = 1_000;
const INSURANCE: i128 = 100;
const STAKE: i128 = 100;

/// 30% of `INSURANCE` is burned, 70% returned.
const INSURANCE_BURN: i128 = 30;
const INSURANCE_RETURN: i128 = 70;

fn insurance_config(enabled: bool, slash_pct: u32) -> InsuranceConfig {
    InsuranceConfig {
        enabled,
        // Threshold low enough that AMOUNT is subject to insurance, and
        // 1% of AMOUNT = 10, so INSURANCE clears the minimum.
        min_amount: 1,
        min_insurance_bps: 100,
        slash_percentage: slash_pct,
    }
}

fn staking_config(enabled: bool, slash_pct: u32) -> StakingConfig {
    StakingConfig {
        enabled,
        min_amount: 1,
        base_stake_bps: 1000, // 10% of the proposal amount
        max_stake_amount: i128::MAX,
        reputation_discount_threshold: 1000, // unreachable — no discount
        reputation_discount_percentage: 0,
        slash_percentage: slash_pct,
        cancellation_slash_percentage: 50,
        slash_to_insurance_pool: false,
        compound_lock_period: 17280,
        compound_epoch: 17280,
        reward_bps_per_execution: 0,
    }
}

/// Returns (client, admin, proposer, token, contract_id).
fn setup(
    env: &Env,
    insurance: InsuranceConfig,
    staking: StakingConfig,
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
            staking_config: staking.clone(),
            proposal_id_prefix: 0,
        },
    );

    client.set_role(&admin, &proposer, &Role::Treasurer);
    // initialize() stores these on Config; the slashing paths read them from
    // their own keys, so persist them explicitly.
    client.update_staking_config(&admin, &staking);
    client.set_insurance_config(&admin, &insurance);

    (client, admin, proposer, token, contract_id)
}

/// A proposal escrowing `INSURANCE` (and, when staking is on, `STAKE`).
///
/// Returns `(proposal_id, proposer balance immediately before rejection)`, so
/// a caller's `balance - before` delta measures only what the rejection returns.
fn escrowed_proposal(
    env: &Env,
    client: &VaultDAOClient<'_>,
    proposer: &Address,
    token: &Address,
    contract_id: &Address,
) -> (u64, i128) {
    StellarAssetClient::new(env, token).mint(contract_id, &AMOUNT);
    StellarAssetClient::new(env, token).mint(proposer, &(INSURANCE + STAKE));

    let id = client.propose_transfer(
        proposer,
        &Address::generate(env),
        token,
        &AMOUNT,
        &Symbol::new(env, "test"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &INSURANCE,
    );

    assert_eq!(
        client.get_proposal(&id).insurance_amount,
        INSURANCE,
        "insurance was escrowed on the proposal"
    );

    (id, balance(env, token, proposer))
}

fn balance(env: &Env, token: &Address, who: &Address) -> i128 {
    soroban_sdk::token::TokenClient::new(env, token).balance(who)
}

// ============================================================================
// Insurance slashing (staking off, so the delta is attributable to insurance)
// ============================================================================

#[test]
fn test_rejection_slashes_insurance_at_configured_rate() {
    let env = Env::default();
    let (client, admin, proposer, token, cid) =
        setup(&env, insurance_config(true, 30), staking_config(false, 10));
    let (id, before) = escrowed_proposal(&env, &client, &proposer, &token, &cid);

    // Admin cancelling someone else's proposal takes the rejection arm.
    client.cancel_proposal(&admin, &id, &Symbol::new(&env, "bad"));

    assert_eq!(
        client.get_insurance_pool_balance(&token),
        INSURANCE_BURN,
        "30% of the insurance is burned into the pool"
    );
    assert_eq!(
        balance(&env, &token, &proposer) - before,
        INSURANCE_RETURN,
        "the remaining 70% returns to the proposer"
    );
}

#[test]
fn test_rejection_does_not_return_insurance_in_full() {
    // Guards the arm boundary: the proposer-initiated cancellation arm refunds
    // insurance in full, the rejection arm must not.
    let env = Env::default();
    let (client, admin, proposer, token, cid) =
        setup(&env, insurance_config(true, 30), staking_config(false, 10));
    let (id, before) = escrowed_proposal(&env, &client, &proposer, &token, &cid);

    client.cancel_proposal(&admin, &id, &Symbol::new(&env, "bad"));

    assert_eq!(
        balance(&env, &token, &proposer) - before,
        INSURANCE_RETURN,
        "the proposer is short by exactly the burned slice"
    );
}

#[test]
fn test_rejection_returns_insurance_in_full_when_disabled() {
    // Insurance off => `slash_insurance_on_rejection` takes its "return in
    // full" branch, even though the proposal carries insurance.
    let env = Env::default();
    let (client, admin, proposer, token, cid) =
        setup(&env, insurance_config(false, 30), staking_config(false, 10));
    let (id, before) = escrowed_proposal(&env, &client, &proposer, &token, &cid);

    client.cancel_proposal(&admin, &id, &Symbol::new(&env, "bad"));

    assert_eq!(client.get_insurance_pool_balance(&token), 0);
    assert_eq!(
        balance(&env, &token, &proposer) - before,
        INSURANCE,
        "all insurance returns when the feature is off"
    );
}

#[test]
fn test_rejection_emits_insurance_slashed_event() {
    let env = Env::default();
    let (client, admin, proposer, token, cid) =
        setup(&env, insurance_config(true, 30), staking_config(false, 10));
    let (id, _) = escrowed_proposal(&env, &client, &proposer, &token, &cid);

    client.cancel_proposal(&admin, &id, &Symbol::new(&env, "bad"));

    let topic = Symbol::new(&env, "insurance_slashed");
    let found = env.events().all().iter().any(|(_, topics, data)| {
        let is_event = topics
            .first()
            .and_then(|t| Symbol::try_from_val(&env, &t).ok())
            .map(|s| s == topic)
            .unwrap_or(false);
        if !is_event {
            return false;
        }
        match <(Address, i128, i128)>::try_from_val(&env, &data) {
            Ok((who, slashed, returned)) => {
                who == proposer && slashed == INSURANCE_BURN && returned == INSURANCE_RETURN
            }
            Err(_) => false,
        }
    });

    assert!(found, "expected an insurance_slashed event for 30/70");
}

// ============================================================================
// Both penalties compose on a single rejection
// ============================================================================

#[test]
fn test_rejection_slashes_both_penalties() {
    let env = Env::default();
    let (client, admin, proposer, token, cid) =
        setup(&env, insurance_config(true, 30), staking_config(true, 10));
    let (id, before) = escrowed_proposal(&env, &client, &proposer, &token, &cid);

    client.cancel_proposal(&admin, &id, &Symbol::new(&env, "bad"));

    // The two penalties are independent: insurance burns into the insurance
    // pool, stake into the stake pool, and neither may swallow the other.
    assert_eq!(client.get_insurance_pool_balance(&token), INSURANCE_BURN);
    assert_eq!(client.get_stake_pool_balance(&token), 10);
    assert_eq!(
        balance(&env, &token, &proposer) - before,
        INSURANCE_RETURN + 90,
        "the proposer keeps 70% of insurance and 90% of stake"
    );
}

#[test]
fn test_rejection_records_both_penalties_on_the_proposal() {
    let env = Env::default();
    let (client, admin, proposer, token, cid) =
        setup(&env, insurance_config(true, 30), staking_config(true, 10));
    let (id, _) = escrowed_proposal(&env, &client, &proposer, &token, &cid);

    client.cancel_proposal(&admin, &id, &Symbol::new(&env, "bad"));

    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Rejected);
    let record = client.get_stake_record(&id).unwrap();
    assert!(record.slashed, "the stake record is settled as slashed");
    assert_eq!(record.slashed_amount, 10);
    assert!(
        !record.refunded,
        "a slashed stake is settled via `slashed`, not `refunded`"
    );
}

// ============================================================================
// Arm boundary
// ============================================================================

#[test]
fn test_cancellation_refunds_insurance_that_rejection_slashes() {
    // The two arms of the same function, on identical escrow, in isolated
    // environments. This is the pairing that makes the rejection arm auditable.
    let rejection_env = Env::default();
    let (r_client, r_admin, r_proposer, r_token, r_cid) = setup(
        &rejection_env,
        insurance_config(true, 30),
        staking_config(false, 10),
    );
    let (r_id, r_before) =
        escrowed_proposal(&rejection_env, &r_client, &r_proposer, &r_token, &r_cid);
    r_client.cancel_proposal(&r_admin, &r_id, &Symbol::new(&rejection_env, "bad"));

    let cancellation_env = Env::default();
    let (c_client, _c_admin, c_proposer, c_token, c_cid) = setup(
        &cancellation_env,
        insurance_config(true, 30),
        staking_config(false, 10),
    );
    let (c_id, c_before) =
        escrowed_proposal(&cancellation_env, &c_client, &c_proposer, &c_token, &c_cid);
    // Proposer withdrawing their own proposal takes the cancellation arm.
    c_client.cancel_proposal(
        &c_proposer,
        &c_id,
        &Symbol::new(&cancellation_env, "withdrew"),
    );

    assert_eq!(
        c_client.get_proposal(&c_id).status,
        ProposalStatus::Cancelled
    );
    assert_eq!(
        balance(&cancellation_env, &c_token, &c_proposer) - c_before,
        INSURANCE,
        "withdrawing refunds insurance in full"
    );
    assert_eq!(
        balance(&rejection_env, &r_token, &r_proposer) - r_before,
        INSURANCE_RETURN,
        "being rejected burns the slashed slice instead"
    );
    assert_eq!(c_client.get_insurance_pool_balance(&c_token), 0);
    assert_eq!(
        r_client.get_insurance_pool_balance(&r_token),
        INSURANCE_BURN
    );
}
