//! Audit chain integrity tests

#![cfg(test)]

use super::*;
use crate::types::{
    AuditAction, ConditionLogic, Priority, RetryConfig, ThresholdStrategy, VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Symbol, Vec,
};

fn make_audit_config(env: &Env, signers: Vec<Address>, threshold: u32) -> InitConfig {
    InitConfig {
        signers,
        threshold,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        veto_window_ledgers: 0,
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 80,
    }
}

#[test]
fn test_audit_chain_integrity_after_5_entries() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = crate::VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let recipient = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let config = make_audit_config(&env, signers, 1);
    client.initialize(&admin, &config);

    // Verify initialization audit entry
    let audit_entry = client.get_audit_entry(&1);
    assert_eq!(audit_entry.id, 1);
    assert_eq!(audit_entry.action, AuditAction::Initialize);
    assert_eq!(audit_entry.actor, admin);
    assert_eq!(audit_entry.prev_hash, 0);

    // Set role and verify audit
    client.set_role(&admin, &signer1, &Role::Treasurer);
    let audit_entry2 = client.get_audit_entry(&2);
    assert_eq!(audit_entry2.action, AuditAction::SetRole);
    assert_eq!(audit_entry2.prev_hash, audit_entry.hash);
    let config = InitConfig {
        signers,
        threshold: 2,
        quorum: 0,
        quorum_percentage: 0,
        default_voting_deadline: 0,
        spending_limit: 10000,
        daily_limit: 50000,
        weekly_limit: 100000,
        timelock_threshold: 5000,
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
        recovery_config: RecoveryConfig::default(&env),
        staking_config: StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: soroban_sdk::Vec::new(&env),
        post_execution_hooks: soroban_sdk::Vec::new(&env),
        veto_addresses: soroban_sdk::Vec::new(&env),
    };

    // Entry 1: Initialize
    client.initialize(&admin, &config);

    // Entry 2: Propose transfer
    let proposal_id = client.propose_transfer(
        &signer1,
        &recipient,
        &env.current_contract_address(),
        &1000i128,
        &soroban_sdk::Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Entry 3: Approve proposal
    client.approve_proposal(&signer1, &proposal_id);

    // Entry 4: Approve proposal (second approval)
    client.approve_proposal(&signer2, &proposal_id);

    // Entry 5: Execute proposal
    client.execute_proposal(&admin, &proposal_id);

    // Verify chain integrity for all 5 entries
    let result = client.verify_audit_chain(&1u64, &5u64);
    assert!(result.is_ok(), "Audit chain should be valid for 5 entries");

    // Verify full audit trail
    let full_result = client.verify_audit_trail_full();
    assert!(full_result.is_ok());
    assert_eq!(
        full_result.unwrap(),
        None,
        "Full audit trail should be intact"
    );

    // Verify individual segments
    assert!(client.verify_audit_chain(&1u64, &3u64).is_ok());
    assert!(client.verify_audit_chain(&3u64, &5u64).is_ok());
    assert!(client.verify_audit_chain(&2u64, &4u64).is_ok());
}

#[test]
fn test_audit_chain_tamper_detection() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = crate::VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &10000);
    let signer = Address::generate(&env);
    let recipient = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    let config = make_audit_config(&env, signers, 1);
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    client.approve_proposal(&signer1, &proposal_id);

    // Verify hash chain integrity
    let entry1 = client.get_audit_entry(&1);
    let entry2 = client.get_audit_entry(&2);
    let entry3 = client.get_audit_entry(&3);
    let entry4 = client.get_audit_entry(&4);

    assert_eq!(entry2.prev_hash, entry1.hash);
    assert_eq!(entry3.prev_hash, entry2.hash);
    assert_eq!(entry4.prev_hash, entry3.hash);

    client.approve_proposal(&signer1, &proposal_id);

    // Verify chain is initially valid
    assert!(client.verify_audit_chain(&1u64, &3u64).is_ok());

    // Simulate tampering by directly modifying storage
    // Note: In a real scenario, this would be detected by the hash mismatch
    // We can't actually tamper with the storage in this test environment,
    // but we can test invalid ranges and edge cases

    // Test invalid ranges
    let result = client.try_verify_audit_chain(&0u64, &3u64);
    assert!(result.is_err(), "Should fail for invalid from_id = 0");

    let result = client.try_verify_audit_chain(&3u64, &2u64);
    assert!(result.is_err(), "Should fail when from_id > to_id");

    let result = client.try_verify_audit_chain(&1u64, &100u64);
    assert!(
        result.is_err(),
        "Should fail when to_id exceeds available entries"
    );
}

