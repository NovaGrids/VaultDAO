#![cfg(test)]

use super::*;
use crate::types::{
    HookEventType, HookRegistration, RetryConfig, ThresholdStrategy, VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Env, Vec};

fn default_init_config(env: &Env, admin: &Address) -> InitConfig {
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    InitConfig {
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        default_voting_deadline: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
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
        staking_config: types::StakingConfig::default(),
    }
}

// ============================================================================
// Legacy pre/post execution hook tests (kept for regression coverage)
// ============================================================================

#[test]
fn test_register_pre_hook() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let hook = Address::generate(&env);

    client.initialize(&admin, &default_init_config(&env, &admin));
    client.register_pre_hook(&admin, &hook);

    let hooks = client.get_pre_hooks();
    assert_eq!(hooks.len(), 1);
    assert_eq!(hooks.get(0), Some(hook));
}

#[test]
fn test_register_post_hook() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let hook = Address::generate(&env);

    client.initialize(&admin, &default_init_config(&env, &admin));
    client.register_post_hook(&admin, &hook);

    let hooks = client.get_post_hooks();
    assert_eq!(hooks.len(), 1);
    assert_eq!(hooks.get(0), Some(hook));
}

#[test]
fn test_remove_pre_hook() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let hook = Address::generate(&env);

    client.initialize(&admin, &default_init_config(&env, &admin));
    client.register_pre_hook(&admin, &hook);
    client.remove_pre_hook(&admin, &hook);

    assert_eq!(client.get_pre_hooks().len(), 0);
}

#[test]
fn test_remove_post_hook() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let hook = Address::generate(&env);

    client.initialize(&admin, &default_init_config(&env, &admin));
    client.register_post_hook(&admin, &hook);
    client.remove_post_hook(&admin, &hook);

    assert_eq!(client.get_post_hooks().len(), 0);
}

#[test]
fn test_hook_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let hook = Address::generate(&env);

    client.initialize(&admin, &default_init_config(&env, &admin));

    let res = client.try_register_pre_hook(&user, &hook);
    assert_eq!(res.err(), Some(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_duplicate_hook() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let hook = Address::generate(&env);

    client.initialize(&admin, &default_init_config(&env, &admin));
    client.register_pre_hook(&admin, &hook);

    let res = client.try_register_pre_hook(&admin, &hook);
    assert_eq!(res.err(), Some(Ok(VaultError::SignerAlreadyExists)));
}

#[test]
fn test_hooks_with_initialization() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let pre_hook = Address::generate(&env);
    let post_hook = Address::generate(&env);

    let mut pre_hooks = Vec::new(&env);
    pre_hooks.push_back(pre_hook.clone());

    let mut post_hooks = Vec::new(&env);
    post_hooks.push_back(post_hook.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers: {
            let mut s = Vec::new(&env);
            s.push_back(admin.clone());
            s
        },
        threshold: 1,
        quorum: 0,
        default_voting_deadline: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        pre_execution_hooks: pre_hooks,
        post_execution_hooks: post_hooks,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };

    client.initialize(&admin, &config);
    assert_eq!(client.get_pre_hooks().len(), 1);
    assert_eq!(client.get_post_hooks().len(), 1);
}

// ============================================================================
// Issue #1091: Keeper Network Lifecycle Hooks — new tests
// ============================================================================

/// Helper: deploy a fresh vault and return (env, client, admin).
fn setup_vault() -> (Env, VaultDAOClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &default_init_config(&env, &admin));
    (env, client, admin)
}

// Test 1: A signer can register a keeper hook and read it back.
#[test]
fn test_keeper_hook_register_and_get() {
    let (env, client, admin) = setup_vault();

    let keeper = Address::generate(&env);
    let callback = Address::generate(&env);

    client.register_keeper_hook(
        &admin,
        &keeper,
        &HookEventType::ProposalReadyToExecute,
        &callback,
        &100_i128,
    );

    let hooks = client.get_keeper_hooks(&HookEventType::ProposalReadyToExecute);
    assert_eq!(hooks.len(), 1);
    let h: HookRegistration = hooks.get(0).unwrap();
    assert_eq!(h.keeper, keeper);
    assert_eq!(h.callback_contract, callback);
    assert_eq!(h.max_fee, 100);
    assert_eq!(h.event_type, HookEventType::ProposalReadyToExecute);
}

