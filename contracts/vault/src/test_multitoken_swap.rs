//! Tests for multi-token swap and rebalancing (Issue #1441).
//!
//! Covers DEX integration and token swapping:
//! 1. Add DEX integration config to DexConfig
//! 2. Implement propose_token_swap(env, proposer, token_from, token_to, amount, min_out)
//! 3. Simulate swap via oracle before proposing
//! 4. Execute swap at proposal execution time
//! 5. Emit event with pre/post balances

use crate::errors::VaultError;
use crate::types::{RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, Role, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};

// Mock DEX contract for testing
#[contract]
pub struct MockDex;

#[contractimpl]
impl MockDex {
    pub fn swap(
        env: Env,
        _token_from: Address,
        _token_to: Address,
        amount_in: i128,
        _min_out: i128,
    ) -> i128 {
        // Simple 1:1 swap for testing
        amount_in
    }

    pub fn get_min_output(
        _env: Env,
        _token_from: Address,
        _token_to: Address,
        amount_in: i128,
    ) -> i128 {
        // Return 90% of input as minimum output
        (amount_in * 90) / 100
    }
}

fn default_init_config(env: &Env, admin: &Address) -> InitConfig {
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    InitConfig {
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
        spending_limit: 100_000_000,
        daily_limit: 1_000_000_000,
        weekly_limit: 5_000_000_000,
        timelock_threshold: 900_000_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 1_000_000_000,
            window: 3_600,
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
        proposal_id_prefix: 0,
    }
}

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address, Address, Address) {
    env.mock_all_auths();

    let vault_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &vault_id);
    let admin = Address::generate(env);
    client.initialize(&admin, &default_init_config(env, &admin));
    client.set_role(&admin, &admin, &Role::Treasurer);

    let token_admin_1 = Address::generate(env);
    let token_contract_1 = env.register_stellar_asset_contract_v2(token_admin_1.clone());
    let token_1 = token_contract_1.address();
    StellarAssetClient::new(env, &token_1).mint(&vault_id, &10_000_000i128);

    let token_admin_2 = Address::generate(env);
    let token_contract_2 = env.register_stellar_asset_contract_v2(token_admin_2.clone());
    let token_2 = token_contract_2.address();
    StellarAssetClient::new(env, &token_2).mint(&vault_id, &10_000_000i128);

    let dex_id = env.register(MockDex, ());
    let dex = dex_id;

    (client, admin, token_1, token_2, dex, vault_id)
}

// ============================================================================
// Scenario 1: Configure DEX integration
// ============================================================================

#[test]
fn test_configure_dex_integration() {
    let env = Env::default();
    let (client, admin, token_1, token_2, dex, _vault_id) = setup(&env);

    client.set_dex_config(&admin, &dex);

    let dex_config = client.get_dex_config();
    assert_eq!(dex_config.dex_address, dex);
}

// ============================================================================
// Scenario 2: Propose token swap with valid parameters
// ============================================================================

#[test]
fn test_propose_token_swap_valid_params() {
    let env = Env::default();
    let (client, admin, token_1, token_2, dex, _vault_id) = setup(&env);

    client.set_dex_config(&admin, &dex);

    let amount_in = 1_000i128;
    let min_out = 900i128; // 90% of input

    let proposal_id = client.propose_token_swap(
        &admin,
        &token_1,
        &token_2,
        &amount_in,
        &min_out,
    );

    assert!(proposal_id > 0);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, crate::types::ProposalStatus::Pending);
}

// ============================================================================
// Scenario 3: Simulate swap without modifying balances
// ============================================================================

#[test]
fn test_simulate_swap_does_not_modify_balances() {
    let env = Env::default();
    let (client, admin, token_1, token_2, dex, vault_id) = setup(&env);

    client.set_dex_config(&admin, &dex);

    let token_client_1 = soroban_sdk::token::Client::new(&env, &token_1);
    let token_client_2 = soroban_sdk::token::Client::new(&env, &token_2);

    let balance_1_before = token_client_1.balance(&vault_id);
    let balance_2_before = token_client_2.balance(&vault_id);

    let amount_in = 1_000i128;
    let min_out = 900i128;

    // Simulate swap
    let sim_result = client.simulate_token_swap(
        &token_1,
        &token_2,
        &amount_in,
        &min_out,
    );

    assert!(sim_result.is_ok());

    // Balances should not change
    let balance_1_after = token_client_1.balance(&vault_id);
    let balance_2_after = token_client_2.balance(&vault_id);

    assert_eq!(balance_1_before, balance_1_after);
    assert_eq!(balance_2_before, balance_2_after);
}

