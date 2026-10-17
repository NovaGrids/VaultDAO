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
        &0u64,
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
        &0u64,
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
        &0u64,
    );
    assert_eq!(res, Err(Ok(VaultError::IntervalTooShort)));
}

// ============================================================================
// renew_subscription
// ============================================================================

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
        &0u64,
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
        &0u64,
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
        &0u64,
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
        &0u64,
    );

    client.cancel_subscription(&admin, &id);

    let sub = client.get_subscription(&id);
    assert_eq!(sub.status, SubscriptionStatus::Cancelled);
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
        &0u64,
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
        &0u64,
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
        &0u64,
    );

    client.cancel_subscription(&subscriber, &id);
    let res =
        client.try_upgrade_subscription(&subscriber, &id, &SubscriptionTier::Premium, &300i128);
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
        &0u64,
    );

    let res = client.try_upgrade_subscription(&other, &id, &SubscriptionTier::Premium, &300i128);
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
        &0u64,
    );

    let res =
        client.try_upgrade_subscription(&subscriber, &id, &SubscriptionTier::Enterprise, &0i128);
    assert_eq!(res, Err(Ok(VaultError::InvalidAmount)));
}

// ============================================================================
// auto_renew by third party
// ============================================================================

// ============================================================================
// get_subscription / get_subscriptions_by_subscriber
// ============================================================================

#[test]
fn test_get_nonexistent_subscription_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, _token) = setup(&env);
    let res = client.try_get_subscription(&999u64);
    assert_eq!(res.err(), Some(Ok(VaultError::SubscriptionNotFound)));
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
        &0u64,
    );
    let id2 = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Standard,
        &token,
        &200i128,
        &1000u64,
        &false,
        &0u64,
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
        &0u64,
    );
    let id2 = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Premium,
        &token,
        &300i128,
        &2000u64,
        &false,
        &0u64,
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

// ============================================================================
// Event verification
// ============================================================================

// ============================================================================
// Status transitions
// ============================================================================

#[test]
fn test_status_transitions_create_cancel() {
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
        &0u64,
    );

    // After creation: Active
    assert_eq!(
        client.get_subscription(&id).status,
        SubscriptionStatus::Active
    );

    // After cancel: Cancelled
    client.cancel_subscription(&subscriber, &id);
    assert_eq!(
        client.get_subscription(&id).status,
        SubscriptionStatus::Cancelled
    );
}

#[test]
fn test_upgrade_preserves_active_status() {
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
        &0u64,
    );

    client.upgrade_subscription(&subscriber, &id, &SubscriptionTier::Premium, &300i128);

    let sub = client.get_subscription(&id);
    assert_eq!(sub.status, SubscriptionStatus::Active);
    assert_eq!(sub.tier, SubscriptionTier::Premium);
    assert_eq!(sub.amount_per_period, 300);
}

#[test]
fn test_auto_renew_flag_stored_correctly() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 10_000);

    let id_auto = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &true,
        &0u64,
    );
    let id_manual = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &false,
        &0u64,
    );

    assert!(client.get_subscription(&id_auto).auto_renew);
    assert!(!client.get_subscription(&id_manual).auto_renew);
}

#[test]
fn test_renew_at_exact_renewal_ledger_succeeds() {
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
        &0u64,
    );

    // Advance exactly to next_renewal_ledger
    let sub = client.get_subscription(&id);
    let advance = sub.next_renewal_ledger - env.ledger().sequence() as u64;
    env.ledger()
        .with_mut(|l| l.sequence_number += advance as u32);

    // Should succeed at the exact boundary
    client.renew_subscription(&subscriber, &id);
    assert_eq!(client.get_subscription(&id).total_payments, 2);
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
        &0u64,
    );
    client.create_subscription(
        &sub_b,
        &provider,
        &SubscriptionTier::Standard,
        &token,
        &200i128,
        &1000u64,
        &false,
        &0u64,
    );
    client.create_subscription(
        &sub_a,
        &provider,
        &SubscriptionTier::Enterprise,
        &token,
        &500i128,
        &1000u64,
        &false,
        &0u64,
    );

    let ids_a = client.get_subscriptions_by_subscriber(&sub_a);
    let ids_b = client.get_subscriptions_by_subscriber(&sub_b);

    assert_eq!(ids_a.len(), 2);
    assert_eq!(ids_b.len(), 1);
}

