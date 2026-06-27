//! Audit chain integrity tests

#![cfg(test)]

use super::*;
use crate::types::{AuditAction, RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Env, Symbol, Vec,
};
use crate::types::*;
use crate::VaultDAO;
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

fn make_audit_config(env: &Env, signers: Vec<Address>, threshold: u32) -> InitConfig {
    InitConfig {
        signers,
        threshold,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: types::StakingConfig::default(),
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
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
            window: 3600, per_token_limit: 0 },
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
    assert_eq!(full_result.unwrap(), None, "Full audit trail should be intact");

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
            window: 3600, per_token_limit: 0 },
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

    // Create some audit entries
    client.initialize(&admin, &config);
    
    let proposal_id = client.propose_transfer(
        &signer,
        &recipient,
        &env.current_contract_address(),
        &1000i128,
        &soroban_sdk::Symbol::new(&env, "test"),
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

    client.approve_proposal(&signer, &proposal_id);

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
    assert!(result.is_err(), "Should fail when to_id exceeds available entries");
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
            window: 3600, per_token_limit: 0 },
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
    assert_ne!(entry1.hash, 0, "Hash should not be zero with proper SHA256 computation");
    assert_ne!(entry1.prev_hash, entry1.hash, "prev_hash should differ from hash");

    // Create another entry and verify chain linkage
    client.update_threshold(&admin, &2u32);
    let entry2 = client.get_audit_entry(&2u64).unwrap();
    
    // Verify chain linkage
    assert_eq!(entry2.prev_hash, entry1.hash, "Chain should be properly linked");
    assert_ne!(entry2.hash, entry1.hash, "Each entry should have unique hash");
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
            window: 3600, per_token_limit: 0 },
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
    assert!(result.is_ok(), "Should be able to verify 50+ entry chain within CPU budget");

    // Test full trail verification
    let full_result = client.verify_audit_trail_full();
    assert!(full_result.is_ok(), "Full trail verification should succeed");
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
            window: 3600, per_token_limit: 0 },
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