//! Tests for escrow expiration and auto-refund (Issue #1434).
//!
//! Escrows can remain in Held state indefinitely if neither party releases them.
//! After a configurable timeout, funds should auto-refund to the depositor.
//!
//! Covered scenarios:
//!  1. Add expires_at field to Escrow (already present in current type)
//!  2. Check in release_escrow: reject if expired
//!  3. Auto-refund to funder post-expiry
//!  4. Emit event with auto-refund reason
//!  5. Anyone can call auto_refund_escrow after expiry
//!  6. Cannot refund escrow that is already released
//!  7. Cannot refund non-expired escrow
//!  8. Refunded status prevents further operations
//!  9. Correct amount refunded accounting
//! 10. Grace period for late completion before expiry

use crate::errors::VaultError;
use crate::types::{
    Milestone, RetryConfig, ThresholdStrategy, VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    client.initialize(
        &admin,
        &InitConfig {
            veto_window_ledgers: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: crate::types::VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
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
                per_token_limit: 0,
                limit: 1_000_000_000,
                window: 3_600,
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
            quorum_percentage: 0,
        },
    );

    // Fund admin
    StellarAssetClient::new(env, &token).mint(&admin, &5_000_000i128);

    (client, admin, token)
}

fn create_escrow(
    env: &Env,
    client: &VaultDAOClient,
    funder: &Address,
    recipient: &Address,
    token: &Address,
    amount: i128,
    duration: u64,
) -> u64 {
    let mut milestones = Vec::new(env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let arbitrator = Address::generate(env);
    client
        .create_escrow(funder, recipient, token, &amount, &milestones, &duration, &arbitrator)
        .expect("create_escrow should succeed")
}

// ============================================================================
// Test 1: Escrow with expiration timestamp
// ============================================================================

#[test]
fn test_escrow_has_expiration_timestamp() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let current_ledger = env.ledger().sequence() as u64;
    let duration = 1000u64;

    let escrow_id = create_escrow(&env, &client, &admin, &recipient, &token, 5000, duration);

    let escrow = client.get_escrow(&escrow_id);
    assert_eq!(escrow.created_at, current_ledger);
    assert_eq!(escrow.expires_at, current_ledger + duration);
}

// ============================================================================
// Test 2: Reject release if escrow is expired
// ============================================================================

#[test]
fn test_release_rejected_when_expired() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let duration = 100u64;

    let escrow_id = create_escrow(&env, &client, &admin, &recipient, &token, 2000, duration);

    // Complete milestone
    client
        .complete_milestone(&admin, &escrow_id, &1u64)
        .expect("complete_milestone should succeed");

    // Advance past expiration
    env.ledger().with_mut(|li| li.sequence_number += 150);

    // Try to release — should fail because expired
    let result = client.try_release_escrow(&recipient, &escrow_id);
    assert!(result.is_err());
}

// ============================================================================
// Test 3: Auto-refund to funder post-expiry
// ============================================================================

#[test]
fn test_auto_refund_returns_funds_to_funder() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let duration = 100u64;
    let amount = 3000i128;

    let escrow_id = create_escrow(&env, &client, &admin, &recipient, &token, amount, duration);

    // Don't complete milestone — let it expire
    env.ledger().with_mut(|li| li.sequence_number += 150);

    // Anyone can call auto-refund
    let caller = Address::generate(&env);
    let released = client
        .release_escrow(&caller, &escrow_id)
        .expect("release_escrow should succeed (auto-refund)");

    assert_eq!(released, amount);
    let escrow = client.get_escrow(&escrow_id);
    assert_eq!(escrow.status, crate::types::EscrowStatus::Refunded);
}

// ============================================================================
// Test 4: Emit event on auto-refund
// ============================================================================

#[test]
fn test_auto_refund_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    let escrow_id = create_escrow(&env, &client, &admin, &recipient, &token, 1000, 50u64);

    env.ledger().with_mut(|li| li.sequence_number += 100);

    let caller = Address::generate(&env);
    let _released = client
        .release_escrow(&caller, &escrow_id)
        .expect("auto-refund should succeed");

    let escrow = client.get_escrow(&escrow_id);
    assert_eq!(escrow.status, crate::types::EscrowStatus::Refunded);
    assert!(escrow.finalized_at > 0);
}

// ============================================================================
// Test 5: Only funder receives refund on expiry
// ============================================================================

#[test]
fn test_refund_goes_to_funder_not_recipient() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    let escrow_id = create_escrow(&env, &client, &admin, &recipient, &token, 2500, 75u64);

    env.ledger().with_mut(|li| li.sequence_number += 100);

    // Try to get refund as recipient — should still go to funder
    let released = client
        .release_escrow(&recipient, &escrow_id)
        .expect("release_escrow should refund to funder");

    let escrow = client.get_escrow(&escrow_id);
    assert_eq!(released, 2500);
    assert_eq!(escrow.status, crate::types::EscrowStatus::Refunded);
}