// ============================================================================
// Grace Period Tests (#898)
// ============================================================================

#[test]
fn test_renew_on_time_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 10_000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &500u64,
        &true,
        &200u64, // grace period
    );

    let sub = client.get_subscription(&id);
    let advance = sub.next_renewal_ledger - env.ledger().sequence() as u64;
    env.ledger()
        .with_mut(|l| l.sequence_number += advance as u32);

    client.renew_subscription(&subscriber, &id);
    assert_eq!(client.get_subscription(&id).total_payments, 2);
}

#[test]
fn test_renew_within_grace_period_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 10_000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &500u64,
        &true,
        &200u64, // 200-ledger grace period
    );

    let sub = client.get_subscription(&id);
    // Advance to next_renewal_ledger + 100 (inside grace period)
    let advance = sub.next_renewal_ledger + 100 - env.ledger().sequence() as u64;
    env.ledger()
        .with_mut(|l| l.sequence_number += advance as u32);

    client.renew_subscription(&subscriber, &id);
    assert_eq!(client.get_subscription(&id).total_payments, 2);
    assert_eq!(
        client.get_subscription(&id).status,
        SubscriptionStatus::Active
    );
}

#[test]
fn test_expire_overdue_subscriptions_batch() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 100_000);

    // Create two subscriptions with short grace periods
    let id1 = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &500u64,
        &false,
        &50u64,
    );
    let id2 = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Standard,
        &token,
        &200i128,
        &500u64,
        &false,
        &50u64,
    );

    let sub1 = client.get_subscription(&id1);
    // Advance past both grace deadlines
    let advance = sub1.next_renewal_ledger + 51 - env.ledger().sequence() as u64;
    env.ledger()
        .with_mut(|l| l.sequence_number += advance as u32);

    let expired = client.expire_overdue_subscriptions(&subscriber, &1u64, &100u32);
    assert_eq!(expired.expired_count, 2);

    assert_eq!(
        client.get_subscription(&id1).status,
        SubscriptionStatus::Expired
    );
    assert_eq!(
        client.get_subscription(&id2).status,
        SubscriptionStatus::Expired
    );
}

#[test]
fn test_reactivate_expired_subscription() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 100_000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &500u64,
        &true,
        &50u64,
    );

    let sub = client.get_subscription(&id);
    // Expire it
    let advance = sub.next_renewal_ledger + 51 - env.ledger().sequence() as u64;
    env.ledger()
        .with_mut(|l| l.sequence_number += advance as u32);
    client.expire_overdue_subscriptions(&subscriber, &1u64, &100u32);
    assert_eq!(
        client.get_subscription(&id).status,
        SubscriptionStatus::Expired
    );

    // Reactivate
    client.reactivate_subscription(&subscriber, &id);
    let reactivated = client.get_subscription(&id);
    assert_eq!(reactivated.status, SubscriptionStatus::Active);
    assert!(reactivated.auto_renew);
    assert_eq!(reactivated.total_payments, 2);
}

#[test]
fn test_renew_after_grace_period_persists_expiry() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 100_000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &500u64,
        &false,
        &50u64,
    );

    let sub = client.get_subscription(&id);
    let advance = sub.next_renewal_ledger + 51 - env.ledger().sequence() as u64;
    env.ledger()
        .with_mut(|l| l.sequence_number += advance as u32);

    // Renewal after the grace period expires the subscription and returns Ok.
    client.renew_subscription(&subscriber, &id);

    let expired = client.get_subscription(&id);
    assert_eq!(expired.status, SubscriptionStatus::Expired);
    assert!(!client.get_subscription(&id).auto_renew);
    assert_eq!(expired.total_payments, 1);
}

// ============================================================================
// upgrade_subscription proration
// ============================================================================

/// Creates a Basic subscription (100 per 1000 ledgers), advances `elapsed`
/// ledgers, upgrades to Premium (300), and returns the amount the provider
/// received from the upgrade (on top of the initial 100 payment).
fn upgrade_charge_after(elapsed: u32) -> i128 {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 10_000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &false,
        &0u64,
    );

    let token_client = soroban_sdk::token::Client::new(&env, &token);
    let before = token_client.balance(&provider);

    env.ledger()
        .with_mut(|l| l.sequence_number += elapsed);
    client.upgrade_subscription(&subscriber, &id, &SubscriptionTier::Premium, &300i128);

    token_client.balance(&provider) - before
}

