use crate::types::{
    RetryConfig, SubscriptionStatus, SubscriptionTier, ThresholdStrategy, VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::Address as _,
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};

fn setup_with_usage_tracking(env: &Env) -> (VaultDAOClient<'_>, Address, Address) {
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
            auto_topup_amount: 0,
            tier_usage_tracking: true,
        },
    );

    (client, admin, token)
}

#[test]
fn test_tier_usage_tracking_enabled() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_usage_tracking(&env);

    let tracking_enabled = client.is_tier_usage_tracking_enabled();
    assert!(tracking_enabled, "Tier usage tracking should be enabled");
}

#[test]
fn test_subscription_usage_tracking_starts_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_usage_tracking(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    StellarAssetClient::new(&env, &token).mint(&subscriber, &1000);

    let sub_id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &true,
        &0u64,
    );

    let usage = client.get_subscription_usage(&subscriber, &sub_id);
    let proposals_created = usage
        .get(&Symbol::new(&env, "proposals_created"))
        .unwrap_or(0);
    assert_eq!(proposals_created, 0, "Initial usage should be 0");
}

#[test]
fn test_basic_tier_has_proposal_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_usage_tracking(&env);

    let limit = client.get_tier_limit(
        &SubscriptionTier::Basic,
        &Symbol::new(&env, "proposals_created"),
    );
    assert_eq!(limit, 10, "Basic tier should have 10 proposals/month limit");
}

#[test]
fn test_standard_tier_has_proposal_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_usage_tracking(&env);

    let limit = client.get_tier_limit(
        &SubscriptionTier::Standard,
        &Symbol::new(&env, "proposals_created"),
    );
    assert_eq!(limit, 25, "Standard tier should have 25 proposals/month limit");
}

#[test]
fn test_premium_tier_has_proposal_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_usage_tracking(&env);

    let limit = client.get_tier_limit(
        &SubscriptionTier::Premium,
        &Symbol::new(&env, "proposals_created"),
    );
    assert_eq!(limit, 50, "Premium tier should have 50 proposals/month limit");
}

#[test]
fn test_enterprise_tier_unlimited() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token) = setup_with_usage_tracking(&env);

    let limit = client.get_tier_limit(
        &SubscriptionTier::Enterprise,
        &Symbol::new(&env, "proposals_created"),
    );
    assert_eq!(limit, i128::MAX, "Enterprise tier should have unlimited limit");
}

#[test]
fn test_different_usage_metrics_tracked() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_usage_tracking(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    StellarAssetClient::new(&env, &token).mint(&subscriber, &1000);

    let sub_id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Premium,
        &token,
        &100i128,
        &1000u64,
        &true,
        &0u64,
    );

    client.record_subscription_usage(
        &subscriber,
        &sub_id,
        &Symbol::new(&env, "signers_managed"),
        &1i128,
    );

    client.record_subscription_usage(
        &subscriber,
        &sub_id,
        &Symbol::new(&env, "recurring_payments"),
        &3i128,
    );

    let usage = client.get_subscription_usage(&subscriber, &sub_id);
    let signers = usage
        .get(&Symbol::new(&env, "signers_managed"))
        .unwrap_or(0);
    let payments = usage
        .get(&Symbol::new(&env, "recurring_payments"))
        .unwrap_or(0);

    assert_eq!(signers, 1);
    assert_eq!(payments, 3);
}

#[test]
fn test_usage_accumulates_across_calls() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_usage_tracking(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    StellarAssetClient::new(&env, &token).mint(&subscriber, &1000);

    let sub_id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Standard,
        &token,
        &100i128,
        &1000u64,
        &true,
        &0u64,
    );

    for _i in 0..5 {
        client.record_subscription_usage(
            &subscriber,
            &sub_id,
            &Symbol::new(&env, "proposals_created"),
            &1i128,
        );
    }

    let usage = client.get_subscription_usage(&subscriber, &sub_id);
    let count = usage
        .get(&Symbol::new(&env, "proposals_created"))
        .unwrap_or(0);
    assert_eq!(count, 5, "Should accumulate 5 proposals");
}

#[test]
fn test_different_subscriptions_have_independent_usage() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup_with_usage_tracking(&env);
    let subscriber = Address::generate(&env);
    let provider1 = Address::generate(&env);
    let provider2 = Address::generate(&env);

    StellarAssetClient::new(&env, &token).mint(&subscriber, &2000);

    let sub_id1 = client.create_subscription(
        &subscriber,
        &provider1,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &true,
        &0u64,
    );

    let sub_id2 = client.create_subscription(
        &subscriber,
        &provider2,
        &SubscriptionTier::Premium,
        &token,
        &100i128,
        &1000u64,
        &true,
        &0u64,
    );

    client.record_subscription_usage(
        &subscriber,
        &sub_id1,
        &Symbol::new(&env, "proposals_created"),
        &3i128,
    );

    client.record_subscription_usage(
        &subscriber,
        &sub_id2,
        &Symbol::new(&env, "proposals_created"),
        &7i128,
    );

    let usage1 = client.get_subscription_usage(&subscriber, &sub_id1);
    let usage2 = client.get_subscription_usage(&subscriber, &sub_id2);

    let count1 = usage1
        .get(&Symbol::new(&env, "proposals_created"))
        .unwrap_or(0);
    let count2 = usage2
        .get(&Symbol::new(&env, "proposals_created"))
        .unwrap_or(0);

    assert_eq!(count1, 3);
    assert_eq!(count2, 7);
}
