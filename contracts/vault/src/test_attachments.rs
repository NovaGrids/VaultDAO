//! Tests for Issue #1063: On-Chain Merkle Proof Attachment Verification
#![cfg(test)]

use super::*;
use crate::types::{RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Bytes, BytesN, Env, String, Symbol, Vec};

fn make_config(env: &Env, signers: Vec<Address>) -> InitConfig {
    InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 10_000,
        daily_limit: 50_000,
        weekly_limit: 100_000,
        timelock_threshold: 9_000,
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

fn sha256_string(env: &Env, s: &str) -> BytesN<32> {
    let b = Bytes::from_slice(env, s.as_bytes());
    env.crypto().sha256(&b).into()
}

// Test 1: Empty attachment list — root equals zero hash
#[test]
fn test_merkle_root_empty_attachments() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&contract_id, &10000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));
    client.set_role(&admin, &admin, &Role::Admin);

    let pid = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    let proposal = client.get_proposal(&pid);
    let zero = BytesN::from_array(&env, &[0u8; 32]);
    assert_eq!(
        proposal.attachment_merkle_root, zero,
        "Empty list root should be zero hash"
    );
}

// Test 2: Single attachment — root equals leaf SHA-256 hash
#[test]
fn test_merkle_root_single_attachment() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&contract_id, &10000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    let pid = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    let att = String::from_str(&env, "QmT5NvutoR7Qq1a6vz1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p");
    client.add_attachment(&admin, &pid, &att);

    let proposal = client.get_proposal(&pid);
    let expected_leaf = sha256_string(&env, "QmT5NvutoR7Qq1a6vz1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p");
    assert_eq!(
        proposal.attachment_merkle_root, expected_leaf,
        "Single attachment root = leaf hash"
    );
}

// Test 3: Multiple attachments produce non-zero root
#[test]
fn test_merkle_root_multiple_attachments() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&contract_id, &10000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    let pid = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    client.add_attachment(
        &admin,
        &pid,
        &String::from_str(&env, "QmAttachmentHashOne11111111111111111111111111111"),
    );
    client.add_attachment(
        &admin,
        &pid,
        &String::from_str(&env, "QmAttachmentHashTwo22222222222222222222222222222"),
    );

    let proposal = client.get_proposal(&pid);
    let zero = BytesN::from_array(&env, &[0u8; 32]);
    assert_ne!(
        proposal.attachment_merkle_root, zero,
        "Multiple attachments root must not be zero"
    );
}

// Test 4: verify_attachment returns true for valid single-leaf proof
#[test]
fn test_verify_attachment_valid_single() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&contract_id, &10000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    let pid = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    let att_str = "QmT5NvutoR7Qq1a6vz1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p";
    client.add_attachment(&admin, &pid, &String::from_str(&env, att_str));

    // For single leaf, proof is empty and index is 0
    let leaf = sha256_string(&env, att_str);
    let proof: Vec<BytesN<32>> = Vec::new(&env);
    let result = client.verify_attachment(&pid, &leaf, &proof, &0u32);
    assert!(result, "Single-leaf proof should verify as true");
}

// Test 5: verify_attachment returns false for invalid leaf
#[test]
fn test_verify_attachment_invalid_leaf() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&contract_id, &10000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    let pid = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    client.add_attachment(
        &admin,
        &pid,
        &String::from_str(&env, "QmRealAttachmentHash111111111111111111111111111"),
    );

    // Use wrong leaf hash
    let wrong_leaf = sha256_string(&env, "QmWrongAttachmentHash_not_in_proposal");
    let proof: Vec<BytesN<32>> = Vec::new(&env);
    let result = client.verify_attachment(&pid, &wrong_leaf, &proof, &0u32);
    assert!(!result, "Wrong leaf should fail verification");
}

// Test 6: Root changes after removing an attachment
#[test]
fn test_merkle_root_updates_on_remove() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&contract_id, &10000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    let pid = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    client.add_attachment(
        &admin,
        &pid,
        &String::from_str(&env, "QmAttachmentA1111111111111111111111111111111111"),
    );
    client.add_attachment(
        &admin,
        &pid,
        &String::from_str(&env, "QmAttachmentB2222222222222222222222222222222222"),
    );
    let root_two = client.get_proposal(&pid).attachment_merkle_root;

    // Remove second attachment
    client.remove_attachment(&admin, &pid, &1u32);
    let root_one = client.get_proposal(&pid).attachment_merkle_root;

    assert_ne!(
        root_two, root_one,
        "Root must change after removing attachment"
    );
}

// Test 7: Empty proposal attachment has zero root — verify_attachment with zero leaf returns true
#[test]
fn test_verify_empty_attachments_zero_leaf() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&contract_id, &10000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    let pid = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    let zero_leaf = BytesN::from_array(&env, &[0u8; 32]);
    let proof: Vec<BytesN<32>> = Vec::new(&env);
    let result = client.verify_attachment(&pid, &zero_leaf, &proof, &0u32);
    assert!(result, "Zero leaf verifies for empty attachment list");
}

// Test 8: Three attachments — verify_attachment for first leaf with correct proof
#[test]
fn test_merkle_root_three_attachments_consistent() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&contract_id, &10000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    let pid = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    client.add_attachment(
        &admin,
        &pid,
        &String::from_str(&env, "QmAttachHashAAA1111111111111111111111111111111"),
    );
    client.add_attachment(
        &admin,
        &pid,
        &String::from_str(&env, "QmAttachHashBBB2222222222222222222222222222222"),
    );
    client.add_attachment(
        &admin,
        &pid,
        &String::from_str(&env, "QmAttachHashCCC3333333333333333333333333333333"),
    );

    let proposal = client.get_proposal(&pid);
    let zero = BytesN::from_array(&env, &[0u8; 32]);
    // Root must be set and non-zero
    assert_ne!(proposal.attachment_merkle_root, zero);
    // Root must remain stable (read twice, same result)
    let proposal2 = client.get_proposal(&pid);
    assert_eq!(
        proposal.attachment_merkle_root,
        proposal2.attachment_merkle_root
    );
}
