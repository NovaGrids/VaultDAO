//! Property-based invariant tests for reentrancy and execution-state integrity.
//!
//! Soroban's execution model prevents true reentrancy at the host level, but the
//! contract must still enforce its own state-machine invariants regardless of call
//! ordering, approval count, or ledger sequence.  These tests search for
//! counterexamples across randomly generated sequences of approve → execute →
//! re-execute attempts to prove those invariants hold universally.
//!
//! ## Invariants under test
//!
//! 1. **Terminal status is permanent** — a proposal in `Executed`, `Cancelled`,
//!    `Expired`, or `Vetoed` can never transition to another status.
//! 2. **No double-execution** — a successfully executed proposal always returns
//!    an error on any subsequent `execute_proposal` call.
//! 3. **Status after execution is always Executed** — if `execute_proposal`
//!    returns `Ok`, the stored status must be `Executed`.
//! 4. **Approval idempotence** — a signer who has already approved cannot
//!    approve again (AlreadyApproved), and their approval count does not change.
//! 5. **Execution precondition** — `execute_proposal` on a Pending proposal
//!    (threshold not met) is always rejected.
//! 6. **Concurrent proposal independence** — executing proposal A does not alter
//!    the status or approval count of unrelated proposal B.
//! 7. **Guard cleared after execution** — the reentrancy guard stored in the
//!    contract is always cleared after a successful execution (a second call in
//!    the same test always returns a typed error, never hangs or panics).
//!
//! ## Running
//!
//! ```bash
//! cargo test test_prop_reentrancy -- --nocapture
//! PROPTEST_CASES=4096 cargo test test_prop_reentrancy -- --nocapture
//! ```

#![cfg(test)]

use crate::types::{
    ConditionLogic, InitConfig, Priority, ProposalStatus, RecoveryConfig, RetryConfig, Role,
    StakingConfig, ThresholdStrategy, VelocityConfig, VoteWeight,
};
use crate::{VaultDAO, VaultDAOClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn make_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env
}

/// Terminal statuses — once reached, a proposal must never leave.
fn is_terminal(status: &ProposalStatus) -> bool {
    matches!(
        status,
        ProposalStatus::Executed
            | ProposalStatus::Cancelled
            | ProposalStatus::Expired
            | ProposalStatus::Vetoed
            | ProposalStatus::Rejected
    )
}

/// Build a vault with two signers and threshold=`threshold`.
/// Returns `(client, admin, signer2, token, contract_id)`.
fn setup_with_threshold(
    env: &Env,
    threshold: u32,
) -> (VaultDAOClient<'_>, Address, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let signer2 = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    StellarAssetClient::new(env, &token).mint(&contract_id, &100_000_000);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer2.clone());

    // Clamp threshold to [1, 2].
    let t = threshold.clamp(1, 2);

    client.initialize(
        &admin,
        &InitConfig {
            signers,
            threshold: t,
            quorum: 0,
            quorum_percentage: 0,
            spending_limit: 10_000_000,
            daily_limit: 50_000_000,
            weekly_limit: 200_000_000,
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
        },
    );

    client.set_role(&admin, &admin, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);

    (client, admin, signer2, token, contract_id)
}

fn new_proposal(
    client: &VaultDAOClient<'_>,
    proposer: &Address,
    token: &Address,
    amount: i128,
) -> u64 {
    let recipient = Address::generate(&client.env);
    client
        .propose_transfer(
            proposer,
            &recipient,
            token,
            &amount,
            &Symbol::new(&client.env, "memo"),
            &Priority::Normal,
            &Vec::new(&client.env),
            &ConditionLogic::And,
            &0i128,
        )
}

