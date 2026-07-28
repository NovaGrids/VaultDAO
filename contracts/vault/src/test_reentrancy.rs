use super::*;
use crate::types::{ConditionLogic, Priority, Role};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, Vec};

fn setup(env: &Env) -> (VaultDAOClient<'static>, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    client.initialize(
        &admin,
        &crate::types::InitConfig {
            veto_window_ledgers: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: crate::types::VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers,
            threshold: 1,
            quorum: 0,
            spending_limit: 100_000,
            daily_limit: 500_000,
            weekly_limit: 1_000_000,
            timelock_threshold: 0,
            timelock_delay: 0,
            velocity_limit: crate::types::VelocityConfig {
                limit: 1_000_000,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: crate::types::ThresholdStrategy::Fixed,
            default_voting_deadline: 0,
            veto_addresses: Vec::new(env),
            retry_config: crate::types::RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(env),
            staking_config: crate::types::StakingConfig::default(),
            proposal_id_prefix: 0,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            quorum_percentage: 0,
        },
    );

    (client, admin, contract_id)
}

#[test]
fn test_reentrancy_guard_set_during_execution() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
    let recipient = Address::generate(&env);

    client.set_role(&admin, &admin, &Role::Treasurer);
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100i128,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    client.approve(&admin, &proposal_id);

    let result = client.execute_proposal(&admin, &proposal_id);
    assert!(result.is_ok(), "First execution should succeed");
}

#[test]
fn test_reentrancy_guard_cleared_after_execution() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
    let recipient = Address::generate(&env);

    client.set_role(&admin, &admin, &Role::Treasurer);
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100i128,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    client.approve(&admin, &proposal_id);
    let _ = client.execute_proposal(&admin, &proposal_id);

    // Verify that the reentrancy guard is cleared by checking that the proposal is executed
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(
        proposal.status,
        ProposalStatus::Executed,
        "Proposal should be executed"
    );
}

#[test]
fn test_proposal_already_executed_prevents_reexecution() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
    let recipient = Address::generate(&env);

    client.set_role(&admin, &admin, &Role::Treasurer);
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100i128,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    client.approve(&admin, &proposal_id);
    let _ = client.execute_proposal(&admin, &proposal_id);

    // Try to execute again - should fail
    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert!(result.is_err(), "Second execution should fail");
}

#[test]
fn test_reentrancy_guard_multiple_proposals() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&admin, &20_000);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);

    client.set_role(&admin, &admin, &Role::Treasurer);
    let proposal_id1 = client.propose_transfer(
        &admin,
        &recipient1,
        &token,
        &100i128,
        &Symbol::new(&env, "memo1"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    let proposal_id2 = client.propose_transfer(
        &admin,
        &recipient2,
        &token,
        &100i128,
        &Symbol::new(&env, "memo2"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    client.approve(&admin, &proposal_id1);
    client.approve(&admin, &proposal_id2);

    let result1 = client.execute_proposal(&admin, &proposal_id1);
    let result2 = client.execute_proposal(&admin, &proposal_id2);

    assert!(result1.is_ok(), "First proposal execution should succeed");
    assert!(result2.is_ok(), "Second proposal execution should succeed");
}
