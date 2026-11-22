//! Tests for Issue #2061: treasury risk engine.
//!
//! 1. Per-token circuit breakers trip in isolation: a tripped token is blocked,
//!    other tokens keep flowing, and the trip persists across hourly windows
//!    until an Admin resets it.
//! 2. Approved-but-unexecuted proposals hold pending reservations that are
//!    excluded from the spendable balance.
//! 3. A reservation is released exactly once on execute, cancel or expiry.
//! 4. Reservations never over-commit: a proposal that does not fit stays
//!    unreserved and cannot steal a covered proposal's funds.
//! 5. Invariant (example + proptest):
//!    `spendable = max(0, balance - earmarked - pending - locked)` and
//!    `pending == sum of per-proposal reservations`.
#![cfg(test)]

use crate::errors::VaultError;
use crate::types::{
    ConditionLogic, InitConfig, Priority, ProposalStatus, RecoveryConfig, RetryConfig,
    StakingConfig, ThresholdStrategy, VelocityConfig, VoteWeight,
};
use crate::{VaultDAO, VaultDAOClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Symbol, Vec,
};

pub(crate) struct Ctx<'a> {
    pub client: VaultDAOClient<'a>,
    pub contract_id: Address,
    pub admin: Address,
    pub s1: Address,
    pub s2: Address,
    pub token: Address,
}

/// 3 signers (admin, s1, s2), threshold 2, no timelock. The vault holds
/// `funding` units of a fresh token.
pub(crate) fn setup_vault(env: &Env, funding: i128, timelock_delay: u64) -> Ctx<'_> {
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let s1 = Address::generate(env);
    let s2 = Address::generate(env);
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(s1.clone());
    signers.push_back(s2.clone());

    client.initialize(
        &admin,
        &InitConfig {
            upgrade_timelock_delay: 17_280,
            signers,
            threshold: 2,
            quorum: 0,
            quorum_percentage: 0,
            spending_limit: 1_000_000,
            daily_limit: 5_000_000,
            weekly_limit: 10_000_000,
            timelock_threshold: 1_000_000_000,
            timelock_delay,
            velocity_limit: VelocityConfig {
                limit: 1_000_000,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            default_voting_deadline: 0,
            veto_addresses: Vec::new(env),
            veto_window_ledgers: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: VoteWeight::Flat,
            high_impact_threshold: 100,
            admin_rotation_delay: 1440,
            proposal_id_prefix: 0,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            retry_config: RetryConfig {
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
                max_retry_delay: 0,
            },
            recovery_config: RecoveryConfig::default(env),
            staking_config: StakingConfig::default(),
        },
    );

    let token = new_token(env, &client, &admin, &contract_id, funding);
    Ctx {
        client,
        contract_id,
        admin,
        s1,
        s2,
        token,
    }
}

/// Register a token, support it, and fund the vault with `funding`.
pub(crate) fn new_token(
    env: &Env,
    client: &VaultDAOClient,
    admin: &Address,
    contract_id: &Address,
    funding: i128,
) -> Address {
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(env))
        .address();
    client.add_supported_token(admin, &token, &1_000_000, &10_000_000);
    if funding > 0 {
        StellarAssetClient::new(env, &token).mint(contract_id, &funding);
    }
    token
}