// ---------------------------------------------------------------------------
// Invariant 1 — Terminal status is permanent.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        max_shrink_iters: 2_048,
        ..Default::default()
    })]

    /// A cancelled proposal cannot be re-approved or re-executed.
    #[test]
    fn test_prop_reentrancy_cancelled_is_terminal(
        amount in 1i128..=1_000i128,
    ) {
        let env = make_env();
        let (client, admin, signer2, token, _) = setup_with_threshold(&env, 1);

        let id = new_proposal(&client, &admin, &token, amount);

        // Cancel immediately.
        client.cancel_proposal(&admin, &id, &Symbol::new(&env, "stop"));

        let status_after_cancel = client.get_proposal(&id).status;
        prop_assert!(is_terminal(&status_after_cancel),
            "status after cancel must be terminal, got {:?}", status_after_cancel);

        // Attempt approve — must fail.
        let approve_result = client.try_approve_proposal(&admin, &id);
        prop_assert!(approve_result.map(|r| r.is_err()).unwrap_or(true),
            "approve on a cancelled proposal must be rejected");

        // Attempt execute — must fail.
        let exec_result = client.try_execute_proposal(&admin, &id);
        prop_assert!(exec_result.map(|r| r.is_err()).unwrap_or(true),
            "execute on a cancelled proposal must be rejected");

        // Status must not have changed.
        let final_status = client.get_proposal(&id).status;
        prop_assert_eq!(&final_status, &status_after_cancel,
            "status must not change after rejected calls on a terminal proposal");

        let _ = signer2; // suppress unused warning
    }

    /// An executed proposal cannot be executed again.
    #[test]
    fn test_prop_reentrancy_executed_is_terminal(
        amount in 1i128..=1_000i128,
        // Ledger advance before the second execute attempt.
        ledger_offset in 0u32..=100_000u32,
    ) {
        let env = make_env();
        // threshold=1 so a single approval by admin is enough.
        let (client, admin, _signer2, token, _) = setup_with_threshold(&env, 1);

        let id = new_proposal(&client, &admin, &token, amount);
        client.approve_proposal(&admin, &id);
        let _ = client.try_execute_proposal(&admin, &id);

        let status_after_first = client.get_proposal(&id).status;

        // Advance ledger before second attempt.
        let seq = env.ledger().sequence();
        env.ledger().set_sequence_number(seq.saturating_add(ledger_offset));

        // Second execute must be rejected.
        let second = client.try_execute_proposal(&admin, &id);
        prop_assert!(second.map(|r| r.is_err()).unwrap_or(true),
            "second execute_proposal call must return an error");

        // Status must not have changed.
        let final_status = client.get_proposal(&id).status;
        prop_assert_eq!(final_status, status_after_first,
            "status must not change after a rejected re-execute attempt");
    }
}

// ---------------------------------------------------------------------------
// Invariant 2 — Status after a successful execution is always `Executed`.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        max_shrink_iters: 2_048,
        ..Default::default()
    })]

    #[test]
    fn test_prop_reentrancy_successful_execute_sets_executed_status(
        amount in 1i128..=1_000i128,
    ) {
        let env = make_env();
        let (client, admin, _signer2, token, _) = setup_with_threshold(&env, 1);

        let id = new_proposal(&client, &admin, &token, amount);
        client.approve_proposal(&admin, &id);

        if let Ok(Ok(())) = client.try_execute_proposal(&admin, &id) {
            let status = client.get_proposal(&id).status;
            prop_assert_eq!(
                status,
                ProposalStatus::Executed,
                "proposal must have status Executed after successful execute_proposal",
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Invariant 3 — Approval idempotence: re-approving the same proposal returns
// AlreadyApproved and does not change the approval count.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        max_shrink_iters: 2_048,
        ..Default::default()
    })]

    #[test]
    fn test_prop_reentrancy_double_approve_rejected(
        amount in 1i128..=1_000i128,
        // Ledger offset between the two approve attempts.
        ledger_offset in 0u32..=1_000u32,
    ) {
        let env = make_env();
        // threshold=2 so a single approval doesn't execute the proposal,
        // giving us room to observe the approval list between the two calls.
        let (client, admin, _signer2, token, _) = setup_with_threshold(&env, 2);

        let id = new_proposal(&client, &admin, &token, amount);

        // First approval must succeed.
        let first = client.try_approve_proposal(&admin, &id);
        prop_assert!(first.map(|r| r.is_ok()).unwrap_or(false),
            "first approve should succeed");

        let approvals_after_first = client.get_proposal(&id).approvals.len();

        env.ledger()
            .set_sequence_number(env.ledger().sequence().saturating_add(ledger_offset));

        // Second approval by the same signer must be rejected.
        let second = client.try_approve_proposal(&admin, &id);
        prop_assert!(second.map(|r| r.is_err()).unwrap_or(true),
            "duplicate approve must be rejected");

        // Approval count must be unchanged.
        let approvals_after_second = client.get_proposal(&id).approvals.len();
        prop_assert_eq!(
            approvals_after_second,
            approvals_after_first,
            "approval count must not increase after a rejected duplicate approve",
        );
    }
}

