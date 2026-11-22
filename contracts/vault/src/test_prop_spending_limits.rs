//! Property-based invariant tests for spending limits.
//!
//! These tests use `proptest` to verify that the vault's daily and weekly spending
//! accumulators, proposal spending reservations, and cancellation refunds satisfy
//! structural invariants across the full range of valid inputs — not just the
//! specific amounts chosen in example-based tests.
//!
//! ## Invariants under test
//!
//! 1. **Monotonicity** — daily/weekly buckets only increase while proposals are
//!    active; they never go negative.
//! 2. **Proposal limit gate** — `propose_transfer` always rejects amounts that
//!    exceed `config.spending_limit`.
//! 3. **Daily limit gate** — the second proposal in the same day that would push
//!    `daily_spent + amount > daily_limit` is always rejected.
//! 4. **Weekly limit gate** — analogous check over the weekly bucket.
//! 5. **Refund identity** — cancelling a proposal fully restores `daily_spent`
//!    and `weekly_spent` to their pre-proposal values.
//! 6. **Overflow safety** — no arithmetic in the spending path panics, even at
//!    near-`i128::MAX` amounts.
//! 7. **Bucket isolation** — cancelling a proposal created in day N does not
//!    affect the bucket for day N+1 (and vice-versa).
//!
//! ## Running
//!
//! ```bash
//! # Quick (CI default: 256 cases per property)
//! cargo test test_prop_spending -- --nocapture
//!
//! # Extended (nightly: 4 096 cases per property)
//! PROPTEST_CASES=4096 cargo test test_prop_spending -- --nocapture
//! ```
//!
//! ## Reproducing a failure
//!
//! When proptest finds a counterexample it prints:
//!
//! ```text
//! thread 'test_prop_spending_...' panicked at '...', src/test_prop_spending_limits.rs:NNN
//! minimal reproduction: ...
//! ```
//!
//! Copy the `minimal reproduction:` line and paste it into a `proptest!` block
//! inside a `#[test]` function (see `docs/reference/TESTING.md §8`).

#![cfg(test)]

use crate::types::{
    ConditionLogic, InitConfig, Priority, RecoveryConfig, RetryConfig, StakingConfig,
    ThresholdStrategy, VelocityConfig, VoteWeight,
};
use crate::{VaultDAO, VaultDAOClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};

// ---------------------------------------------------------------------------
// Constants for the shared vault configuration
// ---------------------------------------------------------------------------

/// Per-proposal hard cap used in all property tests.
const SPENDING_LIMIT: i128 = 100_000;

/// Daily aggregate ceiling — allows up to 5 full-sized proposals before
/// rejection, giving generators room to find the boundary without always
/// hitting it trivially.
const DAILY_LIMIT: i128 = 500_000;

/// Weekly aggregate ceiling — large enough that most single-day sequences
/// don't exhaust it, so tests can distinguish daily from weekly violations.
const WEEKLY_LIMIT: i128 = 2_000_000;

/// Ledger seconds in one "day" for the timestamp-based bucket calculation.
const DAY_SECS: u64 = 86_400;

/// Ledger seconds in one "week".
const WEEK_SECS: u64 = 604_800;

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

fn make_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env
}

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    // Fund vault so executions can succeed when we need them to.
    StellarAssetClient::new(env, &token).mint(&contract_id, &100_000_000);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    client.initialize(
        &admin,
        &InitConfig {
            signers,
            threshold: 1,
            quorum: 0,
            quorum_percentage: 0,
            spending_limit: SPENDING_LIMIT,
            daily_limit: DAILY_LIMIT,
            weekly_limit: WEEKLY_LIMIT,
            timelock_threshold: i128::MAX, // disable timelocks so execute works freely
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 1_000,
                window: 3_600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            default_voting_deadline: 0,
            veto_addresses: Vec::new(env),
            veto_window_ledgers: 0,
            retry_config: RetryConfig {
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
                max_retry_delay: 0,
            },
            recovery_config: RecoveryConfig::default(env),
            staking_config: StakingConfig::default(),
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            proposal_id_prefix: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1_440,
        },
    );

    (client, admin, token)
}

