use crate::errors::VaultError;
use crate::types::{
    RetryConfig, SubscriptionStatus, SubscriptionTier, ThresholdStrategy, VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Vec,
};

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address) {
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
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            veto_addresses: Vec::new(env),
            retry_config: RetryConfig {
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(env),
            staking_config: crate::types::StakingConfig::default(),
            quorum_percentage: 0,
        },
    );

    (client, admin, token_admin, token)
}

fn fund_subscriber(env: &Env, token: &Address, subscriber: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(subscriber, &amount);
}

// ============================================================================
// create_subscription
// ============================================================================

#[test]
fn test_create_subscription_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 1000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &true,
    );

    assert_eq!(id, 1);
    let sub = client.get_subscription(&id);
    assert_eq!(sub.status, SubscriptionStatus::Active);
    assert_eq!(sub.total_payments, 1);
    assert_eq!(sub.tier, SubscriptionTier::Basic);
    assert_eq!(sub.amount_per_period, 100);
    assert!(sub.auto_renew);
}

#[test]
fn test_create_subscription_zero_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    let res = client.try_create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &0i128,
        &1000u64,
        &false,
    );
    assert_eq!(res, Err(Ok(VaultError::InvalidAmount)));
}

#[test]
fn test_create_subscription_zero_interval_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 1000);

    let res = client.try_create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &0u64,
        &false,
    );
    assert_eq!(res, Err(Ok(VaultError::IntervalTooShort)));
}

// ============================================================================
// renew_subscription
// ============================================================================

#[test]
fn test_renew_subscription_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 1000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Standard,
        &token,
        &100i128,
        &500u64,
        &true,
    );

    env.ledger().with_mut(|l| l.sequence_number += 501);

    client.renew_subscription(&subscriber, &id);

    let sub = client.get_subscription(&id);
    assert_eq!(sub.total_payments, 2);
    // next_renewal_ledger advances by interval
    assert_eq!(sub.next_renewal_ledger, sub.last_payment_ledger + 500);
}

#[test]
fn test_renew_before_renewal_ledger_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 1000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &true,
    );

    // Do NOT advance ledger — renewal not due yet.
    let res = client.try_renew_subscription(&subscriber, &id);
    assert_eq!(res, Err(Ok(VaultError::RenewalNotDue)));
}

#[test]
fn test_renew_cancelled_subscription_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 1000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &500u64,
        &true,
    );

    client.cancel_subscription(&subscriber, &id);

    env.ledger().with_mut(|l| l.sequence_number += 501);
    let res = client.try_renew_subscription(&subscriber, &id);
    assert_eq!(res, Err(Ok(VaultError::SubscriptionAlreadyCancelled)));
}

// ============================================================================
// cancel_subscription
// ============================================================================

#[test]
fn test_cancel_subscription_by_subscriber() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 1000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &false,
    );

    client.cancel_subscription(&subscriber, &id);

    let sub = client.get_subscription(&id);
    assert_eq!(sub.status, SubscriptionStatus::Cancelled);
}

#[test]
fn test_cancel_subscription_by_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 1000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &false,
    );

    client.cancel_subscription(&admin, &id);

    let sub = client.get_subscription(&id);
    assert_eq!(sub.status, SubscriptionStatus::Cancelled);
}

#[test]
fn test_cancel_by_non_subscriber_non_admin_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);
    let rando = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 1000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &false,
    );

    let res = client.try_cancel_subscription(&rando, &id);
    assert_eq!(res, Err(Ok(VaultError::NotSubscriberOrAdmin)));
}

#[test]
fn test_cancel_already_cancelled_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 1000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &false,
    );

    client.cancel_subscription(&subscriber, &id);
    let res = client.try_cancel_subscription(&subscriber, &id);
    assert_eq!(res, Err(Ok(VaultError::SubscriptionAlreadyCancelled)));
}

// ============================================================================
// upgrade_subscription
// ============================================================================

#[test]
fn test_upgrade_subscription_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 1000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &false,
    );

    client.upgrade_subscription(&subscriber, &id, &SubscriptionTier::Premium, &300i128);

    let sub = client.get_subscription(&id);
    assert_eq!(sub.tier, SubscriptionTier::Premium);
    assert_eq!(sub.amount_per_period, 300);
    assert_eq!(sub.status, SubscriptionStatus::Active);
}

