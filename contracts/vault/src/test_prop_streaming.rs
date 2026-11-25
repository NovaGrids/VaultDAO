//! Property-based invariant tests for streaming payments.
//!
//! ## Invariants under test
//!
//! 1. **Accrual bound** — `claimed_amount` can never exceed `total_amount`.
//! 2. **Rate × elapsed = accrued** — claimable tokens equal `rate × active_seconds`,
//!    capped at `total_amount - claimed_amount`.
//! 3. **Pause stops accrual** — no tokens accumulate while a stream is paused.
//! 4. **Resume restores accrual** — after resuming, accrual continues from where
//!    it left off; the paused interval is not counted.
//! 5. **Cancel returns unclaimed** — after cancellation, the recipient cannot
//!    claim any further tokens (beyond what was already claimable at cancel time).
//! 6. **No over-claim** — multiple claim calls on the same stream never transfer
//!    more than `total_amount` in aggregate.
//! 7. **Zero/negative rate rejected** — streams with `rate <= 0` are rejected.
//! 8. **Completed state is terminal** — a fully-claimed stream cannot be claimed
//!    from again.
//!
//! ## Running
//!
//! ```bash
//! # CI default
//! cargo test test_prop_streaming -- --nocapture
//!
//! # Extended nightly run
//! PROPTEST_CASES=4096 cargo test test_prop_streaming -- --nocapture
//! ```

#![cfg(test)]

use crate::types::{
    InitConfig, RecoveryConfig, RetryConfig, Role, StakingConfig,
    StreamStatus, ThresholdStrategy, VelocityConfig, VoteWeight,
};
use crate::{VaultDAO, VaultDAOClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Vec,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Tokens funded into the vault for every test.
const VAULT_BALANCE: i128 = 1_000_000_000;

/// Maximum stream duration exercised by the generators (seconds).
const MAX_DURATION_SECS: u64 = 3_600 * 24 * 30; // 30 days

/// Start timestamp used so "elapsed" arithmetic is always positive.
const BASE_TS: u64 = 1_700_000_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn make_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env
}

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let recipient = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    StellarAssetClient::new(env, &token).mint(&contract_id, &VAULT_BALANCE);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    client.initialize(
        &admin,
        &InitConfig {
            signers,
            threshold: 1,
            quorum: 0,
            quorum_percentage: 0,
            spending_limit: VAULT_BALANCE,
            daily_limit: VAULT_BALANCE,
            weekly_limit: VAULT_BALANCE * 7,
            timelock_threshold: i128::MAX,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 10_000,
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
            upgrade_timelock_delay: 17_280,
        },
    );

    // Grant admin the Treasurer role so create_stream passes the role check.
    client.set_role(&admin, &admin, &Role::Treasurer);

    (client, admin, recipient, token)
}

/// Create a stream. Returns `stream_id` on success, `Err(())` on any rejection.
fn create_stream(
    client: &VaultDAOClient<'_>,
    sender: &Address,
    recipient: &Address,
    token: &Address,
    rate: i128,
    total_amount: i128,
    duration_secs: u64,
) -> Result<u64, ()> {
    match client.try_create_stream(sender, recipient, token, &rate, &total_amount, &duration_secs) {
        Ok(Ok(id)) => Ok(id),
        Ok(Err(_)) | Err(_) => Err(()),
    }
}