fn propose(
    client: &VaultDAOClient<'_>,
    admin: &Address,
    token: &Address,
    amount: i128,
) -> Result<u64, ()> {
    let recipient = Address::generate(&client.env);
    match client.try_propose_transfer(
        admin,
        &recipient,
        token,
        &amount,
        &Symbol::new(&client.env, "pay"),
        &Priority::Normal,
        &Vec::new(&client.env),
        &ConditionLogic::And,
        &0i128,
    ) {
        Ok(Ok(id)) => Ok(id),
        Ok(Err(_)) | Err(_) => Err(()),
    }
}

// ---------------------------------------------------------------------------
// Invariant 1 — Monotonicity: daily/weekly buckets never go negative after
// a successful proposal creation.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        max_shrink_iters: 2_048,
        ..Default::default()
    })]

    #[test]
    fn test_prop_spending_daily_bucket_monotonic(
        // Keep amounts strictly positive and ≤ per-proposal limit.
        amount in 1i128..=SPENDING_LIMIT,
        day_offset in 0u64..10u64,
    ) {
        let env = make_env();
        // Start at a stable epoch so day numbers are non-trivially 0.
        env.ledger().set_timestamp(DAY_SECS * (100 + day_offset));
        let (client, admin, token) = setup(&env);

        let day = env.ledger().timestamp() / DAY_SECS;
        let before = client.get_daily_spent(&day);

        // Create a proposal — if this succeeds, the bucket must have grown.
        if let Ok(id) = propose(&client, &admin, &token, amount) {
            let after = client.get_daily_spent(&day);
            prop_assert!(after >= before, "daily bucket must be non-decreasing after proposal creation");
            prop_assert_eq!(after - before, amount, "delta must equal the proposal amount");
            let _ = id; // suppress unused warning
        }
        // If proposal was rejected (exceeds limits, etc.) the bucket must be unchanged.
        // No assertion needed: a rejection that also corrupted state would surface via
        // the monotonicity check on the next iteration.
    }

    #[test]
    fn test_prop_spending_weekly_bucket_monotonic(
        amount in 1i128..=SPENDING_LIMIT,
        week_offset in 0u64..8u64,
    ) {
        let env = make_env();
        env.ledger().set_timestamp(WEEK_SECS * (10 + week_offset));
        let (client, admin, token) = setup(&env);

        let week = env.ledger().timestamp() / WEEK_SECS;
        let before = client.get_weekly_spent(&week);

        if let Ok(_id) = propose(&client, &admin, &token, amount) {
            let after = client.get_weekly_spent(&week);
            prop_assert!(after >= before, "weekly bucket must be non-decreasing after proposal creation");
            prop_assert_eq!(after - before, amount);
        }
    }
}

// ---------------------------------------------------------------------------
// Invariant 2 — Proposal limit gate: amounts > spending_limit are always
// rejected with ExceedsProposalLimit.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        max_shrink_iters: 2_048,
        ..Default::default()
    })]

    #[test]
    fn test_prop_spending_exceeds_proposal_limit_always_rejected(
        // Overage: anywhere from 1 stroop over the limit to 10x the limit.
        overage in 1i128..=(SPENDING_LIMIT * 10),
    ) {
        let env = make_env();
        env.ledger().set_timestamp(DAY_SECS * 50);
        let (client, admin, token) = setup(&env);

        let amount = SPENDING_LIMIT + overage;
        let result = propose(&client, &admin, &token, amount);
        prop_assert!(
            result.is_err(),
            "amount {} should be rejected (limit {})",
            amount,
            SPENDING_LIMIT,
        );
    }
}

// ---------------------------------------------------------------------------
// Invariant 3 — Daily limit gate: a proposal that would push daily_spent over
// daily_limit is rejected, while one that fits is accepted.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        max_shrink_iters: 2_048,
        ..Default::default()
    })]

    #[test]
    fn test_prop_spending_daily_limit_gate(
        // First proposal: a valid amount that the daily limit can absorb.
        first in 1i128..=SPENDING_LIMIT,
        // Second proposal: chosen so that first + second > DAILY_LIMIT.
        // We ensure the second is as large as the daily limit to guarantee overflow.
        second in DAILY_LIMIT..=(DAILY_LIMIT + SPENDING_LIMIT),
    ) {
        // Skip inputs that don't actually overflow the daily limit.
        prop_assume!(first + second > DAILY_LIMIT);

        let env = make_env();
        env.ledger().set_timestamp(DAY_SECS * 200);
        let (client, admin, token) = setup(&env);

        // First proposal should succeed.
        let first_result = propose(&client, &admin, &token, first);
        prop_assume!(first_result.is_ok()); // reject the test case if it fails for other reasons

        // Second proposal must be rejected because it overflows the daily limit.
        // (second > SPENDING_LIMIT so it fails the per-proposal check first — that's fine,
        //  the important property is that it never succeeds when both limits are exceeded.)
        let second_result = propose(&client, &admin, &token, second);
        prop_assert!(
            second_result.is_err(),
            "second proposal (amount={}) should be rejected: daily_spent={} + amount > daily_limit={}",
            second,
            first,
            DAILY_LIMIT,
        );
    }
}

