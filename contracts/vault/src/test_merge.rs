//! Tests for Issue #1100: Vault Merge Protocol

#![cfg(test)]

use crate::types::{MergeStatus, RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

fn default_config(env: &Env, admin: &Address) -> InitConfig {
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        default_voting_deadline: 0,
        spending_limit: 1_000_000,
        daily_limit: 10_000_000,
        weekly_limit: 50_000_000,
        timelock_threshold: 500_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        veto_addresses: Vec::new(env),
    }
}

/// Set up a vault and return (client, admin, contract_id).
fn setup_vault(env: &Env) -> (VaultDAOClient, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.initialize(&admin, &default_config(env, &admin));
    (client, admin, contract_id)
}

// ============================================================================
// Test 1: Full merge — initiate → complete
// ============================================================================

#[test]
fn test_full_merge_initiate_and_complete() {
    let env = Env::default();
    env.mock_all_auths();

    let (target_client, target_admin, _) = setup_vault(&env);
    let source_admin = Address::generate(&env);
    let source_vault = Address::generate(&env);

    // Initiate merge (source_vault merges into this target contract)
    let merge_id = target_client.initiate_merge(&source_admin, &target_admin, &source_vault);

    assert_eq!(merge_id, 1u64);

    // Verify merge record
    let record = target_client.get_merge_record(&merge_id);
    assert_eq!(record.status, MergeStatus::Initiated);
    assert_eq!(record.source_vault, source_vault);
    assert!(record.finalized_at == 0);

    // Complete the merge
    target_client.complete_merge(&target_admin, &merge_id);

    let completed = target_client.get_merge_record(&merge_id);
    assert_eq!(completed.status, MergeStatus::Completed);
    assert!(completed.finalized_at > 0);
}

// ============================================================================
// Test 2: Merge with active proposals
// ============================================================================

#[test]
fn test_merge_counts_active_proposals() {
    let env = Env::default();
    env.mock_all_auths();

    let (target_client, target_admin, contract_id) = setup_vault(&env);
    let source_vault = Address::generate(&env);
    let source_admin = Address::generate(&env);

    // Create some proposals in the target vault
    let token = env
        .register_stellar_asset_contract_v2(target_admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&contract_id, &1_000_000);
    let recipient = Address::generate(&env);

    target_client.propose_transfer(
        &target_admin,
        &recipient,
        &token,
        &100i128,
        &soroban_sdk::Symbol::new(&env, "m"),
        &crate::types::Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );

    let merge_id = target_client.initiate_merge(&source_admin, &target_admin, &source_vault);
    target_client.complete_merge(&target_admin, &merge_id);

    let record = target_client.get_merge_record(&merge_id);
    assert_eq!(record.status, MergeStatus::Completed);
    // Should count the pending proposal
    assert!(record.proposals_transferred >= 1);
}

// ============================================================================
// Test 3: Abort mid-merge — source vault lock released
// ============================================================================

#[test]
fn test_abort_merge() {
    let env = Env::default();
    env.mock_all_auths();

    let (target_client, target_admin, _) = setup_vault(&env);
    let source_vault = Address::generate(&env);
    let source_admin = Address::generate(&env);

    let merge_id = target_client.initiate_merge(&source_admin, &target_admin, &source_vault);

    // Abort the merge
    target_client.abort_merge(&target_admin, &merge_id);

    let record = target_client.get_merge_record(&merge_id);
    assert_eq!(record.status, MergeStatus::Aborted);
    assert!(record.finalized_at > 0);

    // After aborting, a new merge should be initiatable (active merge ID cleared)
    let source_vault2 = Address::generate(&env);
    let merge_id2 = target_client.initiate_merge(&source_admin, &target_admin, &source_vault2);
    assert_eq!(merge_id2, 2u64);
}

// ============================================================================
// Test 4: Duplicate merge attempt blocked (active merge ID)
// ============================================================================

#[test]
fn test_duplicate_merge_attempt_blocked() {
    let env = Env::default();
    env.mock_all_auths();

    let (target_client, target_admin, _) = setup_vault(&env);
    let source_vault = Address::generate(&env);
    let source_admin = Address::generate(&env);

    // First merge initiated
    target_client.initiate_merge(&source_admin, &target_admin, &source_vault);

    // A second initiate while the first is active must fail
    let source_vault2 = Address::generate(&env);
    let result = target_client.try_initiate_merge(&source_admin, &target_admin, &source_vault2);
    assert!(
        result.is_err(),
        "Duplicate merge should be blocked while one is active"
    );
}

// ============================================================================
// Test 5: Cannot merge vault into itself
// ============================================================================

#[test]
fn test_cannot_merge_into_itself() {
    let env = Env::default();
    env.mock_all_auths();

    let (target_client, target_admin, contract_id) = setup_vault(&env);
    let source_admin = Address::generate(&env);

    // source_vault == target_vault (the contract itself)
    let result = target_client.try_initiate_merge(&source_admin, &target_admin, &contract_id);
    assert!(
        result.is_err(),
        "Should not be able to merge a vault into itself"
    );
}

// ============================================================================
// Test 6: Complete non-existent merge fails
// ============================================================================

#[test]
fn test_complete_nonexistent_merge_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (target_client, target_admin, _) = setup_vault(&env);

    let result = target_client.try_complete_merge(&target_admin, &999u64);
    assert!(result.is_err(), "Completing non-existent merge should fail");
}

// ============================================================================
// Test 7: Abort non-existent merge fails
// ============================================================================

#[test]
fn test_abort_nonexistent_merge_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (target_client, target_admin, _) = setup_vault(&env);

    let result = target_client.try_abort_merge(&target_admin, &999u64);
    assert!(result.is_err(), "Aborting non-existent merge should fail");
}

// ============================================================================
// Test 8: Complete already-aborted merge fails
// ============================================================================

#[test]
fn test_complete_aborted_merge_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (target_client, target_admin, _) = setup_vault(&env);
    let source_vault = Address::generate(&env);
    let source_admin = Address::generate(&env);

    let merge_id = target_client.initiate_merge(&source_admin, &target_admin, &source_vault);
    target_client.abort_merge(&target_admin, &merge_id);

    // Cannot complete an already-aborted merge
    let result = target_client.try_complete_merge(&target_admin, &merge_id);
    assert!(result.is_err(), "Cannot complete an aborted merge");
}
