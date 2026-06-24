//! Tests for admin key-rotation timelock (Issue: feature/admin-rotation-timelock).
//!
//! Covered scenarios:
//!  1.  Happy path: initiate → advance past timelock → execute → roles swapped
//!  2.  Cancellation: initiate → cancel → rotation cleared, roles unchanged
//!  3.  After cancel, new rotation can be initiated immediately
//!  4.  Double-initiation rejected (ConditionsNotMet)
//!  5.  Execution before timelock expires (TimelockNotExpired)
//!  6.  Execute/cancel with no pending rotation (ProposalNotFound)
//!  7.  Non-admin cannot initiate (InsufficientRole)
//!  8.  Non-admin cannot cancel (InsufficientRole)
//!  9.  Old admin functions still work during pending rotation
//! 10.  Rotation delay of 0 rejected at vault initialization (InvalidAmount)
//! 11.  Rotation delay below minimum (< 1440) rejected at initialization

use crate::types::{RetryConfig, Role, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Vec,
};

// ============================================================================
// Helper
// ============================================================================

fn default_init_config(env: &Env, admin: &Address) -> InitConfig {
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        default_voting_deadline: 0,
        spending_limit: 100_000_000,
        daily_limit: 1_000_000_000,
        weekly_limit: 5_000_000_000,
        timelock_threshold: 900_000_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 1_000_000_000,
            window: 3_600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        veto_addresses: Vec::new(env),
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
        admin_rotation_delay: 1440,
    }
}

/// Returns (env, client, admin) with mock auths enabled.
fn setup() -> (Env, VaultDAOClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let vault_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &vault_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &default_init_config(&env, &admin));

    (env, client, admin)
}

/// Advance the ledger by `n` sequences.
fn advance(env: &Env, n: u32) {
    env.ledger().with_mut(|li| li.sequence_number += n);
}

// ============================================================================
// Test 1 – Happy path: full rotation cycle
// ============================================================================

#[test]
fn test_happy_path_rotation() {
    let (env, client, admin) = setup();
    let new_admin = Address::generate(&env);

    // Initiate rotation
    client.initiate_admin_rotation(&admin, &new_admin);

    // Pending rotation is queryable
    let pending = client.get_pending_admin_rotation();
    assert!(pending.is_some());
    let r = pending.unwrap();
    assert_eq!(r.new_admin, new_admin);
    assert_eq!(r.initiated_by, admin);

    // Advance exactly past the delay (1440 ledgers)
    advance(&env, 1440);

    // Execute succeeds
    client.execute_admin_rotation();

    // new_admin is now Admin, old admin is demoted to Member
    assert_eq!(client.get_role(&new_admin), Role::Admin);
    assert_eq!(client.get_role(&admin), Role::Member);

    // Pending record is cleared
    assert!(client.get_pending_admin_rotation().is_none());
}

// ============================================================================
// Test 2 – Cancellation clears the rotation without swapping roles
// ============================================================================

#[test]
fn test_cancellation_clears_rotation() {
    let (env, client, admin) = setup();
    let new_admin = Address::generate(&env);

    client.initiate_admin_rotation(&admin, &new_admin);
    assert!(client.get_pending_admin_rotation().is_some());

    // Cancel before timelock expires
    client.cancel_admin_rotation(&admin);

    // Record gone
    assert!(client.get_pending_admin_rotation().is_none());

    // Roles unchanged
    assert_eq!(client.get_role(&admin), Role::Admin);
    assert_eq!(client.get_role(&new_admin), Role::Member);
}

// ============================================================================
// Test 3 – After cancel, new rotation can be initiated immediately
// ============================================================================

#[test]
fn test_new_rotation_after_cancel() {
    let (env, client, admin) = setup();
    let new_admin_1 = Address::generate(&env);
    let new_admin_2 = Address::generate(&env);

    client.initiate_admin_rotation(&admin, &new_admin_1);
    client.cancel_admin_rotation(&admin);

    // Second initiation succeeds for a different target
    client.initiate_admin_rotation(&admin, &new_admin_2);

    let pending = client.get_pending_admin_rotation();
    assert!(pending.is_some());
    assert_eq!(pending.unwrap().new_admin, new_admin_2);

    // Clean up
    let _ = env; // env still in scope
}

