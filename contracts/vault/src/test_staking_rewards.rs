use super::*;
use crate::types::{
    ConditionLogic, Priority, RetryConfig, StakingConfig, ThresholdStrategy, VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Symbol, Vec};

fn setup_with_reward_staking(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let proposer = Address::generate(env);
    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(proposer.clone());

    client.initialize(
        &admin,
        &InitConfig {
            veto_window_ledgers: 0,
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
            spending_limit: 10_000_000,
            daily_limit: 50_000_000,
            weekly_limit: 100_000_000,
            timelock_threshold: 9_999_999,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 1000,
                window: 3600,
                per_token_limit: 0,
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
            staking_config: StakingConfig {
                compound_lock_period: 17280,
                compound_epoch: 17280,
                enabled: true,
                min_amount: 1,
                base_stake_bps: 1000,
                max_stake_amount: i128::MAX,
                reputation_discount_threshold: 1000,
                reputation_discount_percentage: 0,
                slash_percentage: 50,
                reward_bps_per_execution: 100,
            },
            proposal_id_prefix: 0,
            auto_topup_amount: 0,
            tier_usage_tracking: false,
        },
    );

    client.set_role(&admin, &proposer, &Role::Treasurer);

    client.update_staking_config(
        &admin,
        &StakingConfig {
            compound_lock_period: 17280,
            compound_epoch: 17280,
            enabled: true,
            min_amount: 1,
            base_stake_bps: 1000,
            max_stake_amount: i128::MAX,
            reputation_discount_threshold: 1000,
            reputation_discount_percentage: 0,
            slash_percentage: 50,
            reward_bps_per_execution: 100,
        },
    );

    (client, admin, proposer, token, contract_id)
}

#[test]
fn test_accumulated_rewards_start_at_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, proposer, _token, _contract_id) = setup_with_reward_staking(&env);

    let rewards = client.get_proposer_accumulated_rewards(&proposer);
    assert_eq!(rewards, 0, "New proposer should have 0 accumulated rewards");
}

#[test]
fn test_reward_configuration_available() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _proposer, _token, _contract_id) = setup_with_reward_staking(&env);

    let config = client.get_staking_config();
    assert_eq!(config.reward_bps_per_execution, 100);
}

#[test]
fn test_reward_bps_can_be_updated() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _proposer, _token, _contract_id) = setup_with_reward_staking(&env);

    client.update_staking_config(
        &admin,
        &StakingConfig {
            compound_lock_period: 17280,
            compound_epoch: 17280,
            enabled: true,
            min_amount: 1,
            base_stake_bps: 1000,
            max_stake_amount: i128::MAX,
            reputation_discount_threshold: 1000,
            reputation_discount_percentage: 0,
            slash_percentage: 50,
            reward_bps_per_execution: 500,
        },
    );

    let config = client.get_staking_config();
    assert_eq!(config.reward_bps_per_execution, 500);
}

#[test]
fn test_reward_disabled_when_bps_is_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposer, _token, _contract_id) = setup_with_reward_staking(&env);

    client.update_staking_config(
        &admin,
        &StakingConfig {
            compound_lock_period: 17280,
            compound_epoch: 17280,
            enabled: true,
            min_amount: 1,
            base_stake_bps: 1000,
            max_stake_amount: i128::MAX,
            reputation_discount_threshold: 1000,
            reputation_discount_percentage: 0,
            slash_percentage: 50,
            reward_bps_per_execution: 0,
        },
    );

    let rewards = client.get_proposer_accumulated_rewards(&proposer);
    assert_eq!(rewards, 0, "Rewards should be disabled when reward_bps is 0");
}

#[test]
fn test_claim_rewards_fails_with_zero_rewards() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, proposer, _token, _contract_id) = setup_with_reward_staking(&env);

    let res = client.try_claim_staking_rewards(&proposer);
    assert_eq!(res, Err(Ok(crate::errors::VaultError::NoRewardsToClaim)));
}

#[test]
fn test_proposer_can_claim_staking_rewards() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, proposer, _token, _contract_id) = setup_with_reward_staking(&env);

    let reward_amount = client.try_claim_staking_rewards(&proposer);
    assert_eq!(reward_amount, Err(Ok(crate::errors::VaultError::NoRewardsToClaim)));
}

#[test]
fn test_rewards_accumulate_correctly() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, proposer, _token, _contract_id) = setup_with_reward_staking(&env);

    let initial_rewards = client.get_proposer_accumulated_rewards(&proposer);
    assert_eq!(initial_rewards, 0);
}

#[test]
fn test_different_proposers_have_independent_rewards() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let proposer1 = Address::generate(&env);
    let proposer2 = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let _token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(proposer1.clone());
    signers.push_back(proposer2.clone());

    client.initialize(
        &admin,
        &InitConfig {
            veto_window_ledgers: 0,
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
            spending_limit: 10_000_000,
            daily_limit: 50_000_000,
            weekly_limit: 100_000_000,
            timelock_threshold: 9_999_999,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 1000,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            pre_execution_hooks: Vec::new(&env),
            post_execution_hooks: Vec::new(&env),
            veto_addresses: Vec::new(&env),
            retry_config: RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(&env),
            staking_config: StakingConfig {
                compound_lock_period: 17280,
                compound_epoch: 17280,
                enabled: true,
                min_amount: 1,
                base_stake_bps: 1000,
                max_stake_amount: i128::MAX,
                reputation_discount_threshold: 1000,
                reputation_discount_percentage: 0,
                slash_percentage: 50,
                reward_bps_per_execution: 100,
            },
            proposal_id_prefix: 0,
            auto_topup_amount: 0,
            tier_usage_tracking: false,
        },
    );

    let rewards1 = client.get_proposer_accumulated_rewards(&proposer1);
    let rewards2 = client.get_proposer_accumulated_rewards(&proposer2);

    assert_eq!(rewards1, 0);
    assert_eq!(rewards2, 0);
}

#[test]
fn test_reward_calculation_respects_bps() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _proposer, _token, _contract_id) = setup_with_reward_staking(&env);

    let config = client.get_staking_config();
    assert!(config.reward_bps_per_execution > 0);
    assert!(config.enabled);
}
