use super::*;
use crate::types::{RetryConfig, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Env, Vec};

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let user = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(user.clone());

    let config = InitConfig {
        veto_window_ledgers: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
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

    assert!(retrieved.notify_on_proposal);
    assert!(!retrieved.notify_on_approval);
    assert!(retrieved.notify_on_execution);
    assert!(!retrieved.notify_on_rejection);
    assert!(retrieved.notify_on_expiry);
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
    assert!(retrieved.notify_on_expiry);
}
