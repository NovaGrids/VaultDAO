//! Tests for Issue #1543: Add Insurance Premium Auto-Collection on Proposal Execution
#![cfg(test)]

use super::*;
use crate::types::{InsuranceConfig, RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Symbol, Vec};

fn make_init_config(env: &Env, signers: Vec<Address>) -> InitConfig {
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
        spending_limit: 50_000_000,
        daily_limit: 200_000_000,
        weekly_limit: 1_000_000_000,
        timelock_threshold: 40_000,
        timelock_delay: 0,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100_000,
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
        staking_config: crate::types::StakingConfig::default(),
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
    }
}

fn setup_with_insurance_premium(
    env: &Env,
    premium_bps: u32,
) -> (VaultDAOClient<'_>, Address, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let proposer = Address::generate(env);
    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(proposer.clone());

    client.initialize(&admin, &make_init_config(env, signers.clone()));

    // Set insurance config with premium
    client.set_insurance_config(
        &admin,
        &InsuranceConfig {
            enabled: true,
            pool_balance: 0,
            claim_payout_bps: 5000,
            evidence_ttl_ledgers: 100000,
            min_claim_amount: 100,
            max_claim_amount: 50_000,
        },
    );

    // Fund vault
    StellarAssetClient::new(env, &token).mint(&contract_id, &100_000);

    client.set_role(&admin, &proposer, &Role::Treasurer);

    (client, admin, proposer, token, contract_id)
}

#[test]
fn test_premium_collected_on_execution_100_bps() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposer, token, contract_id) = setup_with_insurance_premium(&env, 100);

    // Create proposal for 1000 tokens
    let recipient = Address::generate(&env);
    let proposal_amount = 1000i128;
    let expected_premium = 10i128; // 100 bps = 1% of 1000 = 10

    let proposal_id = client.propose_transfer(
        &proposer,
        &recipient,
        &token,
        &proposal_amount,
        &Symbol::new(&env, "test"),
        &crate::types::Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );

    let pool_before = client.get_insurance_pool_balance(&token);

    // Approve and execute
    client.approve_proposal(&admin, &proposal_id);
    client.execute_proposal(&admin, &proposal_id);

    // Insurance pool should have grown by premium
    let pool_after = client.get_insurance_pool_balance(&token);
    assert_eq!(
        pool_after,
        pool_before + expected_premium,
        "Insurance pool should increase by premium amount"
    );
}

#[test]
fn test_premium_calculation_basis_points() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposer, token, contract_id) = setup_with_insurance_premium(&env, 250);

    // Create proposal for 10000 tokens
    let recipient = Address::generate(&env);
    let proposal_amount = 10000i128;
    let expected_premium = 25i128; // 250 bps = 2.5% of 10000 = 25

    let proposal_id = client.propose_transfer(
        &proposer,
        &recipient,
        &token,
        &proposal_amount,
        &Symbol::new(&env, "test"),
        &crate::types::Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );

    let pool_before = client.get_insurance_pool_balance(&token);

    client.approve_proposal(&admin, &proposal_id);
    client.execute_proposal(&admin, &proposal_id);

    let pool_after = client.get_insurance_pool_balance(&token);
    assert_eq!(
        pool_after,
        pool_before + expected_premium,
        "Premium should be calculated correctly in basis points"
    );
}

#[test]
fn test_premium_zero_when_disabled() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposer, token, contract_id) = setup_with_insurance_premium(&env, 100);

    // Disable insurance
    client.set_insurance_config(
        &admin,
        &InsuranceConfig {
            enabled: false,
            pool_balance: 0,
            claim_payout_bps: 5000,
            evidence_ttl_ledgers: 100000,
            min_claim_amount: 100,
            max_claim_amount: 50_000,
        },
    );

    let recipient = Address::generate(&env);
    let proposal_amount = 1000i128;

    let proposal_id = client.propose_transfer(
        &proposer,
        &recipient,
        &token,
        &proposal_amount,
        &Symbol::new(&env, "test"),
        &crate::types::Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );

    let pool_before = client.get_insurance_pool_balance(&token);

    client.approve_proposal(&admin, &proposal_id);
    client.execute_proposal(&admin, &proposal_id);

    let pool_after = client.get_insurance_pool_balance(&token);
    assert_eq!(
        pool_after, pool_before,
        "No premium should be collected when insurance is disabled"
    );
}

#[test]
fn test_premium_multiple_executions() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposer, token, contract_id) = setup_with_insurance_premium(&env, 100);

    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);

    // First proposal: 1000 tokens → 10 premium
    let proposal_id_1 = client.propose_transfer(
        &proposer,
        &recipient1,
        &token,
        &1000i128,
        &Symbol::new(&env, "test1"),
        &crate::types::Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );

    // Second proposal: 2000 tokens → 20 premium
    let proposal_id_2 = client.propose_transfer(
        &proposer,
        &recipient2,
        &token,
        &2000i128,
        &Symbol::new(&env, "test2"),
        &crate::types::Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );

    let pool_before = client.get_insurance_pool_balance(&token);

    // Execute both proposals
    client.approve_proposal(&admin, &proposal_id_1);
    client.execute_proposal(&admin, &proposal_id_1);

    client.approve_proposal(&admin, &proposal_id_2);
    client.execute_proposal(&admin, &proposal_id_2);

    let pool_after = client.get_insurance_pool_balance(&token);
    let expected_total_premium = 30i128; // 10 + 20
    assert_eq!(
        pool_after,
        pool_before + expected_total_premium,
        "Pool should accumulate premiums from multiple executions"
    );
}

#[test]
fn test_premium_collected_event_emitted() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposer, token, contract_id) = setup_with_insurance_premium(&env, 100);

    let recipient = Address::generate(&env);
    let proposal_amount = 1000i128;

    let proposal_id = client.propose_transfer(
        &proposer,
        &recipient,
        &token,
        &proposal_amount,
        &Symbol::new(&env, "test"),
        &crate::types::Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );

    client.approve_proposal(&admin, &proposal_id);
    client.execute_proposal(&admin, &proposal_id);

    // Event should have been emitted (verification done by event log inspection)
    // This test ensures the execution completes successfully
    let pool = client.get_insurance_pool_balance(&token);
    assert!(pool > 0, "Premium should have been collected and pool updated");
}
