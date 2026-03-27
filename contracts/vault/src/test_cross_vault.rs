use super::*;
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Env, Vec};

fn init_vault<'a>(env: &Env, client: &VaultDAOClient<'a>, admin: &Address, threshold: u32) {
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    client.initialize(
        admin,
        &crate::types::InitConfig {
            signers,
            threshold,
            quorum: 0,
            quorum_percentage: 0,
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
        },
    );
}

#[test]
fn test_set_and_get_cross_vault_config() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    init_vault(&env, &client, &admin, 1);

    let coordinator = Address::generate(&env);
    let mut authorized = Vec::new(&env);
    authorized.push_back(coordinator.clone());

    let config = CrossVaultConfig {
        enabled: true,
        authorized_coordinators: authorized,
        max_action_amount: 10_000,
        max_actions: 5,
    };

    client.set_cross_vault_config(&admin, &config);

    let stored = client.get_cross_vault_config().unwrap();
    assert!(stored.enabled);
    assert_eq!(stored.max_action_amount, 10_000);
    assert!(stored.authorized_coordinators.contains(&coordinator));
}

#[test]
fn test_propose_cross_vault_creates_proposal_and_cv_record() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator_id = env.register(VaultDAO, ());
    let coordinator = VaultDAOClient::new(&env, &coordinator_id);

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    init_vault(&env, &coordinator, &admin, 1);
    coordinator.set_role(&admin, &admin, &Role::Treasurer);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&coordinator_id, &10_000);

    let participant_id = env.register(VaultDAO, ());

    let mut actions = Vec::new(&env);
    actions.push_back(VaultAction {
        vault_address: participant_id.clone(),
        recipient: recipient.clone(),
        token: token.clone(),
        amount: 500,
        memo: Symbol::new(&env, "test"),
    });

    let proposal_id = coordinator.propose_cross_vault(
        &admin,
        &actions,
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    let proposal = coordinator.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending);
    assert_eq!(proposal.amount, 500);

    let cv = coordinator.get_cross_vault_proposal(&proposal_id).unwrap();
    assert_eq!(cv.status, CrossVaultStatus::Pending);
    assert_eq!(cv.actions.len(), 1);
}

#[test]
fn test_execute_cross_vault_success() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator_id = env.register(VaultDAO, ());
    let participant_id = env.register(VaultDAO, ());
    let coordinator = VaultDAOClient::new(&env, &coordinator_id);
    let participant = VaultDAOClient::new(&env, &participant_id);

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);

    init_vault(&env, &coordinator, &admin, 1);
    init_vault(&env, &participant, &admin, 1);

    coordinator.set_role(&admin, &admin, &Role::Treasurer);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    // Fund the coordinator vault (it holds the tokens and transfers directly)
    StellarAssetClient::new(&env, &token).mint(&coordinator_id, &10_000);

    // Configure participant to trust coordinator
    let mut authorized = Vec::new(&env);
    authorized.push_back(coordinator_id.clone());
    participant.set_cross_vault_config(
        &admin,
        &CrossVaultConfig {
            enabled: true,
            authorized_coordinators: authorized,
            max_action_amount: 10_000,
            max_actions: 5,
        },
    );

    let mut actions = Vec::new(&env);
    actions.push_back(VaultAction {
        vault_address: participant_id.clone(),
        recipient: recipient.clone(),
        token: token.clone(),
        amount: 500,
        memo: Symbol::new(&env, "pay"),
    });

    let proposal_id = coordinator.propose_cross_vault(
        &admin,
        &actions,
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    coordinator.approve_proposal(&admin, &proposal_id);

    let proposal = coordinator.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);

    coordinator.execute_cross_vault(&admin, &proposal_id);

    let cv = coordinator.get_cross_vault_proposal(&proposal_id).unwrap();
    assert_eq!(cv.status, CrossVaultStatus::Executed);
    assert_eq!(cv.execution_results.len(), 1);
    assert!(cv.execution_results.get(0).unwrap());

    let token_client = soroban_sdk::token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&recipient), 500);
}

#[test]
fn test_execute_cross_vault_unauthorized_target_records_failure() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator_id = env.register(VaultDAO, ());
    let participant_id = env.register(VaultDAO, ());
    let coordinator = VaultDAOClient::new(&env, &coordinator_id);
    let participant = VaultDAOClient::new(&env, &participant_id);

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);

    init_vault(&env, &coordinator, &admin, 1);
    init_vault(&env, &participant, &admin, 1);
    coordinator.set_role(&admin, &admin, &Role::Treasurer);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&coordinator_id, &10_000);

    // Participant does NOT authorize coordinator
    participant.set_cross_vault_config(
        &admin,
        &CrossVaultConfig {
            enabled: true,
            authorized_coordinators: Vec::new(&env),
            max_action_amount: 10_000,
            max_actions: 5,
        },
    );

    let mut actions = Vec::new(&env);
    actions.push_back(VaultAction {
        vault_address: participant_id.clone(),
        recipient: recipient.clone(),
        token: token.clone(),
        amount: 500,
        memo: Symbol::new(&env, "pay"),
    });

    let proposal_id = coordinator.propose_cross_vault(
        &admin,
        &actions,
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    coordinator.approve_proposal(&admin, &proposal_id);
    coordinator.execute_cross_vault(&admin, &proposal_id);

    let cv = coordinator.get_cross_vault_proposal(&proposal_id).unwrap();
    assert_eq!(cv.status, CrossVaultStatus::Failed);
    assert!(!cv.execution_results.get(0).unwrap());
}

#[test]
fn test_execute_cross_vault_requires_approved_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let coordinator_id = env.register(VaultDAO, ());
    let coordinator = VaultDAOClient::new(&env, &coordinator_id);
    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);

    init_vault(&env, &coordinator, &admin, 1);
    coordinator.set_role(&admin, &admin, &Role::Treasurer);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let participant_id = env.register(VaultDAO, ());
    let mut actions = Vec::new(&env);
    actions.push_back(VaultAction {
        vault_address: participant_id.clone(),
        recipient: recipient.clone(),
        token: token.clone(),
        amount: 100,
        memo: Symbol::new(&env, "x"),
    });

    let proposal_id = coordinator.propose_cross_vault(
        &admin,
        &actions,
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Not approved yet — should fail
    let result = coordinator.try_execute_cross_vault(&admin, &proposal_id);
    assert!(result.is_err());
}
