#![cfg(test)]

use super::*;
use crate::types::{RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Env, Vec,
};

fn default_init_config(env: &Env, admin: &Address) -> InitConfig {
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    InitConfig {
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
            limit: 100,
            window: 3600,
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
        staking_config: types::StakingConfig::default(),
    }
}

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
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        pre_execution_hooks: pre_hooks,
        post_execution_hooks: post_hooks,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
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
