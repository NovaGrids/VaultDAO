//! Tests for Issue #1544: Prevent Insurance Claim Filing Against Own Proposal
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
        spending_limit: 50_000,
        daily_limit: 200_000,
        weekly_limit: 1_000_000,
        timelock_threshold: 40_000,
        timelock_delay: 10,
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
        staking_config: crate::types::StakingConfig::default(),
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
    }
}

fn setup_insurance(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address) {
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

    // Enable insurance
    client.set_insurance_config(
        &admin,
        &InsuranceConfig {
            enabled: true,
            pool_balance: 10_000,
            claim_payout_bps: 5000,
            evidence_ttl_ledgers: 100000,
            min_claim_amount: 100,
            max_claim_amount: 5000,
        },
    );

    // Fund insurance pool
    StellarAssetClient::new(env, &token).mint(&contract_id, &10_000);

    client.set_role(&admin, &proposer, &Role::Treasurer);

    (client, admin, proposer, token)
}

#[test]
fn test_proposer_cannot_file_claim_on_own_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, proposer, token) = setup_insurance(&env);

    // Proposer creates a proposal
    let recipient = Address::generate(&env);
    let proposal_id = client.propose_transfer(
        &proposer,
        &recipient,
        &token,
        &500i128,
        &Symbol::new(&env, "test"),
        &crate::types::Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );

    // Attempt to file insurance claim on own proposal
    let evidence = [0xabu8; 32];
    let claim_result = client.try_file_insurance_claim(&proposer, &proposal_id, &evidence, &250i128);

    assert!(
        claim_result.is_err(),
        "Proposer should not be able to file claim on own proposal"
    );

    // Verify the error is ClaimSelfFiled
    match claim_result {
        Err(Ok(VaultError::ClaimSelfFiled)) => (),
        _ => panic!("Expected ClaimSelfFiled error"),
    }
}

#[test]
fn test_different_claimer_can_file_claim_on_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposer, token) = setup_insurance(&env);

    // Proposer creates a proposal
    let recipient = Address::generate(&env);
    let proposal_id = client.propose_transfer(
        &proposer,
        &recipient,
        &token,
        &500i128,
        &Symbol::new(&env, "test"),
        &crate::types::Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );

    // Different user (admin) files claim on proposal
    let evidence = [0xabu8; 32];
    let claim_result = client.try_file_insurance_claim(&admin, &proposal_id, &evidence, &250i128);

    assert!(
        claim_result.is_ok(),
        "Non-proposer should be able to file claim on proposal"
    );
}

#[test]
fn test_self_filed_claim_rejection_only_for_proposer() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposer, token) = setup_insurance(&env);

    // Admin creates a proposal (not proposer)
    let recipient = Address::generate(&env);
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &500i128,
        &Symbol::new(&env, "test"),
        &crate::types::Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );

    // Proposer (not the original proposer) can file claim
    let evidence = [0xabu8; 32];
    let claim_result = client.try_file_insurance_claim(&proposer, &proposal_id, &evidence, &250i128);

    assert!(
        claim_result.is_ok(),
        "Other signer should be able to file claim on admin's proposal"
    );
}
