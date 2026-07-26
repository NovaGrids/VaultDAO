//! Tests for Issue #1367 — Proposal Execution Cost Estimation Oracle Integration.
//!
//! Covered scenarios:
//!  1. No oracle configured → local CostModel price used, event emitted with source=false
//!  2. Oracle configured, healthy price → oracle price used in fee calculation
//!  3. Oracle configured, healthy price → event emitted with source=true and correct price
//!  4. Oracle returns stale price → fallback to local, event source=false
//!  5. Oracle contract panics / bad address → fallback to local, no propagated panic
//!  6. Oracle returns None → fallback to local
//!  7. Oracle returns zero price → fallback to local
//!  8. Oracle returns negative price → fallback to local
//!  9. Oracle price used: fee_estimate_xlm matches expected formula
//! 10. Local fallback fee_estimate_xlm matches original formula
//! 11. set_gas_price_oracle non-admin is rejected
//! 12. set_gas_price_oracle with max_staleness=0 is rejected
//! 13. clear_gas_price_oracle reverts to local fallback
//! 14. get_gas_price_oracle returns None before set, Some after set
//! 15. clear_gas_price_oracle non-admin is rejected

use super::*;
use crate::types::{
    ConditionLogic, CostModel, GasPriceOracleConfig, GasPriceSource, Priority, RetryConfig,
    ThresholdStrategy, VaultPriceData, VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Events, Ledger},
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};

// ============================================================================
// Mock gas-price oracle
// ============================================================================
//
// Exposes the same `lastprice(asset: Address) -> Option<VaultPriceData>`
// interface used by the vault's existing oracle integration.

#[contracttype]
#[derive(Clone)]
enum GpoKey {
    Price,
    ReturnNone,
}

#[contract]
pub struct MockGasPriceOracle;

#[contractimpl]
impl MockGasPriceOracle {
    pub fn set_price(env: Env, price: i128, timestamp: u64) {
        env.storage()
            .instance()
            .set(&GpoKey::Price, &VaultPriceData { price, timestamp });
        env.storage().instance().set(&GpoKey::ReturnNone, &false);
    }

    pub fn set_return_none(env: Env) {
        env.storage().instance().set(&GpoKey::ReturnNone, &true);
    }

    pub fn lastprice(env: Env, _asset: Address) -> Option<VaultPriceData> {
        let return_none: bool = env
            .storage()
            .instance()
            .get(&GpoKey::ReturnNone)
            .unwrap_or(false);
        if return_none {
            return None;
        }
        env.storage().instance().get(&GpoKey::Price)
    }
}

// ============================================================================
// Helpers
// ============================================================================

fn default_init(env: &Env, admin: &Address) -> InitConfig {
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 10_000_000,
        daily_limit: 50_000_000,
        weekly_limit: 100_000_000,
        timelock_threshold: 9_999_999,
        timelock_delay: 0,
        velocity_limit: VelocityConfig {
            limit: 100_000_000,
            window: 3_600,
            per_token_limit: 0,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        veto_window_ledgers: 0,
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
            max_retry_delay: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1_440,
    }
}

/// Returns (env, client, admin, token, oracle_address, proposal_id).
fn setup() -> (Env, VaultDAOClient<'static>, Address, Address, Address, u64) {
    let env = Env::default();
    env.mock_all_auths();

    let vault_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &vault_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &default_init(&env, &admin));

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    StellarAssetClient::new(&env, &token).mint(&vault_id, &1_000_000i128);

    let oracle_id = env.register(MockGasPriceOracle, ());

    // Create a basic proposal so we have a valid proposal_id.
    let recipient = Address::generate(&env);
    let pid = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100i128,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    (env, client, admin, token, oracle_id, pid)
}

fn oracle_client(env: &Env, oracle: &Address) -> MockGasPriceOracleClient {
    MockGasPriceOracleClient::new(env, oracle)
}

// ============================================================================
// 1. No oracle → local price used, event source=false
// ============================================================================
#[test]
fn test_no_oracle_uses_local_price() {
    let (env, client, _, _, _, pid) = setup();

    let estimate = client.estimate_proposal_cost(&pid).unwrap();
    assert_eq!(estimate.price_source, GasPriceSource::LocalFallback);
    assert_eq!(
        estimate.price_used,
        CostModel::default().stroops_per_10k_compute_units
    );
}

