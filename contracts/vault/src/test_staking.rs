use super::*;
use crate::types::{
    ConditionLogic, Priority, RetryConfig, StakingConfig, ThresholdStrategy, VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Symbol, Vec};

// ============================================================================
// Helpers
// ============================================================================

/// Returns (client, admin, proposer, token, contract_id).
/// Staking is enabled at 10% (base_stake_bps=1000) with the given slash_pct.
fn setup_with_staking(
    env: &Env,
    slash_pct: u32,
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
            velocity_limit: VelocityConfig { limit: 1000, window: 3600 },
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
            staking_config: StakingConfig {
                enabled: true,
                min_amount: 1,
                base_stake_bps: 1000, // 10% stake required
                max_stake_amount: i128::MAX,
                reputation_discount_threshold: 1000, // unreachable — no discount
                reputation_discount_percentage: 0,
                slash_percentage: slash_pct,
            },
        },
    );

    client.set_role(&admin, &proposer, &Role::Treasurer);

    // Explicitly persist staking config to FeatureKey::StakingConfig
    // (initialize stores it in Config but get_staking_config reads FeatureKey::StakingConfig)
    client.update_staking_config(
        &admin,
        &StakingConfig {
            enabled: true,
            min_amount: 1,
            base_stake_bps: 1000,
            max_stake_amount: i128::MAX,
            reputation_discount_threshold: 1000,
            reputation_discount_percentage: 0,
            slash_percentage: slash_pct,
        },
    );

    (client, admin, proposer, token, contract_id)
}

/// Create a proposal with staking enabled.
/// Mints stake tokens to proposer and vault-funds for execution tests.
/// Returns (proposal_id, stake_amount).
fn create_staked_proposal(
    env: &Env,
    client: &VaultDAOClient<'_>,
    proposer: &Address,
    token: &Address,
    contract_id: &Address,
    proposal_amount: i128,
) -> (u64, i128) {
    let stake_amount = proposal_amount / 10; // 10% of proposal amount

    // Fund vault so execution tests can transfer tokens out
    StellarAssetClient::new(env, token).mint(contract_id, &proposal_amount);
    // Mint stake to proposer — locked into vault during propose_transfer
    StellarAssetClient::new(env, token).mint(proposer, &stake_amount);

    let recipient = Address::generate(env);
    let proposal_id = client.propose_transfer(
        proposer,
        &recipient,
        token,
        &proposal_amount,
        &Symbol::new(env, "test"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    );

    (proposal_id, stake_amount)
}

// ============================================================================
// set_staking_config (update_staking_config)
// ============================================================================

#[test]
fn test_set_staking_config_admin_only() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, proposer, _token, _contract_id) = setup_with_staking(&env, 50);

    let new_config = StakingConfig {
        enabled: false,
        min_amount: 0,
        base_stake_bps: 0,
        max_stake_amount: 0,
        reputation_discount_threshold: 0,
        reputation_discount_percentage: 0,
        slash_percentage: 0,
    };

    let res = client.try_update_staking_config(&proposer, &new_config);
    assert_eq!(res, Err(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_set_staking_config_persists() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _proposer, _token, _contract_id) = setup_with_staking(&env, 50);

    let new_config = StakingConfig {
        enabled: true,
        min_amount: 500,
        base_stake_bps: 200,
        max_stake_amount: 10_000,
        reputation_discount_threshold: 800,
        reputation_discount_percentage: 25,
        slash_percentage: 75,
    };

    client.update_staking_config(&admin, &new_config);

    let stored = client.get_staking_config();
    assert_eq!(stored.slash_percentage, 75);
    assert_eq!(stored.base_stake_bps, 200);
    assert_eq!(stored.min_amount, 500);
}

// ============================================================================
// slash_stake on rejection
// ============================================================================

#[test]
fn test_slash_stake_on_rejection_correct_percentage() {
    let env = Env::default();
    env.mock_all_auths();

    // 50% slash
    let (client, admin, proposer, token, contract_id) = setup_with_staking(&env, 50);
    let (proposal_id, stake_amount) =
        create_staked_proposal(&env, &client, &proposer, &token, &contract_id, 1000);

    // stake_amount = 100 (10% of 1000)
    assert_eq!(stake_amount, 100);

    // Verify stake record was created
    let record = client.get_stake_record(&proposal_id);
    assert!(record.is_some(), "stake record must exist after proposal creation");
    assert_eq!(record.unwrap().amount, 100);

    let proposer_balance_before =
        soroban_sdk::token::Client::new(&env, &token).balance(&proposer);

    // Admin cancels another proposer's proposal → rejection semantics → slash 50%
    client.cancel_proposal(&admin, &proposal_id, &Symbol::new(&env, "bad"));

    // StakeRecord: slashed = true, slashed_amount = 50, refunded = false
    let record = client.get_stake_record(&proposal_id).unwrap();
    assert!(record.slashed, "stake_record.slashed must be true");
    assert_eq!(record.slashed_amount, 50, "50% of 100 = 50 slashed");
    assert!(!record.refunded, "refunded must remain false");

    // Remainder (50) returned to proposer
    let proposer_balance_after =
        soroban_sdk::token::Client::new(&env, &token).balance(&proposer);
    assert_eq!(proposer_balance_after, proposer_balance_before + 50);
}

#[test]
fn test_slash_stake_accumulates_in_pool() {
    let env = Env::default();
    env.mock_all_auths();

    // 100% slash — full stake goes to pool
    let (client, admin, proposer, token, contract_id) = setup_with_staking(&env, 100);
    let (proposal_id, stake_amount) =
        create_staked_proposal(&env, &client, &proposer, &token, &contract_id, 1000);

    assert_eq!(stake_amount, 100);

    client.cancel_proposal(&admin, &proposal_id, &Symbol::new(&env, "bad"));

    let pool = client.get_stake_pool_balance(&token);
    assert_eq!(pool, 100);
}

