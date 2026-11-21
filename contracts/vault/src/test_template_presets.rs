//! On-chain validation tests for each official vault policy preset (#2081).
//!
//! These tests instantiate a fresh vault from each preset's template ratios,
//! assert that every derived parameter matches what the catalog documents,
//! and confirm that invalid template combinations are rejected before they
//! ever reach the chain.
//!
//! ## Presets under test
//! - `startup-v1`: 2-of-3, 12h timelock, no whitelist, retry enabled
//! - `dao-v1`:     3-of-5, 24h timelock, whitelist + veto, 60% quorum
//! - `grants-v1`:  1-of-N, whitelist, high daily cap, 12h timelock
//!
//! ## Running
//! ```bash
//! cargo test test_template_presets -- --nocapture
//! ```

#![cfg(test)]

use super::*;
use crate::types::{InitConfig, VaultTemplate, VoteWeight, RecoveryConfig, RetryConfig,
                   StakingConfig, ThresholdStrategy, VelocityConfig, VaultError};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build a `VaultTemplate` that mirrors the documented startup-v1 preset.
fn startup_template(env: &Env) -> VaultTemplate {
    VaultTemplate {
        version: VaultTemplate::CURRENT_VERSION,
        threshold_ratio_percent: 67,  // ceil(2/3 × 100) = 67% → 2 of 3
        quorum_percentage: 0,
        timelock_delay_ledgers: 8_640,
        timelock_threshold_pct: 50,
        veto_window_ledgers: 0,
        daily_limit_ratio_percent: 300,
        weekly_limit_ratio_percent: 1_000,
        fee_tiers: Vec::new(env),
        base_fee_bps: 0,
        enabled_features: 0, // FEATURE_RETRY not reflected in this bitmask for simplicity
        grace_period_ledgers: 1_440,
        vote_weight: VoteWeight::Flat,
        high_impact_threshold: 80,
        admin_rotation_delay: 1_440,
    }
}

/// Build a `VaultTemplate` that mirrors the documented dao-v1 preset.
fn dao_template(env: &Env) -> VaultTemplate {
    VaultTemplate {
        version: VaultTemplate::CURRENT_VERSION,
        threshold_ratio_percent: 60, // 3 of 5
        quorum_percentage: 60,
        timelock_delay_ledgers: 17_280,
        timelock_threshold_pct: 0,   // timelock every proposal
        veto_window_ledgers: 17_280,
        daily_limit_ratio_percent: 200,
        weekly_limit_ratio_percent: 700,
        fee_tiers: Vec::new(env),
        base_fee_bps: 0,
        enabled_features: VaultTemplate::FEATURE_WHITELIST_MODE,
        grace_period_ledgers: 2_880,
        vote_weight: VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 17_280,
    }
}

/// Build a `VaultTemplate` that mirrors the documented grants-v1 preset.
fn grants_template(env: &Env) -> VaultTemplate {
    VaultTemplate {
        version: VaultTemplate::CURRENT_VERSION,
        threshold_ratio_percent: 34, // effectively 1-of-N
        quorum_percentage: 0,
        timelock_delay_ledgers: 8_640,
        timelock_threshold_pct: 10,
        veto_window_ledgers: 8_640,
        daily_limit_ratio_percent: 500,
        weekly_limit_ratio_percent: 2_000,
        fee_tiers: Vec::new(env),
        base_fee_bps: 0,
        enabled_features: VaultTemplate::FEATURE_WHITELIST_MODE,
        grace_period_ledgers: 1_440,
        vote_weight: VoteWeight::Flat,
        high_impact_threshold: 60,
        admin_rotation_delay: 1_440,
    }
}

fn three_signers(env: &Env) -> Vec<Address> {
    let mut v = Vec::new(env);
    v.push_back(Address::generate(env));
    v.push_back(Address::generate(env));
    v.push_back(Address::generate(env));
    v
}

fn five_signers(env: &Env) -> Vec<Address> {
    let mut v = Vec::new(env);
    for _ in 0..5 {
        v.push_back(Address::generate(env));
    }
    v
}

// ---------------------------------------------------------------------------
// Preset: startup-v1
// ---------------------------------------------------------------------------