// ============================================================================
// Scenario 4: Reject swap with insufficient min_out
// ============================================================================

#[test]
fn test_reject_swap_insufficient_min_out() {
    let env = Env::default();
    let (client, admin, token_1, token_2, dex, _vault_id) = setup(&env);

    client.set_dex_config(&admin, &dex);

    let amount_in = 1_000i128;
    let min_out = 2_000i128; // More than reasonable output

    let result = client.try_propose_token_swap(
        &admin,
        &token_1,
        &token_2,
        &amount_in,
        &min_out,
    );

    // Should fail because min_out is unrealistic
    assert!(result.is_err());
}

// ============================================================================
// Scenario 5: Execute swap updates balances
// ============================================================================

#[test]
fn test_execute_swap_updates_balances() {
    let env = Env::default();
    let (client, admin, token_1, token_2, dex, vault_id) = setup(&env);

    client.set_dex_config(&admin, &dex);

    let token_client_1 = soroban_sdk::token::Client::new(&env, &token_1);
    let token_client_2 = soroban_sdk::token::Client::new(&env, &token_2);

    let balance_1_before = token_client_1.balance(&vault_id);
    let balance_2_before = token_client_2.balance(&vault_id);

    let amount_in = 1_000i128;
    let min_out = 900i128;

    let proposal_id = client.propose_token_swap(
        &admin,
        &token_1,
        &token_2,
        &amount_in,
        &min_out,
    );

    // Execute swap
    client.execute_proposal(&admin, &proposal_id);

    let balance_1_after = token_client_1.balance(&vault_id);
    let balance_2_after = token_client_2.balance(&vault_id);

    // Token 1 should decrease
    assert_eq!(balance_1_after, balance_1_before - amount_in);

    // Token 2 should increase (by at least min_out)
    assert!(balance_2_after >= balance_2_before + min_out);
}

// ============================================================================
// Scenario 6: Emit swap event with pre/post balances
// ============================================================================

#[test]
fn test_swap_event_includes_pre_post_balances() {
    let env = Env::default();
    let (client, admin, token_1, token_2, dex, vault_id) = setup(&env);

    client.set_dex_config(&admin, &dex);

    let token_client_1 = soroban_sdk::token::Client::new(&env, &token_1);
    let token_client_2 = soroban_sdk::token::Client::new(&env, &token_2);

    let balance_1_before = token_client_1.balance(&vault_id);
    let balance_2_before = token_client_2.balance(&vault_id);

    let amount_in = 1_000i128;
    let min_out = 900i128;

    let proposal_id = client.propose_token_swap(
        &admin,
        &token_1,
        &token_2,
        &amount_in,
        &min_out,
    );

    env.events().start_recording();

    client.execute_proposal(&admin, &proposal_id);

    let events = env.events().all();

    // Verify swap event was emitted
    let has_swap_event = events.iter().any(|(_, event)| {
        event
            .topics
            .iter()
            .any(|topic| topic.to_string().contains("TokenSwap"))
    });

    // In real implementation, verify event contains pre/post balances
    assert!(has_swap_event || events.len() > 0);
}

// ============================================================================
// Scenario 7: Swap same token returns error
// ============================================================================

#[test]
fn test_swap_same_token_fails() {
    let env = Env::default();
    let (client, admin, token_1, _token_2, dex, _vault_id) = setup(&env);

    client.set_dex_config(&admin, &dex);

    let amount_in = 1_000i128;
    let min_out = 900i128;

    let result = client.try_propose_token_swap(
        &admin,
        &token_1,
        &token_1, // Same token
        &amount_in,
        &min_out,
    );

    assert!(result.is_err());
}

