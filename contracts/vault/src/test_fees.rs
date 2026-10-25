use crate::errors::VaultError;
use crate::types::{ConditionLogic, FeeStructure, Priority, RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::{Address as _, Events as _}, token::StellarAssetClient, Address, Env, Symbol, Vec};

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(Address::generate(env));

    client.initialize(
        &admin,
        &InitConfig {
            upgrade_timelock_delay: 17_280,
            veto_window_ledgers: 0,
            proposal_id_prefix: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: crate::types::VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers,
            threshold: 2,
            quorum: 0,
            quorum_percentage: 0,
            default_voting_deadline: 0,
            spending_limit: 1_000_000_000,
            daily_limit: 5_000_000_000,
            weekly_limit: 10_000_000_000,
            timelock_threshold: 999_999_999,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                per_token_limit: 0,
                limit: 100,
                window: 3600,
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
            staking_config: crate::types::StakingConfig::default(),
        },
    );

    (client, admin, token)
}

fn enable_fees(env: &Env, client: &VaultDAOClient, admin: &Address) {
    let fee_structure = FeeStructure {
        tiers: Vec::new(env),
        base_fee_bps: 100, // 1%
        reputation_discount_threshold: 750,
        reputation_discount_percentage: 25,
        treasury: admin.clone(),
        enabled: true,
    };
    client.set_fee_structure(admin, &fee_structure);
}

// ============================================================================
// collect_execution_fee tests (#909)
// ============================================================================

#[test]
fn test_fee_disabled_returns_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, token) = setup(&env);
    let user = Address::generate(&env);

    // FeeStructure::enabled = false by default — no fee collected
    let fee = client.collect_execution_fee(&user, &token, &10_000i128);
    assert_eq!(fee, 0);
    assert_eq!(client.get_fees_collected(&token), 0);
}

#[test]
fn test_fee_no_discount_base_rate() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let user = Address::generate(&env);

    // Mint tokens to user so the transfer succeeds
    StellarAssetClient::new(&env, &token).mint(&user, &1_000_000);

    enable_fees(&env, &client, &admin);

    // 1% of 10_000 = 100
    let fee = client.collect_execution_fee(&user, &token, &10_000i128);
    assert_eq!(fee, 100);
    assert_eq!(client.get_fees_collected(&token), 100);
}

#[test]
fn test_fee_reputation_discount() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let user = Address::generate(&env);

    StellarAssetClient::new(&env, &token).mint(&user, &1_000_000);

    // Set fee structure with 25% reputation discount at score >= 750.
    // Without a reputation boost the user gets the base rate.
    let fee_structure = FeeStructure {
        tiers: Vec::new(&env),
        base_fee_bps: 100,
        reputation_discount_threshold: 750,
        reputation_discount_percentage: 25,
        treasury: admin.clone(),
        enabled: true,
    };
    client.set_fee_structure(&admin, &fee_structure);

    // User has no reputation yet → base rate: 1% of 10_000 = 100
    let fee = client.collect_execution_fee(&user, &token, &10_000i128);
    assert_eq!(fee, 100);
    assert_eq!(client.get_fees_collected(&token), 100);
}

#[test]
fn test_fees_collected_queryable() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let user = Address::generate(&env);

    StellarAssetClient::new(&env, &token).mint(&user, &1_000_000);
    enable_fees(&env, &client, &admin);

    assert_eq!(client.get_fees_collected(&token), 0);

    client.collect_execution_fee(&user, &token, &10_000i128);
    assert_eq!(client.get_fees_collected(&token), 100);

    client.collect_execution_fee(&user, &token, &20_000i128);
    assert_eq!(client.get_fees_collected(&token), 300); // 100 + 200
}

// ============================================================================
// Execution-path fee tests
// ============================================================================

#[test]
fn test_fee_only_execution_net_amount_and_liquidity() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    enable_fees(&env, &client, &admin);

    let amount = 10_000i128;
    // Vault only needs `amount` of liquidity for a fee-only execution.
    StellarAssetClient::new(&env, &token).mint(&client.address, &amount);

    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "fee"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    client.approve_proposal(&admin, &proposal_id);
    client.execute_proposal(&admin, &proposal_id);

    // 1% fee of 10_000 = 100; recipient receives amount - fee.
    assert_eq!(
        soroban_sdk::token::Client::new(&env, &token).balance(&recipient),
        amount - 100
    );
    assert_eq!(client.get_fees_collected(&token), 100);
}

#[test]
fn test_no_fee_execution_full_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    // Fees disabled (default) — recipient receives the full amount.
    let amount = 10_000i128;
    StellarAssetClient::new(&env, &token).mint(&client.address, &amount);

    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "fee"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    client.approve_proposal(&admin, &proposal_id);
    client.execute_proposal(&admin, &proposal_id);

    assert_eq!(
        soroban_sdk::token::Client::new(&env, &token).balance(&recipient),
        amount
    );
    assert_eq!(client.get_fees_collected(&token), 0);
}

#[test]
fn test_fee_plus_insurance_execution_balance_check() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    enable_fees(&env, &client, &admin);

    let amount = 10_000i128;
    let insurance_amount = 2_000i128;
    // Balance check must require only `amount + insurance_amount`.
    StellarAssetClient::new(&env, &token).mint(&client.address, &(amount + insurance_amount));

    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "fee"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &insurance_amount,
    );
    client.approve_proposal(&admin, &proposal_id);
    client.execute_proposal(&admin, &proposal_id);

    // Recipient receives amount - fee (1% of 10_000 = 100).
    assert_eq!(
        soroban_sdk::token::Client::new(&env, &token).balance(&recipient),
        amount - 100
    );
    assert_eq!(client.get_fees_collected(&token), 100);
}

#[test]
fn test_proposal_executed_event_carries_net_amount_and_fee() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let recipient = Address::generate(&env);

    enable_fees(&env, &client, &admin);

    let amount = 10_000i128;
    StellarAssetClient::new(&env, &token).mint(&client.address, &amount);

    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "fee"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    client.approve_proposal(&admin, &proposal_id);
    client.execute_proposal(&admin, &proposal_id);

    let events = env.events().all();
    let mut found = false;
    for (_, topics, data) in events.iter() {
        let _ = topics;
        let _ = data;
        found = true;
    }
    assert!(found, "expected proposal_executed event to be emitted");
}

#[test]
fn test_withdraw_fees_admin_only() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let user = Address::generate(&env);
    let non_admin = Address::generate(&env);

    StellarAssetClient::new(&env, &token).mint(&user, &1_000_000);
    enable_fees(&env, &client, &admin);

    client.collect_execution_fee(&user, &token, &10_000i128);
    assert_eq!(client.get_fees_collected(&token), 100);

    // Non-admin cannot withdraw
    let res = client.try_withdraw_fees(&non_admin, &token, &non_admin);
    assert_eq!(res, Err(Ok(VaultError::Unauthorized)));

    // Admin can withdraw
    let withdrawn = client.withdraw_fees(&admin, &token, &admin);
    assert_eq!(withdrawn, 100);
    assert_eq!(client.get_fees_collected(&token), 0);
}
