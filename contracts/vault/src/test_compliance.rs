//! Tests for Issue #1103: Compliance Score System

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

fn make_rule(env: &Env, id: u32, weight: u32, evaluator: RuleEvaluator) -> ComplianceRule {
    ComplianceRule {
        rule_id: id,
        description: Symbol::new(env, "rule"),
        weight,
        evaluator,
    }
}

// ── Test 1: No rules → score = 100 ──────────────────────────────────────

#[test]
fn test_no_rules_returns_perfect_score() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &base_config(&env, signers));

    let report = client.evaluate_compliance(&1000u32);
    assert_eq!(report.score, 100);
    assert_eq!(report.failed_rules.len(), 0);
}

// ── Test 2: All passing rules → score = 100 ─────────────────────────────

#[test]
fn test_all_passing_rules_score_100() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &base_config(&env, signers));

    let mut rules = Vec::new(&env);
    rules.push_back(make_rule(&env, 1, 25, RuleEvaluator::TimelockAdherence));
    rules.push_back(make_rule(&env, 2, 25, RuleEvaluator::SpendingLimitCompliance));
    rules.push_back(make_rule(&env, 3, 50, RuleEvaluator::VotingParticipation));
    client.set_compliance_rules(&admin, &rules);

    let report = client.evaluate_compliance(&1000u32);
    assert_eq!(report.score, 100);
    assert_eq!(report.failed_rules.len(), 0);
}

// ── Test 3: AuditTrailCompleteness fails on fresh vault ─────────────────

#[test]
fn test_audit_trail_rule_fails_when_no_entries() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &base_config(&env, signers));

    let mut rules = Vec::new(&env);
    rules.push_back(make_rule(&env, 42, 100, RuleEvaluator::AuditTrailCompleteness));
    client.set_compliance_rules(&admin, &rules);

    let report = client.evaluate_compliance(&1000u32);
    assert!(report.score < 100, "audit rule should fail on fresh vault");
    assert!(report.failed_rules.contains(&42u32));
}

// ── Test 4: Weighted average score calculation ────────────────────────────

#[test]
fn test_score_weighted_average() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &base_config(&env, signers));

    let mut rules = Vec::new(&env);
    // weight 75 passes, weight 25 fails
    rules.push_back(make_rule(&env, 1, 75, RuleEvaluator::TimelockAdherence));
    rules.push_back(make_rule(&env, 2, 25, RuleEvaluator::AuditTrailCompleteness));
    client.set_compliance_rules(&admin, &rules);

    let report = client.evaluate_compliance(&1000u32);
    // passed_weight=75, total_weight=100 → 75
    assert_eq!(report.score, 75);
    assert!(report.failed_rules.contains(&2u32));
    assert!(!report.failed_rules.contains(&1u32));
}

// ── Test 5: Multiple failing rules → all listed in failed_rules ──────────

#[test]
fn test_multiple_failing_rules() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &base_config(&env, signers));

    let mut rules = Vec::new(&env);
    rules.push_back(make_rule(&env, 10, 50, RuleEvaluator::AuditTrailCompleteness));
    rules.push_back(make_rule(&env, 20, 50, RuleEvaluator::AuditTrailCompleteness));
    client.set_compliance_rules(&admin, &rules);

    let report = client.evaluate_compliance(&1000u32);
    assert_eq!(report.score, 0);
    assert_eq!(report.failed_rules.len(), 2);
    assert!(report.failed_rules.contains(&10u32));
    assert!(report.failed_rules.contains(&20u32));
}

// ── Test 6: Report includes generated_at matching current ledger ─────────

#[test]
fn test_report_generated_at_ledger() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &base_config(&env, signers));

    let report = client.evaluate_compliance(&500u32);
    assert_eq!(report.generated_at, env.ledger().sequence());
}

// ── Test 7: set_compliance_rules requires Admin ───────────────────────────

#[test]
fn test_set_compliance_rules_requires_admin() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(member.clone());
    client.initialize(&admin, &base_config(&env, signers));
    client.set_role(&admin, &member, &Role::Member);

    let mut rules = Vec::new(&env);
    rules.push_back(make_rule(&env, 1, 100, RuleEvaluator::TimelockAdherence));

    let r = client.try_set_compliance_rules(&member, &rules);
    assert_eq!(r, Err(Ok(VaultError::InsufficientRole)));
}

// ── Test 8: Max 10 rules enforced ────────────────────────────────────────

#[test]
fn test_max_10_rules_enforced() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &base_config(&env, signers));

    let mut rules = Vec::new(&env);
    for i in 0..11u32 {
        rules.push_back(make_rule(&env, i, 9, RuleEvaluator::TimelockAdherence));
    }

    let r = client.try_set_compliance_rules(&admin, &rules);
    assert_eq!(r, Err(Ok(VaultError::BatchTooLarge)));
}

// ── Test 9: Rules are replaceable by a second call ────────────────────────

#[test]
fn test_rules_can_be_updated() {
    let (env, client) = make_env();
    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &base_config(&env, signers));

    // Set failing rule
    let mut rules1 = Vec::new(&env);
    rules1.push_back(make_rule(&env, 1, 100, RuleEvaluator::AuditTrailCompleteness));
    client.set_compliance_rules(&admin, &rules1);
    assert_eq!(client.evaluate_compliance(&100u32).score, 0);

    // Replace with always-passing rule
    let mut rules2 = Vec::new(&env);
    rules2.push_back(make_rule(&env, 2, 100, RuleEvaluator::TimelockAdherence));
    client.set_compliance_rules(&admin, &rules2);
    assert_eq!(client.evaluate_compliance(&100u32).score, 100);
}
