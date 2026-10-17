//! Tests for milestone completion authorization (escrow security fix).
//!
//! `complete_milestone` previously only checked `completer.require_auth()`, so any
//! address could complete every milestone of an escrow and trigger a release.
//!
//! Covered scenarios:
//!  1. A random address cannot complete a milestone
//!  2. The funder can complete a milestone
//!  3. The arbitrator can complete a milestone
//!  4. Completing the same milestone twice is rejected
//!  5. A successful completion writes an audit entry

use crate::errors::VaultError;
use crate::types::{
    AuditAction, EscrowStatus, InitConfig, Milestone, RetryConfig, ThresholdStrategy,
    VelocityConfig,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Vec};

pub(crate) fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);

    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(Address::generate(env));

    client.initialize(
        &admin,
        &InitConfig {
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
            velocity_limit: VelocityConfig {
                limit: 1_000_000,
                window: 3600,
                per_token_limit: 0,
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
            proposal_id_prefix: 0,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            quorum_percentage: 0,
            upgrade_timelock_delay: 17_280,
        },
    );

    StellarAssetClient::new(env, &token).mint(&admin, &5_000_000i128);
    (client, admin, token)
}

fn create_escrow_with_arbitrator(
    env: &Env,
    client: &VaultDAOClient,
    funder: &Address,
    recipient: &Address,
    arbitrator: &Address,
    token: &Address,
) -> u64 {
    let mut milestones = Vec::new(env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    client.create_escrow(
        funder,
        recipient,
        token,
        &2000i128,
        &milestones,
        &1000u64,
        arbitrator,
    )
}

#[test]
fn test_random_address_cannot_complete_milestone() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, funder, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    let escrow_id =
        create_escrow_with_arbitrator(&env, &client, &funder, &recipient, &arbitrator, &token);

    let stranger = Address::generate(&env);
    let res = client.try_complete_milestone(&stranger, &escrow_id, &1u64);
    assert_eq!(res, Err(Ok(VaultError::Unauthorized)));

    // The milestone must remain incomplete and the escrow must not be releasable
    let escrow = client.get_escrow_info(&escrow_id);
    assert!(!escrow.milestones.get(0).unwrap().is_completed);
    assert_eq!(escrow.status, EscrowStatus::Active);
}

#[test]
fn test_funder_can_complete_milestone() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, funder, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    let escrow_id =
        create_escrow_with_arbitrator(&env, &client, &funder, &recipient, &arbitrator, &token);

    client.complete_milestone(&funder, &escrow_id, &1u64);

    let escrow = client.get_escrow_info(&escrow_id);
    assert!(escrow.milestones.get(0).unwrap().is_completed);
    assert_eq!(escrow.status, EscrowStatus::MilestonesComplete);
}

#[test]
fn test_arbitrator_can_complete_milestone() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, funder, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    let escrow_id =
        create_escrow_with_arbitrator(&env, &client, &funder, &recipient, &arbitrator, &token);

    client.complete_milestone(&arbitrator, &escrow_id, &1u64);

    let escrow = client.get_escrow_info(&escrow_id);
    assert!(escrow.milestones.get(0).unwrap().is_completed);
    assert_eq!(escrow.status, EscrowStatus::MilestonesComplete);
}

#[test]
fn test_recipient_cannot_complete_own_milestone() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, funder, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    let escrow_id =
        create_escrow_with_arbitrator(&env, &client, &funder, &recipient, &arbitrator, &token);

    let res = client.try_complete_milestone(&recipient, &escrow_id, &1u64);
    assert_eq!(res, Err(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_duplicate_milestone_completion_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, funder, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    let escrow_id =
        create_escrow_with_arbitrator(&env, &client, &funder, &recipient, &arbitrator, &token);

    client.complete_milestone(&funder, &escrow_id, &1u64);

    let res = client.try_complete_milestone(&funder, &escrow_id, &1u64);
    assert_eq!(res, Err(Ok(VaultError::AlreadyApproved)));
}

#[test]
fn test_milestone_completion_writes_audit_entry() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, funder, token) = setup(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    let escrow_id =
        create_escrow_with_arbitrator(&env, &client, &funder, &recipient, &arbitrator, &token);

    let before = client.get_audit_entry_count();
    client.complete_milestone(&funder, &escrow_id, &1u64);
    let after = client.get_audit_entry_count();
    assert_eq!(after, before + 1);

    let entry = client.get_audit_entry(&after);
    assert_eq!(entry.action, AuditAction::MilestoneCompleted);
    assert_eq!(entry.actor, funder);
    assert_eq!(entry.target, escrow_id);
}