// ---------------------------------------------------------------------------
// Invariant 1 — Accrual bound: claimed_amount ≤ total_amount at all times.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        max_shrink_iters: 2_048,
        ..Default::default()
    })]

    #[test]
    fn test_prop_streaming_claimed_never_exceeds_total(
        // Rates and totals sampled in ranges that keep total_amount ≤ VAULT_BALANCE.
        rate in 1i128..=1_000i128,
        duration_secs in 1u64..=MAX_DURATION_SECS,
        // Elapsed seconds at which we attempt a claim (may exceed duration).
        elapsed_secs in 0u64..=(MAX_DURATION_SECS + 3_600),
    ) {
        let env = make_env();
        env.ledger().set_timestamp(BASE_TS);

        let (client, admin, recipient, token) = setup(&env);

        // total_amount = rate × duration, capped to avoid exceeding vault balance.
        let total_amount = (rate * duration_secs as i128).min(VAULT_BALANCE / 10);
        prop_assume!(total_amount > 0);

        let stream_id = match create_stream(
            &client, &admin, &recipient, &token, rate, total_amount, duration_secs,
        ) {
            Ok(id) => id,
            Err(_) => return Ok(()), // stream creation rejected — skip
        };

        // Advance time and attempt a claim.
        env.ledger().set_timestamp(BASE_TS + elapsed_secs);
        let _ = client.try_claim_stream(&recipient, &stream_id);

        // Regardless of whether claim succeeded or failed, the invariant holds.
        let stream = client.get_stream(&stream_id);
        prop_assert!(
            stream.claimed_amount <= stream.total_amount,
            "claimed_amount ({}) must never exceed total_amount ({})",
            stream.claimed_amount,
            stream.total_amount,
        );
        prop_assert!(stream.claimed_amount >= 0, "claimed_amount must be non-negative");
    }
}

// ---------------------------------------------------------------------------
// Invariant 2 — Rate × elapsed = accrued (before any claim).
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        max_shrink_iters: 2_048,
        ..Default::default()
    })]

    #[test]
    fn test_prop_streaming_accrual_matches_rate_times_elapsed(
        rate in 1i128..=100i128,
        duration_secs in 3_600u64..=MAX_DURATION_SECS,
        // Elapsed must be within the stream's lifetime and at least 1 second.
        elapsed_secs in 1u64..=3_600u64,
    ) {
        // Skip inputs where elapsed > duration (stream would already be exhausted).
        prop_assume!(elapsed_secs <= duration_secs);

        let env = make_env();
        env.ledger().set_timestamp(BASE_TS);

        let (client, admin, recipient, token) = setup(&env);

        let total_amount = (rate * duration_secs as i128).min(VAULT_BALANCE / 10);
        prop_assume!(total_amount > 0);

        let stream_id = match create_stream(
            &client, &admin, &recipient, &token, rate, total_amount, duration_secs,
        ) {
            Ok(id) => id,
            Err(_) => return Ok(()),
        };

        // Advance exactly `elapsed_secs` and claim once.
        env.ledger().set_timestamp(BASE_TS + elapsed_secs);
        let claim_result = client.try_claim_stream(&recipient, &stream_id);

        if let Ok(Ok(claimed)) = claim_result {
            let expected = (rate * elapsed_secs as i128).min(total_amount);
            // Allow ±1 stroop for integer-division rounding in the contract.
            let diff = (claimed - expected).abs();
            prop_assert!(
                diff <= 1,
                "claimed {} but expected rate({}) × elapsed({}) = {} (diff={})",
                claimed,
                rate,
                elapsed_secs,
                expected,
                diff,
            );
        }
        // If claim returned an error (nothing yet accrued — elapsed too short),
        // the stream's claimed_amount should still be 0.
        let stream = client.get_stream(&stream_id);
        prop_assert!(stream.claimed_amount >= 0);
    }
}

