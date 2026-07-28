//! Tests for recurring payment dry-run simulation (Issue #1446).
//!
//! Covers simulation functionality:
//! 1. Simulate successful payment execution
//! 2. Simulate payment with insufficient balance (fails)
//! 3. Simulate payment with condition not met (skips)
//! 4. Simulate catch-up payments for missed executions
//! 5. Simulate does not modify storage
//! 6. Projected state returned accurately
//! 7. Simulate with various token amounts
//! 8. Simulate payment that would exceed daily limit

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
    StellarAssetClient::new(env, &token).mint(&contract_id, &100_000);

    let recipient = Address::generate(env);
    (client, admin, token, recipient)
}

// ============================================================================
// Scenario 1: Simulate successful payment execution
// ============================================================================

#[test]
fn test_simulate_successful_payment_execution() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let amount = 100i128;
    let interval = 1000u64;

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "payroll"),
        &interval,
        &0u32,
        &0u32,
    );

    let payment = client.get_recurring_payment(&payment_id);

    // Simulate execution
    let sim_result = client.simulate_recurring_execution(&payment_id);

    assert!(sim_result.is_ok());
    let result = sim_result.unwrap();

    // Verify projected state
    assert_eq!(result.will_execute, true);
    assert_eq!(result.projected_payment_count, 1u32);
    assert_eq!(
        result.projected_next_payment_ledger,
        payment.next_payment_ledger + interval
    );
    assert_eq!(result.amount_transferred, amount);
    assert_eq!(result.success, true);
}

// ============================================================================
// Scenario 2: Simulate payment with insufficient balance (fails)
// ============================================================================

#[test]
fn test_simulate_insufficient_balance_fails() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let amount = 200_000i128; // More than vault has (100_000)
    let interval = 1000u64;

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "payroll"),
        &interval,
        &0u32,
        &0u32,
    );

    // Simulate execution
    let sim_result = client.simulate_recurring_execution(&payment_id);

    assert!(sim_result.is_ok());
    let result = sim_result.unwrap();

    // Should indicate execution would fail
    assert_eq!(result.will_execute, false);
    assert_eq!(result.success, false);
    assert_eq!(result.error_reason.is_some(), true);
    assert!(result.error_reason.unwrap().contains("insufficient"));

    // State should not change
    assert_eq!(result.projected_payment_count, 0u32);
}

// ============================================================================
// Scenario 3: Simulate payment with condition not met (skips)
// ============================================================================

#[test]
fn test_simulate_condition_not_met_skips() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let amount = 100i128;
    let interval = 1000u64;
    let balance_threshold = 150_000i128; // Not met

    let payment_id = client.schedule_payment_with_balance_condition(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "payroll"),
        &interval,
        &0u32,
        &0u32,
        &balance_threshold,
    );

    let payment = client.get_recurring_payment(&payment_id);

    // Simulate execution
    let sim_result = client.simulate_recurring_execution(&payment_id);

    assert!(sim_result.is_ok());
    let result = sim_result.unwrap();

    // Should indicate execution would be skipped
    assert_eq!(result.will_execute, false);
    assert_eq!(result.success, true); // It's a "success" in that condition check passed
    assert_eq!(result.skipped, true);
    assert_eq!(result.amount_transferred, 0i128);

    // Next payment ledger should still advance
    assert_eq!(
        result.projected_next_payment_ledger,
        payment.next_payment_ledger + interval
    );
}

// ============================================================================
// Scenario 4: Simulate catch-up payments for missed executions
// ============================================================================

#[test]
fn test_simulate_catchup_payments_for_missed_executions() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let amount = 100i128;
    let interval = 1000u64;

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "payroll"),
        &interval,
        &5u32, // max_missed_payments
        &0u32,
    );

    let payment = client.get_recurring_payment(&payment_id);

    // Advance 3 intervals in the future
    env.ledger().with_mut(|li| {
        li.sequence_number = (payment.next_payment_ledger + 3 * interval) as u32;
    });

    // Simulate execution
    let sim_result = client.simulate_recurring_execution(&payment_id);

    assert!(sim_result.is_ok());
    let result = sim_result.unwrap();

    // Should indicate catch-up would happen
    assert_eq!(result.will_execute, true);
    assert_eq!(result.success, true);
    assert_eq!(result.projected_payment_count, 4u32); // 3 missed + 1 current
    assert_eq!(result.amount_transferred, amount * 4);
}

// ============================================================================
// Scenario 5: Simulate does not modify storage
// ============================================================================

#[test]
fn test_simulate_does_not_modify_storage() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let amount = 100i128;
    let interval = 1000u64;

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "payroll"),
        &interval,
        &0u32,
        &0u32,
    );

    let before = client.get_recurring_payment(&payment_id);

    // Simulate execution
    let _sim_result = client.simulate_recurring_execution(&payment_id);

    let after = client.get_recurring_payment(&payment_id);

    // Storage should remain unchanged
    assert_eq!(after.id, before.id);
    assert_eq!(after.payment_count, before.payment_count);
    assert_eq!(after.next_payment_ledger, before.next_payment_ledger);
    assert_eq!(after.status, before.status);

    // Recipient balance should not change
    let token_client = soroban_sdk::token::Client::new(&env, &token);
    let recipient_balance = token_client.balance(&recipient);
    assert_eq!(recipient_balance, 0i128); // Should still be 0
}

