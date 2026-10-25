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
//!
//! The second half of the file covers the hardened `reject_proposal` entry
//! point (Issue #1753 hardening): a rejection is a *vote*, so it must clear the
//! configured threshold before any penalty fires, the voter must be a snapshot
//! member, the vault must not be paused, and the final rejection must refund
//! the spending reservation and prune the tag index. Insurance and stake are
//! slashed only once the rejection threshold is met.
#![cfg(test)]

use super::*;
use crate::types::{
    ConditionLogic, InsuranceConfig, Priority, RetryConfig, StakingConfig, ThresholdStrategy,
    VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
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
            upgrade_timelock_delay: 17_280,
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

// ============================================================================
// Hardened `reject_proposal`
// ============================================================================

/// A vault with `threshold` signers required to reject, and a paused flag the
/// caller can flip. Returns `(client, admin, proposer, token, contract_id)`.
fn setup_rejection_vault(
    env: &Env,
    threshold: u32,
    signer_count: u32,
) -> (VaultDAOClient<'_>, Address, Address, Address, Address) {
// Rejection voting semantics
// ============================================================================

/// A proposal with `threshold` signers, so a single reject vote is not enough.
///
/// Returns `(client, admin, proposer, other_signer, token, contract_id)`.
fn setup_with_threshold(
    env: &Env,
    threshold: u32,
    insurance: InsuranceConfig,
    staking: StakingConfig,
) -> (
    VaultDAOClient<'_>,
    Address,
    Address,
    Address,
    Address,
    Address,
) {
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let proposer = Address::generate(env);
    let other = Address::generate(env);
    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(proposer.clone());
    for _ in 2..signer_count {
        signers.push_back(Address::generate(env));
    }
    signers.push_back(other.clone());

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
            threshold,
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
            staking_config: staking_config(false, 10),
            staking_config: staking.clone(),
            proposal_id_prefix: 0,
        },
    );

    client.set_role(&admin, &proposer, &Role::Treasurer);
    client.update_staking_config(&admin, &staking_config(false, 10));
    client.set_insurance_config(&admin, &insurance_config(true, 30));

    (client, admin, proposer, token, contract_id)
}

/// Propose a transfer that escrows `INSURANCE`, returning `(id, before)`.
fn rejection_proposal(
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

    (id, balance(env, token, proposer))
}

#[test]
fn test_reject_proposal_single_signer_blocked_until_threshold() {
    // Threshold 2: one rejection is recorded but nothing is slashed and the
    // proposal is not yet Rejected.
    let env = Env::default();
    let (client, admin, proposer, token, cid) = setup_rejection_vault(&env, 2, 3);
    let (id, before) = rejection_proposal(&env, &client, &proposer, &token, &cid);

    client.reject_proposal(&admin, &id, &Symbol::new(&env, "no"));
    client.update_staking_config(&admin, &staking);
    client.set_insurance_config(&admin, &insurance);

    (client, admin, proposer, other, token, contract_id)
}

#[test]
fn test_non_snapshot_signer_cannot_reject() {
    let env = Env::default();
    let (client, _admin, proposer, _other, token, cid) =
        setup_with_threshold(&env, 1, insurance_config(true, 30), staking_config(false, 10));
    let (id, _) = escrowed_proposal(&env, &client, &proposer, &token, &cid);

    // A signer added after the proposal snapshot is not eligible to vote.
    let late = Address::generate(&env);
    client.set_role(&_admin, &late, &Role::Treasurer);

    let res = client.try_reject_proposal(&late, &id, &Symbol::new(&env, "no"));
    assert!(res.is_err(), "a non-snapshot signer cannot reject");
    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Pending);
}

#[test]
fn test_single_reject_vote_does_not_reject_when_threshold_above_one() {
    let env = Env::default();
    let (client, _admin, proposer, other, token, cid) =
        setup_with_threshold(&env, 2, insurance_config(true, 30), staking_config(false, 10));
    let (id, _) = escrowed_proposal(&env, &client, &proposer, &token, &cid);

    client.reject_proposal(&other, &id, &Symbol::new(&env, "nope"));

    assert_eq!(
        client.get_proposal(&id).status,
        ProposalStatus::Pending,
        "a single rejection below threshold must not finalize the proposal"
    );
    assert_eq!(
        balance(&env, &token, &proposer),
        before,
        "no penalty fires before the rejection threshold is met"
    );
    assert_eq!(client.get_insurance_pool_balance(&token), 0);
}

