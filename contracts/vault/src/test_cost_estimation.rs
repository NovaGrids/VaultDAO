use super::*;
use crate::types::{
    ConditionLogic, CostModel, Priority, RetryConfig, ThresholdStrategy, VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Symbol, Vec};

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address) {
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
            spending_limit: 1_000_000,
            daily_limit: 5_000_000,
            weekly_limit: 10_000_000,
            timelock_threshold: 999_999,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 100,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            veto_addresses: Vec::new(env),
            veto_window_ledgers: 0,
            retry_config: RetryConfig {
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(env),
            staking_config: crate::types::StakingConfig::default(),
            proposal_id_prefix: 0,
        },
    );

    (client, admin, token, contract_id)
}

fn create_proposal(
    env: &Env,
    client: &VaultDAOClient<'_>,
    proposer: &Address,
    token: &Address,
    vault_contract: &Address,
) -> u64 {
    StellarAssetClient::new(env, token).mint(vault_contract, &1_000_000);
    let recipient = Address::generate(env);
    client.propose_transfer(
        proposer,
        &recipient,
        token,
        &100i128,
        &Symbol::new(env, "test"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    )
}

// ============================================================================
// update_cost_model + get_cost_model
// ============================================================================

#[test]
fn test_default_cost_model_returned_when_not_set() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _, _) = setup(&env);

    let model = client.get_cost_model();
    // Default model has non-zero base compute units
    assert!(model.base_compute_units > 0);
}

#[test]
fn test_update_cost_model_admin_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _) = setup(&env);

    let model = CostModel {
        base_compute_units: 1_000_000,
        per_condition_compute_units: 100_000,
        per_attachment_compute_units: 20_000,
        per_phase_compute_units: 200_000,
        base_ledger_reads: 10,
        base_ledger_writes: 5,
        stroops_per_10k_compute_units: 200,
    };
    client.update_cost_model(&admin, &model);

    let stored = client.get_cost_model();
    assert_eq!(stored.base_compute_units, 1_000_000);
    assert_eq!(stored.per_condition_compute_units, 100_000);
    assert_eq!(stored.stroops_per_10k_compute_units, 200);
}

#[test]
fn test_update_cost_model_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _, _) = setup(&env);
    let stranger = Address::generate(&env);

    let model = CostModel::default();
    let result = client.try_update_cost_model(&stranger, &model);
    assert_eq!(result, Err(Ok(VaultError::Unauthorized)));
}

// ============================================================================
// estimate_proposal_cost
// ============================================================================

#[test]
fn test_estimate_single_operation_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let estimate = client.estimate_proposal_cost(&proposal_id).unwrap();

    // Base compute units + 10% buffer = base * 1.1
    let model = client.get_cost_model();
    let expected_base = model.base_compute_units + model.base_compute_units / 10;
    assert_eq!(estimate.compute_units, expected_base);
    assert!(estimate.ledger_reads >= model.base_ledger_reads);
    assert!(estimate.ledger_writes >= model.base_ledger_writes);
}

#[test]
fn test_estimate_proposal_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _, _) = setup(&env);
    let result = client.try_estimate_proposal_cost(&9999u64);
    assert_eq!(result, Err(Ok(VaultError::ProposalNotFound)));
}

#[test]
fn test_estimate_respects_custom_cost_model() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let model = CostModel {
        base_compute_units: 2_000_000,
        per_condition_compute_units: 0,
        per_attachment_compute_units: 0,
        per_phase_compute_units: 0,
        base_ledger_reads: 8,
        base_ledger_writes: 4,
        stroops_per_10k_compute_units: 500,
    };
    client.update_cost_model(&admin, &model);

    let estimate = client.estimate_proposal_cost(&proposal_id).unwrap();

    // 2_000_000 base + 10% buffer = 2_200_000
    assert_eq!(estimate.compute_units, 2_200_000);
    assert_eq!(estimate.ledger_reads, 8);
    assert_eq!(estimate.ledger_writes, 4);
    // fee = (2_200_000 / 10_000) * 500 = 220 * 500 = 110_000
    assert_eq!(estimate.fee_estimate_xlm, 110_000);
}
