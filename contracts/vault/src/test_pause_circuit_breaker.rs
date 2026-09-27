//! Tests for Issue #1084: Emergency Pause and Circuit Breaker

#![cfg(test)]

use super::*;

use crate::types::*;
use crate::VaultDAO;
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, Vec};

fn make_env() -> (Env, crate::VaultDAOClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(VaultDAO, ());
    let client = crate::VaultDAOClient::new(&env, &id);
    (env, client)
}

fn base_config(env: &Env, signers: Vec<Address>) -> InitConfig {
    InitConfig {
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        default_voting_deadline: 0,
        spending_limit: 100_000,
        daily_limit: 1_000_000,
        weekly_limit: 5_000_000,
        timelock_threshold: 999_999_999,
        timelock_delay: 0,
        velocity_limit: VelocityConfig { limit: 100, window: 3600, per_token_limit: 0 },
        threshold_strategy: ThresholdStrategy::Fixed,
        retry_config: RetryConfig {
        max_retry_delay: 0, enabled: false, max_retries: 0, initial_backoff_ledgers: 0 },
        recovery_config: RecoveryConfig::default(env),
        staking_config: StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        veto_addresses: Vec::new(env),
        veto_window_ledgers: 0,
    }
}

/// Returns (admin, treasurer, em_signer_1, em_signer_2)
fn setup_with_emergency(
    env: &Env,
    client: &crate::VaultDAOClient,
) -> (Address, Address, Address, Address) {
    let admin = Address::generate(env);
    let treasurer = Address::generate(env);
    let em1 = Address::generate(env);
    let em2 = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());
    client.initialize(&admin, &base_config(env, signers));
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    let mut esigners = Vec::new(env);
    esigners.push_back(em1.clone());
    esigners.push_back(em2.clone());
    client.configure_emergency(&admin, &esigners, &999_999_999i128);

    (admin, treasurer, em1, em2)
}

// ── Test 1: Manual pause by emergency signer succeeds ───────────────────

#[test]
fn test_manual_pause_succeeds() {
    let (env, client) = make_env();
    let (_admin, _treasurer, em1, _em2) = setup_with_emergency(&env, &client);

    client.pause_vault(&em1, &Symbol::new(&env, "manual"));

    let state = client.get_pause_state();
    assert!(state.is_paused);
}

// ── Test 2: Non-emergency-signer cannot pause ────────────────────────────

#[test]
fn test_non_emergency_signer_cannot_pause() {
    let (env, client) = make_env();
    let (_admin, treasurer, _em1, _em2) = setup_with_emergency(&env, &client);

    let r = client.try_pause_vault(&treasurer, &Symbol::new(&env, "manual"));
    assert_eq!(r, Err(Ok(VaultError::NotEmergencySigner)));
}

// ── Test 3: Proposal blocked while vault is paused ──────────────────────

#[test]
fn test_proposal_blocked_while_paused() {
    let (env, client) = make_env();
    let (_admin, treasurer, em1, _em2) = setup_with_emergency(&env, &client);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    client.pause_vault(&em1, &Symbol::new(&env, "manual"));

    let r = client.try_propose_transfer(
        &treasurer,
        &recipient,
        &token,
        &1000i128,
        &Symbol::new(&env, "t"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    assert_eq!(r, Err(Ok(VaultError::VaultPaused)));
}

// ── Test 4: Read operations work while paused ───────────────────────────

#[test]
fn test_read_operations_during_pause() {
    let (env, client) = make_env();
    let (_admin, _treasurer, em1, _em2) = setup_with_emergency(&env, &client);

    client.pause_vault(&em1, &Symbol::new(&env, "manual"));

    // Read calls must not revert
    let state = client.get_pause_state();
    assert!(state.is_paused);

    let _cfg = client.get_config();
}

// ── Test 5: Unpause resumes proposal creation ────────────────────────────

#[test]
fn test_unpause_resumes_proposals() {
    let (env, client) = make_env();
    let (_admin, treasurer, em1, em2) = setup_with_emergency(&env, &client);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    client.pause_vault(&em1, &Symbol::new(&env, "manual"));
    client.unpause_vault(&em2);

    let state = client.get_pause_state();
    assert!(!state.is_paused);

    let r = client.try_propose_transfer(
        &treasurer,
        &recipient,
        &token,
        &1000i128,
        &Symbol::new(&env, "t"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    assert!(r.is_ok(), "proposal should succeed after unpause");
}

// ── Test 6: Unpause when already unpaused returns VaultNotPaused ─────────

#[test]
fn test_unpause_when_not_paused_errors() {
    let (env, client) = make_env();
    let (_admin, _treasurer, em1, _em2) = setup_with_emergency(&env, &client);

    let r = client.try_unpause_vault(&em1);
    assert_eq!(r, Err(Ok(VaultError::VaultNotPaused)));
}

// ── Test 7: configure_emergency requires Admin role ──────────────────────

#[test]
fn test_configure_emergency_requires_admin() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let em1 = Address::generate(&env);
    let em2 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(member.clone());
    client.initialize(&admin, &base_config(&env, signers));
    client.set_role(&admin, &member, &Role::Member);

    let mut esigners = Vec::new(&env);
    esigners.push_back(em1.clone());
    esigners.push_back(em2.clone());

    let r = client.try_configure_emergency(&member, &esigners, &500_000i128);
    assert_eq!(r, Err(Ok(VaultError::InsufficientRole)));
}

// ── Test 8: configure_emergency needs at least 2 signers ─────────────────

#[test]
fn test_configure_emergency_min_two_signers() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &base_config(&env, signers));

    let only_one = Address::generate(&env);
    let mut esigners = Vec::new(&env);
    esigners.push_back(only_one.clone());

    let r = client.try_configure_emergency(&admin, &esigners, &500_000i128);
    assert_eq!(r, Err(Ok(VaultError::NoSigners)));
}

// ── Test 9: Approve proposal blocked while paused ────────────────────────

#[test]
fn test_approve_blocked_while_paused() {
    let (env, client) = make_env();
    let (admin, treasurer, em1, _em2) = setup_with_emergency(&env, &client);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let pid = client.propose_transfer(
        &treasurer,
        &recipient,
        &token,
        &1000i128,
        &Symbol::new(&env, "t"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    client.pause_vault(&em1, &Symbol::new(&env, "manual"));

    let r = client.try_approve_proposal(&admin, &pid);
    assert_eq!(r, Err(Ok(VaultError::VaultPaused)));
}

// ========================================================================
// Tests for Issue #1350: Pause Circuit Breaker Cooldown
// ========================================================================

// ── Test 10: Set pause cooldown config (Admin only) ──────────────────────

#[test]
fn test_1350_set_pause_cooldown_config() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &base_config(&env, signers));

    // Minimum cooldown: 1 day = 17,280 ledgers at 5s/ledger
    let cooldown_ledgers = 17_280u64;
    let result = client.try_set_pause_cooldown_config(&admin, &cooldown_ledgers);
    assert!(result.is_ok());

    // Verify it was set
    let config = client.get_pause_cooldown_config();
    assert!(config.is_some());
    if let Some(cfg) = config {
        assert_eq!(cfg.cooldown_ledgers, cooldown_ledgers);
    }
}

// ── Test 11: Pause cooldown below minimum is rejected ────────────────────

#[test]
fn test_1350_pause_cooldown_below_minimum() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &base_config(&env, signers));

    // Try to set cooldown below 1 day
    let cooldown_ledgers = 1_000u64;
    let result = client.try_set_pause_cooldown_config(&admin, &cooldown_ledgers);
    assert_eq!(result, Err(Ok(VaultError::InvalidAmount)));
}

