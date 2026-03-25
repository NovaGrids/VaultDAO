use super::*;
use crate::types::{AmountTier, RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, Vec};

fn init_config(
    env: &Env,
    signers: Vec<Address>,
    threshold: u32,
    strategy: ThresholdStrategy,
) -> InitConfig {
    InitConfig {
        signers,
        threshold,
        quorum: 0,
        default_voting_deadline: 0,
        spending_limit: 10_000,
        daily_limit: 100_000,
        weekly_limit: 500_000,
        timelock_threshold: 50_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: strategy,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        veto_addresses: Vec::new(env),
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: types::StakingConfig::default(),
    }
}

#[test]
fn test_amount_based_threshold_strategy_boundaries() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let s3 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &100_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(s1.clone());
    signers.push_back(s2.clone());
    signers.push_back(s3.clone());

    let mut tiers = Vec::new(&env);
    tiers.push_back(AmountTier {
        amount: 100,
        approvals: 2,
    });
    tiers.push_back(AmountTier {
        amount: 500,
        approvals: 3,
    });
    tiers.push_back(AmountTier {
        amount: 1000,
        approvals: 4,
    });

    client.initialize(
        &admin,
        &init_config(&env, signers, 1, ThresholdStrategy::AmountBased(tiers)),
    );
    client.set_role(&admin, &s1, &Role::Treasurer);
    client.set_role(&admin, &s2, &Role::Treasurer);
    client.set_role(&admin, &s3, &Role::Treasurer);

    let p = client.propose_transfer(
        &s1,
        &user,
        &token,
        &499,
        &Symbol::new(&env, "tier"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    client.approve_proposal(&s1, &p);
    client.approve_proposal(&s2, &p);
    assert_eq!(client.get_proposal(&p).status, ProposalStatus::Approved);
}

#[test]
fn test_role_assignments_query_returns_deterministic_order() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer = Address::generate(&env);
    let user = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    client.initialize(
        &admin,
        &init_config(&env, signers, 1, ThresholdStrategy::Fixed),
    );
    client.set_role(&admin, &user, &Role::Treasurer);

    let assignments = client.get_role_assignments();
    assert_eq!(assignments.len(), 3);
    assert_eq!(assignments.get(0).unwrap().addr, admin);
    assert_eq!(assignments.get(0).unwrap().role, Role::Admin);
    assert_eq!(assignments.get(1).unwrap().addr, signer);
    assert_eq!(assignments.get(1).unwrap().role, Role::Member);
    assert_eq!(assignments.get(2).unwrap().addr, user);
    assert_eq!(assignments.get(2).unwrap().role, Role::Treasurer);
}