#[test]
fn test_reject_proposal_reaches_threshold_and_slashes() {
    let env = Env::default();
    let (client, admin, proposer, token, cid) = setup_rejection_vault(&env, 2, 3);
    let (id, before) = rejection_proposal(&env, &client, &proposer, &token, &cid);

    let second = Address::generate(&env);
    client.set_role(&admin, &second, &Role::Treasurer);

    client.reject_proposal(&admin, &id, &Symbol::new(&env, "no"));
    client.reject_proposal(&second, &id, &Symbol::new(&env, "no"));

    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Rejected);
    assert_eq!(
        client.get_insurance_pool_balance(&token),
        INSURANCE_BURN,
        "insurance is slashed only once the threshold is met"
    );
    assert_eq!(
        balance(&env, &token, &proposer) - before,
        INSURANCE_RETURN,
        "the proposer is refunded the un-slashed remainder"
    );
}

#[test]
fn test_reject_proposal_requires_snapshot_membership() {
    let env = Env::default();
    let (client, admin, proposer, token, cid) = setup_rejection_vault(&env, 1, 2);
    let (id, _) = rejection_proposal(&env, &client, &proposer, &token, &cid);

    let outsider = Address::generate(&env);
    let result = client.try_reject_proposal(&outsider, &id, &Symbol::new(&env, "no"));
    assert!(
        result.is_err(),
        "a non-snapshot address must not be able to reject"
    );
}

#[test]
fn test_reject_proposal_blocked_when_paused() {
    let env = Env::default();
    let (client, admin, proposer, token, cid) = setup_rejection_vault(&env, 1, 2);
    let (id, _) = rejection_proposal(&env, &client, &proposer, &token, &cid);

    client.pause(&admin);

    let result = client.try_reject_proposal(&admin, &id, &Symbol::new(&env, "no"));
    assert!(result.is_err(), "rejection must be gated by the pause flag");
}

#[test]
fn test_reject_proposal_refunds_spending_reservation() {
    let env = Env::default();
    let (client, admin, proposer, token, cid) = setup_rejection_vault(&env, 1, 2);
    let (id, _) = rejection_proposal(&env, &client, &proposer, &token, &cid);

    let reserved_before = client.get_reserved_spending(&token);
    assert!(
        reserved_before >= AMOUNT,
        "the proposal reserved its amount up front"
    );

    client.reject_proposal(&admin, &id, &Symbol::new(&env, "no"));

    assert_eq!(
        client.get_reserved_spending(&token),
        reserved_before - AMOUNT,
        "final rejection releases the spending reservation"
        "one reject vote is below the threshold"
    );
    assert_eq!(
        client.get_insurance_pool_balance(&token),
        0,
        "no slashing before the rejection threshold is met"
    );
}

#[test]
fn test_rejection_threshold_reached_transitions_to_rejected() {
    let env = Env::default();
    let (client, admin, proposer, other, token, cid) =
        setup_with_threshold(&env, 2, insurance_config(true, 30), staking_config(false, 10));
    let (id, _) = escrowed_proposal(&env, &client, &proposer, &token, &cid);

    client.reject_proposal(&other, &id, &Symbol::new(&env, "nope"));
    client.reject_proposal(&admin, &id, &Symbol::new(&env, "nope"));

    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Rejected);
}

#[test]
fn test_rejection_blocked_while_paused() {
    let env = Env::default();
    let (client, admin, proposer, other, token, cid) =
        setup_with_threshold(&env, 1, insurance_config(true, 30), staking_config(false, 10));
    let (id, _) = escrowed_proposal(&env, &client, &proposer, &token, &cid);

    client.pause(&admin);

    let res = client.try_reject_proposal(&other, &id, &Symbol::new(&env, "nope"));
    assert!(res.is_err(), "rejection is blocked while paused");
    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Pending);
}

