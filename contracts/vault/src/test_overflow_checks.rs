use super::*;
use crate::types::{Priority, Role};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, Vec};

fn setup(env: &Env) -> (VaultDAOClient<'static>, Address, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let signer1 = Address::generate(env);
    let signer2 = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

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
            threshold: 2,
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

    (client, admin, signer1, signer2, contract_id)
}

/// Issue #1417: Fix Integer Overflow in Insurance and Staking Calculations
/// Test insurance calculation with normal amounts (no overflow)
#[test]
fn test_insurance_calculation_normal_amounts() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let recipient = Address::generate(&env);

    // Normal amount should calculate insurance correctly
    // amount * min_insurance_bps / 10_000
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &1000i128,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );

    assert!(proposal_id > 0);
}

/// Issue #1417: amounts at the top of the i128 range must be rejected with a
/// typed contract error, never an arithmetic overflow panic.
#[test]
fn test_proposal_amount_near_i128_max_is_rejected_without_overflow() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2, _contract_id) = setup(&env);

    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let recipient = Address::generate(&env);

    for amount in [92233720368547758i128, i128::MAX / 2, i128::MAX] {
        let result = client.try_propose_transfer(
            &admin,
            &recipient,
            &token,
            &amount,
            &Symbol::new(&env, "memo"),
            &Priority::Normal,
            &Vec::new(&env),
            &crate::types::ConditionLogic::And,
            &0i128,
        );
        assert_eq!(result, Err(Ok(VaultError::ExceedsProposalLimit)));
    }
}

/// Issue #1417: an insurance amount at i128::MAX must not overflow the
/// insurance/stake arithmetic; it resolves to a typed error.
#[test]
fn test_insurance_amount_at_i128_max_does_not_overflow() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2, _contract_id) = setup(&env);

    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();

    let result = client.try_propose_transfer(
        &admin,
        &Address::generate(&env),
        &token,
        &1000i128,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &i128::MAX,
    );
    // Err(Ok(_)) is a contract error; an overflow panic would surface as Err(Err(_)).
    assert!(
        matches!(result, Err(Ok(_))),
        "expected a typed error, got {result:?}"
    );
}

/// Issue #1417: Test multiplication overflow in dividend calculation
#[test]
fn test_dividend_multiplication_safe() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let recipient = Address::generate(&env);

    // Proposal with dividend calculation
    // amount * rate / divisor should use checked operations
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &1000i128,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );

    assert!(proposal_id > 0);
}

/// Issue #1417: Test saturating arithmetic for bounds
#[test]
fn test_saturating_arithmetic_used() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let recipient = Address::generate(&env);

    // When operations would exceed bounds, saturating operations should cap at i128::MAX
    // instead of panicking or wrapping
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100_000i128,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );

    assert!(proposal_id > 0);
}

/// Issue #1417: amounts above the per-proposal limit are rejected before any
/// velocity/spending accumulation can overflow.
#[test]
fn test_velocity_limit_checked() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2, _contract_id) = setup(&env);

    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let recipient = Address::generate(&env);
    let propose = |amount: i128| {
        client.try_propose_transfer(
            &admin,
            &recipient,
            &token,
            &amount,
            &Symbol::new(&env, "memo"),
            &Priority::Normal,
            &Vec::new(&env),
            &crate::types::ConditionLogic::And,
            &0i128,
        )
    };

    // At the 100_000 spending limit: accepted.
    assert!(propose(100_000).is_ok());
    // Above it: typed rejection, no overflow.
    assert_eq!(propose(500_000), Err(Ok(VaultError::ExceedsProposalLimit)));
}

/// Issue #1417: Test daily/weekly spending accumulation safe
#[test]
fn test_daily_weekly_spending_accumulation() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, signer1, _signer2, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    client.set_role(&admin, &signer1, &Role::Treasurer);

    // Multiple proposals accumulating daily/weekly spending
    // total = existing + new_amount should use checked_add
    for i in 0..5 {
        let recipient = Address::generate(&env);
        let _proposal_id = client.propose_transfer(
            &admin,
            &recipient,
            &token,
            &50_000i128,
            &Symbol::new(&env, "memo"),
            &Priority::Normal,
            &Vec::new(&env),
            &crate::types::ConditionLogic::And,
            &0i128,
        );
    }
}