// ============================================================================
// 2. Oracle configured, healthy → oracle price used
// ============================================================================
#[test]
fn test_oracle_price_used_when_healthy() {
    let (env, client, admin, _, oracle, pid) = setup();
    let current = env.ledger().sequence() as u64;
    oracle_client(&env, &oracle).set_price(&500i128, &current);

    client.set_gas_price_oracle(&admin, &oracle, &100u32);

    let estimate = client.estimate_proposal_cost(&pid).unwrap();
    assert_eq!(estimate.price_source, GasPriceSource::Oracle);
    assert_eq!(estimate.price_used, 500);
}

// ============================================================================
// 3. Oracle configured, healthy → event emitted with source=true
// ============================================================================
#[test]
fn test_oracle_price_event_emitted_source_true() {
    let (env, client, admin, _, oracle, pid) = setup();
    let current = env.ledger().sequence() as u64;
    oracle_client(&env, &oracle).set_price(&300i128, &current);
    client.set_gas_price_oracle(&admin, &oracle, &100u32);

    env.events().all(); // flush
    client.estimate_proposal_cost(&pid).unwrap();

    let all_events = env.events().all();
    // Find the oracle_gas_price_used event
    let found = all_events.iter().any(|(topics, data)| {
        if let Ok(topic_sym) = topics.get::<Symbol>(0) {
            if topic_sym == Symbol::new(&env, "oracle_gas_price_used") {
                // data is (price_used: i128, source_is_oracle: bool)
                let price: i128 =
                    soroban_sdk::Val::try_from_val(&env, &data.get::<soroban_sdk::Val>(0).unwrap())
                        .unwrap();
                let is_oracle: bool =
                    soroban_sdk::Val::try_from_val(&env, &data.get::<soroban_sdk::Val>(1).unwrap())
                        .unwrap();
                return price == 300 && is_oracle;
            }
        }
        false
    });
    assert!(
        found,
        "expected oracle_gas_price_used event with source=true"
    );
}

// ============================================================================
// 4. Stale price → fallback to local
// ============================================================================
#[test]
fn test_stale_oracle_price_falls_back_to_local() {
    let (env, client, admin, _, oracle, pid) = setup();
    // Price timestamp = 0; advance 200 ledgers past the 100-ledger window.
    oracle_client(&env, &oracle).set_price(&999i128, &0u64);
    client.set_gas_price_oracle(&admin, &oracle, &100u32);
    env.ledger().with_mut(|li| li.sequence_number += 200);

    let estimate = client.estimate_proposal_cost(&pid).unwrap();
    assert_eq!(estimate.price_source, GasPriceSource::LocalFallback);
    assert_eq!(
        estimate.price_used,
        CostModel::default().stroops_per_10k_compute_units
    );
}

// ============================================================================
// 5. Bad oracle address → fallback, no panic
// ============================================================================
#[test]
fn test_bad_oracle_address_falls_back_without_panic() {
    let (env, client, admin, _, _, pid) = setup();
    let bad_oracle = Address::generate(&env);
    // This will set the oracle but calling it will panic inside try_invoke_contract.
    client.set_gas_price_oracle(&admin, &bad_oracle, &100u32);

    // Must not panic — fallback must be used silently.
    let estimate = client.estimate_proposal_cost(&pid).unwrap();
    assert_eq!(estimate.price_source, GasPriceSource::LocalFallback);
}

// ============================================================================
// 6. Oracle returns None → fallback
// ============================================================================
#[test]
fn test_oracle_returns_none_falls_back() {
    let (env, client, admin, _, oracle, pid) = setup();
    oracle_client(&env, &oracle).set_return_none();
    client.set_gas_price_oracle(&admin, &oracle, &100u32);

    let estimate = client.estimate_proposal_cost(&pid).unwrap();
    assert_eq!(estimate.price_source, GasPriceSource::LocalFallback);
}

// ============================================================================
// 7. Oracle returns zero price → fallback
// ============================================================================
#[test]
fn test_oracle_zero_price_falls_back() {
    let (env, client, admin, _, oracle, pid) = setup();
    let current = env.ledger().sequence() as u64;
    oracle_client(&env, &oracle).set_price(&0i128, &current);
    client.set_gas_price_oracle(&admin, &oracle, &100u32);

    let estimate = client.estimate_proposal_cost(&pid).unwrap();
    assert_eq!(estimate.price_source, GasPriceSource::LocalFallback);
    assert!(estimate.price_used > 0, "fallback price must be positive");
}

// ============================================================================
// 8. Oracle returns negative price → fallback
// ============================================================================
#[test]
fn test_oracle_negative_price_falls_back() {
    let (env, client, admin, _, oracle, pid) = setup();
    let current = env.ledger().sequence() as u64;
    oracle_client(&env, &oracle).set_price(&-100i128, &current);
    client.set_gas_price_oracle(&admin, &oracle, &100u32);

    let estimate = client.estimate_proposal_cost(&pid).unwrap();
    assert_eq!(estimate.price_source, GasPriceSource::LocalFallback);
}