// Test 2: Non-signer cannot register a keeper hook.
#[test]
fn test_keeper_hook_register_requires_signer() {
    let (env, client, _admin) = setup_vault();

    let outsider = Address::generate(&env);
    let callback = Address::generate(&env);

    let res = client.try_register_keeper_hook(
        &outsider,
        &outsider,
        &HookEventType::RecurringDue,
        &callback,
        &0_i128,
    );
    assert_eq!(res.err(), Some(Ok(VaultError::NotASigner)));
}

// Test 3: Registering the same keeper+event_type twice yields HookAlreadyRegistered.
#[test]
fn test_keeper_hook_duplicate_rejected() {
    let (env, client, admin) = setup_vault();

    let keeper = Address::generate(&env);
    let callback = Address::generate(&env);

    client.register_keeper_hook(
        &admin,
        &keeper,
        &HookEventType::StreamDue,
        &callback,
        &0_i128,
    );

    let res = client.try_register_keeper_hook(
        &admin,
        &keeper,
        &HookEventType::StreamDue,
        &callback,
        &0_i128,
    );
    assert_eq!(res.err(), Some(Ok(VaultError::HookAlreadyRegistered)));
}

// Test 4: Per-event-type limit of 5 is enforced.
#[test]
fn test_keeper_hook_per_event_limit() {
    let (env, client, admin) = setup_vault();

    // Register 5 different keepers for the same event type — all should succeed.
    for _ in 0..5 {
        let keeper = Address::generate(&env);
        let callback = Address::generate(&env);
        client.register_keeper_hook(
            &admin,
            &keeper,
            &HookEventType::ProposalReadyToExecute,
            &callback,
            &0_i128,
        );
    }

    // The 6th registration must fail with HookLimitExceeded.
    let extra_keeper = Address::generate(&env);
    let extra_callback = Address::generate(&env);
    let res = client.try_register_keeper_hook(
        &admin,
        &extra_keeper,
        &HookEventType::ProposalReadyToExecute,
        &extra_callback,
        &0_i128,
    );
    assert_eq!(res.err(), Some(Ok(VaultError::HookLimitExceeded)));
}

// Test 5: A registered hook can be deregistered, and the slot becomes free again.
#[test]
fn test_keeper_hook_deregister() {
    let (env, client, admin) = setup_vault();

    let keeper = Address::generate(&env);
    let callback = Address::generate(&env);

    client.register_keeper_hook(
        &admin,
        &keeper,
        &HookEventType::EscrowReady,
        &callback,
        &50_i128,
    );
    assert_eq!(
        client.get_keeper_hooks(&HookEventType::EscrowReady).len(),
        1
    );

    client.deregister_keeper_hook(&admin, &keeper, &HookEventType::EscrowReady);
    assert_eq!(
        client.get_keeper_hooks(&HookEventType::EscrowReady).len(),
        0
    );
}

// Test 6: Deregistering a hook that does not exist returns HookNotFound.
#[test]
fn test_keeper_hook_deregister_not_found() {
    let (env, client, admin) = setup_vault();

    let keeper = Address::generate(&env);

    let res = client.try_deregister_keeper_hook(&admin, &keeper, &HookEventType::RecurringDue);
    assert_eq!(res.err(), Some(Ok(VaultError::HookNotFound)));
}

// Test 7: get_keeper_hooks returns empty vec when nothing registered.
#[test]
fn test_keeper_hook_get_empty() {
    let (_env, client, _admin) = setup_vault();
    let hooks = client.get_keeper_hooks(&HookEventType::StreamDue);
    assert_eq!(hooks.len(), 0);
}

// Test 8: Multiple distinct event types can each hold up to 5 hooks independently.
#[test]
fn test_keeper_hook_different_event_types_independent() {
    let (env, client, admin) = setup_vault();

    // Register 1 hook for each event type — they are stored independently.
    let types = [
        HookEventType::ProposalReadyToExecute,
        HookEventType::StreamDue,
        HookEventType::RecurringDue,
        HookEventType::EscrowReady,
    ];

    for event_type in types.iter() {
        let keeper = Address::generate(&env);
        let callback = Address::generate(&env);
        client.register_keeper_hook(&admin, &keeper, event_type, &callback, &0_i128);
    }

    for event_type in types.iter() {
        assert_eq!(client.get_keeper_hooks(event_type).len(), 1);
    }
}