#[test]
fn test_rejection_refunds_spending_buckets() {
    let env = Env::default();
    let (client, admin, proposer, other, token, cid) =
        setup_with_threshold(&env, 1, insurance_config(true, 30), staking_config(false, 10));
    let (id, _) = escrowed_proposal(&env, &client, &proposer, &token, &cid);

    let daily_before = client.get_daily_spent(&token);
    let weekly_before = client.get_weekly_spent(&token);

    client.reject_proposal(&other, &id, &Symbol::new(&env, "nope"));

    assert_eq!(
        client.get_daily_spent(&token),
        daily_before,
        "the daily bucket is refunded on rejection"
    );
    assert_eq!(
        client.get_weekly_spent(&token),
        weekly_before,
        "the weekly bucket is refunded on rejection"
    );
}

#[test]
fn test_reject_proposal_prunes_tag_index() {
    let env = Env::default();
    let (client, admin, proposer, token, cid) = setup_rejection_vault(&env, 1, 2);
fn test_rejection_prunes_tags_from_index() {
    let env = Env::default();
    let (client, admin, proposer, other, token, cid) =
        setup_with_threshold(&env, 1, insurance_config(true, 30), staking_config(false, 10));

    StellarAssetClient::new(&env, &token).mint(&cid, &AMOUNT);
    StellarAssetClient::new(&env, &token).mint(&proposer, &(INSURANCE + STAKE));

    let tag = Symbol::new(&env, "payroll");
    let tag = Symbol::new(&env, "tagged");
    let mut tags = Vec::new(&env);
    tags.push_back(tag.clone());

    let id = client.propose_transfer(
        &proposer,
        &Address::generate(&env),
        &token,
        &AMOUNT,
        &tag,
        &Priority::Normal,
        &Vec::new(&env),
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &tags,
        &ConditionLogic::And,
        &INSURANCE,
    );

    assert!(
        client.get_proposals_by_tag(&tag).contains(&id),
        "the tag index tracks the pending proposal"
    );

    client.reject_proposal(&admin, &id, &Symbol::new(&env, "no"));

    assert!(
        !client.get_proposals_by_tag(&tag).contains(&id),
        "a rejected proposal is pruned from the tag index"
        !client.get_proposals_by_tag(&tag).is_empty(),
        "the tag is indexed while the proposal is live"
    );

    client.reject_proposal(&other, &id, &Symbol::new(&env, "nope"));

    assert!(
        client.get_proposals_by_tag(&tag).is_empty(),
        "the tag is pruned from the index on rejection"
    );
}

#[test]
fn test_reject_proposal_no_slashing_below_threshold() {
    // Two signers reject but the threshold is 3: the proposal stays Pending and
    // neither insurance nor stake is touched.
    let env = Env::default();
    let (client, admin, proposer, token, cid) = setup_rejection_vault(&env, 3, 4);
    let (id, before) = rejection_proposal(&env, &client, &proposer, &token, &cid);

    let second = Address::generate(&env);
    let third = Address::generate(&env);
    client.set_role(&admin, &second, &Role::Treasurer);
    client.set_role(&admin, &third, &Role::Treasurer);

    client.reject_proposal(&admin, &id, &Symbol::new(&env, "no"));
    client.reject_proposal(&second, &id, &Symbol::new(&env, "no"));

    assert_eq!(client.get_proposal(&id).status, ProposalStatus::Pending);
    assert_eq!(client.get_insurance_pool_balance(&token), 0);
    assert_eq!(client.get_stake_pool_balance(&token), 0);
    assert_eq!(
        balance(&env, &token, &proposer),
        before,
        "no penalty fires below the rejection threshold"
    );
fn test_slashes_only_when_rejection_threshold_met() {
    let env = Env::default();
    let (client, admin, proposer, other, token, cid) =
        setup_with_threshold(&env, 2, insurance_config(true, 30), staking_config(true, 10));
    let (id, _) = escrowed_proposal(&env, &client, &proposer, &token, &cid);

    // First reject vote: below threshold, nothing is slashed.
    client.reject_proposal(&other, &id, &Symbol::new(&env, "nope"));
    assert_eq!(client.get_insurance_pool_balance(&token), 0);
    assert_eq!(client.get_stake_pool_balance(&token), 0);

    // Second reject vote reaches the threshold and triggers both penalties.
    client.reject_proposal(&admin, &id, &Symbol::new(&env, "nope"));
    assert_eq!(client.get_insurance_pool_balance(&token), INSURANCE_BURN);
    assert_eq!(client.get_stake_pool_balance(&token), 10);
}
