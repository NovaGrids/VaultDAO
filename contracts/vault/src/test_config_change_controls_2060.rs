//! Tests for Issue #2060: governance config changes with simulation preview,
//! timelock, dual control, diff events and safety floors.
//!
//! 1. `simulate_config_change` returns exactly the config `execute_config_change`
//!    produces, for every governed parameter.
//! 2. Threshold changes below the safety floor are rejected at proposal,
//!    simulation and execution time.
//! 3. Risk-increasing changes wait out a timelock; tightening changes do not.
//! 4. With dual control on, a risk-increasing change also needs an
//!    acknowledgment from a distinct holder of the ack role.
//! 5. There is no bypass: the only ways around a queued change are cancelling
//!    it or pausing the vault, which blocks it.
//! 6. Execution emits a `config_diff` event with the old and new values.
#![cfg(test)]

use crate::errors::VaultError;
use crate::test_treasury_risk_2061::{setup_vault, Ctx};
use crate::types::{ConfigParam, Role};
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger},
    Address, Env, Symbol, TryFromVal, Vec,
};

/// Governance threshold is 67% of 3 signers = all three must approve.
fn pass(ctx: &Ctx, id: u64) {
    ctx.client.approve_config_change(&ctx.admin, &id);
    ctx.client.approve_config_change(&ctx.s1, &id);
    ctx.client.approve_config_change(&ctx.s2, &id);
}

fn advance(env: &Env, ledgers: u32) {
    env.ledger().with_mut(|li| li.sequence_number += ledgers);
}

fn preview_matches_config(ctx: &Ctx, preview: &crate::types::ConfigChangePreview) {
    let config = ctx.client.get_config();
    let rep = ctx.client.get_reputation_config();
    assert_eq!(preview.threshold, config.threshold);
    assert_eq!(preview.quorum, config.quorum);
    assert_eq!(preview.spending_limit, config.spending_limit);
    assert_eq!(preview.daily_limit, config.daily_limit);
    assert_eq!(preview.weekly_limit, config.weekly_limit);
    assert_eq!(preview.timelock_delay, config.timelock_delay);
    assert_eq!(preview.full_quorum_threshold, config.full_quorum_threshold);
    assert_eq!(preview.reputation_half_life, rep.decay_half_life_ledgers);
    assert_eq!(preview.reputation_decay_floor, rep.decay_min_score);
}

// ---------------------------------------------------------------------------
// Simulation matches apply
// ---------------------------------------------------------------------------

#[test]
fn test_simulation_matches_apply_for_every_param() {
    let env = Env::default();
    let ctx = setup_vault(&env, 0, 50);

    let changes = [
        (ConfigParam::Threshold, 3i128),          // tighten
        (ConfigParam::Quorum, 2),                 // tighten
        (ConfigParam::SpendingLimit, 500_000),    // tighten
        (ConfigParam::DailyLimit, 4_000_000),     // tighten
        (ConfigParam::WeeklyLimit, 9_000_000),    // tighten
        (ConfigParam::TimelockDelay, 100),        // tighten
        (ConfigParam::FullQuorumThreshold, 7_000),// enable: tighten
        (ConfigParam::ReputationHalfLife, 4_000), // neutral
        (ConfigParam::ReputationDecayFloor, 300), // neutral
        (ConfigParam::Threshold, 2),              // loosen
        (ConfigParam::SpendingLimit, 900_000),    // loosen
    ];

    for (param, value) in changes.iter() {
        let preview = ctx.client.simulate_config_change(param, value);
        assert_eq!(preview.new_value, *value);

        let id = ctx.client.propose_config_change(&ctx.admin, param, value);
        pass(&ctx, id);
        if preview.timelock_ledgers > 0 {
            advance(&env, preview.timelock_ledgers as u32);
        }
        ctx.client.execute_config_change(&ctx.admin, &id);

        preview_matches_config(&ctx, &preview);
    }
}

#[test]
fn test_simulation_does_not_change_state() {
    let env = Env::default();
    let ctx = setup_vault(&env, 0, 50);
    let before = ctx.client.get_config();
    let preview = ctx
        .client
        .simulate_config_change(&ConfigParam::DailyLimit, &4_000_000i128);
    assert_eq!(preview.old_value, before.daily_limit);
    assert_eq!(preview.daily_limit, 4_000_000);
    assert!(!preview.risk_increasing);
    assert_eq!(ctx.client.get_config().daily_limit, before.daily_limit);
}

