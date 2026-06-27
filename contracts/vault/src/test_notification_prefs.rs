use super::*;
use crate::types::{RetryConfig, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Env, Symbol, Vec};

fn setup(env: &Env) -> (VaultDAOClient, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let user = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(user.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig { limit: 100, window: 3600, per_token_limit: 0 },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        retry_config: RetryConfig { enabled: false, max_retries: 0, initial_backoff_ledgers: 0 },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
    };
    client.initialize(&admin, &config);
    (client, admin, user)
}

#[test]
fn test_set_and_get_notification_prefs() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, user) = setup(&env);

    let prefs = NotificationPreferences {
        notify_on_proposal: true,
        notify_on_approval: false,
        notify_on_execution: true,
        notify_on_rejection: false,
        notify_on_expiry: true,
    };

    client.set_notification_preferences(&user, &prefs);
    let retrieved = client.get_notification_preferences(&user);

    assert_eq!(retrieved.notify_on_proposal, true);
    assert_eq!(retrieved.notify_on_approval, false);
    assert_eq!(retrieved.notify_on_execution, true);
    assert_eq!(retrieved.notify_on_rejection, false);
    assert_eq!(retrieved.notify_on_expiry, true);
}

#[test]
fn test_get_default_notification_prefs() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, user) = setup(&env);

    // Never set — should return defaults
    let prefs = client.get_notification_preferences(&user);
    assert_eq!(prefs.notify_on_proposal, true);
    assert_eq!(prefs.notify_on_approval, true);
    assert_eq!(prefs.notify_on_execution, true);
    assert_eq!(prefs.notify_on_rejection, true);
    assert_eq!(prefs.notify_on_expiry, false);
}

#[test]
fn test_update_specific_field() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, user) = setup(&env);

    // Set initial prefs
    let prefs = NotificationPreferences {
        notify_on_proposal: true,
        notify_on_approval: true,
        notify_on_execution: true,
        notify_on_rejection: true,
        notify_on_expiry: false,
    };
    client.set_notification_preferences(&user, &prefs);

    // Update only expiry
    let updated = NotificationPreferences {
        notify_on_proposal: true,
        notify_on_approval: true,
        notify_on_execution: true,
        notify_on_rejection: true,
        notify_on_expiry: true,
    };
    client.set_notification_preferences(&user, &updated);

    let retrieved = client.get_notification_preferences(&user);
    assert_eq!(retrieved.notify_on_expiry, true);
}

#[test]
fn test_get_addresses_subscribed_to_execution() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, user) = setup(&env);

    // admin has default prefs (notify_on_execution = true)
    // user disables execution notifications
    let user_prefs = NotificationPreferences {
        notify_on_proposal: true,
        notify_on_approval: true,
        notify_on_execution: false,
        notify_on_rejection: true,
        notify_on_expiry: false,
    };
    client.set_notification_preferences(&user, &user_prefs);

    let subscribers = client.get_addresses_subscribed_to(&Symbol::new(&env, "execution"));
    // admin has default prefs (execution = true), user disabled it
    assert!(subscribers.contains(admin.clone()));
    assert!(!subscribers.contains(user.clone()));
}

#[test]
fn test_get_addresses_subscribed_to_capped_at_100() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig { limit: 200, window: 3600, per_token_limit: 0 },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig { enabled: false, max_retries: 0, initial_backoff_ledgers: 0 },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: crate::types::StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
    };
    client.initialize(&admin, &config);

    // Add 110 addresses to role index with execution notifications enabled
    for _ in 0..110u32 {
        let addr = Address::generate(&env);
        storage::add_role_index_address(&env, &addr);
        // default prefs have notify_on_execution = true
    }

    let subscribers = client.get_addresses_subscribed_to(&Symbol::new(&env, "execution"));
    assert!(subscribers.len() <= 100);
}