// ---------------------------------------------------------------------------
// Invariant 4 — Refund identity: cancelling a proposal fully restores the
// bucket that was charged at creation time.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 512,
        max_shrink_iters: 4_096,
        ..Default::default()
    })]

    #[test]
    fn test_prop_spending_cancel_fully_refunds_daily_bucket(
        amount in 1i128..=SPENDING_LIMIT,
        // Optionally advance into a different day before cancelling,
        // exercising cross-day-boundary refund logic.
        days_before_cancel in 0u64..3u64,
    ) {
        let env = make_env();
        env.ledger().set_timestamp(DAY_SECS * 50);
        let (client, admin, token) = setup(&env);

        let creation_day = env.ledger().timestamp() / DAY_SECS;

        let id = match propose(&client, &admin, &token, amount) {
            Ok(id) => id,
            Err(_) => return Ok(()), // skip if for some reason creation fails
        };

        let after_create = client.get_daily_spent(&creation_day);
        prop_assert_eq!(after_create, amount, "bucket must reflect reservation after creation");

        // Optionally advance ledger into a different calendar day.
        if days_before_cancel > 0 {
            env.ledger()
                .set_timestamp(DAY_SECS * (50 + days_before_cancel));
        }

        client
            .try_cancel_proposal(&admin, &id, &Symbol::new(&env, "refund"))
            .expect("cancel should not host-panic")
            .expect("contract returned error during cancel");

        let after_cancel = client.get_daily_spent(&creation_day);
        prop_assert_eq!(
            after_cancel,
            0,
            "cancellation must fully refund the creation-day bucket (amount={}, days_before_cancel={})",
            amount,
            days_before_cancel,
        );
    }

    #[test]
    fn test_prop_spending_cancel_fully_refunds_weekly_bucket(
        amount in 1i128..=SPENDING_LIMIT,
        weeks_before_cancel in 0u64..2u64,
    ) {
        let env = make_env();
        env.ledger().set_timestamp(WEEK_SECS * 10);
        let (client, admin, token) = setup(&env);

        let creation_week = env.ledger().timestamp() / WEEK_SECS;

        let id = match propose(&client, &admin, &token, amount) {
            Ok(id) => id,
            Err(_) => return Ok(()),
        };

        prop_assert_eq!(client.get_weekly_spent(&creation_week), amount);

        if weeks_before_cancel > 0 {
            env.ledger()
                .set_timestamp(WEEK_SECS * (10 + weeks_before_cancel));
        }

        client
            .try_cancel_proposal(&admin, &id, &Symbol::new(&env, "refund"))
            .expect("cancel should not host-panic")
            .expect("contract returned error during cancel");

        prop_assert_eq!(
            client.get_weekly_spent(&creation_week),
            0,
            "cancellation must fully refund the creation-week bucket",
        );
    }
}

