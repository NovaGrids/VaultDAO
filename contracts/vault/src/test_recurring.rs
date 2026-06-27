//! Comprehensive tests for recurring payment functionality.
//!
//! Covers all 8 required scenarios:
//! 1. interval < 720 → IntervalTooShort
//! 2. valid interval → success, verify next_payment_ledger
//! 3. execute before next_payment_ledger → TimelockNotExpired
//! 4. execute at next_payment_ledger → success, payment_count incremented
//! 5. execute twice in same window → second fails
//! 6. stop recurring payment → is_active = false
//! 7. execute on stopped payment → fails
//! 8. token transfer verified on successful execution

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
            window: 3600, per_token_limit: 0 },
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
        proposal_id_prefix: 0,
    }
}

/// Helper: set up env, contract, admin with Treasurer role, token minted to vault.
fn setup(env: &Env) -> (VaultDAOClient, Address, Address, Address) {
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
// Scenario 1: interval < 720 → IntervalTooShort
// ============================================================================

#[test]
fn test_schedule_payment_interval_too_short() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let result = client.try_schedule_payment(
        &admin,
        &recipient,
        &token,
        &100i128,
        &Symbol::new(&env, "payroll"),
        &719u64, // one below minimum
        &0u32,   // max_missed_payments
    );

    assert_eq!(
        result.err(),
        Some(Ok(VaultError::IntervalTooShort))
    );
}

// ============================================================================
// Scenario 2: valid interval → success, verify next_payment_ledger
// ============================================================================

#[test]
fn test_schedule_payment_valid_interval_sets_next_ledger() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let current_ledger = env.ledger().sequence() as u64;
    let interval = 720u64;

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &100i128,
        &Symbol::new(&env, "payroll"),
        &interval,
        &0u32, // max_missed_payments
    );

    let payment = client.get_recurring_payment(&payment_id);
    assert_eq!(payment.id, payment_id);
    assert_eq!(payment.interval, interval);
    assert_eq!(payment.next_payment_ledger, current_ledger + interval);
    assert_eq!(payment.payment_count, 0);
    assert_eq!(payment.status, crate::types::RecurringStatus::Active);
}

// ============================================================================
// Scenario 3: execute before next_payment_ledger → TimelockNotExpired
// ============================================================================

#[test]
fn test_execute_recurring_payment_too_early_fails() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &100i128,
        &Symbol::new(&env, "payroll"),
        &1000u64,
        &0u32, // max_missed_payments
    );

    // Ledger is still at creation time — payment is not due yet
    let result = client.try_execute_recurring_payment(&payment_id);
    assert_eq!(
        result.err(),
        Some(Ok(VaultError::TimelockNotExpired))
    );
}

// ============================================================================
// Scenario 4: execute at next_payment_ledger → success, payment_count++
// ============================================================================

#[test]
fn test_execute_recurring_payment_at_due_ledger_succeeds() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let interval = 1000u64;
    let amount = 100i128;

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "payroll"),
        &interval,
        &0u32, // max_missed_payments
    );

    let payment = client.get_recurring_payment(&payment_id);
    let due_ledger = payment.next_payment_ledger;

    // Advance to exactly the due ledger
    env.ledger().with_mut(|li| {
        li.sequence_number = due_ledger as u32;
    });

    client.execute_recurring_payment(&payment_id);

    let updated = client.get_recurring_payment(&payment_id);
    assert_eq!(updated.payment_count, 1);
    assert_eq!(updated.next_payment_ledger, due_ledger + interval);
}

// ============================================================================
// Scenario 5: execute twice in same window → second fails
// ============================================================================

#[test]
fn test_execute_recurring_payment_twice_in_same_window_fails() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let interval = 1000u64;

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &100i128,
        &Symbol::new(&env, "payroll"),
        &interval,
        &0u32, // max_missed_payments
    );

    let payment = client.get_recurring_payment(&payment_id);
    let due_ledger = payment.next_payment_ledger;

    env.ledger().with_mut(|li| {
        li.sequence_number = due_ledger as u32;
    });

    // First execution succeeds
    client.execute_recurring_payment(&payment_id);

    // Second execution in the same window (ledger hasn't advanced to next due)
    let result = client.try_execute_recurring_payment(&payment_id);
    assert_eq!(
        result.err(),
        Some(Ok(VaultError::TimelockNotExpired))
    );
}

