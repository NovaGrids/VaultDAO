//! Tests for Issue #1431: Escrow Condition Release Voting
//!
//! The contract has no escrow release-voting entry points yet; these tests
//! pin the voting fields every new escrow starts with.
#![cfg(test)]

use super::*;
use crate::types::Milestone;
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

fn create_escrow(
    env: &Env,
    client: &VaultDAOClient,
    funder: &Address,
    token: &Address,
) -> (u64, Address) {
    StellarAssetClient::new(env, token).mint(funder, &100_000);
    let recipient = Address::generate(env);
    let mut milestones = Vec::new(env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    let escrow_id = client.create_escrow(
        funder,
        &recipient,
        token,
        &100_000i128,
        &milestones,
        &3600u64,
        &Address::generate(env),
    );
    (escrow_id, recipient)
}

#[test]
fn test_escrow_created_with_voting_disabled_and_zero_votes() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, _, _) = setup(&env);
    let (escrow_id, _) = create_escrow(&env, &client, &admin, &token);

    let escrow = client.get_escrow_info(&escrow_id);
    assert!(!escrow.requires_signer_approval);
    assert_eq!(escrow.approval_votes, 0);
    assert_eq!(escrow.rejection_votes, 0);
}

#[test]
fn test_escrow_fields_populated() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, _, _) = setup(&env);
    let (escrow_id, recipient) = create_escrow(&env, &client, &admin, &token);

    let escrow = client.get_escrow_info(&escrow_id);
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

    let result = client.try_get_escrow_info(&999u64);
    assert!(result.is_err());
}