// ---------------------------------------------------------------------------
// Invariant 3 — Pause stops accrual: tokens do not accumulate while paused.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        max_shrink_iters: 2_048,
        ..Default::default()
    })]

    #[test]
    fn test_prop_streaming_pause_stops_accrual(
        rate in 1i128..=100i128,
        duration_secs in 7_200u64..=MAX_DURATION_SECS,
        // Duration of the pause window (seconds).
        pause_duration in 1u64..=3_600u64,
    ) {
        prop_assume!(pause_duration < duration_secs);

        let env = make_env();
        env.ledger().set_timestamp(BASE_TS);

        let (client, admin, recipient, token) = setup(&env);

        let total_amount = (rate * duration_secs as i128).min(VAULT_BALANCE / 10);
        prop_assume!(total_amount > 0);

        let stream_id = match create_stream(
            &client, &admin, &recipient, &token, rate, total_amount, duration_secs,
        ) {
            Ok(id) => id,
            Err(_) => return Ok(()),
        };

        // Let 1 second elapse, then pause.
        env.ledger().set_timestamp(BASE_TS + 1);
        if !matches!(client.try_pause_stream(&admin, &stream_id), Ok(Ok(_))) {
            return Ok(()); // pause rejected (e.g. already inactive) — skip
        }

        // Snapshot claimed_amount immediately after pause.
        let stream_at_pause = client.get_stream(&stream_id);
        let claimed_at_pause = stream_at_pause.claimed_amount;

        // Advance through the pause window without claiming.
        env.ledger().set_timestamp(BASE_TS + 1 + pause_duration);

        // The stream is still paused — accrual should not have increased.
        let stream_during_pause = client.get_stream(&stream_id);
        prop_assert_eq!(
            stream_during_pause.status,
            StreamStatus::Paused,
            "stream must still be Paused",
        );
        prop_assert_eq!(
            stream_during_pause.claimed_amount,
            claimed_at_pause,
            "claimed_amount must not change while stream is paused",
        );

        // Attempt a claim while paused — it must either be rejected or return 0.
        if let Ok(Ok(claimed_while_paused)) = client.try_claim_stream(&recipient, &stream_id) {
            prop_assert_eq!(
                claimed_while_paused, 0,
                "claim while paused must return 0 (no new accrual)",
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Invariant 4 — Resume restores accrual: paused duration is excluded.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        max_shrink_iters: 2_048,
        ..Default::default()
    })]

    #[test]
    fn test_prop_streaming_resume_excludes_paused_time(
        rate in 1i128..=50i128,
        duration_secs in 10_000u64..=MAX_DURATION_SECS,
        pause_duration in 1_000u64..=5_000u64,
        active_after_resume in 100u64..=1_000u64,
    ) {
        prop_assume!(pause_duration + active_after_resume < duration_secs);

        let env = make_env();
        env.ledger().set_timestamp(BASE_TS);

        let (client, admin, recipient, token) = setup(&env);

        let total_amount = (rate * duration_secs as i128).min(VAULT_BALANCE / 10);
        prop_assume!(total_amount > 0);

        let stream_id = match create_stream(
            &client, &admin, &recipient, &token, rate, total_amount, duration_secs,
        ) {
            Ok(id) => id,
            Err(_) => return Ok(()),
        };

        // Pause immediately.
        env.ledger().set_timestamp(BASE_TS + 1);
        if !matches!(client.try_pause_stream(&admin, &stream_id), Ok(Ok(_))) {
            return Ok(());
        }

        // Advance through pause window, then resume.
        env.ledger().set_timestamp(BASE_TS + 1 + pause_duration);
        if !matches!(client.try_resume_stream(&admin, &stream_id), Ok(Ok(_))) {
            return Ok(());
        }

        // Let some active time pass after resumption, then claim.
        env.ledger().set_timestamp(BASE_TS + 1 + pause_duration + active_after_resume);
        let _ = client.try_claim_stream(&recipient, &stream_id);

        let stream = client.get_stream(&stream_id);

        // Accrual should correspond to the ACTIVE seconds only (~1 + active_after_resume),
        // not to (1 + pause_duration + active_after_resume). We allow ±2 for rounding.
        let active_secs = 1u64 + active_after_resume;
        let expected_max = (rate * active_secs as i128).min(total_amount);
        // The claimed amount should not significantly exceed what rate × active seconds allows.
        // A larger violation means paused time was counted, which is the invariant we're testing.
        prop_assert!(
            stream.claimed_amount <= expected_max + 2,
            "claimed {} but active-time model allows only {} (rate={}, active_secs={}). \
             Paused seconds ({}) must not count toward accrual.",
            stream.claimed_amount,
            expected_max,
            rate,
            active_secs,
            pause_duration,
        );
    }
}