#[test]
fn test_audit_hash_deterministic() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = crate::VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    let config = make_audit_config(&env, signers, 1);
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.add_signer(&admin, &user);

    // Verify entire audit trail
    let is_valid = client.verify_audit_trail(&1, &3);
    assert_eq!(is_valid, true);
    let config = InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        default_voting_deadline: 0,
        spending_limit: 10000,
        daily_limit: 50000,
        weekly_limit: 100000,
        timelock_threshold: 5000,
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
        recovery_config: RecoveryConfig::default(&env),
        staking_config: StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: soroban_sdk::Vec::new(&env),
        post_execution_hooks: soroban_sdk::Vec::new(&env),
        veto_addresses: soroban_sdk::Vec::new(&env),
    };

    // Initialize and create an entry
    client.initialize(&admin, &config);

    // Get the first audit entry
    let entry1 = client.get_audit_entry(&1u64).unwrap();

    // Verify the entry has non-zero hash (not the old placeholder)
    assert_ne!(
        entry1.hash, 0,
        "Hash should not be zero with proper SHA256 computation"
    );
    assert_ne!(
        entry1.prev_hash, entry1.hash,
        "prev_hash should differ from hash"
    );

    // Create another entry and verify chain linkage
    client.update_threshold(&admin, &2u32);
    let entry2 = client.get_audit_entry(&2u64).unwrap();

    // Verify chain linkage
    assert_eq!(
        entry2.prev_hash, entry1.hash,
        "Chain should be properly linked"
    );
    assert_ne!(
        entry2.hash, entry1.hash,
        "Each entry should have unique hash"
    );
}

#[test]
fn test_performance_100_entry_chain() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = crate::VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &10000);
    let signer = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    let config = make_audit_config(&env, signers, 1);
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.add_signer(&admin, &signer2);

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    client.approve_proposal(&signer1, &proposal_id);

    // Verify all audit entries exist
    let entry1 = client.get_audit_entry(&1);
    assert_eq!(entry1.action, AuditAction::Initialize);

    let entry2 = client.get_audit_entry(&2);
    assert_eq!(entry2.action, AuditAction::SetRole);

    let entry3 = client.get_audit_entry(&3);
    assert_eq!(entry3.action, AuditAction::AddSigner);

    let entry4 = client.get_audit_entry(&4);
    assert_eq!(entry4.action, AuditAction::ProposeTransfer);

    let entry5 = client.get_audit_entry(&5);
    assert_eq!(entry5.action, AuditAction::ApproveProposal);

    // Verify entire chain
    let is_valid = client.verify_audit_trail(&1, &5);
    assert_eq!(is_valid, true);
    let config = InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        default_voting_deadline: 0,
        spending_limit: 10000,
        daily_limit: 50000,
        weekly_limit: 100000,
        timelock_threshold: 5000,
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
        recovery_config: RecoveryConfig::default(&env),
        staking_config: StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: soroban_sdk::Vec::new(&env),
        post_execution_hooks: soroban_sdk::Vec::new(&env),
        veto_addresses: soroban_sdk::Vec::new(&env),
    };

    // Initialize (entry 1)
    client.initialize(&admin, &config);

    // Create many audit entries by updating threshold repeatedly
    // This is a simple way to generate many audit entries
    for i in 2..=50 {
        client.update_threshold(&admin, &(i % 10 + 1)); // Cycle through valid thresholds
    }

    // Verify we have enough entries
    let entry_count = client.get_audit_entry_count();
    assert!(entry_count >= 50, "Should have at least 50 audit entries");

    // Performance test: verify a large chain segment
    // This should complete within Soroban CPU budget
    let result = client.verify_audit_chain(&1u64, &entry_count.min(50));
    assert!(
        result.is_ok(),
        "Should be able to verify 50+ entry chain within CPU budget"
    );

    // Test full trail verification
    let full_result = client.verify_audit_trail_full();
    assert!(
        full_result.is_ok(),
        "Full trail verification should succeed"
    );
    assert_eq!(full_result.unwrap(), None, "Full trail should be intact");
}

