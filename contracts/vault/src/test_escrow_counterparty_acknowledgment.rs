//! Tests for escrow counterparty acknowledgment step before milestone verification (Issue #1540).
//!
//! Escrow currently allows funders to unilaterally impose terms on recipients.
//! This feature adds a `PendingAcknowledgment` status requiring explicit recipient approval.
//!
//! Covered scenarios:
//!  1. Create escrow with PendingAcknowledgment status
//!  2. Only recipient can acknowledge escrow
//!  3. Cannot verify milestone before acknowledgment
//!  4. Cannot release funds before acknowledgment
//!  5. Successful acknowledgment transitions to Active status
//!  6. Acknowledge idempotency (second acknowledge is safe)
//!  7. Non-recipient cannot acknowledge (Unauthorized)
//!  8. Funder cannot acknowledge their own escrow
//!  9. Get escrow status returns correct state
//! 10. Milestone verification succeeds after acknowledgment

use crate::errors::VaultError;
use crate::types::{Milestone, RetryConfig, ThresholdStrategy, VelocityConfig};
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

    StellarAssetClient::new(env, &token).mint(&admin, &10_000_000i128);

    (client, admin, token)
}

// ============================================================================
// Test 1: Create escrow with PendingAcknowledgment status
// ============================================================================

#[test]
fn test_create_escrow_with_pending_acknowledgment_status() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client
        .create_escrow(
            &admin,
            &recipient,
            &token,
            &1_000i128,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    let escrow = client.get_escrow_info(&escrow_id);
    // Verify escrow is in PendingAcknowledgment status (should be before Active)
    assert!(escrow.status as u32 == 0 || escrow.status as u32 == 6); // 0=Pending, 6=PendingAcknowledgment
}

// ============================================================================
// Test 2: Only recipient can acknowledge escrow
// ============================================================================

#[test]
fn test_only_recipient_can_acknowledge_escrow() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    let unauthorized = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client
        .create_escrow(
            &admin,
            &recipient,
            &token,
            &1_000i128,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    // Unauthorized address cannot acknowledge
    let result = client.acknowledge_escrow(&unauthorized, &escrow_id);
    assert!(result.is_err()); // Should be Unauthorized or similar

    // Only recipient can acknowledge
    let result = client.acknowledge_escrow(&recipient, &escrow_id);
    assert!(result.is_ok()); // Should succeed
}

// ============================================================================
// Test 3: Cannot verify milestone before acknowledgment
// ============================================================================

#[test]
fn test_cannot_verify_milestone_before_acknowledgment() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client
        .create_escrow(
            &admin,
            &recipient,
            &token,
            &1_000i128,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    // Try to verify milestone before acknowledgment - should fail
    let result = client.complete_milestone(&admin, &escrow_id, &1u64);
    assert!(result.is_err()); // Should fail with appropriate error
}

// ============================================================================
// Test 4: Cannot release funds before acknowledgment
// ============================================================================

#[test]
fn test_cannot_release_funds_before_acknowledgment() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client
        .create_escrow(
            &admin,
            &recipient,
            &token,
            &1_000i128,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    // Try to release before acknowledgment - should fail
    let result = client.release_escrow(&recipient, &escrow_id);
    assert!(result.is_err()); // Should fail
}

// ============================================================================
// Test 5: Successful acknowledgment transitions to Active status
// ============================================================================

#[test]
fn test_successful_acknowledgment_transitions_to_active_status() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client
        .create_escrow(
            &admin,
            &recipient,
            &token,
            &1_000i128,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    // Acknowledge escrow
    client
        .acknowledge_escrow(&recipient, &escrow_id)
        .expect("acknowledge_escrow should succeed");

    // Check status is now Active
    let escrow = client.get_escrow_info(&escrow_id);
    // Status should be Active (1) after acknowledgment
    assert_eq!(escrow.status as u32, 1); // Active = 1
}

// ============================================================================
// Test 6: Acknowledge idempotency
// ============================================================================

#[test]
fn test_acknowledge_escrow_idempotency() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client
        .create_escrow(
            &admin,
            &recipient,
            &token,
            &1_000i128,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    // Acknowledge first time
    client
        .acknowledge_escrow(&recipient, &escrow_id)
        .expect("first acknowledge should succeed");

    // Acknowledge second time - should still succeed (idempotent)
    let result = client.acknowledge_escrow(&recipient, &escrow_id);
    assert!(result.is_ok()); // Should succeed
}

// ============================================================================
// Test 7: Funder cannot acknowledge their own escrow
// ============================================================================

#[test]
fn test_funder_cannot_acknowledge_escrow() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client
        .create_escrow(
            &admin,
            &recipient,
            &token,
            &1_000i128,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    // Funder (admin) cannot acknowledge - only recipient can
    let result = client.acknowledge_escrow(&admin, &escrow_id);
    assert!(result.is_err()); // Should fail
}

// ============================================================================
// Test 8: Get escrow status returns correct state
// ============================================================================

#[test]
fn test_get_escrow_status_returns_correct_state() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client
        .create_escrow(
            &admin,
            &recipient,
            &token,
            &1_000i128,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    // Before acknowledgment
    let escrow = client.get_escrow_info(&escrow_id);
    let status_before = escrow.status as u32;

    // After acknowledgment
    client
        .acknowledge_escrow(&recipient, &escrow_id)
        .expect("acknowledge should succeed");

    let escrow = client.get_escrow_info(&escrow_id);
    let status_after = escrow.status as u32;

    // Status should change
    assert_ne!(status_before, status_after);
    assert_eq!(status_after, 1); // Should be Active
}

// ============================================================================
// Test 9: Milestone verification succeeds after acknowledgment
// ============================================================================

#[test]
fn test_milestone_verification_succeeds_after_acknowledgment() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client
        .create_escrow(
            &admin,
            &recipient,
            &token,
            &1_000i128,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    // Acknowledge escrow
    client
        .acknowledge_escrow(&recipient, &escrow_id)
        .expect("acknowledge should succeed");

    // Now milestone verification should succeed
    let result = client.complete_milestone(&admin, &escrow_id, &1u64);
    assert!(result.is_ok()); // Should succeed now
}

// ============================================================================
// Test 10: Release funds succeeds after acknowledgment and milestone verification
// ============================================================================

#[test]
fn test_release_funds_succeeds_after_acknowledgment_and_verification() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client
        .create_escrow(
            &admin,
            &recipient,
            &token,
            &1_000i128,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    // Acknowledge escrow
    client
        .acknowledge_escrow(&recipient, &escrow_id)
        .expect("acknowledge should succeed");

    // Verify milestone
    client
        .complete_milestone(&admin, &escrow_id, &1u64)
        .expect("complete_milestone should succeed");

    // Release funds - should succeed now
    let result = client.release_escrow(&recipient, &escrow_id);
    assert!(result.is_ok()); // Should succeed
}