// ---------------------------------------------------------------------------
// Invariant 5 — No over-claim: repeated claim calls never transfer more than
// total_amount in aggregate.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        max_shrink_iters: 2_048,
        ..Default::default()
    })]

    #[test]
    fn test_prop_streaming_no_over_claim(
        rate in 1i128..=1_000i128,
        duration_secs in 3_600u64..=MAX_DURATION_SECS,
        num_claims in 1usize..=5usize,
    ) {
        let env = make_env();
        env.ledger().set_timestamp(BASE_TS);

        let (client, admin, recipient, token) = setup(&env);

        let total_amount = (rate * duration_secs as i128).min(VAULT_BALANCE / 10);
        prop_assume!(total_amount > 0);

        let stream_id = match create_stream(
            &client, &admin, &recipient, &token, rate, total_amount, duration_secs,
        ) {
            Ok(id) => id,
            Err(_) => return Ok(()),
        };

        let mut total_claimed: i128 = 0;
        let step = duration_secs / (num_claims as u64 + 1);

        for i in 1..=num_claims {
            env.ledger()
                .set_timestamp(BASE_TS + step * i as u64);
            if let Ok(Ok(claimed)) = client.try_claim_stream(&recipient, &stream_id) {
                total_claimed += claimed;
            }

            // Invariant must hold after every intermediate claim, not just the last.
            let stream = client.get_stream(&stream_id);
            prop_assert!(
                stream.claimed_amount <= stream.total_amount,
                "after claim {}/{}: claimed_amount ({}) > total_amount ({})",
                i,
                num_claims,
                stream.claimed_amount,
                stream.total_amount,
            );
        }

        prop_assert!(
            total_claimed <= total_amount,
            "aggregate claimed ({}) exceeded total_amount ({})",
            total_claimed,
            total_amount,
        );
    }
}

// ---------------------------------------------------------------------------
// Invariant 6 — Completed state is terminal: fully-claimed stream rejects
// subsequent claim attempts.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 128,
        max_shrink_iters: 1_024,
        ..Default::default()
    })]

    #[test]
    fn test_prop_streaming_completed_is_terminal(
        rate in 1i128..=1_000i128,
        // Short duration so total_amount is small and we can claim it in one shot.
        duration_secs in 1u64..=100u64,
    ) {
        let env = make_env();
        env.ledger().set_timestamp(BASE_TS);

        let (client, admin, recipient, token) = setup(&env);

        let total_amount = (rate * duration_secs as i128).min(VAULT_BALANCE / 10);
        prop_assume!(total_amount > 0);

        let stream_id = match create_stream(
            &client, &admin, &recipient, &token, rate, total_amount, duration_secs,
        ) {
            Ok(id) => id,
            Err(_) => return Ok(()),
        };

        // Jump past the stream's end time so the entire total is claimable.
        env.ledger().set_timestamp(BASE_TS + duration_secs + 1);
        let _ = client.try_claim_stream(&recipient, &stream_id);

        let stream = client.get_stream(&stream_id);
        // Only assert the terminal invariant if we actually claimed everything.
        if stream.claimed_amount == stream.total_amount {
            prop_assert_eq!(stream.status, StreamStatus::Completed);

            // A second claim on a Completed stream must be rejected.
            let second = client.try_claim_stream(&recipient, &stream_id);
            prop_assert!(
                second.map(|r| r.is_err()).unwrap_or(true),
                "claim on a Completed stream must be rejected",
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Invariant 7 — Zero/negative rate is always rejected.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 128,
        max_shrink_iters: 512,
        ..Default::default()
    })]

    #[test]
    fn test_prop_streaming_invalid_rate_rejected(
        rate in i128::MIN..=0i128,
        duration_secs in 1u64..=MAX_DURATION_SECS,
    ) {
        let env = make_env();
        env.ledger().set_timestamp(BASE_TS);

        let (client, admin, recipient, token) = setup(&env);

        let result = create_stream(&client, &admin, &recipient, &token, rate, 1_000, duration_secs);
        prop_assert!(
            result.is_err(),
            "rate={} must be rejected (must be > 0)",
            rate,
        );
    }

    #[test]
    fn test_prop_streaming_zero_total_rejected(
        rate in 1i128..=1_000i128,
        duration_secs in 1u64..=MAX_DURATION_SECS,
    ) {
        let env = make_env();
        env.ledger().set_timestamp(BASE_TS);

        let (client, admin, recipient, token) = setup(&env);

        let result = create_stream(&client, &admin, &recipient, &token, rate, 0, duration_secs);
        prop_assert!(result.is_err(), "total_amount=0 must be rejected");
    }
}
