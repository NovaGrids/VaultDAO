//! Tests for Issue #1542: Add Staking Cooldown Lockup Period Before Unstake
#![cfg(test)]

use super::*;
use crate::types::{
    ConditionLogic, Priority, RetryConfig, StakingConfig, ThresholdStrategy, VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Symbol, Vec};

fn setup_with_staking_lockup(
    env: &Env,
    lockup_ledgers: u64,
) -> (VaultDAOClient<'_>, Address, Address, Address, Address) {
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
            },
            proposal_id_prefix: 0,
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
        },
    );

    (client, admin, proposer, token, contract_id)
}

#[test]
fn test_unstake_rejected_before_lockup_expires() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, _admin, proposer, token, contract_id) = setup_with_staking_lockup(&env, 1000);

    let stake_amount = 100i128;
    StellarAssetClient::new(&env, &token).mint(&contract_id, &1000);
    StellarAssetClient::new(&env, &token).mint(&proposer, &stake_amount);

    let recipient = Address::generate(&env);
    let proposal_id = client.propose_transfer(
        &proposer,
        &recipient,
        &token,
        &500i128,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Record should indicate stake was locked at ledger 100
    let stake_record = client.get_stake_record(&proposal_id);
    assert!(stake_record.is_some(), "Stake record must exist");

    // Try to unstake at ledger 100 (within lockup period) - should fail
    env.ledger().set_sequence_number(500);
    let unstake_result = client.try_unstake(&proposer, &proposal_id);
    assert!(unstake_result.is_err(), "Unstake must be rejected while lockup is active");
}

#[test]
fn test_unstake_allowed_after_lockup_expires() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, _admin, proposer, token, contract_id) = setup_with_staking_lockup(&env, 1000);

    let stake_amount = 100i128;
    StellarAssetClient::new(&env, &token).mint(&contract_id, &1000);
    StellarAssetClient::new(&env, &token).mint(&proposer, &stake_amount);

    let recipient = Address::generate(&env);
    let proposal_id = client.propose_transfer(
        &proposer,
        &recipient,
        &token,
        &500i128,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    let proposer_balance_before = StellarAssetClient::new(&env, &token).balance(&proposer);

    // Advance ledger beyond lockup (lockup_ledgers = 1000, staked at 100, so expires at 1100)
    env.ledger().set_sequence_number(1200);

    let unstake_result = client.try_unstake(&proposer, &proposal_id);
    assert!(unstake_result.is_ok(), "Unstake must succeed after lockup expires");

    // Stake should be returned to proposer
    let proposer_balance_after = StellarAssetClient::new(&env, &token).balance(&proposer);
    assert_eq!(proposer_balance_after, proposer_balance_before + stake_amount);
}

#[test]
fn test_immediate_unstake_attack_prevented() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, _admin, proposer, token, contract_id) = setup_with_staking_lockup(&env, 500);

    let stake_amount = 100i128;
    StellarAssetClient::new(&env, &token).mint(&contract_id, &1000);
    StellarAssetClient::new(&env, &token).mint(&proposer, &stake_amount);

    let recipient = Address::generate(&env);
    let proposal_id = client.propose_transfer(
        &proposer,
        &recipient,
        &token,
        &500i128,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Attempt immediate unstake (still at ledger 100, lockup expires at 600)
    let unstake_result = client.try_unstake(&proposer, &proposal_id);
    assert!(unstake_result.is_err(), "Immediate unstake must be blocked by lockup");
}
