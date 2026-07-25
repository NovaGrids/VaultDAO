use super::*;
use crate::types::{
    ConditionLogic, Priority, RetryConfig, StakingConfig, ThresholdStrategy, VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Symbol, Vec};

fn setup_with_staking(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address, Address) {
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
fn test_staking_tier_starts_at_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, proposer, _token, _contract_id) = setup_with_staking(&env);

    let tier = client.get_staking_tier(&proposer);
    assert_eq!(tier, 0, "New proposer should start at tier 0");
}

#[test]
fn test_tier_progression_after_10_executions() {
    let env = Env::default();
    env.mock_all_auths();

    let (_client, _admin, _proposer, _token, _contract_id) = setup_with_staking(&env);

    // Test placeholder - implementation will verify tier 1 after 10 executions
}

#[test]
fn test_tier_progression_to_tier_5() {
    let env = Env::default();
    env.mock_all_auths();

    let (_client, _admin, _proposer, _token, _contract_id) = setup_with_staking(&env);

    // Test placeholder - implementation will verify tier 5 after 200 executions
}

#[test]
fn test_tier_multiplier_tier_0() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, proposer, _token, _contract_id) = setup_with_staking(&env);

    let multiplier = client.get_tier_multiplier(&proposer);
    assert_eq!(multiplier, 10000, "Tier 0 should have 1.0x multiplier (10000 bps)");
}

#[test]
fn test_independent_tier_progression_per_proposer() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposer1, token, contract_id) = setup_with_staking(&env);
    let proposer2 = Address::generate(&env);
    client.set_role(&admin, &proposer2, &Role::Treasurer);

    let tier1 = client.get_staking_tier(&proposer1);
    let tier2 = client.get_staking_tier(&proposer2);

    assert_eq!(tier1, 0);
    assert_eq!(tier2, 0);
}