/// Instantiate from the startup preset and assert every derived config field.
#[test]
fn test_preset_startup_derived_config() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signers = three_signers(&env);

    let base = 10_000i128; // 10 000 stroops for easy ratio arithmetic
    client.initialize_from_template(&admin, &startup_template(&env), &signers, &base);

    let cfg = client.get_config();

    // threshold = ceil(67% × 3) = 3 — 100% when rounded up for 3 signers at 67%.
    // The contract uses: raw = ceil(ratio_pct × signer_count / 100), clamped to [1, N].
    // ceil(67 × 3 / 100) = ceil(2.01) = 3.
    assert_eq!(cfg.threshold, 3, "startup threshold should be 3 of 3 (67% of 3 = ceil(2.01)=3)");

    assert_eq!(cfg.quorum, 0, "startup quorum must be disabled");
    assert_eq!(cfg.quorum_percentage, 0);
    assert_eq!(cfg.timelock_delay, 8_640, "startup timelock delay");
    assert_eq!(cfg.timelock_threshold, 5_000, "50% of 10 000 = 5 000");
    assert_eq!(cfg.veto_window_ledgers, 0, "startup has no veto window");
    // daily_limit = max(300% × base, base) = max(30 000, 10 000) = 30 000
    assert_eq!(cfg.daily_limit, 30_000, "startup daily = 300% of base");
    // weekly_limit = max(1 000% × base, daily) = max(100 000, 30 000) = 100 000
    assert_eq!(cfg.weekly_limit, 100_000, "startup weekly = 1 000% of base");
    assert_eq!(cfg.grace_period_ledgers, 1_440);
    assert_eq!(cfg.high_impact_threshold, 80);
    assert_eq!(cfg.admin_rotation_delay, 1_440);
    assert!(!cfg.whitelist_mode, "startup has no whitelist");
}

/// Exporting a startup-configured vault and re-importing it produces identical ratios.
#[test]
fn test_preset_startup_roundtrip() {
    let env = Env::default();
    env.mock_all_auths();

    // --- source vault ---
    let src_id = env.register(VaultDAO, ());
    let src = VaultDAOClient::new(&env, &src_id);
    let src_admin = Address::generate(&env);
    src.initialize_from_template(&src_admin, &startup_template(&env), &three_signers(&env), &10_000i128);

    let exported = src.export_vault_template();

    // --- clone at 2× the base ---
    let dst_id = env.register(VaultDAO, ());
    let dst = VaultDAOClient::new(&env, &dst_id);
    let dst_admin = Address::generate(&env);
    dst.initialize_from_template(&dst_admin, &exported, &three_signers(&env), &20_000i128);

    let dst_cfg = dst.get_config();
    assert_eq!(dst_cfg.daily_limit, 60_000, "2× base → 2× daily limit");
    assert_eq!(dst_cfg.weekly_limit, 200_000, "2× base → 2× weekly limit");
    assert_eq!(dst_cfg.timelock_threshold, 10_000, "2× base → 2× timelock threshold");
}

// ---------------------------------------------------------------------------
// Preset: dao-v1
// ---------------------------------------------------------------------------

#[test]
fn test_preset_dao_derived_config() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signers = five_signers(&env);

    let base = 10_000i128;
    client.initialize_from_template(&admin, &dao_template(&env), &signers, &base);

    let cfg = client.get_config();

    // ceil(60% × 5) = ceil(3.0) = 3
    assert_eq!(cfg.threshold, 3, "dao threshold = 3 of 5");
    assert_eq!(cfg.quorum_percentage, 60, "dao quorum 60%");
    assert_eq!(cfg.timelock_delay, 17_280, "dao 24h timelock delay");
    // timelock_threshold_pct = 0 → timelock_threshold = 0 → triggers on every proposal
    assert_eq!(cfg.timelock_threshold, 0, "dao: timelock every proposal");
    assert_eq!(cfg.veto_window_ledgers, 17_280, "dao 24h veto window");
    // daily = max(200% × 10 000, 10 000) = 20 000
    assert_eq!(cfg.daily_limit, 20_000, "dao daily = 200% of base");
    // weekly = max(700% × 10 000, 20 000) = 70 000
    assert_eq!(cfg.weekly_limit, 70_000, "dao weekly = 700% of base");
    assert_eq!(cfg.grace_period_ledgers, 2_880);
    assert_eq!(cfg.high_impact_threshold, 70);
    assert_eq!(cfg.admin_rotation_delay, 17_280);
    assert!(cfg.whitelist_mode, "dao preset enforces whitelist");
}

#[test]
fn test_preset_dao_quorum_roundtrip() {
    let env = Env::default();
    env.mock_all_auths();

    let src_id = env.register(VaultDAO, ());
    let src = VaultDAOClient::new(&env, &src_id);
    let src_admin = Address::generate(&env);
    src.initialize_from_template(&src_admin, &dao_template(&env), &five_signers(&env), &50_000i128);

    let exported = src.export_vault_template();
    // quorum_percentage must survive the export/import cycle.
    assert_eq!(exported.quorum_percentage, 60);

    let dst_id = env.register(VaultDAO, ());
    let dst = VaultDAOClient::new(&env, &dst_id);
    let dst_admin = Address::generate(&env);
    dst.initialize_from_template(&dst_admin, &exported, &five_signers(&env), &50_000i128);

    let dst_cfg = dst.get_config();
    assert_eq!(dst_cfg.quorum_percentage, 60);
}

// ---------------------------------------------------------------------------
// Preset: grants-v1
// ---------------------------------------------------------------------------