// ============================================================================
// Scenario 6: stop recurring payment → is_active = false
// ============================================================================

#[test]
fn test_stop_recurring_payment_sets_inactive() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &100i128,
        &Symbol::new(&env, "payroll"),
        &720u64,
        &0u32, // max_missed_payments
    );

    assert_eq!(client.get_recurring_payment(&payment_id).status, crate::types::RecurringStatus::Active);

    client.stop_recurring_payment(&admin, &payment_id);

    assert_eq!(client.get_recurring_payment(&payment_id).status, crate::types::RecurringStatus::Stopped);
}

// ============================================================================
// Scenario 7: execute on stopped payment → fails
// ============================================================================

#[test]
fn test_execute_stopped_recurring_payment_fails() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let interval = 720u64;

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &100i128,
        &Symbol::new(&env, "payroll"),
        &interval,
        &0u32, // max_missed_payments
    );

    client.stop_recurring_payment(&admin, &payment_id);

    // Advance past due ledger
    let payment = client.get_recurring_payment(&payment_id);
    env.ledger().with_mut(|li| {
        li.sequence_number = payment.next_payment_ledger as u32;
    });

    let result = client.try_execute_recurring_payment(&payment_id);
    // ProposalNotFound is the error returned for inactive payments
    assert_eq!(
        result.err(),
        Some(Ok(VaultError::ProposalNotFound))
    );
}

// ============================================================================
// Scenario 8: token transfer verified on successful execution
// ============================================================================

#[test]
fn test_execute_recurring_payment_transfers_tokens() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &default_init_config(&env, &admin));
    client.set_role(&admin, &admin, &Role::Treasurer);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token_contract.address();
    let token_client = soroban_sdk::token::Client::new(&env, &token);
    StellarAssetClient::new(&env, &token).mint(&contract_id, &100_000);

    let recipient = Address::generate(&env);
    let amount = 250i128;
    let interval = 720u64;

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "payroll"),
        &interval,
        &0u32, // max_missed_payments
    );

    let payment = client.get_recurring_payment(&payment_id);
    env.ledger().with_mut(|li| {
        li.sequence_number = payment.next_payment_ledger as u32;
    });

    let balance_before = token_client.balance(&recipient);
    client.execute_recurring_payment(&payment_id);
    let balance_after = token_client.balance(&recipient);

    assert_eq!(balance_after - balance_before, amount);

    // Also verify payment_count and next_payment_ledger advanced
    let updated = client.get_recurring_payment(&payment_id);
    assert_eq!(updated.payment_count, 1);
    assert_eq!(
        updated.next_payment_ledger,
        payment.next_payment_ledger + interval
    );
}

// ============================================================================
// New tests for catch-up logic
// ============================================================================

#[test]
fn test_execute_recurring_payment_no_missed_payments() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let interval = 1000u64;
    let amount = 100i128;

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "payroll"),
        &interval,
        &3u32, // max_missed_payments
    );

    let payment = client.get_recurring_payment(&payment_id);
    let due_ledger = payment.next_payment_ledger;

    // Execute exactly on time - no missed payments
    env.ledger().with_mut(|li| {
        li.sequence_number = due_ledger as u32;
    });

    client.execute_recurring_payment(&payment_id);

    let updated = client.get_recurring_payment(&payment_id);
    assert_eq!(updated.payment_count, 1);
    assert_eq!(updated.next_payment_ledger, due_ledger + interval);
}

