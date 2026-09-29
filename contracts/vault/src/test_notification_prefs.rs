use super::*;
use crate::types::{RetryConfig, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Env, Symbol, Vec};

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
        threshold: 2,
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

// ---------------------------------------------------------------------------
// Issue #1741: threshold and quiet hours must be persisted, not hardcoded to 0
// ---------------------------------------------------------------------------

/// A v2 preference set that subscribes to proposals only, with the
/// threshold/quiet-hours values under test.
fn v2_prefs(threshold: i128, quiet_start: u32, quiet_end: u32) -> NotificationPreferencesV2 {
    NotificationPreferencesV2 {
        notify_on_proposal: true,
        notify_on_approval: false,
        notify_on_execution: false,
        notify_on_rejection: false,
        notify_on_expiry: false,
        min_amount_threshold: threshold,
        quiet_hours_start: quiet_start,
        quiet_hours_end: quiet_end,
    }
}

#[test]
fn test_set_notification_prefs_v2_persists_threshold_and_quiet_hours() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, user) = setup(&env);

    client.set_notification_preferences_v2(&user, &v2_prefs(1_000, 100, 200));

    let stored = client.get_notification_preferences_v2(&user);
    assert_eq!(stored.min_amount_threshold, 1_000);
    assert_eq!(stored.quiet_hours_start, 100);
    assert_eq!(stored.quiet_hours_end, 200);
    // Event-type flags are persisted alongside the new fields.
    assert!(stored.notify_on_proposal);
    assert!(!stored.notify_on_approval);
    assert!(!stored.notify_on_execution);
    assert!(!stored.notify_on_rejection);
    assert!(!stored.notify_on_expiry);
}

#[test]
fn test_set_notification_prefs_v2_accepts_wrapping_quiet_window() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, user) = setup(&env);

    // start > end spans the cycle boundary and is supported by the filter.
    client.set_notification_preferences_v2(&user, &v2_prefs(0, 1_200, 200));

    let stored = client.get_notification_preferences_v2(&user);
    assert_eq!(stored.quiet_hours_start, 1_200);
    assert_eq!(stored.quiet_hours_end, 200);
}

#[test]
fn test_set_notification_prefs_v2_rejects_out_of_range_values() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, user) = setup(&env);

    let negative_threshold = v2_prefs(-1, 0, 0);
    assert_eq!(
        client.try_set_notification_preferences_v2(&user, &negative_threshold),
        Err(Ok(VaultError::InvalidNotificationPrefs))
    );

    let out_of_range_end = v2_prefs(0, 0, helpers::QUIET_HOURS_CYCLE as u32);
    assert_eq!(
        client.try_set_notification_preferences_v2(&user, &out_of_range_end),
        Err(Ok(VaultError::InvalidNotificationPrefs))
    );

    let out_of_range_start = v2_prefs(0, helpers::QUIET_HOURS_CYCLE as u32 + 1, 0);
    assert_eq!(
        client.try_set_notification_preferences_v2(&user, &out_of_range_start),
        Err(Ok(VaultError::InvalidNotificationPrefs))
    );
}

#[test]
fn test_notification_prefs_v2_filters_by_min_amount_threshold() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, user) = setup(&env);

    client.set_notification_preferences_v2(&user, &v2_prefs(500, 0, 0));
    let proposal = Symbol::new(&env, "proposal");

    // Below the threshold: filtered out.
    assert!(helpers::compute_relevant_signers(&env, &proposal, 499).is_empty());
    // At and above the threshold: included.
    assert_eq!(helpers::compute_relevant_signers(&env, &proposal, 500).len(), 1);
    assert_eq!(helpers::compute_relevant_signers(&env, &proposal, 5_000).len(), 1);
}

#[test]
fn test_notification_prefs_v2_respects_quiet_hours() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, user) = setup(&env);

    // Quiet window [100, 200) of the cycle.
    client.set_notification_preferences_v2(&user, &v2_prefs(0, 100, 200));
    let proposal = Symbol::new(&env, "proposal");

    // Inside the window: filtered out.
    env.ledger().set_sequence_number(150);
    assert!(helpers::compute_relevant_signers(&env, &proposal, 1_000).is_empty());

    // Outside the window: included.
    env.ledger().set_sequence_number(300);
    assert_eq!(helpers::compute_relevant_signers(&env, &proposal, 1_000).len(), 1);
}

#[test]
fn test_legacy_setter_keeps_defaults_and_clears_thresholds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, user) = setup(&env);

    client.set_notification_preferences_v2(&user, &v2_prefs(1_000, 100, 200));
    // The legacy entry point stores flags only, so the filter fields reset.
    client.set_notification_preferences(
        &user,
        &NotificationPreferences {
            notify_on_proposal: true,
            notify_on_approval: true,
            notify_on_execution: false,
            notify_on_rejection: false,
            notify_on_expiry: false,
        },
    );

    let stored = client.get_notification_preferences_v2(&user);
    assert_eq!(stored.min_amount_threshold, 0);
    assert_eq!(stored.quiet_hours_start, 0);
    assert_eq!(stored.quiet_hours_end, 0);
    assert!(stored.notify_on_approval);
}
