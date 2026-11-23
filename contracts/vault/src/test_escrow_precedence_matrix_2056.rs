//! Tests for Issue #2056: escrow milestone engine, multisig arbitration and
//! the expiry / dispute / partial-release precedence matrix.
//!
//! Every cell of the matrix in `docs/guides/ESCROW.md` is executed below
//! against a fresh contract: one escrow state × one point in time × one action,
//! with the expected status and fund split (or error).
//!
//! Escrow used by every cell: 1_000 units, milestone 1 = 40 %, milestone 2 =
//! 60 %, created at ledger 10, expires at ledger 1_010, arbitration timeout
//! 100 ledgers.
#![cfg(test)]

use crate::errors::VaultError;
use crate::storage;
use crate::test_escrow_milestone_auth::setup;
use crate::types::{EscrowStatus, Milestone, Role};
use crate::VaultDAOClient;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::TokenClient,
    Address, Env, Symbol, Vec,
};

const TOTAL: i128 = 1_000;
const CREATED_AT: u32 = 10;
const DURATION: u64 = 1_000;
const EXPIRES_AT: u32 = CREATED_AT + DURATION as u32;
const TIMEOUT: u64 = 100;

/// Escrow state a cell starts from.
#[derive(Clone, Copy, Debug)]
enum State {
    /// Funded, no milestone completed
    Funded,
    /// Milestone 1 completed, not paid
    Earned40,
    /// Milestone 1 completed and paid through a partial release
    Paid40,
    /// Both milestones completed, nothing paid (`MilestonesComplete`)
    Complete,
    /// Milestone 1 paid, then disputed at `dispute_at`
    DisputedPaid40,
    /// Both milestones completed (unpaid), then disputed at `dispute_at`
    DisputedEarned100,
    /// Fully released to the recipient
    Released,
    /// Expired with nothing earned and refunded to the funder
    Refunded,
}

/// Action a cell performs.
#[derive(Clone, Copy, Debug)]
enum Action {
    Release,
    ReleaseMilestones,
    Dispute,
    CompleteSecond,
    ResolveToRecipient,
    ResolveToFunder,
    AutoResolve,
}

/// Expected outcome: `(status, paid_to_recipient, refunded_to_funder)` or an error.
type Outcome = Result<(EscrowStatus, i128, i128), VaultError>;

struct World<'a> {
    env: Env,
    client: VaultDAOClient<'a>,
    funder: Address,
    recipient: Address,
    arbitrator: Address,
    token: Address,
    escrow_id: u64,
}

