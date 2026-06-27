//! Tests for price-gated escrow release (feature/escrow-oracle).
//!
//! Soroban test-client note: generated client methods for functions returning
//! `Result<T, E: contracterror>` return `T` directly and panic on error.
//!
//! Covered scenarios:
//!  1. PriceAbove – releases when price > threshold
//!  2. PriceAbove – blocks when price == threshold (strictly above required)
//!  3. PriceBelow – releases when price < threshold
//!  4. PriceBelow – blocks when price == threshold
//!  5. Manual condition – releases without any oracle call
//!  6. Oracle unavailable (invalid address) – panics
//!  7. Stale oracle price – panics
//!  8. Zero threshold rejected at creation
//!  9. Already-released escrow panics (idempotency)
//! 10. get_escrow_condition round-trips the stored condition
//! 11. Plain create_escrow stores no condition

use crate::types::{
    EscrowCondition, Milestone, PriceConditionArgs, RetryConfig, ThresholdStrategy, VaultPriceData,
    VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};

// ============================================================================
// Mock Oracle Contract
// ============================================================================

/// Minimal oracle storing a configurable price in instance storage.
/// ABI matches `PriceOracleInterface`: `get_price(Symbol) -> VaultPriceData`.
#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    pub fn get_price(env: Env, _asset_pair: Symbol) -> VaultPriceData {
        env.storage()
            .instance()
            .get(&Symbol::new(&env, "price"))
            .expect("price not set")
    }

    pub fn set_price(env: Env, price: i128, timestamp: u64) {
        env.storage().instance().set(
            &Symbol::new(&env, "price"),
            &VaultPriceData { price, timestamp },
        );
    }
}

// ============================================================================
// Test helpers
// ============================================================================

fn default_init_config(env: &Env, admin: &Address) -> InitConfig {
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        default_voting_deadline: 0,
        spending_limit: 100_000_000,
        daily_limit: 1_000_000_000,
        weekly_limit: 5_000_000_000,
        timelock_threshold: 900_000_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 1_000_000_000,
            window: 3_600,
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
        staking_config: crate::types::StakingConfig::default(),
    }
}

/// Returns (env, vault_client, admin, token_address, oracle_address).
fn setup() -> (Env, VaultDAOClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let vault_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &vault_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &default_init_config(&env, &admin));

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token_contract.address();
    // Vault needs balance for the treasury; admin (funder) needs balance for escrow deposits
    StellarAssetClient::new(&env, &token).mint(&vault_id, &10_000_000i128);
    StellarAssetClient::new(&env, &token).mint(&admin, &1_000_000i128);

    let oracle_id = env.register(MockOracle, ());

    (env, client, admin, token, oracle_id)
}