#[test]
fn test_execute_recurring_payment_three_missed_within_cap() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let interval = 1000u64;
    let amount = 100i128;

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "payroll"),
        &interval,
        &5u32, // max_missed_payments - allow up to 5 missed
    );

    let payment = client.get_recurring_payment(&payment_id);
    let due_ledger = payment.next_payment_ledger;

    // Advance 3 intervals past due (3 missed + 1 current = 4 total payments)
    env.ledger().with_mut(|li| {
        li.sequence_number = (due_ledger + 3 * interval) as u32;
    });

    let token_client = soroban_sdk::token::Client::new(&env, &token);
    let balance_before = token_client.balance(&recipient);

    client.execute_recurring_payment(&payment_id);

    let balance_after = token_client.balance(&recipient);
    let updated = client.get_recurring_payment(&payment_id);

    // Should execute 4 payments (3 missed + 1 current)
    assert_eq!(balance_after - balance_before, amount * 4);
    assert_eq!(updated.payment_count, 4);
    assert_eq!(updated.next_payment_ledger, due_ledger + 4 * interval);
}

#[test]
fn test_execute_recurring_payment_three_missed_exceeding_cap() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let interval = 1000u64;
    let amount = 100i128;

    let payment_id = client.schedule_payment(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "payroll"),
        &interval,
        &2u32, // max_missed_payments - only allow 2 missed
    );

    let payment = client.get_recurring_payment(&payment_id);
    let due_ledger = payment.next_payment_ledger;

    // Advance 3 intervals past due (3 missed > 2 cap)
    env.ledger().with_mut(|li| {
        li.sequence_number = (due_ledger + 3 * interval) as u32;
    });

    let result = client.try_execute_recurring_payment(&payment_id);
    assert_eq!(
        result.err(),
        Some(Ok(VaultError::RecurringPaymentMissedCapExceeded))
    );
}

// ============================================================================
// Issue #942: Recurring Payment Pause and Resume
// ============================================================================

#[test]
fn test_pause_recurring_payment() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let payment_id = client.schedule_payment(
        &admin, &recipient, &token, &100i128,
        &Symbol::new(&env, "pay"), &720u64, &0u32,
    );

    client.pause_recurring_payment(&admin, &payment_id);

    let p = client.get_recurring_payment(&payment_id);
    assert_eq!(p.status, crate::types::RecurringStatus::Paused);
    assert!(p.paused_at_ledger > 0);
}

#[test]
fn test_execute_while_paused_fails() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let payment_id = client.schedule_payment(
        &admin, &recipient, &token, &100i128,
        &Symbol::new(&env, "pay"), &720u64, &0u32,
    );

    // Advance past next_payment_ledger
    env.ledger().with_mut(|l| l.sequence_number += 800);

    client.pause_recurring_payment(&admin, &payment_id);

    let result = client.try_execute_recurring_payment(&payment_id);
    assert_eq!(result, Err(Ok(VaultError::RecurringPaymentPaused)));
}

#[test]
fn test_resume_recurring_payment_advances_schedule() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let payment_id = client.schedule_payment(
        &admin, &recipient, &token, &100i128,
        &Symbol::new(&env, "pay"), &720u64, &0u32,
    );

    let before_pause = client.get_recurring_payment(&payment_id).next_payment_ledger;

    // Pause then advance 100 ledgers
    client.pause_recurring_payment(&admin, &payment_id);
    env.ledger().with_mut(|l| l.sequence_number += 100);

    client.resume_recurring_payment(&admin, &payment_id);

    let p = client.get_recurring_payment(&payment_id);
    assert_eq!(p.status, crate::types::RecurringStatus::Active);
    // next_payment_ledger should have advanced by ~100 ledgers
    assert!(p.next_payment_ledger >= before_pause + 100);
}

#[test]
fn test_stop_then_resume_fails() {
    let env = Env::default();
    let (client, admin, token, recipient) = setup(&env);

    let payment_id = client.schedule_payment(
        &admin, &recipient, &token, &100i128,
        &Symbol::new(&env, "pay"), &720u64, &0u32,
    );

    client.stop_recurring_payment(&admin, &payment_id);

    let result = client.try_resume_recurring_payment(&admin, &payment_id);
    assert_eq!(result, Err(Ok(VaultError::RecurringPaymentStopped)));
}