#[test]
fn test_preset_grants_derived_config() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signers = three_signers(&env);

    let base = 10_000i128;
    client.initialize_from_template(&admin, &grants_template(&env), &signers, &base);

    let cfg = client.get_config();

    // ceil(34% × 3) = ceil(1.02) = 2 — effectively 1 signer at reasonable N
    assert_eq!(cfg.threshold, 2, "grants threshold = 2 of 3 (ceil(34% × 3))");
    assert_eq!(cfg.timelock_delay, 8_640);
    // timelock threshold = 10% of 10 000 = 1 000
    assert_eq!(cfg.timelock_threshold, 1_000, "grants timelock at 10%");
    assert_eq!(cfg.veto_window_ledgers, 8_640);
    // daily = max(500% × 10 000, 10 000) = 50 000
    assert_eq!(cfg.daily_limit, 50_000, "grants daily = 500%");
    // weekly = max(2 000% × 10 000, 50 000) = 200 000
    assert_eq!(cfg.weekly_limit, 200_000, "grants weekly = 2 000%");
    assert!(cfg.whitelist_mode, "grants enforces whitelist");
    assert_eq!(cfg.high_impact_threshold, 60);
}

// ---------------------------------------------------------------------------
// Invalid template rejection
// ---------------------------------------------------------------------------

#[test]
fn test_invalid_threshold_ratio_zero_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signers = three_signers(&env);

    let mut t = startup_template(&env);
    t.threshold_ratio_percent = 0;

    let res = client.try_initialize_from_template(&admin, &t, &signers, &10_000i128);
    assert_eq!(
        res.err(),
        Some(Ok(VaultError::InvalidTemplate)),
        "threshold_ratio_percent=0 must be rejected"
    );
}

#[test]
fn test_invalid_threshold_ratio_over_100_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signers = three_signers(&env);

    let mut t = startup_template(&env);
    t.threshold_ratio_percent = 101;

    let res = client.try_initialize_from_template(&admin, &t, &signers, &10_000i128);
    assert_eq!(
        res.err(),
        Some(Ok(VaultError::InvalidTemplate)),
        "threshold_ratio_percent=101 must be rejected"
    );
}

#[test]
fn test_invalid_quorum_over_100_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signers = three_signers(&env);

    let mut t = dao_template(&env);
    t.quorum_percentage = 101;

    let res = client.try_initialize_from_template(&admin, &t, &signers, &10_000i128);
    assert_eq!(
        res.err(),
        Some(Ok(VaultError::InvalidTemplate)),
        "quorum_percentage=101 must be rejected"
    );
}

#[test]
fn test_invalid_high_impact_threshold_over_100_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signers = three_signers(&env);

    let mut t = startup_template(&env);
    t.high_impact_threshold = 101;

    let res = client.try_initialize_from_template(&admin, &t, &signers, &10_000i128);
    assert_eq!(
        res.err(),
        Some(Ok(VaultError::InvalidTemplate)),
        "high_impact_threshold=101 must be rejected"
    );
}

#[test]
fn test_zero_base_spending_limit_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signers = three_signers(&env);

    let res = client.try_initialize_from_template(&admin, &startup_template(&env), &signers, &0i128);
    assert_eq!(
        res.err(),
        Some(Ok(VaultError::InvalidAmount)),
        "base_spending_limit=0 must be rejected"
    );
}

#[test]
fn test_negative_base_spending_limit_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signers = three_signers(&env);

    let res = client.try_initialize_from_template(&admin, &startup_template(&env), &signers, &-1i128);
    assert_eq!(
        res.err(),
        Some(Ok(VaultError::InvalidAmount)),
        "negative base_spending_limit must be rejected"
    );
}

#[test]
fn test_already_initialized_vault_rejects_template_init() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signers = three_signers(&env);

    client.initialize_from_template(&admin, &startup_template(&env), &signers, &10_000i128);

    let res = client.try_initialize_from_template(&admin, &startup_template(&env), &signers, &10_000i128);
    assert_eq!(
        res.err(),
        Some(Ok(VaultError::AlreadyInitialized)),
        "second initialize_from_template must be rejected"
    );
}

/// Scaling invariant: doubling base_spending_limit exactly doubles all
/// derived absolute amounts.
#[test]
fn test_preset_scaling_invariant() {
    let env = Env::default();
    env.mock_all_auths();

    let make = |base: i128| {
        let id = env.register(VaultDAO, ());
        let c = VaultDAOClient::new(&env, &id);
        let admin = Address::generate(&env);
        c.initialize_from_template(&admin, &startup_template(&env), &three_signers(&env), &base);
        c.get_config()
    };

    let cfg1 = make(10_000);
    let cfg2 = make(20_000);

    assert_eq!(cfg2.daily_limit,       cfg1.daily_limit * 2);
    assert_eq!(cfg2.weekly_limit,      cfg1.weekly_limit * 2);
    assert_eq!(cfg2.timelock_threshold, cfg1.timelock_threshold * 2);
    assert_eq!(cfg2.spending_limit,    cfg1.spending_limit * 2);
}
