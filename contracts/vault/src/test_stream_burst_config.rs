use super::*;
use crate::types::Role;
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

fn setup(env: &Env) -> (VaultDAOClient<'static>, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    client.initialize(
        &admin,
        &crate::types::InitConfig {
            veto_window_ledgers: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: crate::types::VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers,
            threshold: 1,
            quorum: 0,
            spending_limit: 100_000,
            daily_limit: 500_000,
            weekly_limit: 1_000_000,
            timelock_threshold: 0,
            timelock_delay: 0,
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
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(env),
            staking_config: crate::types::StakingConfig::default(),
            proposal_id_prefix: 0,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            quorum_percentage: 0,
            arbitration_timeout_ledgers: 0,
        },
    );

    (client, admin, contract_id)
}

#[test]
fn test_set_stream_burst_factor_min_valid() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let result = client.set_stream_burst_factor(&admin, &100u32);
    assert!(result.is_ok(), "Setting burst factor to 100 should succeed");

    let config = client.get_config();
    assert_eq!(config.burst_factor, 100, "Burst factor should be 100");
}

#[test]
fn test_set_stream_burst_factor_max_valid() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let result = client.set_stream_burst_factor(&admin, &300u32);
    assert!(result.is_ok(), "Setting burst factor to 300 should succeed");

    let config = client.get_config();
    assert_eq!(config.burst_factor, 300, "Burst factor should be 300");
}

#[test]
fn test_set_stream_burst_factor_mid_range() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let result = client.set_stream_burst_factor(&admin, &200u32);
    assert!(result.is_ok(), "Setting burst factor to 200 should succeed");

    let config = client.get_config();
    assert_eq!(config.burst_factor, 200, "Burst factor should be 200");
}

#[test]
fn test_set_stream_burst_factor_below_min() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let result = client.try_set_stream_burst_factor(&admin, &99u32);
    assert!(result.is_err(), "Setting burst factor to 99 should fail");
}

#[test]
fn test_set_stream_burst_factor_above_max() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let result = client.try_set_stream_burst_factor(&admin, &301u32);
    assert!(result.is_err(), "Setting burst factor to 301 should fail");
}

#[test]
fn test_set_stream_burst_factor_admin_only() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let non_admin = Address::generate(&env);

    // Set non-admin role
    client.set_role(&admin, &non_admin, &Role::Treasurer);

    let result = client.try_set_stream_burst_factor(&non_admin, &200u32);
    assert!(result.is_err(), "Non-admin should not be able to set burst factor");
}

#[test]
fn test_set_stream_burst_factor_various_values() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let test_factors = vec![100u32, 120, 150, 200, 250, 300];

    for factor in test_factors {
        let result = client.set_stream_burst_factor(&admin, &factor);
        assert!(result.is_ok(), "Setting burst factor to {} should succeed", factor);

        let config = client.get_config();
        assert_eq!(config.burst_factor, factor, "Burst factor should be {}", factor);
    }
}