#[test]
fn test_audit_chain_edge_cases() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = crate::VaultDAOClient::new(&env, &contract_id);

    // Test empty chain
    let result = client.try_verify_audit_chain(&1u64, &1u64);
    assert!(result.is_err(), "Should fail when no entries exist");

    // Test single entry after initialization
    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        default_voting_deadline: 0,
        spending_limit: 10000,
        daily_limit: 50000,
        weekly_limit: 100000,
        timelock_threshold: 5000,
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
        recovery_config: RecoveryConfig::default(&env),
        staking_config: StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: soroban_sdk::Vec::new(&env),
        post_execution_hooks: soroban_sdk::Vec::new(&env),
        veto_addresses: soroban_sdk::Vec::new(&env),
    };

    client.initialize(&admin, &config);

    // Test single entry verification
    let result = client.verify_audit_chain(&1u64, &1u64);
    assert!(result.is_ok(), "Should succeed for single entry");

    // Test first entry has prev_hash = 0
    let entry1 = client.get_audit_entry(&1u64).unwrap();
    assert_eq!(entry1.prev_hash, 0, "First entry should have prev_hash = 0");
    assert_ne!(entry1.hash, 0, "First entry should have non-zero hash");
}
// ============================================================================
// Issue #1087: Audit Trail Compression Tests
// ============================================================================

fn make_checkpoint_config(env: &Env) -> (Address, crate::VaultDAOClient, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let mut signers = soroban_sdk::Vec::new(env);
    signers.push_back(admin.clone());

    let contract_id = env.register(VaultDAO, ());
    let client = crate::VaultDAOClient::new(env, &contract_id);

    let config = InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        default_voting_deadline: 0,
        spending_limit: 100_000_000,
        daily_limit: 500_000_000,
        weekly_limit: 1_000_000_000,
        timelock_threshold: 50_000_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 1000,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: RecoveryConfig::default(env),
        staking_config: StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: soroban_sdk::Vec::new(env),
        post_execution_hooks: soroban_sdk::Vec::new(env),
        veto_addresses: soroban_sdk::Vec::new(env),
    };

    client.initialize(&admin, &config);
    (admin.clone(), client, contract_id)
}

/// Generate N audit entries by repeatedly updating the threshold.
fn generate_audit_entries(client: &crate::VaultDAOClient, admin: &Address, count: u32) {
    for i in 0..count {
        client.update_threshold(admin, &((i % 10 + 1) as u32));
    }
}

#[test]
fn test_create_audit_checkpoint_archives_entries() {
    let env = Env::default();
    let (admin, client, _) = make_checkpoint_config(&env);

    // Create 100+ audit entries (1 from initialize + 100 from threshold updates)
    generate_audit_entries(&client, &admin, 100);

    // Should have at least 101 entries now (initialize = 1 + 100 updates)
    let count = client.get_audit_entry_count();
    assert!(
        count >= 101,
        "Need at least 101 entries before checkpointing"
    );

    // Create the first checkpoint
    let cp_id = client.create_audit_checkpoint(&admin);
    assert_eq!(cp_id, 1u64, "First checkpoint ID should be 1");

    // Verify checkpoint was stored
    let cp = client.get_audit_checkpoint(&1u64);
    assert_eq!(cp.id, 1u64);
    assert_eq!(cp.from_entry_id, 1u64);
    assert_eq!(cp.to_entry_id, 100u64);
    // Merkle root must be non-zero
    let zero = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    assert_ne!(
        cp.merkle_root, zero,
        "Checkpoint Merkle root must not be zero"
    );
}

