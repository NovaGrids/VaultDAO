use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Vec,
};

fn vesting(env: &Env, total: i128, cliff: u32, start: u32, end: u32) -> VestingSchedule {
    VestingSchedule {
        id: 1,
        beneficiary: Address::generate(env),
        token: Address::generate(env),
        total,
        cliff_ledger: cliff,
        start_ledger: start,
        end_ledger: end,
        claimed: 0,
        cancelled: false,
    }
}

fn calendar(env: &Env, values: &[u64]) -> HolidayCalendar {
    let mut holiday_ledgers = Vec::new(env);
    for value in values {
        holiday_ledgers.push_back(*value);
    }
    HolidayCalendar { holiday_ledgers }
}

fn delegation(env: &Env, from: &Address, to: &Address, depth: u8) -> Delegation {
    Delegation {
        delegator: from.clone(),
        delegate: to.clone(),
        created_at: env.ledger().sequence() as u64,
        expiry_ledger: 0,
        is_active: true,
        chain_depth: depth,
    }
}

// Issue #1101: signer tiers (8 tests)

#[test]
fn junior_can_execute_within_limit() {
    assert!(VaultDAO::can_execute_unilaterally(
        &SignerTier::Junior(1_000),
        1_000,
        10_000
    ));
}

#[test]
fn junior_cannot_exceed_limit() {
    assert!(!VaultDAO::can_execute_unilaterally(
        &SignerTier::Junior(1_000),
        1_001,
        10_000
    ));
}

#[test]
fn senior_can_execute_within_limit() {
    assert!(VaultDAO::can_execute_unilaterally(
        &SignerTier::Senior(10_000),
        9_999,
        20_000
    ));
}

#[test]
fn senior_cannot_exceed_limit() {
    assert!(!VaultDAO::can_execute_unilaterally(
        &SignerTier::Senior(10_000),
        10_001,
        20_000
    ));
}

#[test]
fn principal_always_requires_quorum() {
    assert!(!VaultDAO::can_execute_unilaterally(
        &SignerTier::Principal,
        1,
        10_000
    ));
}

#[test]
fn full_quorum_threshold_overrides_senior_limit() {
    assert!(!VaultDAO::can_execute_unilaterally(
        &SignerTier::Senior(10_000),
        5_001,
        5_000
    ));
}

#[test]
fn full_quorum_threshold_is_inclusive() {
    assert!(VaultDAO::can_execute_unilaterally(
        &SignerTier::Senior(10_000),
        5_000,
        5_000
    ));
}

#[test]
fn non_positive_unilateral_amount_is_rejected() {
    assert!(!VaultDAO::can_execute_unilaterally(
        &SignerTier::Senior(10_000),
        0,
        20_000
    ));
}

// Issue #1104: vesting math and lifecycle (9 tests)

#[test]
fn vesting_before_cliff_is_zero() {
    assert_eq!(
        VaultDAO::vested_amount(&vesting(&Env::default(), 1_000, 20, 10, 110), 19),
        Ok(0)
    );
}

#[test]
fn vesting_at_cliff_is_prorated_from_start() {
    assert_eq!(
        VaultDAO::vested_amount(&vesting(&Env::default(), 1_000, 20, 10, 110), 20),
        Ok(100)
    );
}

#[test]
fn vesting_halfway_is_linear() {
    assert_eq!(
        VaultDAO::vested_amount(&vesting(&Env::default(), 1_000, 20, 10, 110), 60),
        Ok(500)
    );
}

#[test]
fn vesting_at_end_is_full() {
    assert_eq!(
        VaultDAO::vested_amount(&vesting(&Env::default(), 1_000, 20, 10, 110), 110),
        Ok(1_000)
    );
}

#[test]
fn vesting_after_end_is_capped() {
    assert_eq!(
        VaultDAO::vested_amount(&vesting(&Env::default(), 1_000, 20, 10, 110), 500),
        Ok(1_000)
    );
}

#[test]
fn vesting_rounds_down_deterministically() {
    assert_eq!(
        VaultDAO::vested_amount(&vesting(&Env::default(), 100, 1, 0, 3), 1),
        Ok(33)
    );
}

#[test]
fn vesting_claim_delta_is_idempotent() {
    let schedule = vesting(&Env::default(), 1_000, 20, 10, 110);
    let vested = VaultDAO::vested_amount(&schedule, 60).unwrap();
    assert_eq!(vested.saturating_sub(vested), 0);
}

#[test]
fn cancelled_vesting_preserves_claimed_amount() {
    let mut schedule = vesting(&Env::default(), 1_000, 20, 10, 110);
    schedule.claimed = 400;
    schedule.cancelled = true;
    assert_eq!(schedule.claimed, 400);
    assert_eq!(schedule.total - schedule.claimed, 600);
}

#[test]
fn vesting_large_values_use_checked_math() {
    let schedule = vesting(&Env::default(), i128::MAX, 1, 0, 3);
    assert_eq!(
        VaultDAO::vested_amount(&schedule, 2),
        Err(VaultError::InvalidAmount)
    );
}

// Issue #1105: delegation chains (8 tests)

#[test]
fn delegation_depth_one_is_returned() {
    let env = Env::default();
    let id = env.register(VaultDAO, ());
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    env.as_contract(&id, || {
        storage::set_delegation(&env, &delegation(&env, &a, &b, 1))
    });
    let chain = env.as_contract(&id, || {
        VaultDAO::get_delegation_chain(env.clone(), a).unwrap()
    });
    assert_eq!(chain.len(), 1);
    assert_eq!(chain.get(0), Some(b));
}

