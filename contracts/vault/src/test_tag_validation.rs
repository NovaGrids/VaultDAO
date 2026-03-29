use super::*;
use soroban_sdk::{Env, Symbol};

#[test]
fn test_validate_tag_valid_short() {
    let env = Env::default();
    let tag = Symbol::new(&env, "valid");
    let result = validate_tag(&tag);
    assert!(result.is_ok());
}

#[test]
fn test_validate_tag_valid_max_len() {
    let env = Env::default();
    let max_tag = "a".repeat(MAX_TAG_LEN as usize);
    let tag = Symbol::new(&env, &max_tag);
    let result = validate_tag(&tag);
    assert!(result.is_ok());
}

#[test]
fn test_validate_tag_empty_invalid() {
    let env = Env::default();
    let tag = Symbol::new(&env, "");
    let result = validate_tag(&tag);
    assert_eq!(result, Err(VaultError::TagInvalid));
}

#[test]
fn test_validate_tag_too_long_invalid() {
    let env = Env::default();
    let long_tag = "a".repeat((MAX_TAG_LEN + 1) as usize);
    let tag = Symbol::new(&env, &long_tag);
    let result = validate_tag(&tag);
    assert_eq!(result, Err(VaultError::TagInvalid));
}

#[test]
fn test_validate_tag_invalid_chars() {
    let env = Env::default();
    let invalid_tags = ["@invalid", "space tag", "123@"];
    for tag_str in invalid_tags {
        let tag = Symbol::new(&env, tag_str);
        let result = validate_tag(&tag);
        assert_eq!(result, Err(VaultError::TagInvalid));
    }
}

#[test]
fn test_validate_tag_valid_hyphen_underscore() {
    let env = Env::default();
    let valid_tags = ["valid-tag", "VALID_TAG", "mixed-CASE"];
    for tag_str in valid_tags {
        let tag = Symbol::new(&env, tag_str);
        let normalized = validate_tag(&tag).unwrap();
        let lowered = Symbol::new(&env, tag_str.to_lowercase().as_str());
        assert_eq!(normalized, lowered);
    }
}

#[test]
fn test_add_proposal_tag_case_insensitive_dup() {
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

    // Add "ops" tag (lowercase)
    client.add_proposal_tag(&treasurer, &proposal_id, &Symbol::new(&env, "ops"));

    // Try adding "OPS" (uppercase) - should fail case-insensitive dup check
    let result = client.try_add_proposal_tag(&treasurer, &proposal_id, &Symbol::new(&env, "OPS"));
    assert_eq!(result.err(), Some(Ok(VaultError::DuplicateTag)));

    // Verify tags still has only one entry (normalized lowercase)
    let tags = client.get_proposal_tags(&proposal_id);
    assert_eq!(tags.len(), 1);
    assert_eq!(tags.get(0).unwrap(), Symbol::new(&env, "ops"));
}