pub(crate) fn propose(env: &Env, ctx: &Ctx, token: &Address, amount: i128) -> u64 {
    ctx.client.propose_transfer(
        &ctx.admin,
        &Address::generate(env),
        token,
        &amount,
        &Symbol::new(env, "risk"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    )
}

pub(crate) fn approve(ctx: &Ctx, id: u64) {
    ctx.client.approve_proposal(&ctx.admin, &id);
    ctx.client.approve_proposal(&ctx.s1, &id);
}

/// Assert `spendable = max(0, balance - earmarked - pending - locked)`.
fn assert_invariant(env: &Env, ctx: &Ctx, token: &Address) {
    let snap = ctx.client.get_treasury_risk_snapshot(token);
    let balance = TokenClient::new(env, token).balance(&ctx.contract_id);
    assert_eq!(snap.balance, balance);
    assert_eq!(
        snap.spendable,
        (snap.balance - snap.earmarked - snap.pending - snap.locked).max(0)
    );
    assert!(snap.pending >= 0 && snap.earmarked >= 0 && snap.locked >= 0);
}

// ---------------------------------------------------------------------------
// Pending reservations
// ---------------------------------------------------------------------------

#[test]
fn test_approval_creates_reservation_excluded_from_spendable() {
    let env = Env::default();
    let ctx = setup_vault(&env, 10_000, 0);

    let id = propose(&env, &ctx, &ctx.token, 1_000);
    assert_eq!(ctx.client.get_pending_reservation(&id), None);

    approve(&ctx, id);
    assert_eq!(ctx.client.get_proposal(&id).status, ProposalStatus::Approved);
    assert_eq!(
        ctx.client.get_pending_reservation(&id),
        Some((ctx.token.clone(), 1_000))
    );

    let snap = ctx.client.get_treasury_risk_snapshot(&ctx.token);
    assert_eq!(snap.balance, 10_000);
    assert_eq!(snap.pending, 1_000);
    assert_eq!(snap.spendable, 9_000);
    assert_invariant(&env, &ctx, &ctx.token);
}

#[test]
fn test_reservation_released_exactly_once_on_execute() {
    let env = Env::default();
    let ctx = setup_vault(&env, 10_000, 0);

    let id = propose(&env, &ctx, &ctx.token, 1_000);
    approve(&ctx, id);
    ctx.client.execute_proposal(&ctx.admin, &id);

    assert_eq!(ctx.client.get_pending_reservation(&id), None);
    let snap = ctx.client.get_treasury_risk_snapshot(&ctx.token);
    assert_eq!(snap.pending, 0);
    assert_eq!(snap.balance, 9_000);
    assert_eq!(snap.spendable, 9_000);

    // A second execution fails and cannot release anything again.
    assert_eq!(
        ctx.client.try_execute_proposal(&ctx.admin, &id),
        Err(Ok(VaultError::ProposalAlreadyExecuted))
    );
    assert_eq!(ctx.client.get_treasury_risk_snapshot(&ctx.token).pending, 0);
    assert_invariant(&env, &ctx, &ctx.token);
}

#[test]
fn test_reservation_released_exactly_once_on_cancel() {
    let env = Env::default();
    let ctx = setup_vault(&env, 10_000, 0);

    let keep = propose(&env, &ctx, &ctx.token, 2_000);
    approve(&ctx, keep);
    let id = propose(&env, &ctx, &ctx.token, 1_000);
    approve(&ctx, id);
    assert_eq!(ctx.client.get_treasury_risk_snapshot(&ctx.token).pending, 3_000);

    ctx.client
        .cancel_proposal(&ctx.admin, &id, &Symbol::new(&env, "nope"));
    assert_eq!(ctx.client.get_pending_reservation(&id), None);
    assert_eq!(ctx.client.get_treasury_risk_snapshot(&ctx.token).pending, 2_000);

    // Cancelling again is rejected and the other reservation is untouched.
    assert_eq!(
        ctx.client
            .try_cancel_proposal(&ctx.admin, &id, &Symbol::new(&env, "nope")),
        Err(Ok(VaultError::ProposalAlreadyCancelled))
    );
    assert_eq!(ctx.client.get_treasury_risk_snapshot(&ctx.token).pending, 2_000);
    assert_eq!(
        ctx.client.get_pending_reservation(&keep),
        Some((ctx.token.clone(), 2_000))
    );
    assert_invariant(&env, &ctx, &ctx.token);
}

#[test]
fn test_reservation_released_exactly_once_on_expiry() {
    let env = Env::default();
    let ctx = setup_vault(&env, 10_000, 0);

    // A short execution window lets the approval lapse without archiving
    // any storage in the test environment.
    ctx.client.set_exec_window_ledgers(&ctx.admin, &10u64);
    env.ledger().with_mut(|li| li.sequence_number = 100);

    let id = propose(&env, &ctx, &ctx.token, 1_000);
    approve(&ctx, id);

    // Not expired yet: nothing to release.
    assert_eq!(
        ctx.client.try_expire_approved_reservation(&id),
        Err(Ok(VaultError::TimelockNotExpired))
    );

    let approved_at = ctx.client.get_proposal(&id).approved_at;
    env.ledger()
        .with_mut(|li| li.sequence_number = (approved_at + 11) as u32);

    ctx.client.expire_approved_reservation(&id);
    assert_eq!(ctx.client.get_proposal(&id).status, ProposalStatus::Expired);
    assert_eq!(ctx.client.get_pending_reservation(&id), None);
    assert_eq!(ctx.client.get_treasury_risk_snapshot(&ctx.token).pending, 0);

    // Second release attempt is rejected.
    assert_eq!(
        ctx.client.try_expire_approved_reservation(&id),
        Err(Ok(VaultError::ProposalNotApproved))
    );
    assert_eq!(ctx.client.get_treasury_risk_snapshot(&ctx.token).pending, 0);
}

#[test]
fn test_reservations_never_over_commit() {
    let env = Env::default();
    let ctx = setup_vault(&env, 1_500, 0);

    let first = propose(&env, &ctx, &ctx.token, 1_000);
    approve(&ctx, first);
    let second = propose(&env, &ctx, &ctx.token, 1_000);
    approve(&ctx, second);

    // Only the first fits; the second is approved but unreserved.
    assert_eq!(
        ctx.client.get_pending_reservation(&first),
        Some((ctx.token.clone(), 1_000))
    );
    assert_eq!(ctx.client.get_pending_reservation(&second), None);
    let snap = ctx.client.get_treasury_risk_snapshot(&ctx.token);
    assert_eq!(snap.pending, 1_000);
    assert_eq!(snap.spendable, 500);

    // The unreserved proposal cannot draw on the covered one's funds.
    assert!(ctx.client.try_execute_proposal(&ctx.admin, &second).is_err());
    assert_eq!(ctx.client.get_proposal(&second).status, ProposalStatus::Approved);

    // The covered proposal still executes.
    ctx.client.execute_proposal(&ctx.admin, &first);
    assert_eq!(ctx.client.get_proposal(&first).status, ProposalStatus::Executed);
    assert_eq!(ctx.client.get_treasury_risk_snapshot(&ctx.token).pending, 0);
    assert_invariant(&env, &ctx, &ctx.token);
}

#[test]
fn test_veto_releases_reservation() {
    let env = Env::default();
    let ctx = setup_vault(&env, 10_000, 0);

    let id = propose(&env, &ctx, &ctx.token, 1_000);
    approve(&ctx, id);
    assert_eq!(ctx.client.get_treasury_risk_snapshot(&ctx.token).pending, 1_000);

    // Moving the proposal out of Approved by any path releases it.
    env.as_contract(&ctx.contract_id, || {
        let mut p = crate::storage::get_proposal(&env, id).unwrap();
        p.status = ProposalStatus::Vetoed;
        crate::storage::set_proposal(&env, &p);
        // Writing the same terminal state again does not double-release.
        crate::storage::set_proposal(&env, &p);
    });
    assert_eq!(ctx.client.get_pending_reservation(&id), None);
    assert_eq!(ctx.client.get_treasury_risk_snapshot(&ctx.token).pending, 0);
}

// ---------------------------------------------------------------------------
// Per-token circuit breakers
// ---------------------------------------------------------------------------

fn configure_breaker(env: &Env, ctx: &Ctx, token: &Address, threshold: i128) {
    let mut esigners = Vec::new(env);
    esigners.push_back(Address::generate(env));
    esigners.push_back(Address::generate(env));
    ctx.client.configure_emergency(&ctx.admin, &esigners, &0i128);
    ctx.client
        .set_circuit_token_threshold(&ctx.admin, token, &threshold);
}

#[test]
fn test_breaker_trips_only_its_token() {
    let env = Env::default();
    let ctx = setup_vault(&env, 10_000, 0);
    let other = new_token(&env, &ctx.client, &ctx.admin, &ctx.contract_id, 10_000);
    configure_breaker(&env, &ctx, &ctx.token, 1_500);

    let a = propose(&env, &ctx, &ctx.token, 1_000);
    approve(&ctx, a);
    ctx.client.execute_proposal(&ctx.admin, &a);

    // Second outflow in the same window crosses the threshold: trips.
    let b = propose(&env, &ctx, &ctx.token, 1_000);
    approve(&ctx, b);
    ctx.client.execute_proposal(&ctx.admin, &b);
    assert_eq!(ctx.client.get_proposal(&b).status, ProposalStatus::Approved);
    let state = ctx.client.get_token_breaker_state(&ctx.token).unwrap();
    assert!(state.tripped);
    assert_eq!(state.refused_amount, 1_000);
    assert_eq!(state.outflow_at_trip, 1_000);

    // The vault itself is not paused and the other token keeps flowing.
    assert!(!ctx.client.get_pause_state().is_paused);
    let c = propose(&env, &ctx, &other, 1_000);
    approve(&ctx, c);
    ctx.client.execute_proposal(&ctx.admin, &c);
    assert_eq!(ctx.client.get_proposal(&c).status, ProposalStatus::Executed);
    assert!(ctx.client.get_token_breaker_state(&other).is_none());

    // The tripped token stays blocked.
    assert_eq!(
        ctx.client.try_execute_proposal(&ctx.admin, &b),
        Err(Ok(VaultError::TokenCircuitBreakerTripped))
    );
    assert!(ctx.client.get_treasury_risk_snapshot(&ctx.token).breaker_tripped);
    assert!(!ctx.client.get_treasury_risk_snapshot(&other).breaker_tripped);
}

#[test]
fn test_breaker_trip_persists_across_windows_until_reset() {
    let env = Env::default();
    let ctx = setup_vault(&env, 10_000, 0);
    configure_breaker(&env, &ctx, &ctx.token, 500);

    let id = propose(&env, &ctx, &ctx.token, 1_000);
    approve(&ctx, id);
    ctx.client.execute_proposal(&ctx.admin, &id);
    assert!(ctx.client.get_token_breaker_state(&ctx.token).unwrap().tripped);

    // Several hourly windows later the breaker is still tripped.
    env.ledger().with_mut(|li| li.sequence_number += 720 * 3);
    assert_eq!(
        ctx.client.try_execute_proposal(&ctx.admin, &id),
        Err(Ok(VaultError::TokenCircuitBreakerTripped))
    );

    // Only an Admin can reset it.
    assert_eq!(
        ctx.client
            .try_reset_token_circuit_breaker(&ctx.s1, &ctx.token),
        Err(Ok(VaultError::InsufficientRole))
    );
    ctx.client
        .reset_token_circuit_breaker(&ctx.admin, &ctx.token);
    assert!(ctx.client.get_token_breaker_state(&ctx.token).is_none());
    assert_eq!(
        ctx.client
            .try_reset_token_circuit_breaker(&ctx.admin, &ctx.token),
        Err(Ok(VaultError::VaultNotPaused))
    );

    // Raise the threshold and the proposal executes, releasing its reservation.
    ctx.client
        .set_circuit_token_threshold(&ctx.admin, &ctx.token, &5_000i128);
    ctx.client.execute_proposal(&ctx.admin, &id);
    assert_eq!(ctx.client.get_proposal(&id).status, ProposalStatus::Executed);
    assert_eq!(ctx.client.get_treasury_risk_snapshot(&ctx.token).pending, 0);
}

#[test]
fn test_reservation_survives_breaker_trip() {
    let env = Env::default();
    let ctx = setup_vault(&env, 10_000, 0);
    configure_breaker(&env, &ctx, &ctx.token, 500);

    let id = propose(&env, &ctx, &ctx.token, 1_000);
    approve(&ctx, id);
    ctx.client.execute_proposal(&ctx.admin, &id);

    // A trip does not execute the proposal, so its reservation stays.
    assert_eq!(
        ctx.client.get_pending_reservation(&id),
        Some((ctx.token.clone(), 1_000))
    );
    assert_invariant(&env, &ctx, &ctx.token);
}

// ---------------------------------------------------------------------------
// Invariant property
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig::with_cases(16))]

    /// Random approve / execute / cancel sequences keep the risk invariants:
    /// spendable matches the formula, pending equals the sum of per-proposal
    /// reservations, and reservations never exceed unearmarked funds.
    #[test]
    fn prop_risk_invariants_hold(
        funding in 0i128..20_000,
        amounts in proptest::collection::vec(1i128..5_000, 1..5),
        ops in proptest::collection::vec((0usize..5, 0u8..3), 0..12),
    ) {
        let env = Env::default();
        let ctx = setup_vault(&env, funding, 0);

        let mut ids: std::vec::Vec<u64> = std::vec::Vec::new();
        for (i, amount) in amounts.iter().enumerate() {
            // Distinct amounts avoid duplicate-proposal fingerprints.
            let id = propose(&env, &ctx, &ctx.token, *amount + i as i128 * 10_000);
            approve(&ctx, id);
            ids.push(id);
        }

        for (idx, op) in ops {
            let id = ids[idx % ids.len()];
            match op {
                0 => { let _ = ctx.client.try_execute_proposal(&ctx.admin, &id); }
                1 => { let _ = ctx.client.try_cancel_proposal(&ctx.admin, &id, &Symbol::new(&env, "c")); }
                _ => { let _ = ctx.client.try_expire_approved_reservation(&id); }
            }

            let snap = ctx.client.get_treasury_risk_snapshot(&ctx.token);
            prop_assert_eq!(
                snap.spendable,
                (snap.balance - snap.earmarked - snap.pending - snap.locked).max(0)
            );

            let mut sum: i128 = 0;
            for pid in ids.iter() {
                let p = ctx.client.get_proposal(pid);
                match ctx.client.get_pending_reservation(pid) {
                    Some((_, amount)) => {
                        prop_assert!(matches!(p.status, ProposalStatus::Approved | ProposalStatus::Scheduled));
                        sum += amount;
                    }
                    None => {}
                }
            }
            prop_assert_eq!(snap.pending, sum);
            prop_assert!(snap.pending <= (snap.balance - snap.earmarked - snap.locked).max(0));
        }
    }
}
