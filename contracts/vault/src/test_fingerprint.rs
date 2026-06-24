//! Tests for Issue #1089: Proposal Fingerprint Deduplication

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

fn default_config(env: &Env, signers: Vec<Address>) -> InitConfig {
    InitConfig {
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
        retry_config: RetryConfig { enabled: false, max_retries: 0, initial_backoff_ledgers: 0 },
        recovery_config: RecoveryConfig::default(env),
        staking_config: StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        veto_addresses: Vec::new(env),
        veto_window_ledgers: 0,
    }
}

fn propose(
    client: &crate::VaultDAOClient,
    env: &Env,
    proposer: &Address,
    recipient: &Address,
    token: &Address,
    amount: i128,
    memo: &str,
) -> Result<u64, Result<VaultError, soroban_sdk::InvokeError>> {
    client.try_propose_transfer(
        proposer,
        recipient,
        token,
        &amount,
        &Symbol::new(env, memo),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    )
}

// ── Test 1: Exact duplicate is blocked ──────────────────────────────────────

#[test]
fn test_exact_duplicate_blocked() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());
    client.initialize(&admin, &default_config(&env, signers));
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // First proposal succeeds
    let r1 = propose(&client, &env, &treasurer, &recipient, &token, 1000, "memo1");
    assert!(r1.is_ok(), "first proposal should succeed");

    // Identical proposal must be rejected
    let r2 = propose(&client, &env, &treasurer, &recipient, &token, 1000, "memo1");
    assert_eq!(r2, Err(Ok(VaultError::DuplicateProposal)));
}

// ── Test 2: Different memo → different fingerprint → allowed ─────────────

#[test]
fn test_different_description_allowed() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());
    client.initialize(&admin, &default_config(&env, signers));
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    let r1 = propose(&client, &env, &treasurer, &recipient, &token, 1000, "memo_a");
    assert!(r1.is_ok());

    // Same amount, different memo → different fingerprint → should succeed
    let r2 = propose(&client, &env, &treasurer, &recipient, &token, 1000, "memo_b");
    assert!(r2.is_ok(), "different memo produces a distinct fingerprint");
}

// ── Test 3: Different amount → different fingerprint → allowed ────────────

#[test]
fn test_different_amount_allowed() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());
    client.initialize(&admin, &default_config(&env, signers));
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    propose(&client, &env, &treasurer, &recipient, &token, 500, "memo1").unwrap();

    let r2 = propose(&client, &env, &treasurer, &recipient, &token, 501, "memo1");
    assert!(r2.is_ok(), "different amount should be allowed");
}

// ── Test 4: Duplicate check blocks same proposal twice ───────────────────

#[test]
fn test_triple_submit_blocked_after_first() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());
    client.initialize(&admin, &default_config(&env, signers));
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    propose(&client, &env, &treasurer, &recipient, &token, 1000, "dup").unwrap();

    let r2 = propose(&client, &env, &treasurer, &recipient, &token, 1000, "dup");
    assert_eq!(r2, Err(Ok(VaultError::DuplicateProposal)));

    let r3 = propose(&client, &env, &treasurer, &recipient, &token, 1000, "dup");
    assert_eq!(r3, Err(Ok(VaultError::DuplicateProposal)));
}

// ── Test 5: Non-treasurer cannot propose ────────────────────────────────

#[test]
fn test_non_treasurer_cannot_propose() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(member.clone());
    client.initialize(&admin, &default_config(&env, signers));
    client.set_role(&admin, &member, &Role::Member);

    let r = propose(&client, &env, &member, &recipient, &token, 1000, "memo1");
    assert_eq!(r, Err(Ok(VaultError::InsufficientRole)));
}

// ── Test 6: Different recipient → separate fingerprints ─────────────────

#[test]
fn test_different_recipient_allowed() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());
    client.initialize(&admin, &default_config(&env, signers));
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    let r1 = propose(&client, &env, &treasurer, &recipient1, &token, 1000, "memo1");
    let r2 = propose(&client, &env, &treasurer, &recipient2, &token, 1000, "memo1");
    assert!(r1.is_ok());
    assert!(r2.is_ok(), "different recipient = different fingerprint");
}

// ── Test 7: Vault paused → blocks before fingerprint check ──────────────

#[test]
fn test_paused_vault_blocks_proposal() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let emergency = Address::generate(&env);
    let emergency2 = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());
    client.initialize(&admin, &default_config(&env, signers));
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    let mut esigners = Vec::new(&env);
    esigners.push_back(emergency.clone());
    esigners.push_back(emergency2.clone());
    client.configure_emergency(&admin, &esigners, &999_999_999i128);
    client.pause_vault(&emergency, &Symbol::new(&env, "manual"));

    let r = propose(&client, &env, &treasurer, &recipient, &token, 1000, "memo1");
    assert_eq!(r, Err(Ok(VaultError::VaultPaused)));
}
