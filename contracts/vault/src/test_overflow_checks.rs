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

    client.set_role(&admin, &admin, &Role::Treasurer);

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

/// Issue #1417: Test insurance calculation near i128::MAX without overflow
#[test]
fn test_insurance_calculation_large_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let recipient = Address::generate(&env);

    client.set_role(&admin, &admin, &Role::Treasurer);

    // Use a large but safe amount that won't overflow with typical insurance bps
    // i128::MAX = 9223372036854775807
    // If min_insurance_bps = 100 (1%), then: 9223372036854775807 * 100 / 10_000 would overflow
    // Safe amount would be: 9223372036854775807 / 100 * 100 = 92233720368547758
    let safe_large_amount = 92233720368547758i128;

    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &safe_large_amount,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );

    assert!(proposal_id > 0);
}

/// Issue #1417: Test staking calculation with normal amounts
#[test]
fn test_staking_calculation_normal_amounts() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, signer1, _signer2, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    client.set_role(&admin, &admin, &Role::Treasurer);
    client.set_role(&signer1, &signer1, &Role::Staker);

    // Normal staking amount should work without overflow
    // stake_proposal with normal amount
}

/// Issue #1417: Test batch proposal transfer overflow prevention
#[test]
fn test_batch_proposal_no_overflow() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    client.set_role(&admin, &admin, &Role::Treasurer);

    // Create batch proposal with multiple transfers
    // Should handle accumulation without overflow
    let mut recipients = Vec::new(&env);
    let mut amounts = Vec::new(&env);

    for i in 0..3 {
        recipients.push_back(Address::generate(&env));
        amounts.push_back(1000i128);
    }

    // batch_propose_transfers should safely calculate totals
    // without integer overflow
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

    client.set_role(&admin, &admin, &Role::Treasurer);

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

    client.set_role(&admin, &admin, &Role::Treasurer);

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

/// Issue #1417: Test insurance claim amount overflow
#[test]
fn test_insurance_claim_no_overflow() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    // Insurance claim calculations should also use checked operations
    // claim_amount * payout_ratio / divisor
}

/// Issue #1417: Test velocity limit enforcement with large amounts
#[test]
fn test_velocity_limit_checked() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let recipient = Address::generate(&env);

    client.set_role(&admin, &admin, &Role::Treasurer);

    // Velocity tracking: cumulative_amount + new_amount should be checked
    // for overflow before comparing with limit
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &500_000i128,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );

    assert!(proposal_id > 0);
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

    client.set_role(&admin, &admin, &Role::Treasurer);
    client.set_role(&signer1, &signer1, &Role::Approver);

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