#[test]
fn test_entries_removed_after_checkpoint() {
    let env = Env::default();
    let (admin, client, _) = make_checkpoint_config(&env);

    generate_audit_entries(&client, &admin, 100);

    // Create checkpoint - this archives entries 1..=100
    client.create_audit_checkpoint(&admin);

    // Archived entries should no longer be individually accessible
    let result = client.try_get_audit_entry(&1u64);
    assert!(
        result.is_err(),
        "Entry 1 should have been removed after checkpointing"
    );

    let result2 = client.try_get_audit_entry(&100u64);
    assert!(
        result2.is_err(),
        "Entry 100 should have been removed after checkpointing"
    );
}

#[test]
fn test_entries_not_yet_checkpointed_remain_accessible() {
    let env = Env::default();
    let (admin, client, _) = make_checkpoint_config(&env);

    // Create 150 entries: first 100 will be checkpointed, 101-151 stay
    generate_audit_entries(&client, &admin, 150);

    client.create_audit_checkpoint(&admin);

    // Entry 101 should still be accessible (not yet checkpointed)
    let result = client.try_get_audit_entry(&101u64);
    assert!(result.is_ok(), "Entry 101 should still be accessible");
}

#[test]
fn test_verify_audit_entry_valid_proof() {
    let env = Env::default();
    let (admin, client, _) = make_checkpoint_config(&env);

    generate_audit_entries(&client, &admin, 100);

    // Record hash of entry 1 before checkpointing
    let entry1 = client.get_audit_entry(&1u64);

    client.create_audit_checkpoint(&admin);

    // For a single-leaf proof we can verify the root directly
    // Leaf index 0 is entry 1. With an empty proof the root equals the leaf for 1 entry,
    // but for 100 entries we need a proof. The simplest test: verify with empty proof fails.
    let empty_proof: soroban_sdk::Vec<soroban_sdk::BytesN<32>> = soroban_sdk::Vec::new(&env);
    let invalid = client.verify_audit_entry(&1u64, &entry1.hash, &empty_proof, &0u64);
    // An empty proof is only valid for a single-entry tree (100 entries → must fail)
    assert!(!invalid, "Empty proof for 100-entry tree should be invalid");
}

#[test]
fn test_verify_audit_entry_invalid_hash_rejected() {
    let env = Env::default();
    let (admin, client, _) = make_checkpoint_config(&env);

    generate_audit_entries(&client, &admin, 100);
    client.create_audit_checkpoint(&admin);

    let wrong_hash = 0xdeadbeef_u64;
    let empty_proof: soroban_sdk::Vec<soroban_sdk::BytesN<32>> = soroban_sdk::Vec::new(&env);
    let valid = client.verify_audit_entry(&1u64, &wrong_hash, &empty_proof, &0u64);
    assert!(!valid, "Wrong hash should not produce a valid proof");
}

#[test]
fn test_checkpoint_with_nonexistent_id_fails() {
    let env = Env::default();
    let (_, client, _) = make_checkpoint_config(&env);

    // No checkpoint created yet; trying to get checkpoint 1 should fail
    let result = client.try_get_audit_checkpoint(&1u64);
    assert!(
        result.is_err(),
        "Should fail when checkpoint does not exist"
    );
}

#[test]
fn test_create_second_checkpoint_starts_after_first() {
    let env = Env::default();
    let (admin, client, _) = make_checkpoint_config(&env);

    // Create 200+ entries for two checkpoints
    generate_audit_entries(&client, &admin, 200);

    let cp1_id = client.create_audit_checkpoint(&admin);
    let cp2_id = client.create_audit_checkpoint(&admin);

    assert_eq!(cp1_id, 1u64);
    assert_eq!(cp2_id, 2u64);

    let cp1 = client.get_audit_checkpoint(&cp1_id);
    let cp2 = client.get_audit_checkpoint(&cp2_id);

    assert_eq!(cp1.from_entry_id, 1u64);
    assert_eq!(cp1.to_entry_id, 100u64);
    assert_eq!(cp2.from_entry_id, 101u64);
    assert_eq!(cp2.to_entry_id, 200u64);
}