#[test]
fn test_simulation_reports_risk_and_controls() {
    let env = Env::default();
    let ctx = setup_vault(&env, 0, 50);

    // Setting the threshold to its current value changes nothing.
    let p = ctx
        .client
        .simulate_config_change(&ConfigParam::Threshold, &2i128);
    assert!(!p.risk_increasing, "2 -> 2 is unchanged");
    assert_eq!(p.timelock_ledgers, 0);

    let p = ctx
        .client
        .simulate_config_change(&ConfigParam::SpendingLimit, &2_000_000i128);
    assert_eq!(
        p.daily_limit, 5_000_000,
        "other fields are carried through unchanged"
    );
    let p = ctx
        .client
        .simulate_config_change(&ConfigParam::DailyLimit, &6_000_000i128);
    // Raising a limit loosens control: the timelock is the floor (720)
    // because the vault timelock (50) is shorter.
    assert!(p.risk_increasing);
    assert_eq!(p.timelock_ledgers, 720);
    assert!(!p.requires_ack);

    ctx.client.set_config_dual_control(&ctx.admin, &Role::Treasurer);
    let p = ctx
        .client
        .simulate_config_change(&ConfigParam::DailyLimit, &6_000_000i128);
    assert!(p.requires_ack);
}

// ---------------------------------------------------------------------------
// Safety floors
// ---------------------------------------------------------------------------

#[test]
fn test_threshold_below_safety_floor_rejected() {
    let env = Env::default();
    let ctx = setup_vault(&env, 0, 0);

    for v in [0i128, 1] {
        assert_eq!(
            ctx.client
                .try_propose_config_change(&ctx.admin, &ConfigParam::Threshold, &v),
            Err(Ok(VaultError::SafetyFloorViolation))
        );
        assert_eq!(
            ctx.client.try_simulate_config_change(&ConfigParam::Threshold, &v),
            Err(Ok(VaultError::SafetyFloorViolation))
        );
    }
    assert_eq!(
        ctx.client
            .try_propose_config_change(&ctx.admin, &ConfigParam::Threshold, &4i128),
        Err(Ok(VaultError::ThresholdTooHigh))
    );
}

#[test]
fn test_bounds_revalidated_at_execution() {
    let env = Env::default();
    let ctx = setup_vault(&env, 0, 0);

    let id = ctx
        .client
        .propose_config_change(&ctx.admin, &ConfigParam::Threshold, &3i128);
    pass(&ctx, id);

    // A signer leaves after approval; 3 is now above the signer count.
    env.as_contract(&ctx.contract_id, || {
        let mut config = crate::storage::get_config(&env).unwrap();
        config.signers.pop_back();
        crate::storage::set_config(&env, &config);
    });

    assert_eq!(
        ctx.client.try_execute_config_change(&ctx.admin, &id),
        Err(Ok(VaultError::ThresholdTooHigh))
    );
}

#[test]
fn test_limit_hierarchy_enforced() {
    let env = Env::default();
    let ctx = setup_vault(&env, 0, 0);
    // spending (1_000_000) must stay <= daily
    assert_eq!(
        ctx.client
            .try_propose_config_change(&ctx.admin, &ConfigParam::DailyLimit, &999_999i128),
        Err(Ok(VaultError::InvalidAmount))
    );
}

// ---------------------------------------------------------------------------
// Timelock and dual control
// ---------------------------------------------------------------------------

#[test]
fn test_risk_increasing_change_is_timelocked() {
    let env = Env::default();
    let ctx = setup_vault(&env, 0, 1_000);

    let id = ctx
        .client
        .propose_config_change(&ctx.admin, &ConfigParam::DailyLimit, &6_000_000i128);
    pass(&ctx, id);

    let gate = ctx.client.get_config_change_gate(&id).unwrap();
    assert!(gate.risk_increasing);
    // The vault timelock (1000) is longer than the floor and wins.
    assert_eq!(gate.unlock_ledger, gate.approved_at + 1_000);

    assert_eq!(
        ctx.client.try_execute_config_change(&ctx.admin, &id),
        Err(Ok(VaultError::ConfigChangeTimelocked))
    );
    advance(&env, 999);
    assert_eq!(
        ctx.client.try_execute_config_change(&ctx.admin, &id),
        Err(Ok(VaultError::ConfigChangeTimelocked))
    );
    advance(&env, 1);
    ctx.client.execute_config_change(&ctx.admin, &id);
    assert_eq!(ctx.client.get_config().daily_limit, 6_000_000);
    assert!(ctx.client.get_config_change_gate(&id).is_none());
}

#[test]
fn test_tightening_change_applies_immediately() {
    let env = Env::default();
    let ctx = setup_vault(&env, 0, 1_000);

    let id = ctx
        .client
        .propose_config_change(&ctx.admin, &ConfigParam::Threshold, &3i128);
    pass(&ctx, id);
    assert!(!ctx.client.get_config_change_gate(&id).unwrap().risk_increasing);
    ctx.client.execute_config_change(&ctx.admin, &id);
    assert_eq!(ctx.client.get_config().threshold, 3);
}

