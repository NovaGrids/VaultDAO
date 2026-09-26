//! Tests for escrow dispute arbitration (Issue #1432).
//!
//! The contract resolves disputes through a single `DisputeArbitrator` (or
//! Admin) via `resolve_escrow_dispute`; there is no M-of-N arbitrator panel.
//! Covered scenarios:
//!  1. Only the funder or an Admin can file a dispute
//!  2. Filing a dispute records the status and reason
//!  3. An arbitrator can release disputed funds to the recipient
//!  4. An arbitrator can refund disputed funds to the funder
//!  5. Addresses without the arbitrator role cannot resolve
//!  6. Only disputed escrows can be resolved

use crate::errors::VaultError;
use crate::types::{EscrowStatus, Milestone, RetryConfig, Role, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env, Symbol, Vec,
};

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address) {
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
            default_voting_deadline: 0,
            spending_limit: 100_000_000,
            daily_limit: 1_000_000_000,
            weekly_limit: 5_000_000_000,
            timelock_threshold: 900_000_000,
            timelock_delay: 100,
            velocity_limit: VelocityConfig {
                per_token_limit: 0,
                limit: 1_000_000_000,
                window: 3_600,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
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
            quorum_percentage: 0,
        },
    );

    // Fund admin
    StellarAssetClient::new(env, &token).mint(&admin, &1_000_000i128);

    (client, admin, token)
}

fn create_escrow(
    env: &Env,
    client: &VaultDAOClient,
    funder: &Address,
    token: &Address,
) -> (u64, Address) {
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
        &1_000i128,
        &milestones,
        &10_000u64,
        &Address::generate(env),
    );
    (escrow_id, recipient)
}

fn arbitrator(env: &Env, client: &VaultDAOClient, admin: &Address) -> Address {
    let arbitrator = Address::generate(env);
    client.set_role(admin, &arbitrator, &Role::DisputeArbitrator);
    arbitrator
}

#[test]
fn test_dispute_requires_authorization() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let (escrow_id, recipient) = create_escrow(&env, &client, &admin, &token);

    let reason = Symbol::new(&env, "quality_issue");
    assert_eq!(
        client.try_dispute_escrow(&Address::generate(&env), &escrow_id, &reason),
        Err(Ok(VaultError::Unauthorized))
    );
    assert_eq!(
        client.try_dispute_escrow(&recipient, &escrow_id, &reason),
        Err(Ok(VaultError::Unauthorized))
    );
}

#[test]
fn test_dispute_records_status_and_reason() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let (escrow_id, _) = create_escrow(&env, &client, &admin, &token);

    client.dispute_escrow(&admin, &escrow_id, &Symbol::new(&env, "non_delivery"));

    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Disputed);
    assert_eq!(escrow.dispute_reason, Symbol::new(&env, "non_delivery"));
}

#[test]
fn test_arbitrator_releases_to_recipient() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let (escrow_id, recipient) = create_escrow(&env, &client, &admin, &token);
    let arbitrator = arbitrator(&env, &client, &admin);

    client.dispute_escrow(&admin, &escrow_id, &Symbol::new(&env, "non_delivery"));
    client.resolve_escrow_dispute(&arbitrator, &escrow_id, &true);

    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Released);
    assert_eq!(escrow.released_amount, 1_000);
    assert_eq!(TokenClient::new(&env, &token).balance(&recipient), 1_000);
}

#[test]
fn test_arbitrator_refunds_funder() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let funder_before = TokenClient::new(&env, &token).balance(&admin);
    let (escrow_id, recipient) = create_escrow(&env, &client, &admin, &token);
    let arbitrator = arbitrator(&env, &client, &admin);

    client.dispute_escrow(&admin, &escrow_id, &Symbol::new(&env, "quality_issue"));
    client.resolve_escrow_dispute(&arbitrator, &escrow_id, &false);

    let escrow = client.get_escrow_info(&escrow_id);
    assert_eq!(escrow.status, EscrowStatus::Refunded);
    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&admin), funder_before);
    assert_eq!(token_client.balance(&recipient), 0);
}

#[test]
fn test_non_arbitrator_cannot_resolve() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let (escrow_id, _) = create_escrow(&env, &client, &admin, &token);

    client.dispute_escrow(&admin, &escrow_id, &Symbol::new(&env, "disagreement"));

    assert_eq!(
        client.try_resolve_escrow_dispute(&Address::generate(&env), &escrow_id, &true),
        Err(Ok(VaultError::Unauthorized))
    );
    assert_eq!(
        client.get_escrow_info(&escrow_id).status,
        EscrowStatus::Disputed
    );
}

#[test]
fn test_cannot_resolve_undisputed_escrow() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token) = setup(&env);
    let (escrow_id, _) = create_escrow(&env, &client, &admin, &token);
    let arbitrator = arbitrator(&env, &client, &admin);

    assert_eq!(
        client.try_resolve_escrow_dispute(&arbitrator, &escrow_id, &true),
        Err(Ok(VaultError::ProposalNotPending))
    );
}