// ============================================================================
// Scenario 6: Projected state returned accurately
// ============================================================================

#[test]
fn test_projected_state_returned_accurately() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let amount = 250i128;
    let interval = 1000u64;

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "payroll"),
        &interval,
        &0u32,
        &0u32,
    );

    let payment = client.get_recurring_payment(&payment_id);

    // Simulate execution at due ledger
    env.ledger().with_mut(|li| {
        li.sequence_number = payment.next_payment_ledger as u32;
    });

    let sim_result = client.simulate_recurring_execution(&payment_id);
    let result = sim_result.unwrap();

    // Verify all projected values
    assert_eq!(result.current_balance_before, 100_000i128);
    assert_eq!(result.current_balance_after, 100_000i128 - amount);
    assert_eq!(result.projected_payment_count, payment.payment_count + 1);
    assert_eq!(
        result.projected_next_payment_ledger,
        payment.next_payment_ledger + interval
    );
    assert_eq!(result.amount_transferred, amount);
    assert_eq!(result.will_execute, true);
    assert_eq!(result.skipped, false);
    assert_eq!(result.success, true);
}

// ============================================================================
// Scenario 7: Simulate with various token amounts
// ============================================================================

#[test]
fn test_simulate_with_various_token_amounts() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let interval = 1000u64;

    let amounts = [1i128, 50i128, 100i128, 1_000i128, 50_000i128];

    for amount in amounts.iter() {
        let payment_id = client.schedule_payment(
            &admin,
            &recipient,
            &token,
            amount,
            &Symbol::new(&env, format!("pay_{}", amount).as_str()),
            &interval,
            &0u32,
            &0u32,
        );

        let payment = client.get_recurring_payment(&payment_id);
        env.ledger().with_mut(|li| {
            li.sequence_number = payment.next_payment_ledger as u32;
        });

        let sim_result = client.simulate_recurring_execution(&payment_id);
        assert!(sim_result.is_ok());

        let result = sim_result.unwrap();
        assert_eq!(result.amount_transferred, *amount);
        assert_eq!(result.projected_payment_count, 1u32);
    }
}

// ============================================================================
// Scenario 8: Simulate payment that would exceed daily limit
// ============================================================================

#[test]
fn test_simulate_exceeds_daily_limit_fails() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    // Daily limit is 50000 from config
    let amount = 100_000i128; // Exceeds limit

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "over_limit"),
        &1000u64,
        &0u32,
        &0u32,
    );

    let payment = client.get_recurring_payment(&payment_id);
    env.ledger().with_mut(|li| {
        li.sequence_number = payment.next_payment_ledger as u32;
    });

    // Simulate execution
    let sim_result = client.simulate_recurring_execution(&payment_id);

    assert!(sim_result.is_ok());
    let result = sim_result.unwrap();

    // Should fail due to daily limit
    assert_eq!(result.will_execute, false);
    assert_eq!(result.success, false);
    assert_eq!(result.error_reason.is_some(), true);
    assert!(
        result.error_reason.unwrap().contains("daily")
            || result.error_reason.unwrap().contains("limit")
    );
}

// ============================================================================
// Scenario 9: Simulate early execution (before due ledger)
// ============================================================================

#[test]
fn test_simulate_early_execution_fails() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let amount = 100i128;
    let interval = 1000u64;

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "payroll"),
        &interval,
        &0u32,
        &0u32,
    );

    // Current ledger is before due ledger
    let sim_result = client.simulate_recurring_execution(&payment_id);

    assert!(sim_result.is_ok());
    let result = sim_result.unwrap();

    // Should fail because not due yet
    assert_eq!(result.will_execute, false);
    assert_eq!(result.success, false);
    assert!(result.error_reason.is_some());
}

// ============================================================================
// Scenario 10: Simulate stopped payment returns error
// ============================================================================

#[test]
fn test_simulate_stopped_payment_fails() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let amount = 100i128;
    let interval = 1000u64;

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "payroll"),
        &interval,
        &0u32,
        &0u32,
    );

    // Stop the payment
    client.stop_recurring_payment(&admin, &payment_id);

    let payment = client.get_recurring_payment(&payment_id);
    env.ledger().with_mut(|li| {
        li.sequence_number = payment.next_payment_ledger as u32;
    });

    // Simulate execution
    let sim_result = client.simulate_recurring_execution(&payment_id);

    assert!(sim_result.is_ok());
    let result = sim_result.unwrap();

    // Should fail because payment is stopped
    assert_eq!(result.will_execute, false);
    assert_eq!(result.success, false);
}

// ============================================================================
// Scenario 11: Simulate returns detailed error messages
// ============================================================================

#[test]
fn test_simulate_returns_detailed_error_messages() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    // Payment with insufficient balance
    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &200_000i128, // More than available
        &Symbol::new(&env, "over_limit"),
        &1000u64,
        &0u32,
        &0u32,
    );

    let payment = client.get_recurring_payment(&payment_id);
    env.ledger().with_mut(|li| {
        li.sequence_number = payment.next_payment_ledger as u32;
    });

    // Simulate execution
    let sim_result = client.simulate_recurring_execution(&payment_id);

    assert!(sim_result.is_ok());
    let result = sim_result.unwrap();

    assert_eq!(result.success, false);
    assert!(result.error_reason.is_some());

    let error = result.error_reason.unwrap();
    assert!(!error.is_empty());
    // Should contain meaningful error details
    assert!(error.len() > 5);
}
