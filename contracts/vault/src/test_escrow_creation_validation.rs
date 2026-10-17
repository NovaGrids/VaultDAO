use super::*;
use crate::types::{
    InitConfig, Milestone, RecoveryConfig, RetryConfig, StakingConfig, VelocityConfig,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

fn milestone(id: u64, percentage: u32) -> Milestone {
    Milestone {
        id,
        percentage,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    }
}

fn setup(env: &Env) -> (VaultDAOClient<'static>, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);

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
            threshold_strategy: crate::types::ThresholdStrategy::Fixed,
            default_voting_deadline: 0,
            veto_addresses: Vec::new(env),
            retry_config: RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: RecoveryConfig::default(env),
            staking_config: StakingConfig::default(),
            proposal_id_prefix: 0,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            quorum_percentage: 0,
        },
    );

    (client, admin)
}

/// Registers a token and marks it supported, returning its address.
fn supported_token(env: &Env, client: &VaultDAOClient<'static>, admin: &Address) -> Address {
    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    client.add_supported_token(admin, &token, &100_000, &1_000_000);
    token
}

#[test]
fn test_create_escrow_rejects_unsupported_token() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let token_admin = Address::generate(&env);
    let unsupported = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &unsupported).mint(&admin, &10_000);

    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    let mut milestones = Vec::new(&env);
    milestones.push_back(milestone(1, 100));

    let result = client.try_create_escrow(
        &admin,
        &recipient,
        &unsupported,
        &5_000,
        &milestones,
        &1_000,
        &arbitrator,
    );
    assert_eq!(result, Err(Ok(VaultError::TokenNotSupported)));
}

#[test]
fn test_create_escrow_rejects_zero_duration() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let token = supported_token(&env, &client, &admin);
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&admin, &10_000);

    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    let mut milestones = Vec::new(&env);
    milestones.push_back(milestone(1, 100));

    let result = client.try_create_escrow(
        &admin,
        &recipient,
        &token,
        &5_000,
        &milestones,
        &0,
        &arbitrator,
    );
    assert_eq!(result, Err(Ok(VaultError::InvalidAmount)));
}

#[test]
fn test_create_escrow_rejects_recipient_equal_to_funder() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let token = supported_token(&env, &client, &admin);
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&admin, &10_000);

    let arbitrator = Address::generate(&env);
    let mut milestones = Vec::new(&env);
    milestones.push_back(milestone(1, 100));

    let result = client.try_create_escrow(
        &admin,
        &admin,
        &token,
        &5_000,
        &milestones,
        &1_000,
        &arbitrator,
    );
    assert_eq!(result, Err(Ok(VaultError::InvalidAmount)));
}

#[test]
fn test_create_escrow_rejects_duplicate_milestone_ids() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let token = supported_token(&env, &client, &admin);
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&admin, &10_000);

    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    let mut milestones = Vec::new(&env);
    milestones.push_back(milestone(7, 50));
    milestones.push_back(milestone(7, 50));

    let result = client.try_create_escrow(
        &admin,
        &recipient,
        &token,
        &5_000,
        &milestones,
        &1_000,
        &arbitrator,
    );
    assert_eq!(result, Err(Ok(VaultError::InvalidAmount)));
}

#[test]
fn test_create_escrow_rejects_zero_milestone_id() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let token = supported_token(&env, &client, &admin);
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&admin, &10_000);

    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    let mut milestones = Vec::new(&env);
    milestones.push_back(milestone(0, 100));

    let result = client.try_create_escrow(
        &admin,
        &recipient,
        &token,
        &5_000,
        &milestones,
        &1_000,
        &arbitrator,
    );
    assert_eq!(result, Err(Ok(VaultError::InvalidAmount)));
}

#[test]
fn test_create_escrow_rejects_too_many_milestones() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let token = supported_token(&env, &client, &admin);
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&admin, &10_000);

    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    let mut milestones = Vec::new(&env);
    for id in 1..=(MAX_ESCROW_MILESTONES as u64 + 1) {
        milestones.push_back(milestone(id, 1));
    }

    let result = client.try_create_escrow(
        &admin,
        &recipient,
        &token,
        &5_000,
        &milestones,
        &1_000,
        &arbitrator,
    );
    assert_eq!(result, Err(Ok(VaultError::InvalidAmount)));
}

#[test]
fn test_create_escrow_accepts_valid_parameters() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let token = supported_token(&env, &client, &admin);
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&admin, &10_000);

    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);
    let mut milestones = Vec::new(&env);
    milestones.push_back(milestone(1, 50));
    milestones.push_back(milestone(2, 50));

    let escrow_id = client.create_escrow(
        &admin,
        &recipient,
        &token,
        &5_000,
        &milestones,
        &1_000,
        &arbitrator,
    );
    assert_eq!(escrow_id, 1);
}
