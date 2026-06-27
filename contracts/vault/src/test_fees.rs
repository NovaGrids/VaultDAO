use crate::errors::VaultError;
use crate::types::{FeeTier, FeeStructure, RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::Address as _,
    token::StellarAssetClient,
    Address, Env, Vec,
};

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

    client.initialize(
        &admin,
        &InitConfig {
            signers,
            threshold: 1,
            quorum: 0,
            quorum_percentage: 0,
            default_voting_deadline: 0,
            spending_limit: 1_000_000_000,
            daily_limit: 5_000_000_000,
            weekly_limit: 10_000_000_000,
            timelock_threshold: 999_999_999,
            timelock_delay: 0,
            velocity_limit: VelocityConfig { limit: 100, window: 3600 },
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
fn test_fee_volume_discount_tier() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token) = setup(&env);
    let user = Address::generate(&env);

    StellarAssetClient::new(&env, &token).mint(&user, &10_000_000);

    // Set up a volume tier: >= 500_000 volume → 50 bps (0.5%)
    let mut tiers = Vec::new(&env);
    tiers.push_back(FeeTier { min_volume: 500_000, fee_bps: 50 });

    let fee_structure = FeeStructure {
        tiers,
        base_fee_bps: 100,
        reputation_discount_threshold: 750,
        reputation_discount_percentage: 25,
        treasury: admin.clone(),
        enabled: true,
    };
    client.set_fee_structure(&admin, &fee_structure);

    // First call: user volume = 0, base rate applies → 1% of 10_000 = 100
    let fee1 = client.collect_execution_fee(&user, &token, &10_000i128);
    assert_eq!(fee1, 100);

    // Build up volume past the tier threshold with a large transaction
    let fee2 = client.collect_execution_fee(&user, &token, &600_000i128);
    // user_volume after fee1 = 10_000; still below 500_000 → base rate 100 bps
    // fee = 600_000 * 100 / 10_000 = 6_000
    assert_eq!(fee2, 6_000);

    // Now user_volume = 610_000 >= 500_000 → tier rate 50 bps
    let fee3 = client.collect_execution_fee(&user, &token, &10_000i128);
    assert_eq!(fee3, 50); // 10_000 * 50 / 10_000 = 50
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