#[test]
fn test_upgrade_prorates_charge_at_start_of_period() {
    // 200 difference for the full 1000-ledger period.
    assert_eq!(upgrade_charge_after(0), 200);
}

#[test]
fn test_upgrade_prorates_charge_in_middle_of_period() {
    // 200 difference, half the period remaining.
    assert_eq!(upgrade_charge_after(500), 100);
}

#[test]
fn test_upgrade_prorates_charge_near_end_of_period() {
    // 200 difference, 100 of 1000 ledgers remaining.
    assert_eq!(upgrade_charge_after(900), 20);
}

#[test]
fn test_downgrade_via_upgrade_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 10_000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Premium,
        &token,
        &300i128,
        &1000u64,
        &false,
        &0u64,
    );

    let res = client.try_upgrade_subscription(&subscriber, &id, &SubscriptionTier::Basic, &100i128);
    assert_eq!(res, Err(Ok(VaultError::InvalidSubscriptionChange)));

    let same = client.try_upgrade_subscription(&subscriber, &id, &SubscriptionTier::Premium, &300i128);
    assert_eq!(same, Err(Ok(VaultError::InvalidSubscriptionChange)));
}

#[test]
fn test_reactivate_preserves_manual_renew_setting() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);
    let other = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 100_000);

    let id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &500u64,
        &false,
        &50u64,
    );

    let sub = client.get_subscription(&id);
    let advance = sub.next_renewal_ledger + 51 - env.ledger().sequence() as u64;
    env.ledger()
        .with_mut(|l| l.sequence_number += advance as u32);
    client.expire_overdue_subscriptions(&subscriber, &1u64, &100u32);

    client.reactivate_subscription(&subscriber, &id);
    let reactivated = client.get_subscription(&id);
    assert_eq!(reactivated.status, SubscriptionStatus::Active);
    assert!(!reactivated.auto_renew);

    // A third party must still not be able to trigger a charge.
    let res = client.try_renew_subscription(&other, &id);
    assert_eq!(res, Err(Ok(VaultError::NotSubscriberOrAdmin)));
}

#[test]
fn test_expire_overdue_paginates_and_handles_mixed_statuses() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, _token_admin, token) = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    fund_subscriber(&env, &token, &subscriber, 100_000);

    // Ids 1, 2, 3 and 5 are short-interval; id 4 is long-interval and not overdue.
    let short = |env_client: &VaultDAOClient<'_>| {
        env_client.create_subscription(
            &subscriber,
            &provider,
            &SubscriptionTier::Basic,
            &token,
            &100i128,
            &500u64,
            &false,
            &50u64,
        )
    };
    let active_overdue = short(&client); // 1
    let paused_overdue = short(&client); // 2
    let cancelled = short(&client); // 3
    let long = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &10_000u64,
        &false,
        &50u64,
    ); // 4
    let active_overdue_2 = short(&client); // 5

    client.pause_subscription(&subscriber, &paused_overdue);
    client.cancel_subscription(&subscriber, &cancelled);

    env.ledger().with_mut(|l| l.sequence_number += 560);

    // Two pages of at most two IDs each: [1,3), [3,5), [5,6).
    let mut cursor = 1u64;
    let mut total = 0u32;
    let mut pages = 0u32;
    loop {
        let batch: ExpiryBatch = client.expire_overdue_subscriptions(&subscriber, &cursor, &2u32);
        total += batch.expired_count;
        pages += 1;
        if batch.done {
            break;
        }
        cursor = batch.next_cursor;
    }

    assert_eq!(pages, 3);
    assert_eq!(total, 3);
    assert_eq!(
        client.get_subscription(&active_overdue).status,
        SubscriptionStatus::Expired
    );
    assert_eq!(
        client.get_subscription(&paused_overdue).status,
        SubscriptionStatus::Expired
    );
    assert_eq!(
        client.get_subscription(&active_overdue_2).status,
        SubscriptionStatus::Expired
    );
    assert_eq!(
        client.get_subscription(&cancelled).status,
        SubscriptionStatus::Cancelled
    );
    assert_eq!(
        client.get_subscription(&long).status,
        SubscriptionStatus::Active
    );
}