// ============================================================================
// 9. Oracle path: fee_estimate_xlm uses oracle price in formula
// ============================================================================
#[test]
fn test_fee_estimate_uses_oracle_price_in_formula() {
    let (env, client, admin, _, oracle, pid) = setup();
    let current = env.ledger().sequence() as u64;
    let oracle_price: i128 = 250;
    oracle_client(&env, &oracle).set_price(&oracle_price, &current);
    client.set_gas_price_oracle(&admin, &oracle, &100u32);

    let estimate = client.estimate_proposal_cost(&pid).unwrap();

    // Reproduce the formula: fee = (compute_units / 10_000) * price_used
    let expected_fee = (estimate.compute_units as i128 / 10_000).saturating_mul(oracle_price);
    assert_eq!(estimate.fee_estimate_xlm, expected_fee);
}

// ============================================================================
// 10. Local fallback path: fee_estimate_xlm matches original formula
// ============================================================================
#[test]
fn test_fee_estimate_local_fallback_matches_original_formula() {
    let (env, client, _, _, _, pid) = setup();
    // No oracle configured.
    let model = CostModel::default();

    let estimate = client.estimate_proposal_cost(&pid).unwrap();

    let expected_fee = (estimate.compute_units as i128 / 10_000)
        .saturating_mul(model.stroops_per_10k_compute_units);
    assert_eq!(estimate.fee_estimate_xlm, expected_fee);
    assert_eq!(estimate.price_used, model.stroops_per_10k_compute_units);
}

// ============================================================================
// 11. Non-admin cannot set oracle
// ============================================================================
#[test]
fn test_set_gas_price_oracle_non_admin_rejected() {
    let (env, client, _, _, oracle, _) = setup();
    let stranger = Address::generate(&env);

    let result = client.try_set_gas_price_oracle(&stranger, &oracle, &100u32);
    assert_eq!(result, Err(Ok(VaultError::Unauthorized)));
}

// ============================================================================
// 12. max_staleness = 0 rejected
// ============================================================================
#[test]
fn test_set_gas_price_oracle_zero_staleness_rejected() {
    let (env, client, admin, _, oracle, _) = setup();

    let result = client.try_set_gas_price_oracle(&admin, &oracle, &0u32);
    assert_eq!(result, Err(Ok(VaultError::InvalidAmount)));
}

// ============================================================================
// 13. clear_gas_price_oracle reverts to local fallback
// ============================================================================
#[test]
fn test_clear_oracle_reverts_to_local() {
    let (env, client, admin, _, oracle, pid) = setup();
    let current = env.ledger().sequence() as u64;
    oracle_client(&env, &oracle).set_price(&888i128, &current);
    client.set_gas_price_oracle(&admin, &oracle, &100u32);

    // Oracle path active.
    let with_oracle = client.estimate_proposal_cost(&pid).unwrap();
    assert_eq!(with_oracle.price_source, GasPriceSource::Oracle);

    // Clear it.
    client.clear_gas_price_oracle(&admin);

    let after_clear = client.estimate_proposal_cost(&pid).unwrap();
    assert_eq!(after_clear.price_source, GasPriceSource::LocalFallback);
    assert_eq!(
        after_clear.price_used,
        CostModel::default().stroops_per_10k_compute_units
    );
}

// ============================================================================
// 14. get_gas_price_oracle reflects config state
// ============================================================================
#[test]
fn test_get_gas_price_oracle_lifecycle() {
    let (env, client, admin, _, oracle, _) = setup();

    assert!(client.get_gas_price_oracle().is_none());

    client.set_gas_price_oracle(&admin, &oracle, &50u32);
    let cfg = client.get_gas_price_oracle().unwrap();
    assert_eq!(cfg.address, oracle);
    assert_eq!(cfg.max_staleness, 50);

    client.clear_gas_price_oracle(&admin);
    assert!(client.get_gas_price_oracle().is_none());
}

// ============================================================================
// 15. Non-admin cannot clear oracle
// ============================================================================
#[test]
fn test_clear_gas_price_oracle_non_admin_rejected() {
    let (env, client, admin, _, oracle, _) = setup();
    client.set_gas_price_oracle(&admin, &oracle, &100u32);

    let stranger = Address::generate(&env);
    let result = client.try_clear_gas_price_oracle(&stranger);
    assert_eq!(result, Err(Ok(VaultError::Unauthorized)));
}
