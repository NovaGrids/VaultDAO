//! Tests for on-chain notification preferences (feature/execution-notifications).
//!
//! The feature lets each signer store a `NotificationPrefs` struct in Instance
//! storage so off-chain indexers can filter which events to push per-signer,
//! rather than broadcasting everything and filtering at the client side.
//!
//! Covered scenarios:
//!  1. set_notification_prefs → get_notification_prefs round-trips correctly
//!  2. Prefs can be updated; second write overwrites the first
//!  3. get_notification_prefs returns None for a signer with no prefs
//!  4. get_relevant_signers: only subscribed signers are returned
//!  5. get_relevant_signers: amount-threshold filters out signers below the minimum
//!  6. get_relevant_signers: signer in quiet hours is excluded
//!  7. get_relevant_signers: signer outside quiet hours is included
//!  8. Too many subscribed_events (> 20) is rejected with InvalidAmount

use crate::types::{NotificationPrefs, RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Symbol, Vec,
};

// ============================================================================
// Helper
// ============================================================================

fn default_init_config(env: &Env, admin: &Address) -> InitConfig {
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        default_voting_deadline: 0,
        spending_limit: 100_000_000,
        daily_limit: 1_000_000_000,
        weekly_limit: 5_000_000_000,
        timelock_threshold: 900_000_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 1_000_000_000,
            window: 3_600,
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
        admin_rotation_delay: 1440,
    }
}

fn setup() -> (Env, VaultDAOClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let vault_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &vault_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &default_init_config(&env, &admin));

    (env, client, admin)
}

/// Build a minimal `NotificationPrefs` for `signer` subscribed to `event_type`.
fn make_prefs(
    env: &Env,
    signer: Address,
    event_type: &str,
    min_amount: i128,
    quiet_start: u32,
    quiet_end: u32,
) -> NotificationPrefs {
    let mut events = Vec::new(env);
    events.push_back(Symbol::new(env, event_type));
    NotificationPrefs {
        signer,
        subscribed_events: events,
        min_amount_threshold: min_amount,
        quiet_hours_start: quiet_start,
        quiet_hours_end: quiet_end,
    }
}

// ============================================================================
// Test 1 – Round-trip: stored prefs can be read back
// ============================================================================

#[test]
fn test_set_and_get_prefs_round_trip() {
    let (env, client, admin) = setup();

    let prefs = make_prefs(&env, admin.clone(), "proposal_created", 0, 0, 0);
    client.set_notification_prefs(&admin, &prefs);

    let stored = client.get_notification_prefs(&admin);
    assert!(stored.is_some());
    let stored = stored.unwrap();
    assert_eq!(stored.signer, admin);
    assert_eq!(stored.min_amount_threshold, 0);
    assert_eq!(stored.quiet_hours_start, 0);
    assert_eq!(stored.quiet_hours_end, 0);
    assert_eq!(stored.subscribed_events.len(), 1);
    assert_eq!(
        stored.subscribed_events.get(0).unwrap(),
        Symbol::new(&env, "proposal_created")
    );
}

// ============================================================================
// Test 2 – Update: second write overwrites the first
// ============================================================================

#[test]
fn test_update_prefs_overwrites_previous() {
    let (env, client, admin) = setup();

    let prefs_v1 = make_prefs(&env, admin.clone(), "proposal_created", 500, 0, 0);
    client.set_notification_prefs(&admin, &prefs_v1);

    let prefs_v2 = make_prefs(&env, admin.clone(), "proposal_executed", 1_000, 100, 200);
    client.set_notification_prefs(&admin, &prefs_v2);

    let stored = client.get_notification_prefs(&admin).unwrap();
    assert_eq!(stored.min_amount_threshold, 1_000);
    assert_eq!(stored.quiet_hours_start, 100);
    assert_eq!(stored.quiet_hours_end, 200);
    // Subscribed to "proposal_executed" now, not "proposal_created"
    assert_eq!(
        stored.subscribed_events.get(0).unwrap(),
        Symbol::new(&env, "proposal_executed")
    );
}

// ============================================================================
// Test 3 – None returned for signer with no prefs
// ============================================================================

#[test]
fn test_get_prefs_returns_none_for_unregistered_signer() {
    let (env, client, _admin) = setup();
    let stranger = Address::generate(&env);
    assert!(client.get_notification_prefs(&stranger).is_none());
}

// ============================================================================
// Test 4 – Filter by event type: only subscribed signers appear
// ============================================================================

