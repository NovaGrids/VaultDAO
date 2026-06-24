use super::*;
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Env, Vec};

fn init_vault(env: &Env, client: &VaultDAOClient<'_>, admin: &Address, threshold: u32) {
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
                window: 3600, per_token_limit: 0 },
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
        proposal_id_prefix: 0,
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

#[test]
fn test_bridge_to_vault_success() {
    let env = Env::default();
    env.mock_all_auths();

    let source_vault_id = env.register(VaultDAO, ());
    let target_vault_id = env.register(VaultDAO, ());
    let source_client = VaultDAOClient::new(&env, &source_vault_id);
    let target_client = VaultDAOClient::new(&env, &target_vault_id);
    let admin = Address::generate(&env);

    init_vault(&env, &source_client, &admin, 1);
    init_vault(&env, &target_client, &admin, 1);
    source_client.set_role(&admin, &admin, &Role::Treasurer);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&source_vault_id, &1000);

    let current_ledger = env.ledger().sequence();
    let deadline_ledger = current_ledger + 1000;

    let bridge_id = source_client.bridge_to_vault(
        &admin,
        &target_vault_id,
        &token,
        &100,
        &95,
        &(deadline_ledger as u64),
    );

    // Check target vault balance
    let token_client = soroban_sdk::token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&target_vault_id), 100);

    // Check bridge record
    let bridge_record = source_client.get_bridge_record(&bridge_id).unwrap();
    assert_eq!(bridge_record.status, crate::types::BridgeStatus::Initiated);
    assert_eq!(bridge_record.amount, 100);
    assert_eq!(bridge_record.min_received, 95);
}

#[test]
fn test_confirm_bridge_receipt_success() {
    let env = Env::default();
    env.mock_all_auths();

    let source_vault_id = env.register(VaultDAO, ());
    let target_vault_id = env.register(VaultDAO, ());
    let source_client = VaultDAOClient::new(&env, &source_vault_id);
    let target_client = VaultDAOClient::new(&env, &target_vault_id);
    let admin = Address::generate(&env);

    init_vault(&env, &source_client, &admin, 1);
    init_vault(&env, &target_client, &admin, 1);
    source_client.set_role(&admin, &admin, &Role::Treasurer);
    target_client.set_role(&admin, &admin, &Role::Treasurer);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&source_vault_id, &1000);

    let current_ledger = env.ledger().sequence();
    let deadline_ledger = current_ledger + 1000;

    let bridge_id = source_client.bridge_to_vault(
        &admin,
        &target_vault_id,
        &token,
        &100,
        &95,
        &(deadline_ledger as u64),
    );

    // Confirm receipt
    target_client.confirm_bridge_receipt(&admin, &bridge_id, &98);

    // Check bridge record
    let bridge_record = source_client.get_bridge_record(&bridge_id).unwrap();
    assert_eq!(bridge_record.status, crate::types::BridgeStatus::Confirmed);
    assert_eq!(bridge_record.actual_amount, 98);
}

#[test]
fn test_bridge_slippage_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let source_vault_id = env.register(VaultDAO, ());
    let target_vault_id = env.register(VaultDAO, ());
    let source_client = VaultDAOClient::new(&env, &source_vault_id);
    let target_client = VaultDAOClient::new(&env, &target_vault_id);
    let admin = Address::generate(&env);

    init_vault(&env, &source_client, &admin, 1);
    init_vault(&env, &target_client, &admin, 1);
    source_client.set_role(&admin, &admin, &Role::Treasurer);
    target_client.set_role(&admin, &admin, &Role::Treasurer);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&source_vault_id, &1000);

    let current_ledger = env.ledger().sequence();
    let deadline_ledger = current_ledger + 1000;

    let bridge_id = source_client.bridge_to_vault(
        &admin,
        &target_vault_id,
        &token,
        &100,
        &95,
        &(deadline_ledger as u64),
    );

    // Confirm receipt with too little amount
    let result = target_client.try_confirm_bridge_receipt(&admin, &bridge_id, &90);
    assert_eq!(result, Err(Ok(VaultError::BridgeSlippageExceeded)));

    // Check funds were returned
    let token_client = soroban_sdk::token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&source_vault_id), 1000);

    // Check bridge record
    let bridge_record = source_client.get_bridge_record(&bridge_id).unwrap();
    assert_eq!(bridge_record.status, crate::types::BridgeStatus::Rejected);
}

