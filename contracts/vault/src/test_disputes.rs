use super::*;
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Env, Vec};

fn setup(env: &Env) -> (VaultDAOClient<'static>, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    client.initialize(
        &admin,
        &crate::types::InitConfig {
            signers,
            threshold: 1,
            quorum: 0,
            spending_limit: 100_000,
            daily_limit: 500_000,
            weekly_limit: 1_000_000,
            timelock_threshold: 0,
            timelock_delay: 0,
            velocity_limit: crate::types::VelocityConfig {
                limit: 1_000_000,
                window: 3600,
            },
            threshold_strategy: crate::types::ThresholdStrategy::Fixed,
            default_voting_deadline: 0,
            veto_addresses: Vec::new(env),
            retry_config: crate::types::RetryConfig {
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(env),
            staking_config: crate::types::StakingConfig::default(),
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            quorum_percentage: 0,
        },
    );

    (client, admin, contract_id)
}

fn make_proposal(
    env: &Env,
    client: &VaultDAOClient,
    admin: &Address,
    token: &Address,
    recipient: &Address,
) -> u64 {
    client.set_role(admin, admin, &Role::Treasurer);
    client.propose_transfer(
        admin,
        recipient,
        token,
        &100i128,
        &Symbol::new(env, "memo"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    )
}

#[test]
fn test_raise_dispute_by_signer() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&contract_id, &10_000);
    let recipient = Address::generate(&env);

    let proposal_id = make_proposal(&env, &client, &admin, &token, &recipient);

    let dispute_id = client.raise_dispute(
        &admin,
        &proposal_id,
        &None,
        &Symbol::new(&env, "fraud"),
        &Vec::new(&env),
    );

    assert_eq!(dispute_id, 1);

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.proposal_id, proposal_id);
    assert_eq!(dispute.status, DisputeStatus::Filed);

    let ids = client.get_proposal_disputes(&proposal_id);
    assert_eq!(ids.len(), 1);
    assert_eq!(ids.get(0).unwrap(), dispute_id);
}

#[test]
fn test_raise_dispute_non_signer_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let recipient = Address::generate(&env);
    let outsider = Address::generate(&env);

    let proposal_id = make_proposal(&env, &client, &admin, &token, &recipient);

    let result = client.try_raise_dispute(
        &outsider,
        &proposal_id,
        &None,
        &Symbol::new(&env, "fraud"),
        &Vec::new(&env),
    );
    assert!(result.is_err());
}

#[test]
fn test_resolve_dispute_by_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let recipient = Address::generate(&env);

    let proposal_id = make_proposal(&env, &client, &admin, &token, &recipient);
    let dispute_id = client.raise_dispute(
        &admin,
        &proposal_id,
        &None,
        &Symbol::new(&env, "fraud"),
        &Vec::new(&env),
    );

    env.ledger().set_sequence_number(100);
    client.resolve_dispute(&admin, &dispute_id, &DisputeResolution::InFavorOfProposer);

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::Resolved);
    assert_eq!(dispute.resolution, DisputeResolution::InFavorOfProposer);
    assert_eq!(dispute.arbitrator, admin);
    assert!(dispute.resolved_at > 0);
}

#[test]
fn test_resolve_dispute_dismissed_outcome() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let recipient = Address::generate(&env);

    let proposal_id = make_proposal(&env, &client, &admin, &token, &recipient);
    let dispute_id = client.raise_dispute(
        &admin,
        &proposal_id,
        &None,
        &Symbol::new(&env, "invalid"),
        &Vec::new(&env),
    );

    client.resolve_dispute(&admin, &dispute_id, &DisputeResolution::Dismissed);

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::Dismissed);
}

#[test]
fn test_cannot_resolve_already_resolved_dispute() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let recipient = Address::generate(&env);

    let proposal_id = make_proposal(&env, &client, &admin, &token, &recipient);
    let dispute_id = client.raise_dispute(
        &admin,
        &proposal_id,
        &None,
        &Symbol::new(&env, "fraud"),
        &Vec::new(&env),
    );

    client.resolve_dispute(&admin, &dispute_id, &DisputeResolution::Compromise);

    let result =
        client.try_resolve_dispute(&admin, &dispute_id, &DisputeResolution::InFavorOfDisputer);
    assert!(result.is_err());
}

#[test]
fn test_raise_dispute_with_escrow_funder() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let funder = Address::generate(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&funder, &10_000);

    let proposal_id = make_proposal(&env, &client, &admin, &token, &recipient);

    let mut milestones = Vec::new(&env);
    milestones.push_back(crate::types::Milestone {
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client.create_escrow(
        &funder,
        &recipient,
        &token,
        &100i128,
        &milestones,
        &1000u64,
        &arbitrator,
    );

    let dispute_id = client.raise_dispute(
        &funder,
        &proposal_id,
        &Some(escrow_id),
        &Symbol::new(&env, "breach"),
        &Vec::new(&env),
    );

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.status, DisputeStatus::Filed);
    assert_eq!(dispute.proposal_id, proposal_id);
}

#[test]
fn test_raise_dispute_escrow_unauthorized_third_party() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let funder = Address::generate(&env);
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    let outsider = Address::generate(&env);

    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&funder, &10_000);

    let proposal_id = make_proposal(&env, &client, &admin, &token, &recipient);

    let mut milestones = Vec::new(&env);
    milestones.push_back(crate::types::Milestone {
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });

    let escrow_id = client.create_escrow(
        &funder,
        &recipient,
        &token,
        &100i128,
        &milestones,
        &1000u64,
        &arbitrator,
    );

    let result = client.try_raise_dispute(
        &outsider,
        &proposal_id,
        &Some(escrow_id),
        &Symbol::new(&env, "breach"),
        &Vec::new(&env),
    );
    assert!(result.is_err());
}
