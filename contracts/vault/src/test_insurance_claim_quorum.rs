//! Tests for Issue #1355: Insurance Claim Governance Voting with Quorum
//!
//! Covers the safeguards layered on top of the plain majority check from #1075:
//! per-claim voting configuration, quorum as a percentage of signers, explicit
//! closing of the voting period (no auto-execute), and voting window boundaries.
#![cfg(test)]

use super::*;
use crate::types::{
    InsuranceClaimStatus, InsuranceVotingConfig, RetryConfig, ThresholdStrategy, VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    BytesN, Env, Vec,
};

const START_LEDGER: u32 = 100;

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
        staking_config: types::StakingConfig::default(),
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
    }
}

/// Vault with `signer_count` signers plus a claimant who is *not* a signer,
/// so every signer is an eligible voter.
///
/// Returns (client, admin, signers, claimant, token).
fn setup(
    env: &Env,
    signer_count: u32,
) -> (VaultDAOClient<'_>, Address, Vec<Address>, Address, Address) {
    env.mock_all_auths();
    env.ledger().set_sequence_number(START_LEDGER);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let claimant = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let tc = soroban_sdk::token::StellarAssetClient::new(env, &token);
    tc.mint(&contract_id, &1_000_000);
    tc.mint(&claimant, &100_000);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    for _ in 1..signer_count {
        signers.push_back(Address::generate(env));
    }

    client.initialize(&admin, &make_config(env, signers.clone()));

    (client, admin, signers, claimant, token)
}

fn evidence(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0xabu8; 32])
}

// ============================================================================
// Per-claim voting configuration
// ============================================================================

#[test]
fn test_claim_snapshots_default_voting_config() {
    let env = Env::default();
    let (client, _admin, _signers, claimant, token) = setup(&env, 4);

    let deadline = START_LEDGER as u64 + 1_000;
    let claim_id =
        client.submit_insurance_claim(&claimant, &token, &1_000i128, &evidence(&env), &deadline);

    let claim = client.get_insurance_claim(&claim_id);
    let defaults = InsuranceVotingConfig::default();
    assert_eq!(
        claim.approval_threshold_bps,
        defaults.approval_threshold_bps
    );
    assert_eq!(claim.quorum_bps, defaults.quorum_bps);
    assert_eq!(claim.voting_window, defaults.voting_window);
    // Claimant is not a signer, so all 4 signers are eligible.
    assert_eq!(claim.eligible_voters, 4);
    assert_eq!(claim.voter_count, 0);
    assert!(!claim.voting_closed);
}

#[test]
fn test_large_claim_escalates_quorum_and_window() {
    let env = Env::default();
    let (client, admin, _signers, claimant, token) = setup(&env, 4);

    client.set_insurance_voting_config(
        &admin,
        &InsuranceVotingConfig {
            approval_threshold_bps: 5_000,
            quorum_bps: 5_000,
            voting_window: 720,
            large_claim_threshold: 10_000,
            large_approval_threshold_bps: 6_667,
            large_claim_quorum_bps: 7_500,
            large_claim_voting_window: 5_000,
        },
    );

    // Below the large-claim threshold: ordinary parameters.
    let small = client.submit_insurance_claim(
        &claimant,
        &token,
        &9_999i128,
        &evidence(&env),
        &(START_LEDGER as u64 + 800),
    );
    let small_claim = client.get_insurance_claim(&small);
    assert_eq!(small_claim.quorum_bps, 5_000);
    assert_eq!(small_claim.voting_window, 720);

    // At the threshold: escalated parameters.
    let large = client.submit_insurance_claim(
        &claimant,
        &token,
        &10_000i128,
        &evidence(&env),
        &(START_LEDGER as u64 + 6_000),
    );
    let large_claim = client.get_insurance_claim(&large);
    assert_eq!(large_claim.quorum_bps, 7_500);
    assert_eq!(large_claim.approval_threshold_bps, 6_667);
    assert_eq!(large_claim.voting_window, 5_000);
}

#[test]
fn test_large_claim_rejects_short_voting_window() {
    let env = Env::default();
    let (client, admin, _signers, claimant, token) = setup(&env, 4);

    client.set_insurance_voting_config(
        &admin,
        &InsuranceVotingConfig {
            approval_threshold_bps: 5_000,
            quorum_bps: 5_000,
            voting_window: 720,
            large_claim_threshold: 10_000,
            large_approval_threshold_bps: 6_667,
            large_claim_quorum_bps: 7_500,
            large_claim_voting_window: 5_000,
        },
    );

    // A window that is fine for a small claim is too short for a large one.
    let res = client.try_submit_insurance_claim(
        &claimant,
        &token,
        &10_000i128,
        &evidence(&env),
        &(START_LEDGER as u64 + 800),
    );
    assert_eq!(
        res.err(),
        Some(Ok(VaultError::ClaimVoteDeadlineTooShort)),
        "large claims must get the longer deliberation window"
    );
}