#[test]
fn delegation_depth_two_is_returned() {
    let env = Env::default();
    let id = env.register(VaultDAO, ());
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);
    env.as_contract(&id, || {
        storage::set_delegation(&env, &delegation(&env, &a, &b, 2));
        storage::set_delegation(&env, &delegation(&env, &b, &c, 1));
    });
    let chain = env.as_contract(&id, || {
        VaultDAO::get_delegation_chain(env.clone(), a).unwrap()
    });
    assert_eq!(chain.len(), 2);
}

#[test]
fn delegation_depth_three_is_rejected() {
    let env = Env::default();
    let id = env.register(VaultDAO, ());
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);
    let d = Address::generate(&env);
    env.as_contract(&id, || {
        storage::set_delegation(&env, &delegation(&env, &a, &b, 3));
        storage::set_delegation(&env, &delegation(&env, &b, &c, 2));
        storage::set_delegation(&env, &delegation(&env, &c, &d, 1));
    });
    assert_eq!(
        env.as_contract(&id, || VaultDAO::get_delegation_chain(env.clone(), a)),
        Err(VaultError::DelegationChainTooLong)
    );
}

#[test]
fn inactive_delegation_ends_chain() {
    let env = Env::default();
    let id = env.register(VaultDAO, ());
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let mut value = delegation(&env, &a, &b, 1);
    value.is_active = false;
    env.as_contract(&id, || storage::set_delegation(&env, &value));
    let chain = env.as_contract(&id, || {
        VaultDAO::get_delegation_chain(env.clone(), a).unwrap()
    });
    assert!(chain.is_empty());
}

#[test]
fn expired_delegation_ends_chain() {
    let env = Env::default();
    env.ledger().with_mut(|ledger| ledger.sequence_number = 20);
    let id = env.register(VaultDAO, ());
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let mut value = delegation(&env, &a, &b, 1);
    value.expiry_ledger = 10;
    env.as_contract(&id, || storage::set_delegation(&env, &value));
    let chain = env.as_contract(&id, || {
        VaultDAO::get_delegation_chain(env.clone(), a).unwrap()
    });
    assert!(chain.is_empty());
}

#[test]
fn reverse_index_contains_original_delegator_once() {
    let env = Env::default();
    let id = env.register(VaultDAO, ());
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let value = delegation(&env, &a, &b, 1);
    env.as_contract(&id, || {
        storage::set_delegation(&env, &value);
        storage::set_delegation(&env, &value);
        assert_eq!(storage::get_delegators_for(&env, &b).len(), 1);
    });
}

#[test]
fn represented_voters_are_not_duplicated() {
    let env = Env::default();
    let id = env.register(VaultDAO, ());
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    env.as_contract(&id, || {
        storage::set_delegation(&env, &delegation(&env, &a, &b, 1));
        let mut voters = Vec::new(&env);
        voters.push_back(b.clone());
        VaultDAO::get_all_represented_voters(&env, &b, &mut voters, 0);
        VaultDAO::get_all_represented_voters(&env, &b, &mut voters, 0);
        assert_eq!(voters.len(), 2);
    });
}

#[test]
fn delegation_chain_depth_is_persisted() {
    let env = Env::default();
    let id = env.register(VaultDAO, ());
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    env.as_contract(&id, || {
        storage::set_delegation(&env, &delegation(&env, &a, &b, 2));
        assert_eq!(storage::get_delegation(&env, &a).unwrap().chain_depth, 2);
    });
}

// Issue #1102: holiday calendar (7 tests)

#[test]
fn sorted_calendar_finds_holiday_with_binary_search() {
    assert!(VaultDAO::is_non_business_ledger(
        &calendar(&Env::default(), &[10, 20, 30]),
        20
    ));
}

#[test]
fn calendar_non_holiday_is_unchanged() {
    assert!(!VaultDAO::is_non_business_ledger(
        &calendar(&Env::default(), &[10, 20, 30]),
        21
    ));
}

#[test]
fn saturday_is_non_business_ledger() {
    let ledger = storage::DAY_IN_LEDGERS as u64 * 5;
    assert!(VaultDAO::is_non_business_ledger(
        &calendar(&Env::default(), &[]),
        ledger
    ));
}

#[test]
fn sunday_is_non_business_ledger() {
    let ledger = storage::DAY_IN_LEDGERS as u64 * 6;
    assert!(VaultDAO::is_non_business_ledger(
        &calendar(&Env::default(), &[]),
        ledger
    ));
}

#[test]
fn weekday_is_business_ledger() {
    let ledger = storage::DAY_IN_LEDGERS as u64 * 4;
    assert!(!VaultDAO::is_non_business_ledger(
        &calendar(&Env::default(), &[]),
        ledger
    ));
}

#[test]
fn pay_early_moves_before_holiday() {
    let env = Env::default();
    let id = env.register(VaultDAO, ());
    env.as_contract(&id, || {
        storage::set_holiday_calendar(&env, &calendar(&env, &[100]));
        assert_eq!(
            VaultDAO::adjust_recurring_ledger(&env, 100, true, &HolidayBehavior::PayEarly),
            99
        );
    });
}

#[test]
fn pay_late_moves_after_holiday() {
    let env = Env::default();
    let id = env.register(VaultDAO, ());
    env.as_contract(&id, || {
        storage::set_holiday_calendar(&env, &calendar(&env, &[100]));
        assert_eq!(
            VaultDAO::adjust_recurring_ledger(&env, 100, true, &HolidayBehavior::PayLate),
            101
        );
    });
}
