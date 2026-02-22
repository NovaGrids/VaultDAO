#![cfg(test)]

use super::*;
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Env, Symbol, Vec,
};

#[test]
fn test_multisig_approval() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    // Initialize with 2-of-3 multisig
    let config = InitConfig {
        signers,
        threshold: 2,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
    };
    client.initialize(&admin, &config);

    // Treasurer roles
    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);

    // 1. Propose transfer
    let conditions = Vec::new(&env);
    let proposal_id =
        client.propose_transfer(&signer1, &user, &token, &100, &Symbol::new(&env, "test"), &conditions, &ConditionLogic::And);

    // 2. First approval (signer1)
    client.approve_proposal(&signer1, &proposal_id);

    // Check status: Still Pending
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending);

    // 3. Second approval (signer2) -> Should meet threshold
    client.approve_proposal(&signer2, &proposal_id);

    // Check status: Approved (since amount < timelock_threshold)
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
    assert_eq!(proposal.unlock_ledger, 0); // No timelock
}

#[test]
fn test_unauthorized_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
    };
    client.initialize(&admin, &config);

    // Member tries to propose
    let conditions = Vec::new(&env);
    let res =
        client.try_propose_transfer(&member, &member, &token, &100, &Symbol::new(&env, "fail"), &conditions, &ConditionLogic::And);

    assert!(res.is_err());
    assert_eq!(res.err(), Some(Ok(VaultError::InsufficientRole)));
}

#[test]
fn test_timelock_violation() {
    let env = Env::default();
    env.mock_all_auths();

    // Setup ledgers
    env.ledger().set_sequence_number(100);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env); // In a real test, this would be a mock token

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    // Initialize with low timelock threshold
    let config = InitConfig {
        signers,
        threshold: 1,
        spending_limit: 2000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 200,
    };
    client.initialize(&admin, &config);

    client.set_role(&admin, &signer1, &Role::Treasurer);

    // 1. Propose large transfer (600 > 500)
    let conditions = Vec::new(&env);
    let proposal_id =
        client.propose_transfer(&signer1, &user, &token, &600, &Symbol::new(&env, "large"), &conditions, &ConditionLogic::And);

    // 2. Approve -> Should trigger timelock
    client.approve_proposal(&signer1, &proposal_id);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
    assert_eq!(proposal.unlock_ledger, 100 + 200); // Current + Delay

    // 3. Try execute immediately (Ledger 100)
    let res = client.try_execute_proposal(&signer1, &proposal_id);
    assert_eq!(res.err(), Some(Ok(VaultError::TimelockNotExpired)));

    // 4. Advance time past unlock (Ledger 301)
    env.ledger().set_sequence_number(301);

    // Note: This execution will fail with InsufficientBalance/TransferFailed unless we mock the token,
    // but we just want to verify we pass the timelock check.
    // In this mock, we haven't set up the token contract balance, so it will fail there.
    // However, getting past TimelockNotExpired is the goal.
    let res = client.try_execute_proposal(&signer1, &proposal_id);
    assert_ne!(res.err(), Some(Ok(VaultError::TimelockNotExpired)));
}

#[test]
fn test_condition_balance_above() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone());

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &admin, &Role::Treasurer);

    // Create condition: balance must be > 500
    let mut conditions = Vec::new(&env);
    conditions.push_back(Condition::BalanceAbove(500));

    let proposal_id = client.propose_transfer(
        &admin,
        &user,
        &token.address(),
        &100,
        &Symbol::new(&env, "cond"),
        &conditions,
        &ConditionLogic::And,
    );

    client.approve_proposal(&admin, &proposal_id);

    // Try execute with balance = 0 (condition requires > 500)
    let res = client.try_execute_proposal(&admin, &proposal_id);
    assert_eq!(res.err(), Some(Ok(VaultError::ConditionsNotMet)));
}

#[test]
fn test_condition_date_after() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone());

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &admin, &Role::Treasurer);

    // Create condition: execute only after ledger 200
    let mut conditions = Vec::new(&env);
    conditions.push_back(Condition::DateAfter(200));

    let proposal_id = client.propose_transfer(
        &admin,
        &user,
        &token.address(),
        &100,
        &Symbol::new(&env, "date"),
        &conditions,
        &ConditionLogic::And,
    );

    client.approve_proposal(&admin, &proposal_id);

    // Try execute at ledger 100 (should fail)
    let res = client.try_execute_proposal(&admin, &proposal_id);
    assert_eq!(res.err(), Some(Ok(VaultError::ConditionsNotMet)));

    // Advance to ledger 201
    env.ledger().set_sequence_number(201);

    // Now should pass condition check (but fail on balance/transfer)
    let res = client.try_execute_proposal(&admin, &proposal_id);
    assert_ne!(res.err(), Some(Ok(VaultError::ConditionsNotMet)));
}

#[test]
fn test_condition_and_logic() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone());

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &admin, &Role::Treasurer);

    // Multiple conditions with AND logic
    let mut conditions = Vec::new(&env);
    conditions.push_back(Condition::BalanceAbove(500));
    conditions.push_back(Condition::DateAfter(150));

    let proposal_id = client.propose_transfer(
        &admin,
        &user,
        &token.address(),
        &100,
        &Symbol::new(&env, "and"),
        &conditions,
        &ConditionLogic::And,
    );

    client.approve_proposal(&admin, &proposal_id);

    // At ledger 100, date condition fails
    let res = client.try_execute_proposal(&admin, &proposal_id);
    assert_eq!(res.err(), Some(Ok(VaultError::ConditionsNotMet)));

    // Advance to ledger 151 (date passes, but balance still fails)
    env.ledger().set_sequence_number(151);
    let res = client.try_execute_proposal(&admin, &proposal_id);
    assert_eq!(res.err(), Some(Ok(VaultError::ConditionsNotMet)));
}

#[test]
fn test_condition_or_logic() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone());

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &admin, &Role::Treasurer);

    // Multiple conditions with OR logic
    let mut conditions = Vec::new(&env);
    conditions.push_back(Condition::BalanceAbove(500));
    conditions.push_back(Condition::DateAfter(50)); // This is already true

    let proposal_id = client.propose_transfer(
        &admin,
        &user,
        &token.address(),
        &100,
        &Symbol::new(&env, "or"),
        &conditions,
        &ConditionLogic::Or,
    );

    client.approve_proposal(&admin, &proposal_id);

    // At ledger 100, DateAfter(50) is true, so OR passes
    let res = client.try_execute_proposal(&admin, &proposal_id);
    // Should not fail on ConditionsNotMet (will fail on balance/transfer instead)
    assert_ne!(res.err(), Some(Ok(VaultError::ConditionsNotMet)));
}

#[test]
fn test_no_conditions() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone());

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &admin, &Role::Treasurer);

    // Empty conditions
    let conditions = Vec::new(&env);

    let proposal_id = client.propose_transfer(
        &admin,
        &user,
        &token.address(),
        &100,
        &Symbol::new(&env, "none"),
        &conditions,
        &ConditionLogic::And,
    );

    client.approve_proposal(&admin, &proposal_id);

    // Should not fail on conditions (will fail on balance/transfer)
    let res = client.try_execute_proposal(&admin, &proposal_id);
    assert_ne!(res.err(), Some(Ok(VaultError::ConditionsNotMet)));
}
