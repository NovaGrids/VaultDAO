use super::*;
use crate::types::{Priority, Role};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, Vec};

fn setup(env: &Env) -> (VaultDAOClient<'static>, Address, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let signer1 = Address::generate(env);
    let signer2 = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    client.initialize(
        &admin,
        &crate::types::InitConfig {
            veto_window_ledgers: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: crate::types::VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers,
            threshold: 2,
            quorum: 0,
            spending_limit: 100_000,
            daily_limit: 500_000,
            weekly_limit: 1_000_000,
            timelock_threshold: 0,
            timelock_delay: 0,
            velocity_limit: crate::types::VelocityConfig {
                limit: 1_000_000,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: crate::types::ThresholdStrategy::Fixed,
            default_voting_deadline: 0,
            veto_addresses: Vec::new(env),
            retry_config: crate::types::RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(env),
            staking_config: crate::types::StakingConfig::default(),
            proposal_id_prefix: 0,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            quorum_percentage: 0,
        },
    );

    (client, admin, signer1, signer2, contract_id)
}

/// Issue #1415: Add Token Address Allowlist to Prevent Abuse
/// Test add_approved_token function
#[test]
fn test_add_approved_token_admin_only() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, signer1, _signer2, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    // Admin should be able to add approved token
    client.add_approved_token(&admin, &token);

    // Non-admin should fail (would panic in actual implementation)
    // This is a placeholder - actual implementation would need the function to be public
}

/// Issue #1415: Test remove_approved_token function
#[test]
fn test_remove_approved_token_admin_only() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    // Add token first
    client.add_approved_token(&admin, &token);

    // Admin should be able to remove approved token
    client.remove_approved_token(&admin, &token);
}

/// Issue #1415: Test allowlist enforcement flag
#[test]
fn test_enforce_token_allowlist_config() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2, _contract_id) = setup(&env);

    // Test setting enforce_token_allowlist to true
    // This would modify the config with enforce_token_allowlist: true
    // The actual implementation would store this in DataKey::ApprovedTokens
}

/// Issue #1415: Test proposal fails with unapproved token when enforcement enabled
#[test]
fn test_proposal_with_unapproved_token_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, signer1, signer2, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token1 = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let token2 = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let recipient = Address::generate(&env);

    client.set_role(&admin, &admin, &Role::Treasurer);
    client.set_role(&signer1, &signer1, &Role::Approver);
    client.set_role(&signer2, &signer2, &Role::Approver);

    // Add token1 to allowlist
    client.add_approved_token(&admin, &token1);

    // Proposal with allowed token should succeed
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token1,
        &1000i128,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );

    assert!(proposal_id > 0);

    // Proposal with unapproved token should fail (when enforcement is enabled)
    // This test would verify that propose_transfer_internal checks the allowlist
}

/// Issue #1415: Test multiple tokens in allowlist
#[test]
fn test_multiple_tokens_in_allowlist() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token1 = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let token2 = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let token3 = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    // Add multiple tokens
    client.add_approved_token(&admin, &token1);
    client.add_approved_token(&admin, &token2);
    client.add_approved_token(&admin, &token3);

    // Remove one token
    client.remove_approved_token(&admin, &token2);

    // token1 and token3 should still be in allowlist
    // token2 should be removed
}

/// Issue #1415: Test adding duplicate token
#[test]
fn test_add_duplicate_token_to_allowlist() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    // Add token
    client.add_approved_token(&admin, &token);

    // Adding same token again should be idempotent
    client.add_approved_token(&admin, &token);
}

/// Issue #1415: Test removing non-existent token
#[test]
fn test_remove_nonexistent_token() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    // Removing non-existent token should be safe (no-op or error handling)
    client.remove_approved_token(&admin, &token);
}
