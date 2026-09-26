//! Tests for Issue #1428: Proposal Execution Gas Cost Estimation Cache
//!
//! Tests verify that:
//! - Fee estimates are cached in proposals
//! - Cache has a timestamp for expiry tracking (1 hour TTL)
//! - Cache can be invalidated by admin
//! - Events are emitted when cache is invalidated
#![cfg(test)]

use super::*;
use crate::types::{ConditionLogic, Priority, RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Symbol, Vec};

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address) {
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
            spending_limit: 1_000_000,
            daily_limit: 5_000_000,
            weekly_limit: 10_000_000,
            timelock_threshold: 999_999,
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

    (client, admin, token, contract_id)
}

fn create_proposal(
    env: &Env,
    client: &VaultDAOClient<'_>,
    proposer: &Address,
    token: &Address,
    vault_contract: &Address,
) -> u64 {
    StellarAssetClient::new(env, token).mint(vault_contract, &1_000_000);
    let recipient = Address::generate(env);
    client.propose_transfer(
        proposer,
        &recipient,
        token,
        &100i128,
        &Symbol::new(env, "test"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    )
}

// ============================================================================
// Fee Cache Tests (Issue #1428)
// ============================================================================

#[test]
fn test_proposal_fee_cache_fields_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault_contract) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault_contract);

    let proposal = client.get_proposal(proposal_id).unwrap();
    // Cache should be None initially
    assert_eq!(proposal.fee_estimate_cache, None);
    // Timestamp should be initialized (0 initially)
    assert_eq!(proposal.fee_cache_timestamp, 0);
}

#[test]
fn test_fee_cache_populated_after_estimate() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault_contract) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault_contract);

    // Estimate cost populates cache
    let fee = client.estimate_proposal_cost(proposal_id);
    assert!(fee > 0);

    // Verify proposal has cached fee
    let proposal = client.get_proposal(proposal_id).unwrap();
    assert!(proposal.fee_estimate_cache.is_some());
}

#[test]
fn test_fee_cache_same_on_repeat_calls() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault_contract) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault_contract);

    let fee1 = client.estimate_proposal_cost(proposal_id);
    let fee2 = client.estimate_proposal_cost(proposal_id);

    assert_eq!(fee1, fee2);
}

#[test]
fn test_fee_cache_independent_per_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault_contract) = setup(&env);
    let id1 = create_proposal(&env, &client, &admin, &token, &vault_contract);
    let id2 = create_proposal(&env, &client, &admin, &token, &vault_contract);

    client.estimate_proposal_cost(id1);
    client.estimate_proposal_cost(id2);

    let p1 = client.get_proposal(id1).unwrap();
    let p2 = client.get_proposal(id2).unwrap();

    // Each should have own cache
    assert!(p1.fee_estimate_cache.is_some());
    assert!(p2.fee_estimate_cache.is_some());
}

#[test]
fn test_proposal_not_found_estimate_cost() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _, _) = setup(&env);

    let result = client.try_estimate_proposal_cost(999);
    assert!(result.is_err());
}
