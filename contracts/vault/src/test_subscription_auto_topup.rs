use crate::types::{
    RetryConfig, SubscriptionStatus, SubscriptionTier, ThresholdStrategy, VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::Address as _,
    token::StellarAssetClient,
    Address, Env, Vec,
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
            threshold: 1,
            quorum: 0,
            default_voting_deadline: 0,
            spending_limit: 1_000_000,
            daily_limit: 5_000_000,
            weekly_limit: 10_000_000,
            timelock_threshold: 999_999,
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
            auto_topup_amount: 1000,
            tier_usage_tracking: false,
        },
    );

    (client, admin, token)
}

#[test]
fn test_create_subscription_with_auto_topup_source() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);
    let topup_source = Address::generate(&env);

    StellarAssetClient::new(&env, &token).mint(&subscriber, &1000);
    StellarAssetClient::new(&env, &token).mint(&topup_source, &5000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &true,
        &0u64,
    );

    let sub = client.get_subscription(&id);
    assert_eq!(sub.auto_topup_amount, 0, "Default auto_topup_amount should be 0");
}

#[test]
fn test_subscription_auto_topup_field_exists() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    StellarAssetClient::new(&env, &token).mint(&subscriber, &1000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &true,
        &0u64,
    );

    let sub = client.get_subscription(&id);
    assert_eq!(sub.auto_topup_source, None);
    assert_eq!(sub.auto_topup_amount, 0);
}

#[test]
fn test_auto_topup_with_zero_amount_is_disabled() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    StellarAssetClient::new(&env, &token).mint(&subscriber, &1000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &true,
        &0u64,
    );

    let sub = client.get_subscription(&id);
    assert!(sub.auto_topup_source.is_none());
}

#[test]
fn test_subscription_with_multiple_providers() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider1 = Address::generate(&env);
    let provider2 = Address::generate(&env);

    StellarAssetClient::new(&env, &token).mint(&subscriber, &2000);

    let id1 = client.create_subscription(
        &subscriber,
        &provider1,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &true,
        &0u64,
    );

    let id2 = client.create_subscription(
        &subscriber,
        &provider2,
        &SubscriptionTier::Premium,
        &token,
        &200i128,
        &1000u64,
        &true,
        &0u64,
    );

    let sub1 = client.get_subscription(&id1);
    let sub2 = client.get_subscription(&id2);

    assert_eq!(sub1.tier, SubscriptionTier::Basic);
    assert_eq!(sub2.tier, SubscriptionTier::Premium);
}
