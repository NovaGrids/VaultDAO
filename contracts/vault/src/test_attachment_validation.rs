use super::*;
use soroban_sdk::{Env, String, testutils::Address as _};

#[test]
fn test_validate_strict_attachment_cid_valid_qm() {
    let env = Env::default();
    let valid_cid = String::from_str(&env, "QmNRz73aEft8TiwC1D3dY2eFzL2bH4k6j7m8n9p0q1r2s3t4u5v6w7x8y9z0");
    assert!(validate_strict_attachment_cid(&valid_cid).is_ok());
}

#[test]
fn test_validate_strict_attachment_cid_valid_qb() {
    let env = Env::default();
    let valid_cid = String::from_str(&env, "Qmb8T2xP4zL3k5j7m9n1p3q5r7s9t1u3v5w7x9y1z3a5b7c9d1e3f5g7h9i1");
    assert!(validate_strict_attachment_cid(&valid_cid).is_ok());
}

#[test]
fn test_validate_strict_attachment_cid_no_prefix_invalid() {
    let env = Env::default();
    let invalid_cid = String::from_str(&env, "abc123def456ghi789");
    let result = validate_strict_attachment_cid(&invalid_cid);
    assert_eq!(result, Err(VaultError::AttachmentCIDInvalid));
}

#[test]
fn test_validate_strict_attachment_cid_invalid_chars() {
    let env = Env::default();
    let invalid_cid = String::from_str(&env, "Qm@invalid!");
    let result = validate_strict_attachment_cid(&invalid_cid);
    assert_eq!(result, Err(VaultError::AttachmentCIDInvalid));
}

#[test]
fn test_add_attachment_valid_cid() {
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

    let valid_cid = String::from_str(&env, "QmNRz73aEft8TiwC1D3dY2eFzL2bH4k6j7m8n9p0q1r2s3t4u5v6w7x8y9z0");
    client.add_attachment(&treasurer, &proposal_id, &valid_cid);
}

#[test]
fn test_add_attachment_invalid_cid_rejected() {
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

    let invalid_cid = String::from_str(&env, "invalid_hash");
    let result = client.try_add_attachment(&treasurer, &proposal_id, &invalid_cid);
    assert_eq!(result.err(), Some(Ok(VaultError::AttachmentCIDInvalid)));
}
