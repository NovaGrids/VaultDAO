//! Tests for Issue #1533: Velocity history authorization
//!
//! Validates that the get_velocity_history query function properly enforces
//! access control, allowing only authorized parties (admin, the signer themselves,
//! or individuals with Treasurer privilege) to access velocity history data.

use crate::types::{RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, Role, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

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

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address) {
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let signer = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    let mut config = default_init_config(env, &admin);
    config.signers = signers;
    client.initialize(&admin, &config);

    (client, admin, signer)
}

// ============================================================================
// Test: Admin can read any signer's velocity history
// ============================================================================

#[test]
fn test_admin_can_read_velocity_history() {
    let env = Env::default();
    let (client, admin, signer) = setup(&env);

    // Admin should be able to read velocity history of any signer
    let history = client.get_velocity_history(&admin, &signer);
    assert!(history.len() >= 0);
}

// ============================================================================
// Test: Signer can read their own velocity history
// ============================================================================

#[test]
fn test_signer_can_read_own_velocity_history() {
    let env = Env::default();
    let (client, _admin, signer) = setup(&env);

    // Signer should be able to read their own velocity history
    let history = client.get_velocity_history(&signer, &signer);
    assert!(history.len() >= 0);
}

// ============================================================================
// Test: Treasurer can read any signer's velocity history
// ============================================================================

#[test]
fn test_treasurer_can_read_velocity_history() {
    let env = Env::default();
    let (client, admin, signer) = setup(&env);

    let treasurer = Address::generate(&env);

    // Set treasurer role
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // Treasurer should be able to read velocity history of any signer
    let history = client.get_velocity_history(&treasurer, &signer);
    assert!(history.len() >= 0);
}

// ============================================================================
// Test: Unauthorized user cannot read another signer's velocity history
// ============================================================================

#[test]
fn test_unauthorized_user_cannot_read_velocity_history() {
    let env = Env::default();
    let (client, admin, signer) = setup(&env);

    let unauthorized = Address::generate(&env);

    // Unauthorized user should not be able to read another signer's velocity history
    let result = client.try_get_velocity_history(&unauthorized, &signer);
    assert!(result.is_err());
}

// ============================================================================
// Test: Member role cannot read another member's velocity history
// ============================================================================

#[test]
fn test_member_cannot_read_other_member_velocity_history() {
    let env = Env::default();
    let (client, admin, signer) = setup(&env);

    let member1 = Address::generate(&env);
    let member2 = Address::generate(&env);

    // Set both as members
    client.set_role(&admin, &member1, &Role::Member);
    client.set_role(&admin, &member2, &Role::Member);

    // member1 should not be able to read member2's velocity history
    let result = client.try_get_velocity_history(&member1, &member2);
    assert!(result.is_err());
}

// ============================================================================
// Test: Unauthorized access returns appropriate error
// ============================================================================

#[test]
fn test_unauthorized_access_returns_error() {
    let env = Env::default();
    let (client, _admin, signer) = setup(&env);

    let unauthorized = Address::generate(&env);

    // Attempt to read velocity history without authorization
    let result = client.try_get_velocity_history(&unauthorized, &signer);
    assert_eq!(result.is_err(), true);
}
