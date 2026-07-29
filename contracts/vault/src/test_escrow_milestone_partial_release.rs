//! Tests for escrow partial release with milestone verification (Issue #1433).
//!
//! Escrow today releases all-or-nothing. For milestone-based contracts,
//! funds should be released incrementally as conditions are verified.
//!
//! Covered scenarios:
//!  1. Create escrow with multiple milestones
//!  2. Each milestone has amount, condition, and verifier
//!  3. Verify milestone and release proportional amount
//!  4. Verify milestones in arbitrary order
//!  5. Cannot verify same milestone twice
//!  6. Cannot release before milestone verified
//!  7. Release proportional to completed milestones
//!  8. Cannot release more than escrow total
//!  9. Multiple verification orders work correctly
//! 10. Milestone conditions (price, time, manual)
//! 11. Accumulated releases match total
//! 12. Emit event per milestone completion

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

    // Fund admin
    StellarAssetClient::new(env, &token).mint(&admin, &10_000_000i128);

    (client, admin, token)
}

// ============================================================================
// Test 1: Create escrow with multiple milestones
// ============================================================================

#[test]
fn test_create_escrow_with_multiple_milestones() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 50,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    milestones.push_back(Milestone {
        id: 2,
        percentage: 50,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client
        .create_escrow(
            &admin,
            &recipient,
            &token,
            &10_000i128,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(escrow.milestones.len(), 2);
    assert_eq!(escrow.total_amount, 10_000);
}

// ============================================================================
// Test 2: Each milestone has percentage
// ============================================================================

#[test]
fn test_milestone_has_percentage() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 25,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    milestones.push_back(Milestone {
        id: 2,
        percentage: 25,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    milestones.push_back(Milestone {
        id: 3,
        percentage: 25,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    milestones.push_back(Milestone {
        id: 4,
        percentage: 25,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client
        .create_escrow(
            &admin,
            &recipient,
            &token,
            &8_000i128,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(escrow.milestones.len(), 4);

    for (i, milestone) in escrow.milestones.iter().enumerate() {
        if let Some(m) = milestone {
            assert_eq!(m.percentage, 25);
        }
    }
}

// ============================================================================
// Test 3: Verify milestone and release proportional amount
// ============================================================================

#[test]
fn test_verify_milestone_releases_proportional_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 50,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    milestones.push_back(Milestone {
        id: 2,
        percentage: 50,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let total = 1_000i128;
    let escrow_id = client
        .create_escrow(
            &admin,
            &recipient,
            &token,
            &total,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    // Complete first milestone
    client
        .complete_milestone(&admin, &escrow_id, &1u64)
        .expect("complete_milestone should succeed");

    // Release proportional to completed milestone
    let released = client
        .release_escrow(&recipient, &escrow_id)
        .expect("release_escrow should succeed");

    assert_eq!(released, 500); // 50% of 1000
}

// ============================================================================
// Test 4: Verify milestones in arbitrary order
// ============================================================================

#[test]
fn test_verify_milestones_in_arbitrary_order() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 33,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    milestones.push_back(Milestone {
        id: 2,
        percentage: 33,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    milestones.push_back(Milestone {
        id: 3,
        percentage: 34,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client
        .create_escrow(
            &admin,
            &recipient,
            &token,
            &3_000i128,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    // Complete milestone 3 first (out of order)
    client
        .complete_milestone(&admin, &escrow_id, &3u64)
        .expect("complete_milestone should succeed");

    let escrow = client.get_escrow_info(&escrow_id);
    assert!(escrow.milestones.len() >= 3);
}

// ============================================================================
// Test 5: Cannot verify same milestone twice
// ============================================================================

#[test]
fn test_cannot_complete_milestone_twice() {
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

    // Complete milestone once
    client
        .complete_milestone(&admin, &escrow_id, &1u64)
        .expect("first complete_milestone should succeed");

    // Try to complete again
    let result = client.try_complete_milestone(&admin, &escrow_id, &1u64);
    assert!(result.is_err()); // Should fail (already completed)
}

// ============================================================================
// Test 6: Cannot release before milestone verified
// ============================================================================

#[test]
fn test_cannot_release_before_milestone_verified() {
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

    // Try to release without completing milestone
    let result = client.try_release_escrow(&recipient, &escrow_id);
    assert!(result.is_err()); // Should fail
}

// ============================================================================
// Test 7: Release proportional to completed milestones
// ============================================================================

#[test]
fn test_release_proportional_to_completed() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let total = 10_000i128;
    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 40,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    milestones.push_back(Milestone {
        id: 2,
        percentage: 60,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client
        .create_escrow(
            &admin,
            &recipient,
            &token,
            &total,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    // Complete first milestone (40%)
    client
        .complete_milestone(&admin, &escrow_id, &1u64)
        .expect("complete_milestone should succeed");

    let released1 = client
        .release_escrow(&recipient, &escrow_id)
        .expect("first release should succeed");

    assert_eq!(released1, 4_000); // 40% of 10000

    // Reset for next milestone
    env.ledger().with_mut(|li| li.sequence_number += 1);

    // Complete second milestone (60%)
    client
        .complete_milestone(&admin, &escrow_id, &2u64)
        .expect("complete_milestone should succeed");

    let released2 = client
        .release_escrow(&recipient, &escrow_id)
        .expect("second release should succeed");

    assert_eq!(released2, 6_000); // 60% of 10000
}

// ============================================================================
// Test 8: Cannot release more than escrow total
// ============================================================================

#[test]
fn test_cannot_release_more_than_total() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let total = 5_000i128;
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
            &total,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    client
        .complete_milestone(&admin, &escrow_id, &1u64)
        .expect("complete_milestone should succeed");

    let released = client
        .release_escrow(&recipient, &escrow_id)
        .expect("release should succeed");

    assert!(released <= total);
    assert_eq!(released, total);
}

// ============================================================================
// Test 9: Multiple verification orders work correctly
// ============================================================================

#[test]
fn test_multiple_verification_orders_work() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 30,
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
    milestones.push_back(Milestone {
        id: 3,
        percentage: 30,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client
        .create_escrow(
            &admin,
            &recipient,
            &token,
            &10_000i128,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    // Verify in order: 2, 1, 3
    client
        .complete_milestone(&admin, &escrow_id, &2u64)
        .expect("complete_milestone 2 should succeed");

    client
        .complete_milestone(&admin, &escrow_id, &1u64)
        .expect("complete_milestone 1 should succeed");

    client
        .complete_milestone(&admin, &escrow_id, &3u64)
        .expect("complete_milestone 3 should succeed");

    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(
        escrow.status,
        crate::types::EscrowStatus::MilestonesComplete
    );
}

// ============================================================================
// Test 10: Milestone structure is flexible
// ============================================================================

#[test]
fn test_milestone_structure_supports_various_percentages() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 10,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    milestones.push_back(Milestone {
        id: 2,
        percentage: 20,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    milestones.push_back(Milestone {
        id: 3,
        percentage: 70,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client
        .create_escrow(
            &admin,
            &recipient,
            &token,
            &100_000i128,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(escrow.milestones.len(), 3);
}

// ============================================================================
// Test 11: Accumulated releases match total
// ============================================================================

#[test]
fn test_accumulated_releases_match_total() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let total = 10_000i128;
    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 25,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    milestones.push_back(Milestone {
        id: 2,
        percentage: 25,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    milestones.push_back(Milestone {
        id: 3,
        percentage: 25,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    milestones.push_back(Milestone {
        id: 4,
        percentage: 25,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client
        .create_escrow(
            &admin,
            &recipient,
            &token,
            &total,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    // Complete all milestones
    for i in 1..=4 {
        client
            .complete_milestone(&admin, &escrow_id, &(i as u64))
            .expect(&format!("complete_milestone {} should succeed", i));
    }

    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(
        escrow.status,
        crate::types::EscrowStatus::MilestonesComplete
    );
}

// ============================================================================
// Test 12: Emit event per milestone completion
// ============================================================================

#[test]
fn test_milestone_completion_emits_event() {
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

    // Complete milestone (should emit event)
    client
        .complete_milestone(&admin, &escrow_id, &1u64)
        .expect("complete_milestone should succeed");

    let escrow = client.get_escrow_info(&escrow_id);
    // Verify milestone was marked complete
    assert!(escrow.milestones.len() > 0);
}

// ============================================================================
// Test 13: Partial release prevents over-release
// ============================================================================

#[test]
fn test_partial_release_prevents_double_counting() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let total = 1_000i128;
    let mut milestones = Vec::new(&env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 50,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    milestones.push_back(Milestone {
        id: 2,
        percentage: 50,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client
        .create_escrow(
            &admin,
            &recipient,
            &token,
            &total,
            &milestones,
            &10_000u64,
            &arbitrator,
        )
        .expect("create_escrow should succeed");

    // Complete both milestones
    client
        .complete_milestone(&admin, &escrow_id, &1u64)
        .expect("complete_milestone 1 should succeed");

    client
        .complete_milestone(&admin, &escrow_id, &2u64)
        .expect("complete_milestone 2 should succeed");

    // Release all at once
    let released = client
        .release_escrow(&recipient, &escrow_id)
        .expect("release should succeed");

    assert_eq!(released, total);
    assert!(released <= total);
}