#[test]
fn test_in_flight_claim_keeps_its_original_rules() {
    let env = Env::default();
    let (client, admin, _signers, claimant, token) = setup(&env, 4);

    let claim_id = client.submit_insurance_claim(
        &claimant,
        &token,
        &1_000i128,
        &evidence(&env),
        &(START_LEDGER as u64 + 1_000),
    );

    // Tighten the rules after submission.
    client.set_insurance_voting_config(
        &admin,
        &InsuranceVotingConfig {
            approval_threshold_bps: 9_000,
            quorum_bps: 10_000,
            voting_window: 50_000,
            large_claim_threshold: 0,
            large_approval_threshold_bps: 6_667,
            large_claim_quorum_bps: 7_500,
            large_claim_voting_window: 17_280,
        },
    );

    let claim = client.get_insurance_claim(&claim_id);
    assert_eq!(
        claim.quorum_bps, 5_000,
        "config change must not move the goalposts"
    );
    assert_eq!(claim.approval_threshold_bps, 5_000);
}

#[test]
fn test_set_voting_config_admin_only() {
    let env = Env::default();
    let (client, _admin, signers, _claimant, _token) = setup(&env, 3);

    let non_admin = signers.get(1).unwrap();
    let res = client.try_set_insurance_voting_config(&non_admin, &InsuranceVotingConfig::default());
    assert_eq!(res.err(), Some(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_set_voting_config_rejects_out_of_range_bps() {
    let env = Env::default();
    let (client, admin, _signers, _claimant, _token) = setup(&env, 3);

    let cfg = InsuranceVotingConfig {
        quorum_bps: 10_001,
        ..InsuranceVotingConfig::default()
    };
    let res = client.try_set_insurance_voting_config(&admin, &cfg);
    assert_eq!(res.err(), Some(Ok(VaultError::InvalidAmount)));
}

// ============================================================================
// Quorum enforcement
// ============================================================================

#[test]
fn test_quorum_calculation_rounds_up() {
    let env = Env::default();
    let (client, _admin, _signers, claimant, token) = setup(&env, 3);

    let claim_id = client.submit_insurance_claim(
        &claimant,
        &token,
        &1_000i128,
        &evidence(&env),
        &(START_LEDGER as u64 + 1_000),
    );

    // 50% of 3 signers rounds up to 2, not down to 1.
    let (voted, required, eligible) = client.get_insurance_claim_quorum(&claim_id);
    assert_eq!(voted, 0);
    assert_eq!(required, 2);
    assert_eq!(eligible, 3);
}

#[test]
fn test_below_quorum_expires_claim_and_slashes_bond() {
    let env = Env::default();
    let (client, admin, _signers, claimant, token) = setup(&env, 4);

    let deadline = START_LEDGER as u64 + 1_000;
    let claim_id =
        client.submit_insurance_claim(&claimant, &token, &1_000i128, &evidence(&env), &deadline);

    // Only 1 of 4 signers votes — quorum needs 2.
    client.vote_on_insurance_claim(&admin, &claim_id, &true);

    env.ledger().set_sequence_number(deadline as u32 + 1);
    let status = client.close_insurance_claim_voting(&admin, &claim_id);

    assert_eq!(
        status,
        InsuranceClaimStatus::Expired,
        "a lone approving voter must not be able to carry a claim"
    );

    let claim = client.get_insurance_claim(&claim_id);
    assert!(claim.voting_closed);
    assert!(claim.bond_settled);
    // 10% of the 100-stroop bond is retained by the pool.
    assert_eq!(client.get_insurance_pool_balance(&token), 10);
}

#[test]
fn test_quorum_met_approves_claim() {
    let env = Env::default();
    let (client, admin, signers, claimant, token) = setup(&env, 4);

    let deadline = START_LEDGER as u64 + 1_000;
    let claim_id =
        client.submit_insurance_claim(&claimant, &token, &1_000i128, &evidence(&env), &deadline);

    client.vote_on_insurance_claim(&admin, &claim_id, &true);
    client.vote_on_insurance_claim(&signers.get(1).unwrap(), &claim_id, &true);

    let (voted, required, _) = client.get_insurance_claim_quorum(&claim_id);
    assert!(voted >= required);

    env.ledger().set_sequence_number(deadline as u32 + 1);
    let status = client.close_insurance_claim_voting(&admin, &claim_id);
    assert_eq!(status, InsuranceClaimStatus::Approved);

    // Bond is returned in full on approval.
    let claim = client.get_insurance_claim(&claim_id);
    assert!(claim.bond_settled);
    assert_eq!(client.get_insurance_pool_balance(&token), 0);
}

#[test]
fn test_quorum_met_but_threshold_missed_rejects() {
    let env = Env::default();
    let (client, admin, signers, claimant, token) = setup(&env, 4);

    let deadline = START_LEDGER as u64 + 1_000;
    let claim_id =
        client.submit_insurance_claim(&claimant, &token, &1_000i128, &evidence(&env), &deadline);

    // 1 approve, 2 reject: quorum satisfied, approval threshold is not.
    client.vote_on_insurance_claim(&admin, &claim_id, &true);
    client.vote_on_insurance_claim(&signers.get(1).unwrap(), &claim_id, &false);
    client.vote_on_insurance_claim(&signers.get(2).unwrap(), &claim_id, &false);

    env.ledger().set_sequence_number(deadline as u32 + 1);
    assert_eq!(
        client.close_insurance_claim_voting(&admin, &claim_id),
        InsuranceClaimStatus::Rejected
    );
}

#[test]
fn test_tie_rejects_on_close() {
    let env = Env::default();
    let (client, admin, signers, claimant, token) = setup(&env, 4);

    let deadline = START_LEDGER as u64 + 1_000;
    let claim_id =
        client.submit_insurance_claim(&claimant, &token, &1_000i128, &evidence(&env), &deadline);

    client.vote_on_insurance_claim(&admin, &claim_id, &true);
    client.vote_on_insurance_claim(&signers.get(1).unwrap(), &claim_id, &false);

    env.ledger().set_sequence_number(deadline as u32 + 1);
    assert_eq!(
        client.close_insurance_claim_voting(&admin, &claim_id),
        InsuranceClaimStatus::Rejected,
        "an exact 50/50 split is not a majority"
    );
}

#[test]
fn test_claimant_excluded_from_eligible_voters() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(START_LEDGER);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let claimant = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let tc = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    tc.mint(&contract_id, &1_000_000);
    tc.mint(&claimant, &100_000);

    // Claimant *is* a signer here.
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(claimant.clone());
    signers.push_back(Address::generate(&env));
    client.initialize(&admin, &make_config(&env, signers));

    let claim_id = client.submit_insurance_claim(
        &claimant,
        &token,
        &1_000i128,
        &evidence(&env),
        &(START_LEDGER as u64 + 1_000),
    );

    let claim = client.get_insurance_claim(&claim_id);
    assert_eq!(
        claim.eligible_voters, 2,
        "the claimant cannot vote on their own claim, so they are not eligible"
    );
}

// ============================================================================
// Voting window boundaries and explicit close
// ============================================================================

#[test]
fn test_vote_on_deadline_ledger_is_accepted() {
    let env = Env::default();
    let (client, admin, _signers, claimant, token) = setup(&env, 4);

    let deadline = START_LEDGER as u64 + 1_000;
    let claim_id =
        client.submit_insurance_claim(&claimant, &token, &1_000i128, &evidence(&env), &deadline);

    // The deadline ledger itself is still inside the window.
    env.ledger().set_sequence_number(deadline as u32);
    client.vote_on_insurance_claim(&admin, &claim_id, &true);

    assert_eq!(client.get_insurance_claim(&claim_id).voter_count, 1);
}

#[test]
fn test_late_vote_is_rejected() {
    let env = Env::default();
    let (client, admin, _signers, claimant, token) = setup(&env, 4);

    let deadline = START_LEDGER as u64 + 1_000;
    let claim_id =
        client.submit_insurance_claim(&claimant, &token, &1_000i128, &evidence(&env), &deadline);

    env.ledger().set_sequence_number(deadline as u32 + 1);
    let res = client.try_vote_on_insurance_claim(&admin, &claim_id, &true);
    assert_eq!(res.err(), Some(Ok(VaultError::ClaimVotingWindowClosed)));

    // The claim is untouched — settlement is the close call's job, not a side
    // effect of a rejected vote.
    let claim = client.get_insurance_claim(&claim_id);
    assert_eq!(claim.status, InsuranceClaimStatus::Pending);
    assert!(!claim.bond_settled);
}

#[test]
fn test_majority_does_not_auto_execute() {
    let env = Env::default();
    let (client, admin, signers, claimant, token) = setup(&env, 4);

    let deadline = START_LEDGER as u64 + 1_000;
    let claim_id =
        client.submit_insurance_claim(&claimant, &token, &1_000i128, &evidence(&env), &deadline);

    client.vote_on_insurance_claim(&admin, &claim_id, &true);
    client.vote_on_insurance_claim(&signers.get(1).unwrap(), &claim_id, &true);
    client.vote_on_insurance_claim(&signers.get(2).unwrap(), &claim_id, &true);

    let claim = client.get_insurance_claim(&claim_id);
    assert_eq!(
        claim.status,
        InsuranceClaimStatus::Pending,
        "an early majority must not short-circuit the deliberation window"
    );
    assert!(!claim.bond_settled);
}

#[test]
fn test_cannot_close_while_window_open() {
    let env = Env::default();
    let (client, admin, signers, claimant, token) = setup(&env, 4);

    let deadline = START_LEDGER as u64 + 1_000;
    let claim_id =
        client.submit_insurance_claim(&claimant, &token, &1_000i128, &evidence(&env), &deadline);

    client.vote_on_insurance_claim(&admin, &claim_id, &true);
    client.vote_on_insurance_claim(&signers.get(1).unwrap(), &claim_id, &true);

    let res = client.try_close_insurance_claim_voting(&admin, &claim_id);
    assert_eq!(res.err(), Some(Ok(VaultError::ClaimVotingStillOpen)));
}

#[test]
fn test_close_early_once_every_signer_has_voted() {
    let env = Env::default();
    let (client, admin, signers, claimant, token) = setup(&env, 3);

    let deadline = START_LEDGER as u64 + 1_000;
    let claim_id =
        client.submit_insurance_claim(&claimant, &token, &1_000i128, &evidence(&env), &deadline);

    client.vote_on_insurance_claim(&admin, &claim_id, &true);
    client.vote_on_insurance_claim(&signers.get(1).unwrap(), &claim_id, &true);
    client.vote_on_insurance_claim(&signers.get(2).unwrap(), &claim_id, &false);

    // Window is still open, but there is nobody left to hear from.
    assert_eq!(
        client.close_insurance_claim_voting(&admin, &claim_id),
        InsuranceClaimStatus::Approved
    );
}

#[test]
fn test_cannot_close_twice() {
    let env = Env::default();
    let (client, admin, signers, claimant, token) = setup(&env, 4);

    let deadline = START_LEDGER as u64 + 1_000;
    let claim_id =
        client.submit_insurance_claim(&claimant, &token, &1_000i128, &evidence(&env), &deadline);

    client.vote_on_insurance_claim(&admin, &claim_id, &true);
    client.vote_on_insurance_claim(&signers.get(1).unwrap(), &claim_id, &true);

    env.ledger().set_sequence_number(deadline as u32 + 1);
    client.close_insurance_claim_voting(&admin, &claim_id);

    let res = client.try_close_insurance_claim_voting(&admin, &claim_id);
    assert_eq!(res.err(), Some(Ok(VaultError::ClaimNotPending)));
}

#[test]
fn test_cannot_vote_after_close() {
    let env = Env::default();
    let (client, admin, signers, claimant, token) = setup(&env, 4);

    let deadline = START_LEDGER as u64 + 1_000;
    let claim_id =
        client.submit_insurance_claim(&claimant, &token, &1_000i128, &evidence(&env), &deadline);

    client.vote_on_insurance_claim(&admin, &claim_id, &true);
    client.vote_on_insurance_claim(&signers.get(1).unwrap(), &claim_id, &true);

    env.ledger().set_sequence_number(deadline as u32 + 1);
    client.close_insurance_claim_voting(&admin, &claim_id);

    let res = client.try_vote_on_insurance_claim(&signers.get(2).unwrap(), &claim_id, &false);
    assert_eq!(res.err(), Some(Ok(VaultError::ClaimNotPending)));
}

#[test]
fn test_non_signer_cannot_close_voting() {
    let env = Env::default();
    let (client, _admin, _signers, claimant, token) = setup(&env, 4);

    let deadline = START_LEDGER as u64 + 1_000;
    let claim_id =
        client.submit_insurance_claim(&claimant, &token, &1_000i128, &evidence(&env), &deadline);

    env.ledger().set_sequence_number(deadline as u32 + 1);
    let outsider = Address::generate(&env);
    let res = client.try_close_insurance_claim_voting(&outsider, &claim_id);
    assert_eq!(res.err(), Some(Ok(VaultError::Unauthorized)));
}
