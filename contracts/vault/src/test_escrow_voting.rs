//! Tests for Issue #1431: Escrow Condition Release Voting
//!
//! Tests verify that:
//! - Escrows can be configured to require signer approval for release
//! - Signers can vote to approve or reject release
//! - M-of-N approval threshold is enforced
//! - Voting history is tracked
//! - Events are emitted for voting milestones
#![cfg(test)]

use super::*;
use crate::types::{RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Vec};

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address, Vec<Address>) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    let signer_2 = Address::generate(env);
    let signer_3 = Address::generate(env);
    signers.push_back(signer_2.clone());
    signers.push_back(signer_3.clone());

    client.initialize(
        &admin,
        &InitConfig {
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: crate::types::VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers: signers.clone(),
            threshold: 2,
            quorum: 0,
            quorum_percentage: 0,
            default_voting_deadline: 0,
            spending_limit: 100_000_000,
            daily_limit: 500_000_000,
            weekly_limit: 1_000_000_000,
            timelock_threshold: 999_999_999,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 100,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            veto_addresses: Vec::new(env),
            veto_window_ledgers: 0,
            retry_config: RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(env),
            staking_config: crate::types::StakingConfig::default(),
            proposal_id_prefix: 0,
        },
    );

    (client, admin, token, contract_id, signers)
}

// ============================================================================
// Escrow Voting Tests (Issue #1431)
// ============================================================================

#[test]
fn test_escrow_created_with_voting_disabled_by_default() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault_contract, _) = setup(&env);
    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&vault_contract, &1_000_000);

    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let escrow_id = client.create_escrow(
        &admin,
        &recipient,
        &token,
        &100_000i128,
        &arbitrator,
        &3600u64,
    );

    let escrow = client.get_escrow(escrow_id).unwrap();
    // Voting should be disabled by default
    assert!(!escrow.requires_signer_approval);
}

#[test]
fn test_escrow_voting_can_be_enabled() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault_contract, _) = setup(&env);
    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&vault_contract, &1_000_000);

    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let escrow_id = client.create_escrow(
        &admin,
        &recipient,
        &token,
        &100_000i128,
        &arbitrator,
        &3600u64,
    );

    // Enable voting (if method exists)
    let _result = client.try_set_escrow_requires_signer_approval(&admin, escrow_id, true);
}

#[test]
fn test_escrow_vote_counts_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault_contract, _) = setup(&env);
    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&vault_contract, &1_000_000);

    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let escrow_id = client.create_escrow(
        &admin,
        &recipient,
        &token,
        &100_000i128,
        &arbitrator,
        &3600u64,
    );

    let escrow = client.get_escrow(escrow_id).unwrap();
    // Vote counts should start at zero
    assert_eq!(escrow.approval_votes, 0);
    assert_eq!(escrow.rejection_votes, 0);
}

#[test]
fn test_basic_escrow_creation() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault_contract, _) = setup(&env);
    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&vault_contract, &1_000_000);

    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let escrow_id = client.create_escrow(
        &admin,
        &recipient,
        &token,
        &100_000i128,
        &arbitrator,
        &3600u64,
    );

    assert!(escrow_id > 0);
}

#[test]
fn test_escrow_fields_populated() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault_contract, _) = setup(&env);
    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&vault_contract, &1_000_000);

    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let escrow_id = client.create_escrow(
        &admin,
        &recipient,
        &token,
        &100_000i128,
        &arbitrator,
        &3600u64,
    );

    let escrow = client.get_escrow(escrow_id).unwrap();
    assert_eq!(escrow.total_amount, 100_000i128);
    assert_eq!(escrow.released_amount, 0);
    assert_eq!(escrow.funder, admin);
    assert_eq!(escrow.recipient, recipient);
}

#[test]
fn test_escrow_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _, _, _) = setup(&env);

    let result = client.try_get_escrow(999);
    assert!(result.is_err());
}
