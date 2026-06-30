//! Tests for Issue #1075: Insurance Pool Governance with Claim Voting
#![cfg(test)]

use super::*;
use crate::types::{InsuranceConfig, RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, BytesN, Env, Vec};

fn make_config(env: &Env, signers: Vec<Address>) -> InitConfig {
    InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 50_000,
        daily_limit: 200_000,
        weekly_limit: 1_000_000,
        timelock_threshold: 40_000,
        timelock_delay: 10,
        velocity_limit: VelocityConfig { limit: 100, window: 3600 },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        retry_config: RetryConfig { enabled: false, max_retries: 0, initial_backoff_ledgers: 0 },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: types::StakingConfig::default(),
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
    }
}

fn evidence() -> [u8; 32] {
    [0xabu8; 32]
}

// Test 1: Successfully submit an insurance claim
#[test]
fn test_submit_insurance_claim() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let claimant = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let tc = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    tc.mint(&contract_id, &100_000);
    tc.mint(&claimant, &10_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    // Fund insurance pool first
    client.set_insurance_config(&admin, &InsuranceConfig {
        enabled: true,
        min_amount: 0,
        min_insurance_bps: 100,
        slash_percentage: 10,
    });

    let ev = BytesN::from_array(&env, &evidence());
    let deadline = 100u64 + 1000u64; // current ledger + 1000 > min 720
    let claim_id = client.submit_insurance_claim(&claimant, &token, &1_000i128, &ev, &deadline);
    assert_eq!(claim_id, 1);

    let claim = client.get_insurance_claim(&claim_id);
    assert_eq!(claim.claimant, claimant);
    assert_eq!(claim.amount, 1_000i128);
}

// Test 2: Vote deadline too short is rejected
#[test]
fn test_claim_deadline_too_short() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let claimant = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&claimant, &5_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    let ev = BytesN::from_array(&env, &evidence());
    // Deadline only 100 ledgers ahead — below minimum 720
    let res = client.try_submit_insurance_claim(&claimant, &token, &1_000i128, &ev, &200u64);
    assert_eq!(res.err(), Some(Ok(VaultError::ClaimVoteDeadlineTooShort)));
}

// Test 3: Claimant cannot vote on own claim
#[test]
fn test_claim_self_vote_blocked() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let claimant = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&claimant, &5_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(claimant.clone());
    client.initialize(&admin, &make_config(&env, signers));

    let ev = BytesN::from_array(&env, &evidence());
    let claim_id = client.submit_insurance_claim(&claimant, &token, &500i128, &ev, &1100u64);

    let res = client.try_vote_on_insurance_claim(&claimant, &claim_id, &true);
    assert_eq!(res.err(), Some(Ok(VaultError::ClaimSelfVote)));
}

// Test 4: Majority approval resolves claim as approved
#[test]
fn test_majority_approval() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let claimant = Address::generate(&env);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let tc = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    tc.mint(&contract_id, &50_000);
    tc.mint(&claimant, &5_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(voter1.clone());
    signers.push_back(voter2.clone());
    client.initialize(&admin, &make_config(&env, signers));

    // Add funds to pool
    client.set_insurance_config(&admin, &InsuranceConfig {
        enabled: false, min_amount: 0, min_insurance_bps: 100, slash_percentage: 10,
    });

    let ev = BytesN::from_array(&env, &evidence());
    let claim_id = client.submit_insurance_claim(&claimant, &token, &500i128, &ev, &1100u64);

    // Two voters approve — majority
    client.vote_on_insurance_claim(&voter1, &claim_id, &true);
    client.vote_on_insurance_claim(&voter2, &claim_id, &true);

    let claim = client.get_insurance_claim(&claim_id);
    assert_eq!(claim.status, types::InsuranceClaimStatus::Approved);
}

// Test 5: Majority rejection resolves claim as rejected and slashes bond
#[test]
fn test_majority_rejection_slashes_bond() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let claimant = Address::generate(&env);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&claimant, &5_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(voter1.clone());
    signers.push_back(voter2.clone());
    signers.push_back(voter3.clone());
    client.initialize(&admin, &make_config(&env, signers));

    let ev = BytesN::from_array(&env, &evidence());
    let claim_id = client.submit_insurance_claim(&claimant, &token, &500i128, &ev, &1100u64);

    // 3 reject, 0 approve
    client.vote_on_insurance_claim(&voter1, &claim_id, &false);
    client.vote_on_insurance_claim(&voter2, &claim_id, &false);
    client.vote_on_insurance_claim(&voter3, &claim_id, &false);

    let claim = client.get_insurance_claim(&claim_id);
    assert_eq!(claim.status, types::InsuranceClaimStatus::Rejected);
    assert!(claim.bond_settled);
}

// Test 6: Double voting is blocked
#[test]
fn test_double_vote_blocked() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let claimant = Address::generate(&env);
    let voter = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&claimant, &5_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(voter.clone());
    client.initialize(&admin, &make_config(&env, signers));

    let ev = BytesN::from_array(&env, &evidence());
    let claim_id = client.submit_insurance_claim(&claimant, &token, &500i128, &ev, &1100u64);

    client.vote_on_insurance_claim(&voter, &claim_id, &true);

    let res = client.try_vote_on_insurance_claim(&voter, &claim_id, &true);
    assert_eq!(res.err(), Some(Ok(VaultError::ClaimAlreadyVoted)));
}

// Test 7: Non-signer cannot vote
#[test]
fn test_non_signer_cannot_vote() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let claimant = Address::generate(&env);
    let outsider = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&claimant, &5_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(&env, signers));

    let ev = BytesN::from_array(&env, &evidence());
    let claim_id = client.submit_insurance_claim(&claimant, &token, &500i128, &ev, &1100u64);

    let res = client.try_vote_on_insurance_claim(&outsider, &claim_id, &true);
    assert_eq!(res.err(), Some(Ok(VaultError::Unauthorized)));
}

// Test 8: Tie — claim remains pending until deadline
#[test]
fn test_tie_claim_pending() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let claimant = Address::generate(&env);
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&claimant, &5_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(voter1.clone());
    signers.push_back(voter2.clone());
    client.initialize(&admin, &make_config(&env, signers));

    let ev = BytesN::from_array(&env, &evidence());
    let claim_id = client.submit_insurance_claim(&claimant, &token, &500i128, &ev, &1100u64);

    // 1 approve, 1 reject — tie, no majority
    client.vote_on_insurance_claim(&voter1, &claim_id, &true);
    client.vote_on_insurance_claim(&voter2, &claim_id, &false);

    let claim = client.get_insurance_claim(&claim_id);
    assert_eq!(claim.status, types::InsuranceClaimStatus::Pending, "Tie should leave claim pending");
}