fn milestones(env: &Env) -> Vec<Milestone> {
    let mut v = Vec::new(env);
    v.push_back(Milestone {
        id: 1,
        percentage: 40,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    v.push_back(Milestone {
        id: 2,
        percentage: 60,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    v
}

fn set_ledger(env: &Env, seq: u32) {
    env.ledger().with_mut(|li| li.sequence_number = seq);
}

fn world<'a>() -> World<'a> {
    let env = Env::default();
    env.mock_all_auths();
    // Rebuild the client so it does not borrow the local `env`.
    let (contract_id, admin, token) = {
        let (client, admin, token) = setup(&env);
        (client.address.clone(), admin, token)
    };
    let client = VaultDAOClient::new(&env, &contract_id);
    env.as_contract(&client.address, || {
        let mut config = storage::get_config(&env).unwrap();
        config.arbitration_timeout_ledgers = TIMEOUT;
        storage::set_config(&env, &config);
    });

    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    client.set_role(&admin, &arbitrator, &Role::DisputeArbitrator);

    set_ledger(&env, CREATED_AT);
    let escrow_id = client.create_escrow(
        &admin,
        &recipient,
        &token,
        &TOTAL,
        &milestones(&env),
        &DURATION,
        &arbitrator,
    );

    World {
        env,
        client,
        funder: admin,
        recipient,
        arbitrator,
        token,
        escrow_id,
    }
}

/// Build `state`. Disputed states are disputed at `dispute_at`.
fn prepare(w: &World, state: State, dispute_at: u32) {
    let c = &w.client;
    let id = &w.escrow_id;
    set_ledger(&w.env, 100);
    match state {
        State::Funded => {}
        State::Earned40 => c.complete_milestone(&w.funder, id, &1),
        State::Paid40 | State::DisputedPaid40 => {
            c.complete_milestone(&w.funder, id, &1);
            assert_eq!(c.release_escrow_milestones(&w.recipient, id), 400);
        }
        State::Complete | State::DisputedEarned100 | State::Released => {
            c.complete_milestone(&w.funder, id, &1);
            c.complete_milestone(&w.funder, id, &2);
        }
        State::Refunded => {}
    }
    match state {
        State::DisputedPaid40 | State::DisputedEarned100 => {
            set_ledger(&w.env, dispute_at);
            c.dispute_escrow(&w.funder, id, &Symbol::new(&w.env, "dispute"));
        }
        State::Released => {
            c.release_escrow(&w.recipient, id);
        }
        State::Refunded => {
            set_ledger(&w.env, EXPIRES_AT);
            c.release_escrow(&w.funder, id);
        }
        _ => {}
    }
}

fn act(w: &World, action: Action) -> Result<(), VaultError> {
    let c = &w.client;
    let id = &w.escrow_id;
    fn normalize<T: core::fmt::Debug, E: core::fmt::Debug>(
        r: Result<Result<T, E>, Result<VaultError, soroban_sdk::InvokeError>>,
    ) -> Result<(), VaultError> {
        match r {
            Ok(Ok(_)) => Ok(()),
            Err(Ok(e)) => Err(e),
            other => panic!("unexpected host result: {:?}", other),
        }
    }
    match action {
        Action::Release => normalize(c.try_release_escrow(&w.recipient, id)),
        Action::ReleaseMilestones => normalize(c.try_release_escrow_milestones(&w.recipient, id)),
        Action::Dispute => normalize(c.try_dispute_escrow(&w.funder, id, &Symbol::new(&w.env, "late"))),
        Action::CompleteSecond => normalize(c.try_complete_milestone(&w.funder, id, &2)),
        Action::ResolveToRecipient => normalize(c.try_resolve_escrow_dispute(&w.arbitrator, id, &true)),
        Action::ResolveToFunder => normalize(c.try_resolve_escrow_dispute(&w.arbitrator, id, &false)),
        Action::AutoResolve => normalize(c.try_auto_resolve_escrow(id)),
    }
}

/// Run one cell and check the outcome plus the accounting invariants.
fn cell(state: State, dispute_at: u32, at: u32, action: Action, expected: Outcome) {
    let w = world();
    prepare(&w, state, dispute_at);
    let before = w.client.get_escrow_accounting(&w.escrow_id);

    set_ledger(&w.env, at);
    let result = act(&w, action);
    let acc = w.client.get_escrow_accounting(&w.escrow_id);
    let escrow = w.client.get_escrow_info(&w.escrow_id);

    let label = format!("{:?} @{} {:?}", state, at, action);
    match expected {
        Ok((status, paid, refunded)) => {
            assert_eq!(result, Ok(()), "{}", label);
            assert_eq!(escrow.status, status, "{}", label);
            assert_eq!(acc.paid_to_recipient, paid, "{}", label);
            assert_eq!(acc.refunded_to_funder, refunded, "{}", label);
        }
        Err(e) => {
            assert_eq!(result, Err(e), "{}", label);
            assert_eq!(acc, before, "{}: failed action must not move funds", label);
        }
    }

    // Conservation: nothing is created or lost.
    assert_eq!(
        acc.paid_to_recipient + acc.refunded_to_funder + acc.locked,
        TOTAL,
        "{}",
        label
    );
    // The recipient never receives more than was earned unless an arbitrator
    // explicitly ruled for it.
    if !matches!(action, Action::ResolveToRecipient) {
        assert!(acc.paid_to_recipient <= acc.earned_by_recipient, "{}", label);
    }
    // Token balances agree with the books.
    assert_eq!(
        TokenClient::new(&w.env, &w.token).balance(&w.recipient),
        acc.paid_to_recipient,
        "{}",
        label
    );
}

const BEFORE: u32 = 500;
const AFTER: u32 = EXPIRES_AT + 1;
const NA: u32 = 0;

use Action::*;
use EscrowStatus as S;
use State::*;

// ---------------------------------------------------------------------------
// Precedence matrix: open (undisputed) states
// ---------------------------------------------------------------------------

#[test]
fn matrix_funded() {
    cell(Funded, NA, BEFORE, Release, Err(VaultError::ConditionsNotMet));
    cell(Funded, NA, BEFORE, ReleaseMilestones, Err(VaultError::ProposalAlreadyExecuted));
    cell(Funded, NA, BEFORE, Dispute, Ok((S::Disputed, 0, 0)));
    cell(Funded, NA, BEFORE, CompleteSecond, Ok((S::Active, 0, 0)));
    cell(Funded, NA, BEFORE, ResolveToRecipient, Err(VaultError::ProposalNotPending));
    cell(Funded, NA, BEFORE, AutoResolve, Err(VaultError::ProposalNotPending));

    // Expiry with nothing earned: full refund.
    cell(Funded, NA, AFTER, Release, Ok((S::Refunded, 0, 1_000)));
    cell(Funded, NA, AFTER, ReleaseMilestones, Err(VaultError::ProposalExpired));
    cell(Funded, NA, AFTER, Dispute, Err(VaultError::ProposalExpired));
    cell(Funded, NA, AFTER, CompleteSecond, Err(VaultError::ProposalExpired));
    cell(Funded, NA, AFTER, ResolveToRecipient, Err(VaultError::ProposalNotPending));
    cell(Funded, NA, AFTER, AutoResolve, Err(VaultError::ProposalNotPending));
}

#[test]
fn matrix_earned_40() {
    cell(Earned40, NA, BEFORE, Release, Err(VaultError::ConditionsNotMet));
    cell(Earned40, NA, BEFORE, ReleaseMilestones, Ok((S::Active, 400, 0)));
    cell(Earned40, NA, BEFORE, Dispute, Ok((S::Disputed, 0, 0)));
    cell(Earned40, NA, BEFORE, CompleteSecond, Ok((S::MilestonesComplete, 0, 0)));
    cell(Earned40, NA, BEFORE, ResolveToRecipient, Err(VaultError::ProposalNotPending));
    cell(Earned40, NA, BEFORE, AutoResolve, Err(VaultError::ProposalNotPending));

    // Expiry: earned 40 % still goes to the recipient, the rest is refunded.
    cell(Earned40, NA, AFTER, Release, Ok((S::Refunded, 400, 600)));
    cell(Earned40, NA, AFTER, ReleaseMilestones, Err(VaultError::ProposalExpired));
    cell(Earned40, NA, AFTER, Dispute, Err(VaultError::ProposalExpired));
    cell(Earned40, NA, AFTER, CompleteSecond, Err(VaultError::ProposalExpired));
    cell(Earned40, NA, AFTER, ResolveToRecipient, Err(VaultError::ProposalNotPending));
    cell(Earned40, NA, AFTER, AutoResolve, Err(VaultError::ProposalNotPending));
}

#[test]
fn matrix_paid_40() {
    cell(Paid40, NA, BEFORE, Release, Err(VaultError::ConditionsNotMet));
    // Double release after a partial is impossible.
    cell(Paid40, NA, BEFORE, ReleaseMilestones, Err(VaultError::ProposalAlreadyExecuted));
    cell(Paid40, NA, BEFORE, Dispute, Ok((S::Disputed, 400, 0)));
    cell(Paid40, NA, BEFORE, CompleteSecond, Ok((S::MilestonesComplete, 400, 0)));
    cell(Paid40, NA, BEFORE, ResolveToRecipient, Err(VaultError::ProposalNotPending));
    cell(Paid40, NA, BEFORE, AutoResolve, Err(VaultError::ProposalNotPending));

    // Expiry after a partial: the paid 400 is not paid again.
    cell(Paid40, NA, AFTER, Release, Ok((S::Refunded, 400, 600)));
    cell(Paid40, NA, AFTER, ReleaseMilestones, Err(VaultError::ProposalExpired));
    cell(Paid40, NA, AFTER, Dispute, Err(VaultError::ProposalExpired));
    cell(Paid40, NA, AFTER, CompleteSecond, Err(VaultError::ProposalExpired));
    cell(Paid40, NA, AFTER, ResolveToRecipient, Err(VaultError::ProposalNotPending));
    cell(Paid40, NA, AFTER, AutoResolve, Err(VaultError::ProposalNotPending));
}

#[test]
fn matrix_complete() {
    cell(Complete, NA, BEFORE, Release, Ok((S::Released, 1_000, 0)));
    cell(Complete, NA, BEFORE, ReleaseMilestones, Ok((S::Released, 1_000, 0)));
    cell(Complete, NA, BEFORE, Dispute, Ok((S::Disputed, 0, 0)));
    cell(Complete, NA, BEFORE, CompleteSecond, Err(VaultError::ProposalNotPending));
    cell(Complete, NA, BEFORE, ResolveToRecipient, Err(VaultError::ProposalNotPending));
    cell(Complete, NA, BEFORE, AutoResolve, Err(VaultError::ProposalNotPending));

    // Fully earned funds survive expiry.
    cell(Complete, NA, AFTER, Release, Ok((S::Released, 1_000, 0)));
    cell(Complete, NA, AFTER, ReleaseMilestones, Err(VaultError::ProposalExpired));
    cell(Complete, NA, AFTER, Dispute, Err(VaultError::ProposalExpired));
    cell(Complete, NA, AFTER, CompleteSecond, Err(VaultError::ProposalNotPending));
    cell(Complete, NA, AFTER, ResolveToRecipient, Err(VaultError::ProposalNotPending));
    cell(Complete, NA, AFTER, AutoResolve, Err(VaultError::ProposalNotPending));
}

// ---------------------------------------------------------------------------
// Precedence matrix: disputed states
// ---------------------------------------------------------------------------

/// Disputed before expiry: checked within the arbitration window and after it.
#[test]
fn matrix_disputed_paid_40_before_expiry() {
    let d = BEFORE;
    let within = d + 50;
    let timed_out = d + TIMEOUT as u32;

    for t in [within, timed_out] {
        cell(DisputedPaid40, d, t, Release, Err(VaultError::ConditionsNotMet));
        cell(DisputedPaid40, d, t, ReleaseMilestones, Err(VaultError::ConditionsNotMet));
        cell(DisputedPaid40, d, t, Dispute, Err(VaultError::ProposalNotPending));
        cell(DisputedPaid40, d, t, CompleteSecond, Err(VaultError::ProposalNotPending));
    }

    // Arbitration decides within the window; the paid 400 is never clawed back.
    cell(DisputedPaid40, d, within, ResolveToRecipient, Ok((S::Released, 1_000, 0)));
    cell(DisputedPaid40, d, within, ResolveToFunder, Ok((S::Refunded, 400, 600)));
    cell(DisputedPaid40, d, within, AutoResolve, Err(VaultError::TimelockNotExpired));

    // After the timeout only the fallback applies.
    cell(DisputedPaid40, d, timed_out, ResolveToRecipient, Err(VaultError::EscrowArbitrationClosed));
    cell(DisputedPaid40, d, timed_out, ResolveToFunder, Err(VaultError::EscrowArbitrationClosed));
    cell(DisputedPaid40, d, timed_out, AutoResolve, Ok((S::Refunded, 400, 600)));
}

/// Disputed just before expiry: the dispute takes precedence over expiry.
#[test]
fn matrix_disputed_earned_100_across_expiry() {
    let d = EXPIRES_AT - 30;
    let after_expiry_within = d + 50; // past expires_at, inside the window
    let timed_out = d + TIMEOUT as u32;
    assert!(after_expiry_within > EXPIRES_AT);

    for t in [after_expiry_within, timed_out] {
        // Expiry settlement is blocked while disputed.
        cell(DisputedEarned100, d, t, Release, Err(VaultError::ConditionsNotMet));
        cell(DisputedEarned100, d, t, ReleaseMilestones, Err(VaultError::ConditionsNotMet));
        cell(DisputedEarned100, d, t, Dispute, Err(VaultError::ProposalNotPending));
        cell(DisputedEarned100, d, t, CompleteSecond, Err(VaultError::ProposalNotPending));
    }

    cell(DisputedEarned100, d, after_expiry_within, ResolveToRecipient, Ok((S::Released, 1_000, 0)));
    cell(DisputedEarned100, d, after_expiry_within, ResolveToFunder, Ok((S::Refunded, 0, 1_000)));
    cell(DisputedEarned100, d, after_expiry_within, AutoResolve, Err(VaultError::TimelockNotExpired));

    // Timeout fallback: fully earned funds go to the recipient, not the funder.
    cell(DisputedEarned100, d, timed_out, ResolveToRecipient, Err(VaultError::EscrowArbitrationClosed));
    cell(DisputedEarned100, d, timed_out, ResolveToFunder, Err(VaultError::EscrowArbitrationClosed));
    cell(DisputedEarned100, d, timed_out, AutoResolve, Ok((S::Released, 1_000, 0)));
}

// ---------------------------------------------------------------------------
// Precedence matrix: terminal states
// ---------------------------------------------------------------------------

#[test]
fn matrix_terminal_states() {
    for (state, paid, refunded) in [(Released, 1_000, 0), (Refunded, 0, 1_000)] {
        for t in [EXPIRES_AT + 5, EXPIRES_AT + 500] {
            cell(state, NA, t, Release, Err(VaultError::ProposalAlreadyExecuted));
            cell(state, NA, t, ReleaseMilestones, Err(VaultError::ProposalAlreadyExecuted));
            cell(state, NA, t, Dispute, Err(VaultError::ProposalNotPending));
            cell(state, NA, t, CompleteSecond, Err(VaultError::ProposalNotPending));
            cell(state, NA, t, ResolveToRecipient, Err(VaultError::ProposalNotPending));
            cell(state, NA, t, AutoResolve, Err(VaultError::ProposalNotPending));
        }
        let w = world();
        prepare(&w, state, NA);
        let acc = w.client.get_escrow_accounting(&w.escrow_id);
        assert_eq!((acc.paid_to_recipient, acc.refunded_to_funder, acc.locked), (paid, refunded, 0));
    }
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

#[test]
fn test_state_machine_transitions() {
    let all = [
        S::Pending,
        S::Active,
        S::MilestonesComplete,
        S::Released,
        S::Refunded,
        S::Disputed,
    ];
    let allowed = [
        (S::Pending, S::Active),
        (S::Active, S::Active),
        (S::Active, S::MilestonesComplete),
        (S::Active, S::Disputed),
        (S::Active, S::Released),
        (S::Active, S::Refunded),
        (S::MilestonesComplete, S::Disputed),
        (S::MilestonesComplete, S::Released),
        (S::MilestonesComplete, S::Refunded),
        (S::Disputed, S::Released),
        (S::Disputed, S::Refunded),
    ];
    for from in all.iter() {
        for to in all.iter() {
            let expected = allowed.iter().any(|(f, t)| f == from && t == to);
            assert_eq!(from.can_transition_to(to), expected, "{:?} -> {:?}", from, to);
        }
    }
    assert!(S::Released.is_terminal() && S::Refunded.is_terminal());
    assert!(!S::Disputed.is_terminal());
}

#[test]
fn test_partial_releases_sum_to_total_once() {
    let w = world();
    set_ledger(&w.env, 100);
    w.client.complete_milestone(&w.funder, &w.escrow_id, &1);
    assert_eq!(w.client.release_escrow_milestones(&w.recipient, &w.escrow_id), 400);
    w.client.complete_milestone(&w.funder, &w.escrow_id, &2);
    assert_eq!(w.client.release_escrow_milestones(&w.recipient, &w.escrow_id), 600);

    let escrow = w.client.get_escrow_info(&w.escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Released);
    assert_eq!(escrow.released_amount, TOTAL);
    assert_eq!(
        w.client.try_release_escrow_milestones(&w.recipient, &w.escrow_id),
        Err(Ok(VaultError::ProposalAlreadyExecuted))
    );
    assert_eq!(
        w.client.try_release_escrow(&w.recipient, &w.escrow_id),
        Err(Ok(VaultError::ProposalAlreadyExecuted))
    );
    assert_eq!(TokenClient::new(&w.env, &w.token).balance(&w.recipient), TOTAL);
}

// ---------------------------------------------------------------------------
// Multisig arbitration panel
// ---------------------------------------------------------------------------

fn panel(env: &Env, n: u32) -> Vec<Address> {
    let mut v = Vec::new(env);
    for _ in 0..n {
        v.push_back(Address::generate(env));
    }
    v
}

#[test]
fn test_panel_validation() {
    let w = world();
    let p = panel(&w.env, 3);

    // Threshold must be a strict majority.
    assert_eq!(
        w.client.try_set_escrow_arbitration_panel(&w.escrow_id, &p, &1),
        Err(Ok(VaultError::EscrowPanelInvalid))
    );
    assert_eq!(
        w.client.try_set_escrow_arbitration_panel(&w.escrow_id, &p, &4),
        Err(Ok(VaultError::EscrowPanelInvalid))
    );
    // Parties cannot sit on the panel.
    let mut conflicted = p.clone();
    conflicted.push_back(w.recipient.clone());
    assert_eq!(
        w.client
            .try_set_escrow_arbitration_panel(&w.escrow_id, &conflicted, &3),
        Err(Ok(VaultError::EscrowPanelInvalid))
    );
    // No duplicates.
    let mut dup = p.clone();
    dup.push_back(p.get(0).unwrap());
    assert_eq!(
        w.client.try_set_escrow_arbitration_panel(&w.escrow_id, &dup, &3),
        Err(Ok(VaultError::EscrowPanelInvalid))
    );

    w.client.set_escrow_arbitration_panel(&w.escrow_id, &p, &2);
    assert_eq!(
        w.client
            .get_escrow_arbitration_panel(&w.escrow_id)
            .unwrap()
            .threshold,
        2
    );
}

#[test]
fn test_panel_majority_settles_and_single_arbitrator_is_disabled() {
    let w = world();
    let p = panel(&w.env, 3);
    w.client.set_escrow_arbitration_panel(&w.escrow_id, &p, &2);

    set_ledger(&w.env, 100);
    w.client.complete_milestone(&w.funder, &w.escrow_id, &1);
    w.client.release_escrow_milestones(&w.recipient, &w.escrow_id);
    w.client
        .dispute_escrow(&w.funder, &w.escrow_id, &Symbol::new(&w.env, "late"));

    // The single designated arbitrator can no longer decide alone.
    assert_eq!(
        w.client
            .try_resolve_escrow_dispute(&w.arbitrator, &w.escrow_id, &true),
        Err(Ok(VaultError::Unauthorized))
    );
    // Outsiders cannot vote.
    assert_eq!(
        w.client
            .try_vote_escrow_arbitration(&Address::generate(&w.env), &w.escrow_id, &true),
        Err(Ok(VaultError::Unauthorized))
    );

    let a0 = p.get(0).unwrap();
    let a1 = p.get(1).unwrap();
    let a2 = p.get(2).unwrap();
    w.client.vote_escrow_arbitration(&a0, &w.escrow_id, &false);
    assert_eq!(
        w.client.try_vote_escrow_arbitration(&a0, &w.escrow_id, &true),
        Err(Ok(VaultError::AlreadyApproved))
    );
    w.client.vote_escrow_arbitration(&a1, &w.escrow_id, &true);
    assert_eq!(
        w.client.get_escrow_info(&w.escrow_id).status,
        EscrowStatus::Disputed
    );
    w.client.vote_escrow_arbitration(&a2, &w.escrow_id, &false);

    let acc = w.client.get_escrow_accounting(&w.escrow_id);
    assert_eq!(
        w.client.get_escrow_info(&w.escrow_id).status,
        EscrowStatus::Refunded
    );
    // Partial payment survives the refund ruling.
    assert_eq!((acc.paid_to_recipient, acc.refunded_to_funder, acc.locked), (400, 600, 0));
}

#[test]
fn test_panel_timeout_fallback_cannot_starve_recipient() {
    let w = world();
    let p = panel(&w.env, 3);
    w.client.set_escrow_arbitration_panel(&w.escrow_id, &p, &2);

    set_ledger(&w.env, 100);
    w.client.complete_milestone(&w.funder, &w.escrow_id, &1);
    w.client.complete_milestone(&w.funder, &w.escrow_id, &2);
    w.client
        .dispute_escrow(&w.funder, &w.escrow_id, &Symbol::new(&w.env, "stall"));

    // One vote, then the panel goes silent.
    w.client
        .vote_escrow_arbitration(&p.get(0).unwrap(), &w.escrow_id, &false);

    set_ledger(&w.env, 100 + TIMEOUT as u32);
    assert_eq!(
        w.client
            .try_vote_escrow_arbitration(&p.get(1).unwrap(), &w.escrow_id, &false),
        Err(Ok(VaultError::EscrowArbitrationClosed))
    );
    w.client.auto_resolve_escrow(&w.escrow_id);

    let acc = w.client.get_escrow_accounting(&w.escrow_id);
    assert_eq!(
        w.client.get_escrow_info(&w.escrow_id).status,
        EscrowStatus::Released
    );
    assert_eq!(acc.paid_to_recipient, TOTAL);
    assert_eq!(TokenClient::new(&w.env, &w.token).balance(&w.recipient), TOTAL);
}

#[test]
fn test_panel_cannot_be_changed_while_disputed() {
    let w = world();
    set_ledger(&w.env, 100);
    w.client
        .dispute_escrow(&w.funder, &w.escrow_id, &Symbol::new(&w.env, "x"));
    assert_eq!(
        w.client
            .try_set_escrow_arbitration_panel(&w.escrow_id, &panel(&w.env, 3), &2),
        Err(Ok(VaultError::ProposalNotPending))
    );
}