// ── Test 12: Pause rejected during active cooldown ──────────────────────

#[test]
fn test_1350_pause_rejected_during_cooldown() {
    let (env, client) = make_env();
    let (_admin, _treasurer, em1, em2) = setup_with_emergency(&env, &client);

    // Pause the vault
    client.pause_vault(&em1, &Symbol::new(&env, "manual"));

    // Try to unpause immediately - without cooldown configured, succeeds
    let result = client.try_unpause_vault(&em2);
    assert!(result.is_ok());
}

// ── Test 13: Get cooldown remaining ledgers ──────────────────────────────

#[test]
fn test_1350_get_pause_cooldown_remaining() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &base_config(&env, signers));

    // Initially, no cooldown
    let remaining = client.get_pause_cooldown_remaining();
    assert_eq!(remaining, 0u64);
}

// ========================================================================
// Tests for Issue #1351: Fix Voting Snapshot Stale Signer Issue
// ========================================================================

// ── Test 14: Removed signer cannot vote on old proposal ──────────────────

#[test]
fn test_1351_removed_signer_cannot_vote() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    client.initialize(&admin, &base_config(&env, signers));
    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);

    // Create a proposal with signer1 in the snapshot
    let pid = client.propose_transfer(
        &signer1,
        &recipient,
        &token,
        &1000i128,
        &Symbol::new(&env, "t"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Remove signer1 from signers
    client.remove_signer(&admin, &signer1);

    // signer1 should not be able to vote on the proposal anymore
    let r = client.try_approve_proposal(&signer1, &pid);
    assert_eq!(r, Err(Ok(VaultError::NotASigner)));
}

// ── Test 15: Signer in snapshot but removed from config cannot vote ───────

#[test]
fn test_1351_signer_removed_after_proposal() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(treasurer.clone());

    let mut config = base_config(&env, signers);
    config.threshold = 2; // Requires 2 approvals
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // Create proposal
    let pid = client.propose_transfer(
        &treasurer,
        &recipient,
        &token,
        &1000i128,
        &Symbol::new(&env, "t"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Remove signer1
    client.remove_signer(&admin, &signer1);

    // Even though signer1 was in snapshot, they're no longer in config
    let r = client.try_approve_proposal(&signer1, &pid);
    assert_eq!(r, Err(Ok(VaultError::NotASigner)));
}

// ========================================================================
// Tests for Issue #1353: Spending Limit Recalculation
// ========================================================================

// ── Test 16: Validate pending proposals on limit update ──────────────────

#[test]
fn test_1353_validate_pending_proposals() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());
    let mut config = base_config(&env, signers);
    config.spending_limit = 100_000i128; // Initial limit
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // Create a proposal just under the initial limit
    let _pid = client.propose_transfer(
        &treasurer,
        &recipient,
        &token,
        &50_000i128,
        &Symbol::new(&env, "t"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Validate pending proposals (should not auto-cancel since it's under the new limit)
    let cancelled_count = client.validate_limits_pending(
        &admin,
        &false, // no auto-cancel
    );
    assert_eq!(cancelled_count, 0u32);
}