#[test]
fn test_bridge_deadline_exceeded() {
    let env = Env::default();
    env.mock_all_auths();

    let source_vault_id = env.register(VaultDAO, ());
    let target_vault_id = env.register(VaultDAO, ());
    let source_client = VaultDAOClient::new(&env, &source_vault_id);
    let target_client = VaultDAOClient::new(&env, &target_vault_id);
    let admin = Address::generate(&env);

    init_vault(&env, &source_client, &admin, 1);
    init_vault(&env, &target_client, &admin, 1);
    source_client.set_role(&admin, &admin, &Role::Treasurer);
    target_client.set_role(&admin, &admin, &Role::Treasurer);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&source_vault_id, &1000);

    let current_ledger = env.ledger().sequence();
    let deadline_ledger = current_ledger + 10;

    let bridge_id = source_client.bridge_to_vault(
        &admin,
        &target_vault_id,
        &token,
        &100,
        &95,
        &(deadline_ledger as u64),
    );

    // Advance ledger past deadline
    env.ledger().set_sequence(deadline_ledger + 1);

    // Try to confirm receipt
    let result = target_client.try_confirm_bridge_receipt(&admin, &bridge_id, &98);
    assert_eq!(result, Err(Ok(VaultError::BridgeDeadlineExceeded)));

    // Check funds were returned
    let token_client = soroban_sdk::token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&source_vault_id), 1000);

    // Check bridge record
    let bridge_record = source_client.get_bridge_record(&bridge_id).unwrap();
    assert_eq!(bridge_record.status, crate::types::BridgeStatus::Returned);
}

#[test]
fn test_bridge_amount_exceeds_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let source_vault_id = env.register(VaultDAO, ());
    let target_vault_id = env.register(VaultDAO, ());
    let source_client = VaultDAOClient::new(&env, &source_vault_id);
    let admin = Address::generate(&env);

    init_vault(&env, &source_client, &admin, 1);
    source_client.set_role(&admin, &admin, &Role::Treasurer);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&source_vault_id, &200000);

    let current_ledger = env.ledger().sequence();
    let deadline_ledger = current_ledger + 1000;

    // Try to bridge more than spending limit (which is 100_000)
    let result = source_client.try_bridge_to_vault(
        &admin,
        &target_vault_id,
        &token,
        &150000,
        &140000,
        &(deadline_ledger as u64),
    );
    assert_eq!(result, Err(Ok(VaultError::BridgeAmountExceedsLimit)));
}

#[test]
fn test_bridge_invalid_min_received() {
    let env = Env::default();
    env.mock_all_auths();

    let source_vault_id = env.register(VaultDAO, ());
    let target_vault_id = env.register(VaultDAO, ());
    let source_client = VaultDAOClient::new(&env, &source_vault_id);
    let admin = Address::generate(&env);

    init_vault(&env, &source_client, &admin, 1);
    source_client.set_role(&admin, &admin, &Role::Treasurer);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&source_vault_id, &1000);

    let current_ledger = env.ledger().sequence();
    let deadline_ledger = current_ledger + 1000;

    // Try to bridge with min_received > amount
    let result = source_client.try_bridge_to_vault(
        &admin,
        &target_vault_id,
        &token,
        &100,
        &101,
        &(deadline_ledger as u64),
    );
    assert_eq!(result, Err(Ok(VaultError::InvalidAmount)));
}

#[test]
fn test_bridge_invalid_deadline() {
    let env = Env::default();
    env.mock_all_auths();

    let source_vault_id = env.register(VaultDAO, ());
    let target_vault_id = env.register(VaultDAO, ());
    let source_client = VaultDAOClient::new(&env, &source_vault_id);
    let admin = Address::generate(&env);

    init_vault(&env, &source_client, &admin, 1);
    source_client.set_role(&admin, &admin, &Role::Treasurer);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&source_vault_id, &1000);

    let current_ledger = env.ledger().sequence();

    // Try to bridge with deadline <= current ledger
    let result = source_client.try_bridge_to_vault(
        &admin,
        &target_vault_id,
        &token,
        &100,
        &95,
        &(current_ledger as u64),
    );
    assert_eq!(result, Err(Ok(VaultError::BridgeDeadlineExceeded)));
}