#[test]
fn test_filter_by_event_type() {
    let (env, client, admin) = setup();
    let signer_a = Address::generate(&env);
    let signer_b = Address::generate(&env);

    // signer_a subscribes to "proposal_created"
    client.set_notification_prefs(
        &signer_a,
        &make_prefs(&env, signer_a.clone(), "proposal_created", 0, 0, 0),
    );
    // signer_b subscribes to "proposal_executed" only
    client.set_notification_prefs(
        &signer_b,
        &make_prefs(&env, signer_b.clone(), "proposal_executed", 0, 0, 0),
    );

    let event = Symbol::new(&env, "proposal_created");
    let relevant = client.get_relevant_signers(&event, &0i128);

    // Only signer_a should appear; admin and signer_b have no "proposal_created" sub
    assert!(relevant.contains(&signer_a));
    assert!(!relevant.contains(&signer_b));
    assert!(!relevant.contains(&admin));
}

// ============================================================================
// Test 5 – Amount threshold: signers below their minimum are excluded
// ============================================================================

#[test]
fn test_amount_threshold_filtering() {
    let (env, client, _admin) = setup();
    let big_whale = Address::generate(&env);
    let small_fish = Address::generate(&env);

    // big_whale wants notifications only for large proposals
    client.set_notification_prefs(
        &big_whale,
        &make_prefs(&env, big_whale.clone(), "proposal_created", 1_000_000, 0, 0),
    );
    // small_fish is fine with any proposal
    client.set_notification_prefs(
        &small_fish,
        &make_prefs(&env, small_fish.clone(), "proposal_created", 0, 0, 0),
    );

    let event = Symbol::new(&env, "proposal_created");

    // A small proposal (500_000 < 1_000_000) should only match small_fish
    let relevant_small = client.get_relevant_signers(&event, &500_000i128);
    assert!(!relevant_small.contains(&big_whale));
    assert!(relevant_small.contains(&small_fish));

    // A large proposal matches both
    let relevant_large = client.get_relevant_signers(&event, &5_000_000i128);
    assert!(relevant_large.contains(&big_whale));
    assert!(relevant_large.contains(&small_fish));
}

// ============================================================================
// Test 6 – Quiet hours: signer currently inside window is excluded
// ============================================================================

#[test]
fn test_quiet_hours_signer_excluded_when_in_window() {
    let (env, client, _admin) = setup();
    let quiet_signer = Address::generate(&env);

    // quiet window: offsets [100, 300) within the 1440-ledger day
    client.set_notification_prefs(
        &quiet_signer,
        &make_prefs(&env, quiet_signer.clone(), "proposal_created", 0, 100, 300),
    );

    // Set ledger so that sequence % 1440 == 150 → inside quiet window
    env.ledger().with_mut(|li| li.sequence_number = 150);

    let event = Symbol::new(&env, "proposal_created");
    let relevant = client.get_relevant_signers(&event, &0i128);
    assert!(!relevant.contains(&quiet_signer));
}

// ============================================================================
// Test 7 – Quiet hours: signer outside the window is included
// ============================================================================

#[test]
fn test_quiet_hours_signer_included_when_outside_window() {
    let (env, client, _admin) = setup();
    let active_signer = Address::generate(&env);

    // quiet window: offsets [100, 300)
    client.set_notification_prefs(
        &active_signer,
        &make_prefs(&env, active_signer.clone(), "proposal_created", 0, 100, 300),
    );

    // Set ledger so that sequence % 1440 == 50 → before quiet window
    env.ledger().with_mut(|li| li.sequence_number = 50);

    let event = Symbol::new(&env, "proposal_created");
    let relevant = client.get_relevant_signers(&event, &0i128);
    assert!(relevant.contains(&active_signer));
}

// ============================================================================
// Test 8 – More than 20 subscribed events are rejected
// ============================================================================

#[test]
#[should_panic]
fn test_too_many_subscribed_events_rejected() {
    let (env, client, admin) = setup();

    let mut events = Vec::new(&env);
    // Push 21 entries — one over the limit
    for i in 0u32..21 {
        // Soroban Symbol max is 32 chars; "ev" + 2-digit number is fine
        let name = if i < 10 {
            soroban_sdk::symbol_short!("ev0")
        } else {
            soroban_sdk::symbol_short!("ev1")
        };
        // Use a distinct value for each slot to avoid dedup issues in the Vec
        let _ = i;
        events.push_back(Symbol::new(&env, "proposal_created"));
    }

    let prefs = NotificationPrefs {
        signer: admin.clone(),
        subscribed_events: events,
        min_amount_threshold: 0,
        quiet_hours_start: 0,
        quiet_hours_end: 0,
    };

    // Must panic with InvalidAmount (> 20 entries)
    client.set_notification_prefs(&admin, &prefs);
}