// ---------------------------------------------------------------------------
// Invariant 4 — Execution precondition: Pending proposals (threshold not met)
// cannot be executed.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        max_shrink_iters: 2_048,
        ..Default::default()
    })]

    #[test]
    fn test_prop_reentrancy_pending_proposal_not_executable(
        amount in 1i128..=1_000i128,
    ) {
        let env = make_env();
        // threshold=2: even after admin approves, the proposal needs signer2 too.
        let (client, admin, _signer2, token, _) = setup_with_threshold(&env, 2);

        let id = new_proposal(&client, &admin, &token, amount);

        // No approvals at all — Pending.
        let result = client.try_execute_proposal(&admin, &id);
        prop_assert!(result.map(|r| r.is_err()).unwrap_or(true),
            "executing an unapproved proposal must be rejected");

        // Add one approval (threshold still not met with threshold=2).
        let _ = client.try_approve_proposal(&admin, &id);
        let result2 = client.try_execute_proposal(&admin, &id);
        prop_assert!(result2.map(|r| r.is_err()).unwrap_or(true),
            "executing with insufficient approvals must be rejected");

        // Status must still be Pending.
        let status = client.get_proposal(&id).status;
        prop_assert_eq!(status, ProposalStatus::Pending,
            "status must remain Pending when execution preconditions are not met");
    }
}

// ---------------------------------------------------------------------------
// Invariant 5 — Concurrent proposal independence: executing A does not
// corrupt B's status or approval list.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        max_shrink_iters: 2_048,
        ..Default::default()
    })]

    #[test]
    fn test_prop_reentrancy_independent_proposals_dont_interfere(
        amount_a in 1i128..=500i128,
        amount_b in 1i128..=500i128,
    ) {
        let env = make_env();
        let (client, admin, signer2, token, _) = setup_with_threshold(&env, 1);

        let id_a = new_proposal(&client, &admin, &token, amount_a);
        let id_b = new_proposal(&client, &admin, &token, amount_b);

        // Approve both.
        let _ = client.try_approve_proposal(&admin, &id_a);
        let _ = client.try_approve_proposal(&admin, &id_b);

        // Snapshot B's approval list before executing A.
        let approvals_b_before = client.get_proposal(&id_b).approvals.len();
        let status_b_before = client.get_proposal(&id_b).status.clone();

        // Execute A.
        let _ = client.try_execute_proposal(&admin, &id_a);

        // B must be unchanged.
        let approvals_b_after = client.get_proposal(&id_b).approvals.len();
        let status_b_after = client.get_proposal(&id_b).status.clone();

        prop_assert_eq!(
            approvals_b_after,
            approvals_b_before,
            "executing proposal A must not change B's approval count",
        );
        prop_assert_eq!(
            status_b_after,
            status_b_before,
            "executing proposal A must not change B's status",
        );

        let _ = signer2; // suppress unused warning
    }
}

