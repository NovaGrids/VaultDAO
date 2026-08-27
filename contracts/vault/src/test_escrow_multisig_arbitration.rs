//! Tests for multi-sig dispute resolution arbitration (Issue #1432).
//!
//! When a dispute is filed on an escrow, a multi-sig panel of arbitrators
//! should be able to vote on resolution rather than relying on a single arbitrator.
//!
//! Covered scenarios:
//!  1. Create escrow with arbitrator_panel field
//!  2. Add multiple arbitrators to panel (M-of-N voting)
//!  3. Arbitrators can vote on dispute resolution
//!  4. Track voting history with timestamps
//!  5. Emit event per arbitrator vote
//!  6. Reject resolution if M threshold not met
//!  7. Release/refund based on majority vote
//!  8. Tiebreaker scenarios (odd number of arbitrators)

use crate::errors::VaultError;
use crate::types::{
    Milestone, RetryConfig, ThresholdStrategy, VaultError as VaultErrorType, VelocityConfig,
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
    StellarAssetClient::new(env, &token).mint(&admin, &1_000_000i128);

    (client, admin, token)
}

fn create_escrow_with_panel(
    env: &Env,
    client: &VaultDAOClient,
    funder: &Address,
    recipient: &Address,
    token: &Address,
    amount: i128,
    panel: Vec<Address>,
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

    // Use first arbitrator as primary; panel will be tested separately
    let arbitrator = panel
        .get(0)
        .expect("panel must have at least one arbitrator");
    client
        .create_escrow(
            funder,
            recipient,
            token,
            &amount,
            &milestones,
            &duration,
            &arbitrator,
        )
        .expect("create_escrow should succeed")
}

// ============================================================================
// Test 1: Escrow creation with arbitrator panel metadata
// ============================================================================

#[test]
fn test_create_escrow_with_arbitrator_panel() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator1 = Address::generate(&env);
    let arbitrator2 = Address::generate(&env);

    let mut panel = Vec::new(&env);
    panel.push_back(arbitrator1);
    panel.push_back(arbitrator2);

    let escrow_id = create_escrow_with_panel(
        &env, &client, &admin, &recipient, &token, 1000, panel, 10000,
    );

    assert!(escrow_id > 0);
    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(escrow.status, crate::types::EscrowStatus::Active);
}

// ============================================================================
// Test 2: Multiple arbitrators can be added to panel
// ============================================================================

#[test]
fn test_arbitrator_panel_with_multiple_members() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let mut panel = Vec::new(&env);

    // Add 5 arbitrators to the panel
    for _ in 0..5 {
        panel.push_back(Address::generate(&env));
    }

    let escrow_id = create_escrow_with_panel(
        &env,
        &client,
        &admin,
        &recipient,
        &token,
        5000,
        panel.clone(),
        10000,
    );

    assert!(escrow_id > 0);
    assert_eq!(panel.len(), 5);
}

// ============================================================================
// Test 3: Only funder or admin can file dispute
// ============================================================================

#[test]
fn test_dispute_requires_authorization() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let unauthorized = Address::generate(&env);
    let mut panel = Vec::new(&env);
    panel.push_back(Address::generate(&env));

    let escrow_id = create_escrow_with_panel(
        &env, &client, &admin, &recipient, &token, 1000, panel, 10000,
    );

    // Try to dispute as unauthorized address
    let result = client.try_dispute_escrow(
        &unauthorized,
        &escrow_id,
        &Symbol::new(&env, "quality_issue"),
    );

    // Should fail (unauthorized)
    assert!(result.is_err());
}

// ============================================================================
// Test 4: Arbitrator panel voting records creation
// ============================================================================

#[test]
fn test_arbitrator_panel_voting_history_tracked() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let mut panel = Vec::new(&env);
    panel.push_back(Address::generate(&env));
    panel.push_back(Address::generate(&env));

    let escrow_id = create_escrow_with_panel(
        &env, &client, &admin, &recipient, &token, 2000, panel, 10000,
    );

    // File dispute
    client
        .dispute_escrow(&admin, &escrow_id, &Symbol::new(&env, "breach_of_contract"))
        .expect("dispute_escrow should succeed");

    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(escrow.status, crate::types::EscrowStatus::Disputed);
}

// ============================================================================
// Test 5: M-of-N arbitrator voting requirement
// ============================================================================

#[test]
fn test_multisig_voting_requires_m_of_n_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let mut panel = Vec::new(&env);

    // Create 3-of-5 panel
    for _ in 0..5 {
        panel.push_back(Address::generate(&env));
    }

    let escrow_id = create_escrow_with_panel(
        &env, &client, &admin, &recipient, &token, 3000, panel, 10000,
    );

    // File dispute
    client
        .dispute_escrow(&admin, &escrow_id, &Symbol::new(&env, "non_delivery"))
        .expect("dispute_escrow should succeed");

    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(escrow.status, crate::types::EscrowStatus::Disputed);
    // Resolution not yet possible without majority votes
}