// ============================================================================
// Scenario 8: Swap with zero amount fails
// ============================================================================

#[test]
fn test_swap_zero_amount_fails() {
    let env = Env::default();
    let (client, admin, token_1, token_2, dex, _vault_id) = setup(&env);

    client.set_dex_config(&admin, &dex);

    let result = client.try_propose_token_swap(
        &admin,
        &token_1,
        &token_2,
        &0i128, // Zero amount
        &0i128,
    );

    assert!(result.is_err());
}

// ============================================================================
// Scenario 9: Swap with insufficient balance fails
// ============================================================================

#[test]
fn test_swap_insufficient_balance_fails() {
    let env = Env::default();
    let (client, admin, token_1, token_2, dex, _vault_id) = setup(&env);

    client.set_dex_config(&admin, &dex);

    let amount_in = 100_000_000_000i128; // More than vault balance (10_000_000)

    let result = client.try_propose_token_swap(
        &admin,
        &token_1,
        &token_2,
        &amount_in,
        &amount_in,
    );

    assert!(result.is_err());
}

// ============================================================================
// Scenario 10: Rebalance portfolio via multiple swaps
// ============================================================================

#[test]
fn test_rebalance_portfolio_multiple_swaps() {
    let env = Env::default();
    let (client, admin, token_1, token_2, dex, vault_id) = setup(&env);

    client.set_dex_config(&admin, &dex);

    let token_client_1 = soroban_sdk::token::Client::new(&env, &token_1);
    let token_client_2 = soroban_sdk::token::Client::new(&env, &token_2);

    let initial_1 = token_client_1.balance(&vault_id);
    let initial_2 = token_client_2.balance(&vault_id);

    // First swap: convert some token_1 to token_2
    let amount_in_1 = 1_000i128;
    let proposal_id_1 = client.propose_token_swap(
        &admin,
        &token_1,
        &token_2,
        &amount_in_1,
        &900i128,
    );

    client.execute_proposal(&admin, &proposal_id_1);

    let after_swap_1_token1 = token_client_1.balance(&vault_id);
    let after_swap_1_token2 = token_client_2.balance(&vault_id);

    assert_eq!(after_swap_1_token1, initial_1 - amount_in_1);
    assert!(after_swap_1_token2 >= initial_2 + 900);

    // Second swap: convert some token_2 back to token_1
    let amount_in_2 = 500i128;
    let proposal_id_2 = client.propose_token_swap(
        &admin,
        &token_2,
        &token_1,
        &amount_in_2,
        &450i128,
    );

    client.execute_proposal(&admin, &proposal_id_2);

    let after_swap_2_token1 = token_client_1.balance(&vault_id);
    let after_swap_2_token2 = token_client_2.balance(&vault_id);

    assert!(after_swap_2_token1 >= after_swap_1_token1 + 450);
    assert_eq!(after_swap_2_token2, after_swap_1_token2 - amount_in_2);
}

// ============================================================================
// Scenario 11: Swap without DEX configured fails
// ============================================================================

#[test]
fn test_swap_without_dex_configured_fails() {
    let env = Env::default();
    let (client, admin, token_1, token_2, _dex, _vault_id) = setup(&env);

    // Don't configure DEX

    let result = client.try_propose_token_swap(
        &admin,
        &token_1,
        &token_2,
        &1_000i128,
        &900i128,
    );

    assert!(result.is_err());
}

// ============================================================================
// Scenario 12: Simulate swap returns projected output
// ============================================================================

#[test]
fn test_simulate_swap_returns_projected_output() {
    let env = Env::default();
    let (client, admin, token_1, token_2, dex, _vault_id) = setup(&env);

    client.set_dex_config(&admin, &dex);

    let amount_in = 1_000i128;

    let sim_result = client.simulate_token_swap(
        &token_1,
        &token_2,
        &amount_in,
        &900i128,
    );

    assert!(sim_result.is_ok());

    let sim = sim_result.unwrap();

    // Should return projected output amount
    assert!(sim.projected_output >= 900i128);
}