/// Single milestone that is immediately completable (release_ledger = 0).
fn instant_milestone(env: &Env) -> Vec<Milestone> {
    let mut m = Vec::new(env);
    m.push_back(Milestone {
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    m
}

fn price_above(oracle: Address, env: &Env, threshold: i128) -> EscrowCondition {
    EscrowCondition::PriceAbove(PriceConditionArgs {
        oracle,
        asset_pair: Symbol::new(env, "XLM_USD"),
        threshold,
    })
}

fn price_below(oracle: Address, env: &Env, threshold: i128) -> EscrowCondition {
    EscrowCondition::PriceBelow(PriceConditionArgs {
        oracle,
        asset_pair: Symbol::new(env, "XLM_USD"),
        threshold,
    })
}

/// Create a conditioned escrow and complete its single milestone. Returns the escrow ID.
fn create_and_complete(
    env: &Env,
    client: &VaultDAOClient,
    admin: &Address,
    token: &Address,
    condition: &EscrowCondition,
) -> u64 {
    let recipient = Address::generate(env);
    let arbitrator = Address::generate(env);
    // Client returns T directly; panics on VaultError
    let id = client.create_escrow_with_condition(
        admin,
        &recipient,
        token,
        &1_000i128,
        &instant_milestone(env),
        &10_000u64,
        &arbitrator,
        condition,
    );
    client.complete_milestone(admin, &id, &1u64);
    id
}

// ============================================================================
// Test 1 – PriceAbove: releases when price > threshold
// ============================================================================

#[test]
fn test_price_above_releases_when_met() {
    let (env, client, admin, token, oracle) = setup();
    let current = env.ledger().sequence() as u64;
    MockOracleClient::new(&env, &oracle).set_price(&200, &current);

    let cond = price_above(oracle, &env, 150);
    let id = create_and_complete(&env, &client, &admin, &token, &cond);

    let released = client.attempt_escrow_release(&id);
    assert_eq!(released, 1_000);
}

// ============================================================================
// Test 2 – PriceAbove: blocks when price == threshold
// ============================================================================

#[test]
#[should_panic]
fn test_price_above_blocks_when_equal_to_threshold() {
    let (env, client, admin, token, oracle) = setup();
    let current = env.ledger().sequence() as u64;
    MockOracleClient::new(&env, &oracle).set_price(&150, &current);

    let cond = price_above(oracle, &env, 150);
    let id = create_and_complete(&env, &client, &admin, &token, &cond);

    client.attempt_escrow_release(&id);
}

// ============================================================================
// Test 3 – PriceBelow: releases when price < threshold
// ============================================================================

#[test]
fn test_price_below_releases_when_met() {
    let (env, client, admin, token, oracle) = setup();
    let current = env.ledger().sequence() as u64;
    MockOracleClient::new(&env, &oracle).set_price(&99, &current);

    let cond = price_below(oracle, &env, 100);
    let id = create_and_complete(&env, &client, &admin, &token, &cond);

    let released = client.attempt_escrow_release(&id);
    assert_eq!(released, 1_000);
}

// ============================================================================
// Test 4 – PriceBelow: blocks when price == threshold
// ============================================================================

#[test]
#[should_panic]
fn test_price_below_blocks_when_equal_to_threshold() {
    let (env, client, admin, token, oracle) = setup();
    let current = env.ledger().sequence() as u64;
    MockOracleClient::new(&env, &oracle).set_price(&100, &current);

    let cond = price_below(oracle, &env, 100);
    let id = create_and_complete(&env, &client, &admin, &token, &cond);

    client.attempt_escrow_release(&id);
}

// ============================================================================
// Test 5 – Manual condition releases without any oracle call
// ============================================================================

#[test]
fn test_manual_condition_releases_without_oracle() {
    let (env, client, admin, token, _oracle) = setup();
    // No price is set — any oracle call would panic the mock
    let id = create_and_complete(&env, &client, &admin, &token, &EscrowCondition::Manual);
    let released = client.attempt_escrow_release(&id);
    assert_eq!(released, 1_000);
}

// ============================================================================
// Test 6 – Oracle unavailable (bad address) panics
// ============================================================================

#[test]
#[should_panic]
fn test_oracle_unavailable_panics() {
    let (env, client, admin, token, _oracle) = setup();
    let bad_oracle = Address::generate(&env);

    let cond = price_above(bad_oracle, &env, 100);
    let id = create_and_complete(&env, &client, &admin, &token, &cond);

    client.attempt_escrow_release(&id);
}

// ============================================================================
// Test 7 – Stale oracle price panics
// ============================================================================

#[test]
#[should_panic]
fn test_stale_price_panics() {
    let (env, client, admin, token, oracle) = setup();

    // Price published at ledger 0; advance 200 ledgers past the 100-ledger staleness window
    MockOracleClient::new(&env, &oracle).set_price(&200, &0u64);
    env.ledger().with_mut(|li| li.sequence_number += 200);

    let cond = price_above(oracle, &env, 150);
    let id = create_and_complete(&env, &client, &admin, &token, &cond);

    client.attempt_escrow_release(&id);
}

// ============================================================================
// Test 8 – Zero threshold rejected at creation
// ============================================================================

#[test]
#[should_panic]
fn test_zero_threshold_rejected_at_creation() {
    let (env, client, admin, token, oracle) = setup();
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let bad_cond = EscrowCondition::PriceAbove(PriceConditionArgs {
        oracle,
        asset_pair: Symbol::new(&env, "XLM_USD"),
        threshold: 0,
    });

    client.create_escrow_with_condition(
        &admin,
        &recipient,
        &token,
        &1_000i128,
        &instant_milestone(&env),
        &10_000u64,
        &arbitrator,
        &bad_cond,
    );
}

// ============================================================================
// Test 9 – Idempotency: second call on released escrow panics
// ============================================================================

#[test]
#[should_panic]
fn test_already_released_panics_on_second_attempt() {
    let (env, client, admin, token, oracle) = setup();
    let current = env.ledger().sequence() as u64;
    MockOracleClient::new(&env, &oracle).set_price(&200, &current);

    let cond = price_above(oracle, &env, 150);
    let id = create_and_complete(&env, &client, &admin, &token, &cond);

    client.attempt_escrow_release(&id); // first succeeds
    client.attempt_escrow_release(&id); // must panic
}

// ============================================================================
// Test 10 – get_escrow_condition round-trips the stored condition
// ============================================================================

#[test]
fn test_get_escrow_condition_returns_stored_condition() {
    let (env, client, admin, token, oracle) = setup();
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let cond = EscrowCondition::PriceBelow(PriceConditionArgs {
        oracle: oracle.clone(),
        asset_pair: Symbol::new(&env, "XLM_USD"),
        threshold: 500,
    });

    let id = client.create_escrow_with_condition(
        &admin,
        &recipient,
        &token,
        &1_000i128,
        &instant_milestone(&env),
        &10_000u64,
        &arbitrator,
        &cond,
    );

    let stored = client.get_escrow_condition(&id);
    assert!(stored.is_some());

    match stored.unwrap() {
        EscrowCondition::PriceBelow(args) => {
            assert_eq!(args.threshold, 500);
            assert_eq!(args.asset_pair, Symbol::new(&env, "XLM_USD"));
        }
        _ => panic!("unexpected condition variant"),
    }
}

// ============================================================================
// Test 11 – Plain create_escrow stores no condition
// ============================================================================

#[test]
fn test_plain_create_escrow_has_no_condition() {
    let (env, client, admin, token, _oracle) = setup();
    let recipient = Address::generate(&env);
    let arbitrator = Address::generate(&env);

    let id = client.create_escrow(
        &admin,
        &recipient,
        &token,
        &1_000i128,
        &instant_milestone(&env),
        &10_000u64,
        &arbitrator,
    );

    assert!(client.get_escrow_condition(&id).is_none());
}