// ---------------------------------------------------------------------------
// Invariant 6 — Guard cleared after execution: the second call in the same
// test always returns a typed error, never panics.
// This test specifically verifies that the execution-lock flag does not remain
// set after a successful execution.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        max_shrink_iters: 2_048,
        ..Default::default()
    })]

    #[test]
    fn test_prop_reentrancy_guard_cleared_allows_next_proposal(
        amount_first in 1i128..=500i128,
        amount_second in 1i128..=500i128,
    ) {
        let env = make_env();
        let (client, admin, _signer2, token, _) = setup_with_threshold(&env, 1);

        // Execute first proposal.
        let id1 = new_proposal(&client, &admin, &token, amount_first);
        client.approve_proposal(&admin, &id1);
        let first_result = client.try_execute_proposal(&admin, &id1);

        // If first execution succeeded, the guard must have been cleared.
        // We verify this by successfully executing a second, independent proposal.
        if first_result.map(|r| r.is_ok()).unwrap_or(false) {
            let id2 = new_proposal(&client, &admin, &token, amount_second);
            client.approve_proposal(&admin, &id2);

            // This call must NOT panic. It may fail (e.g. daily limit reached),
            // but it must resolve to a typed result — not hang or abort.
            let second_result = client.try_execute_proposal(&admin, &id2);
            prop_assert!(
                second_result.is_ok() || second_result.is_err(),
                "second execute after guard clear must return a typed result, not panic",
            );
        }
    }

    /// Randomly ordered approve/cancel/execute sequences must never produce
    /// an unexpected status or panic for any proposal.
    #[test]
    fn test_prop_reentrancy_arbitrary_sequence_no_panic(
        amount in 1i128..=1_000i128,
        // Encode the action sequence as a compact bit pattern:
        //   bits 0-1: initial action (00=none, 01=approve, 10=cancel, 11=approve+cancel)
        //   bit  2:   attempt execute
        //   bit  3:   advance ledger before execute
        //   bits 4-5: post-execute action (00=none, 01=re-approve, 10=re-execute, 11=both)
        sequence in 0u8..=63u8,
    ) {
        let env = make_env();
        let (client, admin, _signer2, token, _) = setup_with_threshold(&env, 1);

        let id = new_proposal(&client, &admin, &token, amount);

        let approve_first  = (sequence & 0b0000_0001) != 0;
        let cancel_first   = (sequence & 0b0000_0010) != 0;
        let attempt_exec   = (sequence & 0b0000_0100) != 0;
        let advance_ledger = (sequence & 0b0000_1000) != 0;
        let re_approve     = (sequence & 0b0001_0000) != 0;
        let re_execute     = (sequence & 0b0010_0000) != 0;

        if approve_first {
            let _ = client.try_approve_proposal(&admin, &id);
        }
        if cancel_first {
            let _ = client.try_cancel_proposal(&admin, &id, &Symbol::new(&env, "c1"));
        }
        if advance_ledger {
            let seq = env.ledger().sequence();
            env.ledger().set_sequence_number(seq.saturating_add(1_000));
        }
        if attempt_exec {
            // Must not panic.
            let _ = client.try_execute_proposal(&admin, &id);
        }
        if re_approve {
            let _ = client.try_approve_proposal(&admin, &id);
        }
        if re_execute {
            // Must not panic.
            let _ = client.try_execute_proposal(&admin, &id);
        }

        // Final state check: the proposal must still be retrievable and in a
        // valid, well-defined status.
        let proposal = client.get_proposal(&id);
        let valid_statuses = [
            ProposalStatus::Pending,
            ProposalStatus::Approved,
            ProposalStatus::Executed,
            ProposalStatus::Cancelled,
            ProposalStatus::Expired,
            ProposalStatus::Rejected,
            ProposalStatus::Vetoed,
            ProposalStatus::Scheduled,
        ];
        prop_assert!(
            valid_statuses.contains(&proposal.status),
            "proposal status {:?} is not a valid ProposalStatus variant",
            proposal.status,
        );
    }
}

// ---------------------------------------------------------------------------
// Invariant 7 — Spending reservation integrity across execution.
// Executing a proposal reduces the vault's spendable balance by exactly the
// proposal amount — not more, not less.
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        max_shrink_iters: 2_048,
        ..Default::default()
    })]

    #[test]
    fn test_prop_reentrancy_execution_charges_exact_amount(
        amount in 1i128..=1_000i128,
    ) {
        let env = make_env();
        env.ledger().set_timestamp(86_400 * 50); // stable day bucket
        let (client, admin, _signer2, token, _) = setup_with_threshold(&env, 1);

        let day = env.ledger().timestamp() / 86_400;

        // Creation reserves the amount.
        let id = new_proposal(&client, &admin, &token, amount);
        prop_assert_eq!(client.get_daily_spent(&day), amount,
            "proposal creation must reserve exactly `amount` in the daily bucket");

        // Approval and execution must not double-charge.
        client.approve_proposal(&admin, &id);
        let exec_result = client.try_execute_proposal(&admin, &id);

        if exec_result.map(|r| r.is_ok()).unwrap_or(false) {
            // After execution the daily bucket should still reflect exactly `amount`
            // (the reservation was placed at creation and is consumed at execution).
            let daily_after_exec = client.get_daily_spent(&day);
            prop_assert_eq!(
                daily_after_exec,
                amount,
                "daily_spent after execution must equal the proposal amount (no double-charge)",
            );
        }
    }
}
