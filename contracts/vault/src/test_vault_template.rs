#![cfg(test)]

use super::*;
use crate::types::{InitConfig, VaultTemplate};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

fn init_config(env: &Env, signers: Vec<Address>, threshold: u32) -> InitConfig {
    InitConfig {
        veto_window_ledgers: 200,
        whitelist_mode: true,
        grace_period_ledgers: 150,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 4000,
        weekly_limit: 9000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: crate::types::VelocityConfig {
            limit: 1_000_000,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: crate::types::ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        retry_config: crate::types::RetryConfig {
            max_retry_delay: 0,
            enabled: true,
            max_retries: 3,
            initial_backoff_ledgers: 10,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig {
            enabled: true,
            ..crate::types::StakingConfig::default()
        },
        proposal_id_prefix: 0,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        quorum_percentage: 60,
    }
}

/// Exporting a configured vault produces ratios (not absolute amounts) that
/// reflect its configuration, and never leaks signer addresses.
#[test]
fn test_export_vault_template_from_configured_vault() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    // threshold 2 of 3 signers => ceil(2*100/3) = 67%
    client.initialize(&admin, &init_config(&env, signers, 2));

    let template = client.export_vault_template();

    assert_eq!(template.version, VaultTemplate::CURRENT_VERSION);
    assert_eq!(template.threshold_ratio_percent, 67);
    assert_eq!(template.quorum_percentage, 60);
    assert_eq!(template.timelock_delay_ledgers, 100);
    // timelock_threshold 500 / spending_limit 1000 => 50%
    assert_eq!(template.timelock_threshold_pct, 50);
    assert_eq!(template.veto_window_ledgers, 200);
    // daily_limit 4000 / spending_limit 1000 => 400%
    assert_eq!(template.daily_limit_ratio_percent, 400);
    // weekly_limit 9000 / spending_limit 1000 => 900%
    assert_eq!(template.weekly_limit_ratio_percent, 900);
    assert_eq!(template.grace_period_ledgers, 150);
    assert_eq!(template.high_impact_threshold, 70);

    assert_ne!(
        template.enabled_features & VaultTemplate::FEATURE_WHITELIST_MODE,
        0
    );
    assert_ne!(template.enabled_features & VaultTemplate::FEATURE_RETRY, 0);
    assert_ne!(
        template.enabled_features & VaultTemplate::FEATURE_STAKING,
        0
    );
}

/// A new vault can be bootstrapped from an exported template, and the
/// resulting configuration scales the template's ratios by the new vault's
/// own base spending limit (not the original absolute amounts).
#[test]
fn test_initialize_from_template() {
    let env = Env::default();
    env.mock_all_auths();

    let source_id = env.register(VaultDAO, ());
    let source_client = VaultDAOClient::new(&env, &source_id);
    let source_admin = Address::generate(&env);
    let source_signer = Address::generate(&env);

    let mut source_signers = Vec::new(&env);
    source_signers.push_back(source_admin.clone());
    source_signers.push_back(source_signer.clone());
    source_client.initialize(&source_admin, &init_config(&env, source_signers, 2));

    let template = source_client.export_vault_template();

    let new_id = env.register(VaultDAO, ());
    let new_client = VaultDAOClient::new(&env, &new_id);
    let new_admin = Address::generate(&env);
    let new_signer1 = Address::generate(&env);
    let new_signer2 = Address::generate(&env);
    let new_signer3 = Address::generate(&env);

    let mut new_signers = Vec::new(&env);
    new_signers.push_back(new_admin.clone());
    new_signers.push_back(new_signer1.clone());
    new_signers.push_back(new_signer2.clone());
    new_signers.push_back(new_signer3.clone());

    // Deploy the clone at 10x the original's spending limit.
    new_client.initialize_from_template(&new_admin, &template, &new_signers, &10_000i128);

    let new_config = new_client.get_config();
    assert_eq!(new_config.signers.len(), 4);
    assert_eq!(new_config.spending_limit, 10_000);
    // threshold_ratio_percent 100% (2 of 2) applied to 4 signers => 4
    assert_eq!(new_config.threshold, 4);
    assert_eq!(new_config.quorum_percentage, 60);
    // daily_limit_ratio_percent 400% of new base 10_000 => 40_000
    assert_eq!(new_config.daily_limit, 40_000);
    assert_eq!(new_config.weekly_limit, 90_000);
    assert_eq!(new_config.timelock_threshold, 5_000);
    assert_eq!(new_config.timelock_delay, 100);
    assert_eq!(new_config.veto_window_ledgers, 200);
    assert!(new_config.whitelist_mode);
    assert!(new_config.retry_config.enabled);
    assert!(new_config.staking_config.enabled);

    // A second call to either init path must fail (first-time init guard).
    let res =
        new_client.try_initialize_from_template(&new_admin, &template, &new_signers, &10_000i128);
    assert_eq!(res.err(), Some(Ok(VaultError::AlreadyInitialized)));
}

/// initialize_from_template rejects a template with an invalid threshold ratio.
#[test]
fn test_initialize_from_template_rejects_invalid_threshold_ratio() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let mut template = valid_template(&env);
    template.threshold_ratio_percent = 0;
    let res = client.try_initialize_from_template(&admin, &template, &signers, &1_000i128);
    assert_eq!(res.err(), Some(Ok(VaultError::InvalidTemplate)));

    let mut template_over = valid_template(&env);
    template_over.threshold_ratio_percent = 101;
    let res_over =
        client.try_initialize_from_template(&admin, &template_over, &signers, &1_000i128);
    assert_eq!(res_over.err(), Some(Ok(VaultError::InvalidTemplate)));
}

fn valid_template(env: &Env) -> VaultTemplate {
    VaultTemplate {
        version: VaultTemplate::CURRENT_VERSION,
        threshold_ratio_percent: 100,
        quorum_percentage: 0,
        timelock_delay_ledgers: 0,
        timelock_threshold_pct: 0,
        veto_window_ledgers: 0,
        daily_limit_ratio_percent: 100,
        weekly_limit_ratio_percent: 100,
        fee_tiers: Vec::new(env),
        base_fee_bps: 0,
        enabled_features: 0,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
    }
}