#[test]
fn test_dual_control_requires_distinct_ack_role() {
    let env = Env::default();
    let ctx = setup_vault(&env, 0, 0);
    ctx.client.set_role(&ctx.admin, &ctx.s1, &Role::Treasurer);
    ctx.client.set_config_dual_control(&ctx.admin, &Role::Treasurer);

    let id = ctx
        .client
        .propose_config_change(&ctx.admin, &ConfigParam::SpendingLimit, &2_000_000i128);
    // keep the hierarchy valid: spending 2M <= daily 5M
    pass(&ctx, id);
    advance(&env, 720);

    assert_eq!(
        ctx.client.try_execute_config_change(&ctx.admin, &id),
        Err(Ok(VaultError::ConfigChangeAckRequired))
    );

    // Wrong role.
    assert_eq!(
        ctx.client.try_acknowledge_config_change(&ctx.s2, &id),
        Err(Ok(VaultError::InsufficientRole))
    );

    ctx.client.acknowledge_config_change(&ctx.s1, &id);
    assert_eq!(
        ctx.client.try_acknowledge_config_change(&ctx.s1, &id),
        Err(Ok(VaultError::AlreadyApproved))
    );
    ctx.client.execute_config_change(&ctx.admin, &id);
    assert_eq!(ctx.client.get_config().spending_limit, 2_000_000);
}

#[test]
fn test_proposer_cannot_acknowledge_own_change() {
    let env = Env::default();
    let ctx = setup_vault(&env, 0, 0);
    ctx.client.set_role(&ctx.admin, &ctx.s1, &Role::Treasurer);
    ctx.client.set_config_dual_control(&ctx.admin, &Role::Treasurer);

    let id = ctx
        .client
        .propose_config_change(&ctx.s1, &ConfigParam::SpendingLimit, &2_000_000i128);
    pass(&ctx, id);
    assert_eq!(
        ctx.client.try_acknowledge_config_change(&ctx.s1, &id),
        Err(Ok(VaultError::Unauthorized))
    );
}

#[test]
fn test_disabling_dual_control_needs_two_parties() {
    let env = Env::default();
    let ctx = setup_vault(&env, 0, 0);
    ctx.client.set_role(&ctx.admin, &ctx.s1, &Role::Treasurer);
    ctx.client.set_config_dual_control(&ctx.admin, &Role::Treasurer);

    // The Admin alone (also as the acknowledger) cannot turn it off.
    assert_eq!(
        ctx.client
            .try_disable_config_dual_control(&ctx.admin, &ctx.admin),
        Err(Ok(VaultError::Unauthorized))
    );
    ctx.client
        .disable_config_dual_control(&ctx.admin, &ctx.s1);
    assert!(!ctx.client.get_config_dual_control().enabled);
}

#[test]
fn test_no_timelock_bypass_pause_blocks_and_cancel_is_the_escape() {
    let env = Env::default();
    let ctx = setup_vault(&env, 0, 0);
    let em1 = Address::generate(&env);
    let mut esigners = Vec::new(&env);
    esigners.push_back(em1.clone());
    esigners.push_back(Address::generate(&env));
    ctx.client.configure_emergency(&ctx.admin, &esigners, &0i128);

    let id = ctx
        .client
        .propose_config_change(&ctx.admin, &ConfigParam::DailyLimit, &6_000_000i128);
    pass(&ctx, id);

    // Emergency pause: even after the timelock, the loosening change cannot run.
    ctx.client.pause_vault(&em1, &Symbol::new(&env, "incident"));
    advance(&env, 720);
    assert_eq!(
        ctx.client.try_execute_config_change(&ctx.admin, &id),
        Err(Ok(VaultError::VaultPaused))
    );

    // The emergency signer cancels the queued change.
    ctx.client.cancel_config_change(&em1, &id);
    assert_eq!(
        ctx.client.try_execute_config_change(&ctx.admin, &id),
        Err(Ok(VaultError::ProposalNotApproved))
    );
    assert!(ctx.client.get_config_change_gate(&id).is_none());
    assert_eq!(ctx.client.get_config().daily_limit, 5_000_000);

    // Random addresses cannot cancel.
    let id2 = ctx
        .client
        .propose_config_change(&ctx.admin, &ConfigParam::Threshold, &3i128);
    assert_eq!(
        ctx.client
            .try_cancel_config_change(&Address::generate(&env), &id2),
        Err(Ok(VaultError::Unauthorized))
    );
}

// ---------------------------------------------------------------------------
// Diff events
// ---------------------------------------------------------------------------

#[test]
fn test_execute_emits_config_diff() {
    let env = Env::default();
    let ctx = setup_vault(&env, 0, 0);

    let id = ctx
        .client
        .propose_config_change(&ctx.admin, &ConfigParam::Quorum, &2i128);
    pass(&ctx, id);
    ctx.client.execute_config_change(&ctx.admin, &id);

    let diff = Symbol::new(&env, "config_diff");
    let field = Symbol::new(&env, "quorum");
    let found = env.events().all().iter().any(|(_, topics, data)| {
        let name = topics.get(0).and_then(|t| Symbol::try_from_val(&env, &t).ok());
        let gov = topics.get(1).and_then(|t| u64::try_from_val(&env, &t).ok());
        let f = topics.get(2).and_then(|t| Symbol::try_from_val(&env, &t).ok());
        let values = <(i128, i128)>::try_from_val(&env, &data).ok();
        name == Some(diff.clone()) && gov == Some(id) && f == Some(field.clone()) && values == Some((0, 2))
    });
    assert!(found, "expected config_diff(quorum, 0 -> 2)");
}