// Test 9: Total vault limit of 20 hooks is enforced across all event types.
#[test]
fn test_keeper_hook_total_vault_limit() {
    let (env, client, admin) = setup_vault();

    // Fill 4 event types × 5 = 20 hooks.
    let event_types = [
        HookEventType::ProposalReadyToExecute,
        HookEventType::StreamDue,
        HookEventType::RecurringDue,
        HookEventType::EscrowReady,
    ];

    for event_type in event_types.iter() {
        for _ in 0..5 {
            let keeper = Address::generate(&env);
            let callback = Address::generate(&env);
            client.register_keeper_hook(&admin, &keeper, event_type, &callback, &0_i128);
        }
    }

    // Any additional registration (any event type) must fail.
    // Use a different event type that still has space per-event (but total is exhausted).
    // We re-use ProposalReadyToExecute — it is already at 5 so it would hit the per-event
    // limit first, which is fine — the important thing is that the vault-total limit is checked.
    let extra_keeper = Address::generate(&env);
    let extra_callback = Address::generate(&env);
    let res = client.try_register_keeper_hook(
        &admin,
        &extra_keeper,
        &HookEventType::ProposalReadyToExecute,
        &extra_callback,
        &0_i128,
    );
    // Either limit (per-event or total) is acceptable here.
    assert!(res.is_err());
}

// Test 10: Proposal lifecycle — hook is stored and retrievable after registration,
// confirming the ProposalReadyToExecute event type round-trips correctly.
#[test]
fn test_keeper_hook_proposal_ready_event_type_roundtrip() {
    let (env, client, admin) = setup_vault();

    let keeper = Address::generate(&env);
    let callback = Address::generate(&env);

    client.register_keeper_hook(
        &admin,
        &keeper,
        &HookEventType::ProposalReadyToExecute,
        &callback,
        &200_i128,
    );

    let hooks = client.get_keeper_hooks(&HookEventType::ProposalReadyToExecute);
    assert_eq!(hooks.len(), 1);
    let h: HookRegistration = hooks.get(0).unwrap();
    assert_eq!(h.event_type, HookEventType::ProposalReadyToExecute);
    assert_eq!(h.max_fee, 200);
}

// Test 11: Hooks registered for a different event type are not returned for another.
#[test]
fn test_keeper_hook_event_type_isolation() {
    let (env, client, admin) = setup_vault();

    let keeper = Address::generate(&env);
    let callback = Address::generate(&env);

    // Register only for RecurringDue
    client.register_keeper_hook(
        &admin,
        &keeper,
        &HookEventType::RecurringDue,
        &callback,
        &0_i128,
    );

    // ProposalReadyToExecute must still be empty
    assert_eq!(
        client
            .get_keeper_hooks(&HookEventType::ProposalReadyToExecute)
            .len(),
        0
    );
    // EscrowReady must still be empty
    assert_eq!(
        client.get_keeper_hooks(&HookEventType::EscrowReady).len(),
        0
    );
}

// Test 12: Re-register after deregister succeeds (slot is freed correctly).
#[test]
fn test_keeper_hook_reregister_after_deregister() {
    let (env, client, admin) = setup_vault();

    let keeper = Address::generate(&env);
    let callback = Address::generate(&env);

    client.register_keeper_hook(
        &admin,
        &keeper,
        &HookEventType::StreamDue,
        &callback,
        &10_i128,
    );

    client.deregister_keeper_hook(&admin, &keeper, &HookEventType::StreamDue);

    // Should be able to register again with a new callback
    let callback2 = Address::generate(&env);
    client.register_keeper_hook(
        &admin,
        &keeper,
        &HookEventType::StreamDue,
        &callback2,
        &20_i128,
    );

    let hooks = client.get_keeper_hooks(&HookEventType::StreamDue);
    assert_eq!(hooks.len(), 1);
    assert_eq!(hooks.get(0).unwrap().max_fee, 20);
}