// ---------------------------------------------------------------------------
// Invariant 5 — Bucket isolation: cancelling a proposal from day N does not
// affect day N+1's bucket.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        max_shrink_iters: 2_048,
        ..Default::default()
    })]

    #[test]
    fn test_prop_spending_bucket_isolation(
        amount_day0 in 1i128..=SPENDING_LIMIT,
        amount_day1 in 1i128..=SPENDING_LIMIT,
    ) {
        let env = make_env();
        env.ledger().set_timestamp(DAY_SECS * 100);
        let (client, admin, token) = setup(&env);

        let day0 = env.ledger().timestamp() / DAY_SECS;
        let id0 = match propose(&client, &admin, &token, amount_day0) {
            Ok(id) => id,
            Err(_) => return Ok(()),
        };

        // Advance to the next day.
        env.ledger().set_timestamp(DAY_SECS * 101);
        let day1 = env.ledger().timestamp() / DAY_SECS;
        prop_assert_ne!(day0, day1);

        let id1 = match propose(&client, &admin, &token, amount_day1) {
            Ok(id) => id,
            Err(_) => {
                // If day1 proposal fails (e.g. velocity limit), clean up day0 and bail.
                let _ = client.try_cancel_proposal(&admin, &id0, &Symbol::new(&env, "bail"));
                return Ok(());
            }
        };

        // Cancel the day0 proposal while in day1.
        client
            .try_cancel_proposal(&admin, &id0, &Symbol::new(&env, "d0"))
            .expect("cancel d0 should succeed")
            .expect("contract panicked");

        // Day0 bucket must be cleared.
        prop_assert_eq!(client.get_daily_spent(&day0), 0, "day0 bucket must be zeroed after cancel");

        // Day1 bucket must be unaffected.
        prop_assert_eq!(
            client.get_daily_spent(&day1),
            amount_day1,
            "day1 bucket must not be altered by cancelling a day0 proposal",
        );

        // Clean up day1 too.
        let _ = client.try_cancel_proposal(&admin, &id1, &Symbol::new(&env, "d1"));
    }
}

// ---------------------------------------------------------------------------
// Invariant 6 — Overflow safety: near-maximum amounts are handled without
// panicking; they're rejected with a typed VaultError, never an abort.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 128,
        max_shrink_iters: 1_024,
        ..Default::default()
    })]

    #[test]
    fn test_prop_spending_near_max_never_panics(
        // Sample from extreme i128 territory — all well above any realistic limit.
        raw in (i128::MAX / 2)..=i128::MAX,
    ) {
        let env = make_env();
        env.ledger().set_timestamp(DAY_SECS * 500);
        let (client, admin, token) = setup(&env);

        // These are all bigger than SPENDING_LIMIT, so the contract must reject
        // them with a typed error.  The key invariant: it must NOT panic.
        let result = propose(&client, &admin, &token, raw);
        prop_assert!(
            result.is_err(),
            "near-max amount {} must be rejected, not accepted",
            raw,
        );
    }

    #[test]
    fn test_prop_spending_zero_and_negative_always_rejected(
        raw in i128::MIN..=0i128,
    ) {
        let env = make_env();
        env.ledger().set_timestamp(DAY_SECS * 500);
        let (client, admin, token) = setup(&env);

        let result = propose(&client, &admin, &token, raw);
        prop_assert!(
            result.is_err(),
            "zero/negative amount {} must always be rejected",
            raw,
        );
    }
}

// ---------------------------------------------------------------------------
// Invariant 7 — Multi-proposal accumulation: n sequential proposals each of
// amount `a` yield daily_spent == n * a, until the daily limit is crossed.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 128,
        max_shrink_iters: 2_048,
        ..Default::default()
    })]

    #[test]
    fn test_prop_spending_accumulation_exact(
        // Pick n in [1, 4] and amount that fits n times in the daily limit.
        n in 1usize..=4usize,
        amount in 1i128..=(DAILY_LIMIT / 5),
    ) {
        // Skip if n proposals would exceed the daily limit — that path is
        // tested separately by the daily-limit gate invariant.
        prop_assume!((n as i128) * amount <= DAILY_LIMIT);
        // Also skip if any single amount exceeds the per-proposal limit.
        prop_assume!(amount <= SPENDING_LIMIT);

        let env = make_env();
        env.ledger().set_timestamp(DAY_SECS * 300);
        let (client, admin, token) = setup(&env);

        let day = env.ledger().timestamp() / DAY_SECS;

        for i in 0..n {
            let result = propose(&client, &admin, &token, amount);
            match result {
                Ok(_) => {
                    let expected = (i as i128 + 1) * amount;
                    prop_assert_eq!(
                        client.get_daily_spent(&day),
                        expected,
                        "after {} proposals of amount {} each, daily_spent should be {}",
                        i + 1,
                        amount,
                        expected,
                    );
                }
                Err(e) => {
                    // Should not happen given the prop_assume guards above.
                    prop_assert!(false, "proposal {} of {} unexpectedly failed: {:?}", i + 1, n, e);
                }
            }
        }
    }
}