#[test]
fn test_upgrade_cancelled_subscription_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 1000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &false,
    );

    client.cancel_subscription(&subscriber, &id);
    let res = client.try_upgrade_subscription(
        &subscriber,
        &id,
        &SubscriptionTier::Premium,
        &300i128,
    );
    assert_eq!(res, Err(Ok(VaultError::SubscriptionNotActive)));
}

#[test]
fn test_upgrade_by_non_subscriber_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);
    let other = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 1000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &false,
    );

    let res =
        client.try_upgrade_subscription(&other, &id, &SubscriptionTier::Premium, &300i128);
    assert_eq!(res, Err(Ok(VaultError::NotSubscriberOrAdmin)));
}

#[test]
fn test_upgrade_zero_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 1000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &false,
    );

    let res =
        client.try_upgrade_subscription(&subscriber, &id, &SubscriptionTier::Enterprise, &0i128);
    assert_eq!(res, Err(Ok(VaultError::InvalidAmount)));
}

// ============================================================================
// auto_renew by third party
// ============================================================================

#[test]
fn test_auto_renew_by_third_party() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);
    let keeper = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 1000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &500u64,
        &true,
    );

    env.ledger().with_mut(|l| l.sequence_number += 501);

    client.renew_subscription(&keeper, &id);

    let sub = client.get_subscription(&id);
    assert_eq!(sub.total_payments, 2);
}

#[test]
fn test_manual_renew_by_third_party_fails_when_auto_renew_false() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);
    let keeper = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 1000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &500u64,
        &false,
    );

    env.ledger().with_mut(|l| l.sequence_number += 501);

    let res = client.try_renew_subscription(&keeper, &id);
    assert_eq!(res, Err(Ok(VaultError::NotSubscriberOrAdmin)));
}

// ============================================================================
// get_subscription / get_subscriptions_by_subscriber
// ============================================================================

#[test]
fn test_get_nonexistent_subscription_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, _token) = setup(&env);
    let res = client.try_get_subscription(&999u64);
    assert_eq!(res, Err(Ok(VaultError::SubscriptionNotFound)));
}

#[test]
fn test_subscription_ids_are_sequential() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 10_000);

    let id1 = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &false,
    );
    let id2 = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Standard,
        &token,
        &200i128,
        &1000u64,
        &false,
    );

    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
}

#[test]
fn test_get_subscriptions_by_subscriber() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 10_000);

    let id1 = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &false,
    );
    let id2 = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Premium,
        &token,
        &300i128,
        &2000u64,
        &false,
    );

    let ids = client.get_subscriptions_by_subscriber(&subscriber);
    assert_eq!(ids.len(), 2);
    assert_eq!(ids.get(0).unwrap(), id1);
    assert_eq!(ids.get(1).unwrap(), id2);
}

#[test]
fn test_get_subscriptions_by_subscriber_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, _token) = setup(&env);
    let stranger = Address::generate(&env);

    let ids = client.get_subscriptions_by_subscriber(&stranger);
    assert_eq!(ids.len(), 0);
}

#[test]
fn test_multiple_subscribers_independent_indexes() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let sub_a = Address::generate(&env);
    let sub_b = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &sub_a, 10_000);
    fund_subscriber(&env, &token, &sub_b, 10_000);

    client.create_subscription(
        &sub_a,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &false,
    );
    client.create_subscription(
        &sub_b,
        &provider,
        &SubscriptionTier::Standard,
        &token,
        &200i128,
        &1000u64,
        &false,
    );
    client.create_subscription(
        &sub_a,
        &provider,
        &SubscriptionTier::Enterprise,
        &token,
        &500i128,
        &1000u64,
        &false,
    );

    let ids_a = client.get_subscriptions_by_subscriber(&sub_a);
    let ids_b = client.get_subscriptions_by_subscriber(&sub_b);

    assert_eq!(ids_a.len(), 2);
    assert_eq!(ids_b.len(), 1);
}