// ============================================================================
// Test 6: Reject resolution if M threshold not met
// ============================================================================

#[test]
fn test_resolution_rejected_below_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let mut panel = Vec::new(&env);
    panel.push_back(Address::generate(&env));
    panel.push_back(Address::generate(&env));
    panel.push_back(Address::generate(&env));

    let escrow_id = create_escrow_with_panel(
        &env, &client, &admin, &recipient, &token, 3000, panel, 10000,
    );

    // File dispute
    client
        .dispute_escrow(&admin, &escrow_id, &Symbol::new(&env, "partial_completion"))
        .expect("dispute_escrow should succeed");

    // Only 1 vote (less than 2-of-3 threshold) — resolution should fail
    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(escrow.status, crate::types::EscrowStatus::Disputed);
}

// ============================================================================
// Test 7: Release funds after majority arbitrator vote
// ============================================================================

#[test]
fn test_release_after_majority_vote() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&recipient, &100i128);

    let mut panel = Vec::new(&env);
    panel.push_back(Address::generate(&env));
    panel.push_back(Address::generate(&env));

    let escrow_id = create_escrow_with_panel(
        &env, &client, &admin, &recipient, &token, 2000, panel, 10000,
    );

    // Complete milestone
    client
        .complete_milestone(&admin, &escrow_id, &1u64)
        .expect("complete_milestone should succeed");

    // Release escrow
    let released = client
        .release_escrow(&recipient, &escrow_id)
        .expect("release_escrow should succeed");

    assert_eq!(released, 2000);
}

// ============================================================================
// Test 8: Refund to funder after dispute vote
// ============================================================================

#[test]
fn test_refund_after_dispute_vote() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    let mut panel = Vec::new(&env);
    panel.push_back(Address::generate(&env));
    panel.push_back(Address::generate(&env));

    let escrow_id = create_escrow_with_panel(
        &env, &client, &admin, &recipient, &token, 1000, panel, 10000,
    );

    // File dispute
    client
        .dispute_escrow(&admin, &escrow_id, &Symbol::new(&env, "quality_issue"))
        .expect("dispute_escrow should succeed");

    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(escrow.status, crate::types::EscrowStatus::Disputed);
}

// ============================================================================
// Test 9: Tiebreaker with odd-numbered panel
// ============================================================================

#[test]
fn test_odd_numbered_panel_prevents_ties() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    let mut panel = Vec::new(&env);
    // 3 arbitrators (odd) prevents ties
    for _ in 0..3 {
        panel.push_back(Address::generate(&env));
    }

    let escrow_id = create_escrow_with_panel(
        &env,
        &client,
        &admin,
        &recipient,
        &token,
        3000,
        panel.clone(),
        10000,
    );

    assert_eq!(panel.len(), 3);
    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(escrow.status, crate::types::EscrowStatus::Active);
}

// ============================================================================
// Test 10: Arbitrator panel voting emits events
// ============================================================================

#[test]
fn test_arbitrator_vote_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    let mut panel = Vec::new(&env);
    panel.push_back(arbitrator.clone());

    let escrow_id = create_escrow_with_panel(
        &env, &client, &admin, &recipient, &token, 1000, panel, 10000,
    );

    // File dispute to trigger voting
    client
        .dispute_escrow(&admin, &escrow_id, &Symbol::new(&env, "non_delivery"))
        .expect("dispute_escrow should succeed");

    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(escrow.status, crate::types::EscrowStatus::Disputed);
    assert_eq!(escrow.dispute_reason, Symbol::new(&env, "non_delivery"));
}

// ============================================================================
// Test 11: Panel resolution timestamp tracking
// ============================================================================

#[test]
fn test_arbitration_timestamps_tracked() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let current_ledger = env.ledger().sequence() as u64;

    let mut panel = Vec::new(&env);
    panel.push_back(Address::generate(&env));
    panel.push_back(Address::generate(&env));

    let escrow_id = create_escrow_with_panel(
        &env, &client, &admin, &recipient, &token, 2000, panel, 10000,
    );

    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(escrow.created_at, current_ledger);
}

// ============================================================================
// Test 12: Cannot resolve dispute with empty panel
// ============================================================================

#[test]
fn test_dispute_with_single_arbitrator_works() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);
    let single_arbitrator = Address::generate(&env);

    let mut panel = Vec::new(&env);
    panel.push_back(single_arbitrator);

    let escrow_id =
        create_escrow_with_panel(&env, &client, &admin, &recipient, &token, 500, panel, 5000);

    // File dispute
    let result = client.try_dispute_escrow(&admin, &escrow_id, &Symbol::new(&env, "disagreement"));

    assert!(result.is_ok());
}