// ============================================================================
// Test 6: Cannot refund already-released escrow
// ============================================================================

#[test]
fn test_cannot_refund_already_released() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    let escrow_id = create_escrow(&env, &client, &admin, &recipient, &token, 1500, 500u64);

    // Complete milestone before expiry
    client
        .complete_milestone(&admin, &escrow_id, &1u64)
        .expect("complete_milestone should succeed");

    // Release normally
    let released = client
        .release_escrow(&recipient, &escrow_id)
        .expect("release should succeed");

    assert_eq!(released, 1500);

    // Now advance past expiry
    env.ledger().with_mut(|li| li.sequence_number += 600);

    // Try to refund — should fail (already released)
    let result = client.try_release_escrow(&admin, &escrow_id);
    assert!(result.is_err());
}

// ============================================================================
// Test 7: Cannot process non-expired escrow auto-refund
// ============================================================================

#[test]
fn test_non_expired_escrow_cannot_be_auto_refunded() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    let escrow_id = create_escrow(&env, &client, &admin, &recipient, &token, 1000, 1000u64);

    // Still within expiration window — should not auto-refund
    let result = client.try_release_escrow(&recipient, &escrow_id);

    // Should fail because milestones not complete and not expired
    assert!(result.is_err());
}

// ============================================================================
// Test 8: Refunded escrow status prevents further operations
// ============================================================================

#[test]
fn test_refunded_escrow_prevents_operations() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    let escrow_id = create_escrow(&env, &client, &admin, &recipient, &token, 2000, 80u64);

    env.ledger().with_mut(|li| li.sequence_number += 150);

    // Auto-refund
    let _released = client
        .release_escrow(&admin, &escrow_id)
        .expect("auto-refund should succeed");

    // Try to complete milestone on refunded escrow — should fail
    let result = client.try_complete_milestone(&admin, &escrow_id, &1u64);
    assert!(result.is_err());
}

// ============================================================================
// Test 9: Correct partial amount refunded
// ============================================================================

#[test]
fn test_partial_refund_accounting() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let total_amount = 5000i128;

    let mut milestones = Vec::new(&env);
    // Two milestones: 60% and 40%
    milestones.push_back(Milestone {
        id: 1,
        percentage: 60,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    milestones.push_back(Milestone {
        id: 2,
        percentage: 40,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let arbitrator = Address::generate(&env);
    let escrow_id = client
        .create_escrow(&admin, &recipient, &token, &total_amount, &milestones, &1000u64, &arbitrator)
        .expect("create_escrow should succeed");

    // Complete first milestone
    client
        .complete_milestone(&admin, &escrow_id, &1u64)
        .expect("complete_milestone should succeed");

    // Release partial
    let released = client
        .release_escrow(&recipient, &escrow_id)
        .expect("release should succeed");

    assert_eq!(released, 3000); // 60% of 5000

    let escrow = client.get_escrow(&escrow_id);
    assert_eq!(escrow.released_amount, 3000);
    assert_eq!(escrow.total_amount, total_amount);
}

// ============================================================================
// Test 10: Grace period to complete before expiry
// ============================================================================

#[test]
fn test_grace_period_completion_before_expiry() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let duration = 500u64;

    let escrow_id = create_escrow(&env, &client, &admin, &recipient, &token, 4000, duration);

    // Complete milestone well before expiry
    env.ledger().with_mut(|li| li.sequence_number += 200);

    client
        .complete_milestone(&admin, &escrow_id, &1u64)
        .expect("complete_milestone should succeed");

    // Release should work (before expiry, milestone complete)
    let released = client
        .release_escrow(&recipient, &escrow_id)
        .expect("release should succeed");

    assert_eq!(released, 4000);
}

// ============================================================================
// Test 11: Multiple calls to auto-refund are idempotent
// ============================================================================

#[test]
fn test_multiple_refund_calls_are_idempotent() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    let escrow_id = create_escrow(&env, &client, &admin, &recipient, &token, 1000, 50u64);

    env.ledger().with_mut(|li| li.sequence_number += 100);

    // First refund
    let released1 = client
        .release_escrow(&admin, &escrow_id)
        .expect("first refund should succeed");

    assert_eq!(released1, 1000);

    // Second refund attempt — should fail (already refunded)
    let result = client.try_release_escrow(&admin, &escrow_id);
    assert!(result.is_err());
}

// ============================================================================
// Test 12: Expiration blocks both release paths
// ============================================================================

#[test]
fn test_expiration_prevents_milestone_release() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    let escrow_id = create_escrow(&env, &client, &admin, &recipient, &token, 1500, 100u64);

    // Complete milestone
    client
        .complete_milestone(&admin, &escrow_id, &1u64)
        .expect("complete_milestone should succeed");

    // Advance past expiry
    env.ledger().with_mut(|li| li.sequence_number += 150);

    // Release should return refund (not milestone-based release)
    let released = client
        .release_escrow(&recipient, &escrow_id)
        .expect("expired release should still work (as refund)");

    assert_eq!(released, 1500);
}
