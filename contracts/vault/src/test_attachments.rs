//! Tests for Issue #1063: On-Chain Merkle Proof Attachment Verification
#![cfg(test)]

use super::*;
use crate::types::{RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Bytes, BytesN, Env, String, Symbol, Vec};

fn make_config(env: &Env, signers: Vec<Address>) -> InitConfig {
    InitConfig {
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 10_000,
        daily_limit: 50_000,
        weekly_limit: 100_000,
        timelock_threshold: 9_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
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