#[test]
fn test_slash_stake_zero_when_staking_disabled_on_rejection() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposer, token, contract_id) = setup_with_staking(&env, 50);
    let (proposal_id, stake_amount) =
        create_staked_proposal(&env, &client, &proposer, &token, &contract_id, 1000);

    // Disable staking before rejection — slash_amount becomes 0
    client.update_staking_config(
        &admin,
        &StakingConfig {
            enabled: false,
            min_amount: 0,
            base_stake_bps: 0,
            max_stake_amount: 0,
            reputation_discount_threshold: 0,
            reputation_discount_percentage: 0,
            slash_percentage: 0,
        },
    );

    let proposer_balance_before =
        soroban_sdk::token::Client::new(&env, &token).balance(&proposer);
    client.cancel_proposal(&admin, &proposal_id, &Symbol::new(&env, "bad"));

    // Full stake returned when staking disabled
    let proposer_balance_after =
        soroban_sdk::token::Client::new(&env, &token).balance(&proposer);
    assert_eq!(proposer_balance_after, proposer_balance_before + stake_amount);

    // Pool stays empty
    assert_eq!(client.get_stake_pool_balance(&token), 0);
}

// ============================================================================
// refund_stake on execution
// ============================================================================

#[test]
fn test_refund_stake_on_execution_sets_refunded_flag() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposer, token, contract_id) = setup_with_staking(&env, 50);
    let (proposal_id, _stake_amount) =
        create_staked_proposal(&env, &client, &proposer, &token, &contract_id, 1000);

    client.approve_proposal(&admin, &proposal_id);
    client.execute_proposal(&admin, &proposal_id);

    let record = client.get_stake_record(&proposal_id).unwrap();
    assert!(record.refunded, "stake_record.refunded must be true after execution");
    assert!(!record.slashed, "slashed must remain false");
    assert_eq!(record.slashed_amount, 0);
}

#[test]
fn test_refund_stake_returns_full_amount_to_proposer() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposer, token, contract_id) = setup_with_staking(&env, 50);
    let (proposal_id, stake_amount) =
        create_staked_proposal(&env, &client, &proposer, &token, &contract_id, 1000);

    let proposer_balance_before =
        soroban_sdk::token::Client::new(&env, &token).balance(&proposer);

    client.approve_proposal(&admin, &proposal_id);
    client.execute_proposal(&admin, &proposal_id);

    let proposer_balance_after =
        soroban_sdk::token::Client::new(&env, &token).balance(&proposer);
    assert_eq!(proposer_balance_after, proposer_balance_before + stake_amount);
}

// ============================================================================
// Double-refund / double-slash prevention
// ============================================================================

#[test]
fn test_double_slash_prevented() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposer, token, contract_id) = setup_with_staking(&env, 50);
    let (proposal_id, _) =
        create_staked_proposal(&env, &client, &proposer, &token, &contract_id, 1000);

    client.cancel_proposal(&admin, &proposal_id, &Symbol::new(&env, "bad"));

    let pool_after_first = client.get_stake_pool_balance(&token);

    // Second cancel must fail — proposal is already Rejected
    let res = client.try_cancel_proposal(&admin, &proposal_id, &Symbol::new(&env, "bad2"));
    assert!(res.is_err(), "second rejection must fail");

    // Pool must not have grown
    assert_eq!(client.get_stake_pool_balance(&token), pool_after_first);
}

// ============================================================================
// withdraw_stake_pool
// ============================================================================

#[test]
fn test_withdraw_stake_pool_admin_only() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposer, token, contract_id) = setup_with_staking(&env, 100);
    let (proposal_id, _) =
        create_staked_proposal(&env, &client, &proposer, &token, &contract_id, 1000);
    client.cancel_proposal(&admin, &proposal_id, &Symbol::new(&env, "bad"));

    let withdraw_target = Address::generate(&env);
    let res = client.try_withdraw_stake_pool(&proposer, &token, &withdraw_target, &50);
    assert_eq!(res, Err(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_withdraw_stake_pool_transfers_and_decrements() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposer, token, contract_id) = setup_with_staking(&env, 100);
    let (proposal_id, stake_amount) =
        create_staked_proposal(&env, &client, &proposer, &token, &contract_id, 1000);

    client.cancel_proposal(&admin, &proposal_id, &Symbol::new(&env, "bad"));

    let pool_before = client.get_stake_pool_balance(&token);
    assert_eq!(pool_before, stake_amount);

    let withdraw_target = Address::generate(&env);
    client.withdraw_stake_pool(&admin, &token, &withdraw_target, &stake_amount);

    assert_eq!(client.get_stake_pool_balance(&token), 0);

    let target_balance =
        soroban_sdk::token::Client::new(&env, &token).balance(&withdraw_target);
    assert_eq!(target_balance, stake_amount);
}

#[test]
fn test_withdraw_stake_pool_insufficient_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposer, token, contract_id) = setup_with_staking(&env, 50);
    let (proposal_id, _) =
        create_staked_proposal(&env, &client, &proposer, &token, &contract_id, 1000);
    client.cancel_proposal(&admin, &proposal_id, &Symbol::new(&env, "bad"));

    let pool = client.get_stake_pool_balance(&token);
    let withdraw_target = Address::generate(&env);

    let res = client.try_withdraw_stake_pool(&admin, &token, &withdraw_target, &(pool + 1));
    assert_eq!(res, Err(Ok(VaultError::InsufficientBalance)));
}
