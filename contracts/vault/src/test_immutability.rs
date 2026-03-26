use super::*;
use soroban_sdk::{Env, testutils::Address as _};

#[test]
fn test_cannot_add_tag_to_approved_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    let config = InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig { limit: 100, window: 3600 },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig { enabled: false, max_retries: 0, initial_backoff_ledgers: 0 },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &treasurer,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Approve to make immutable
    client.approve_proposal(&treasurer, &proposal_id);

    // Try to add tag - should fail
    let result = client.try_add_proposal_tag(&treasurer, &proposal_id, &Symbol::new(&env, "ops"));
    assert_eq!(result.err(), Some(Ok(VaultError::ProposalImmutable)));
}

#[test]
fn test_cannot_set_metadata_on_approved_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    let config = InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig { limit: 100, window: 3600 },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig { enabled: false, max_retries: 0, initial_backoff_ledgers: 0 },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &treasurer,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Approve to make immutable
    client.approve_proposal(&treasurer, &proposal_id);

    // Try to set metadata - should fail
    let result = client.try_set_proposal_metadata(
        &treasurer,
        &proposal_id,
        &Symbol::new(&env, "key"),
        &String::from_str(&env, "value"),
    );
    assert_eq!(result.err(), Some(Ok(VaultError::ProposalImmutable)));
}

#[test]
fn test_cannot_add_attachment_to_approved_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    let config = InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig { limit: 100, window: 3600 },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig { enabled: false, max_retries: 0, initial_backoff_ledgers: 0 },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &treasurer,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Approve to make immutable
    client.approve_proposal(&treasurer, &proposal_id);

    // Try to add attachment - should fail
    let valid_cid = String::from_str(&env, "QmNRz73aEft8TiwC1D3dY2eFzL2bH4k6j7m8n9p0q1r2s3t4u5v6w7x8y9z0");
    let result = client.try_add_attachment(&treasurer, &proposal_id, &valid_cid);
    assert_eq!(result.err(), Some(Ok(VaultError::ProposalImmutable)));
}

#[test]
fn test_cannot_remove_tag_from_approved_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    let config = InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig { limit: 100, window: 3600 },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig { enabled: false, max_retries: 0, initial_backoff_ledgers: 0 },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &treasurer,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Add tag first
    client.add_proposal_tag(&treasurer, &proposal_id, &Symbol::new(&env, "ops"));

    // Approve to make immutable
    client.approve_proposal(&treasurer, &proposal_id);

    // Try to remove tag - should fail
    let result = client.try_remove_proposal_tag(&treasurer, &proposal_id, &Symbol::new(&env, "ops"));
    assert_eq!(result.err(), Some(Ok(VaultError::ProposalImmutable)));
}