// ============================================================================
// Test 4 – Double-initiation is rejected with ConditionsNotMet
// ============================================================================

#[test]
#[should_panic]
fn test_double_initiation_rejected() {
    let (env, client, admin) = setup();
    let _ = env;
    let new_admin = Address::generate(&env);

    client.initiate_admin_rotation(&admin, &new_admin);
    // Second call while one is already pending must panic
    client.initiate_admin_rotation(&admin, &new_admin);
}

// ============================================================================
// Test 5 – Execution before timelock expires is rejected
// ============================================================================

#[test]
#[should_panic]
fn test_execute_before_timelock_panics() {
    let (env, client, admin) = setup();
    let new_admin = Address::generate(&env);

    client.initiate_admin_rotation(&admin, &new_admin);

    // Advance only 1 ledger — timelock is 1440
    advance(&env, 1);

    // Must panic with TimelockNotExpired
    client.execute_admin_rotation();
}

// ============================================================================
// Test 6 – execute/cancel with no pending rotation returns ProposalNotFound
// ============================================================================

#[test]
#[should_panic]
fn test_execute_without_pending_panics() {
    let (_env, client, _admin) = setup();
    // No rotation was initiated
    client.execute_admin_rotation();
}

#[test]
#[should_panic]
fn test_cancel_without_pending_panics() {
    let (_env, client, admin) = setup();
    client.cancel_admin_rotation(&admin);
}

// ============================================================================
// Test 7 – Non-admin cannot initiate
// ============================================================================

#[test]
#[should_panic]
fn test_non_admin_cannot_initiate() {
    let (env, client, _admin) = setup();
    let non_admin = Address::generate(&env);
    let new_admin = Address::generate(&env);

    // non_admin has Role::Member — must panic with InsufficientRole
    client.initiate_admin_rotation(&non_admin, &new_admin);
}

// ============================================================================
// Test 8 – Non-admin cannot cancel
// ============================================================================

#[test]
#[should_panic]
fn test_non_admin_cannot_cancel() {
    let (env, client, admin) = setup();
    let new_admin = Address::generate(&env);
    let non_admin = Address::generate(&env);

    client.initiate_admin_rotation(&admin, &new_admin);

    // Must panic — non_admin has no Admin role
    client.cancel_admin_rotation(&non_admin);
}

// ============================================================================
// Test 9 – Admin functions still work during a pending rotation
// ============================================================================

#[test]
fn test_admin_functions_work_during_pending_rotation() {
    let (env, client, admin) = setup();
    let new_admin = Address::generate(&env);
    let signer = Address::generate(&env);

    client.initiate_admin_rotation(&admin, &new_admin);
    assert!(client.get_pending_admin_rotation().is_some());

    // Old admin can still assign roles while rotation is pending
    client.set_role(&admin, &signer, &Role::Admin);
    assert_eq!(client.get_role(&signer), Role::Admin);

    // Old admin can still revoke roles
    client.set_role(&admin, &signer, &Role::Member);
    assert_eq!(client.get_role(&signer), Role::Member);
}

// ============================================================================
// Test 10 – Rotation delay of 0 is rejected at vault initialization
// ============================================================================

#[test]
#[should_panic]
fn test_zero_rotation_delay_rejected_at_init() {
    let env = Env::default();
    env.mock_all_auths();

    let vault_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &vault_id);
    let admin = Address::generate(&env);

    let mut cfg = default_init_config(&env, &admin);
    cfg.admin_rotation_delay = 0; // explicitly invalid

    // Must panic with InvalidAmount
    client.initialize(&admin, &cfg);
}

// ============================================================================
// Test 11 – Rotation delay below minimum (< 1440) is rejected at initialization
// ============================================================================

#[test]
#[should_panic]
fn test_below_minimum_rotation_delay_rejected_at_init() {
    let env = Env::default();
    env.mock_all_auths();

    let vault_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &vault_id);
    let admin = Address::generate(&env);

    let mut cfg = default_init_config(&env, &admin);
    cfg.admin_rotation_delay = 1439; // one less than 24 h minimum

    // Must panic with InvalidAmount
    client.initialize(&admin, &cfg);
}
