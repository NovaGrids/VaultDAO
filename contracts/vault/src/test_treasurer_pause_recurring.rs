//! Tests for Issue #1535: Treasurer can pause recurring payments
//!
//! Validates that the Treasurer role can pause recurring payments, expanding
//! the capability beyond Admin-only access. Tests both the positive case
//! (Treasurer successfully pauses) and negative case (Members cannot pause).

use crate::errors::VaultError;
use crate::types::{RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, Role, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};

fn default_init_config(env: &Env, admin: &Address) -> InitConfig {
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    InitConfig {
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
        spending_limit: 1000,
        daily_limit: 50000,
        weekly_limit: 100000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
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
        staking_config: crate::types::StakingConfig::default(),
        proposal_id_prefix: 0,
    }
}

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address) {
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.initialize(&admin, &default_init_config(env, &admin));
    client.set_role(&admin, &admin, &Role::Treasurer);

    let token_admin = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token_contract.address();
    StellarAssetClient::new(env, &token).mint(&contract_id, &1_000_000);

    let recipient = Address::generate(env);
    (client, admin, token, recipient)
}

// ============================================================================
// Scenario 1: Treasurer successfully pauses recurring payment
// ============================================================================

#[test]
fn test_treasurer_pauses_recurring_payment_successfully() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let treasurer = Address::generate(&env);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // Create a recurring payment
    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &100i128,
        &Symbol::new(&env, "payroll"),
        &800u64,
        &0u32,
        &0u32,
    );

    // Verify payment is active
    let payment_before = client.get_recurring_payment(&payment_id);
    assert!(payment_before.is_active);

    // Treasurer pauses the recurring payment
    client.pause_recurring_payment(&treasurer, &payment_id);

    // Verify payment is now paused
    let payment_after = client.get_recurring_payment(&payment_id);
    assert!(!payment_after.is_active);
}

// ============================================================================
// Scenario 2: Member role is still rejected from pausing recurring payments
// ============================================================================

#[test]
fn test_member_role_is_rejected_pausing_recurring_payment() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let member = Address::generate(&env);
    client.set_role(&admin, &member, &Role::Member);

    // Create a recurring payment
    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &100i128,
        &Symbol::new(&env, "payroll"),
        &800u64,
        &0u32,
        &0u32,
    );

    // Verify payment is active
    let payment_before = client.get_recurring_payment(&payment_id);
    assert!(payment_before.is_active);

    // Member attempts to pause the recurring payment (should fail)
    let result = client.try_pause_recurring_payment(&member, &payment_id);
    assert_eq!(result, Err(Ok(VaultError::Unauthorized)));

    // Verify payment is still active
    let payment_after = client.get_recurring_payment(&payment_id);
    assert!(payment_after.is_active);
}

// ============================================================================
// Scenario 3: Admin can still pause recurring payments
// ============================================================================

#[test]
fn test_admin_can_pause_recurring_payment() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    // Create a recurring payment
    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &100i128,
        &Symbol::new(&env, "payroll"),
        &800u64,
        &0u32,
        &0u32,
    );

    // Verify payment is active
    let payment_before = client.get_recurring_payment(&payment_id);
    assert!(payment_before.is_active);

    // Admin pauses the recurring payment
    client.pause_recurring_payment(&admin, &payment_id);

    // Verify payment is now paused
    let payment_after = client.get_recurring_payment(&payment_id);
    assert!(!payment_after.is_active);
}

// ============================================================================
// Scenario 4: Paused recurring payment cannot be executed
// ============================================================================

#[test]
fn test_paused_recurring_payment_cannot_execute() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let treasurer = Address::generate(&env);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // Create a recurring payment
    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &100i128,
        &Symbol::new(&env, "payroll"),
        &800u64,
        &0u32,
        &0u32,
    );

    // Treasurer pauses the payment
    client.pause_recurring_payment(&treasurer, &payment_id);

    // Advance ledger to payment time
    env.ledger().set_sequence_number(1000u32);

    // Attempt to execute the paused payment (should fail)
    let result = client.try_execute_recurring_payment(&admin, &payment_id);
    assert_eq!(result, Err(Ok(VaultError::RecurringPaymentNotActive)));
}
