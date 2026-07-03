use super::*;
use crate::types::{
    ConditionLogic, DisputeStatus, Priority, Role,
};
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

fn make_proposal(
    env: &Env,
    client: &VaultDAOClient,
    admin: &Address,
    token: &Address,
    recipient: &Address,
) -> u64 {
    client.set_role(admin, admin, &Role::Treasurer);
    client.propose_transfer(
        admin,
        recipient,
        token,
        &100i128,
        &Symbol::new(env, "memo"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    )
}

#[test]
fn test_raise_dispute_by_signer_with_bond() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&admin, &10_000); // Mint to admin so they can post bond
    let recipient = Address::generate(&env);

    let proposal_id = make_proposal(&env, &client, &admin, &token, &recipient);

    let bond_amount = 100i128;
    let dispute_id = client.raise_dispute(
        &admin,
        &proposal_id,
        &None,
        &Symbol::new(&env, "fraud"),
        &Vec::new(&env),
        &token,
        &bond_amount,
    );

    assert_eq!(dispute_id, 1);

    let dispute = client.get_dispute(&dispute_id);
    assert_eq!(dispute.proposal_id, proposal_id);
    assert_eq!(dispute.status, DisputeStatus::Filed);
    assert_eq!(dispute.dispute_bond, bond_amount);
    assert_eq!(dispute.bond_token, token);

    let ids = client.get_proposal_disputes(&proposal_id);
    assert_eq!(ids.len(), 1);
    assert_eq!(ids.get(0).unwrap(), dispute_id);
}






#[test]
fn test_dispute_bond_too_small() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
    let recipient = Address::generate(&env);

    let proposal_id = make_proposal(&env, &client, &admin, &token, &recipient);

    // Try 0 bond
    let result = client.try_raise_dispute(
        &admin,
        &proposal_id,
        &None,
        &Symbol::new(&env, "fraud"),
        &Vec::new(&env),
        &token,
        &0i128,
    );
    assert_eq!(result, Err(Ok(VaultError::DisputeBondTooSmall)));
}









