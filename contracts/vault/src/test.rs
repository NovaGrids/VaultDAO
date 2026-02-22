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
    let proposal_id =
        client.propose_transfer(&signer1, &user, &token, &100, &Symbol::new(&env, "test"));

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
    let res =
        client.try_propose_transfer(&member, &member, &token, &100, &Symbol::new(&env, "fail"));

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
    let proposal_id =
        client.propose_transfer(&signer1, &user, &token, &600, &Symbol::new(&env, "large"));

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
fn test_whitelist_mode() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let approved_recipient = Address::generate(&env);
    let unapproved_recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());

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
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // Enable whitelist mode
    client.set_list_mode(&admin, &ListMode::Whitelist);

    // Add approved recipient to whitelist
    client.add_to_whitelist(&admin, &approved_recipient);

    // Try to propose to approved recipient - should succeed
    let result = client.try_propose_transfer(
        &treasurer,
        &approved_recipient,
        &token,
        &100,
        &Symbol::new(&env, "approved"),
    );
    assert!(result.is_ok());

    // Try to propose to unapproved recipient - should fail
    let result = client.try_propose_transfer(
        &treasurer,
        &unapproved_recipient,
        &token,
        &100,
        &Symbol::new(&env, "unapproved"),
    );
    assert!(result.is_err());
    assert_eq!(result.err(), Some(Ok(VaultError::RecipientNotWhitelisted)));
}

#[test]
fn test_blacklist_mode() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let normal_recipient = Address::generate(&env);
    let blocked_recipient = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());

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
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // Enable blacklist mode
    client.set_list_mode(&admin, &ListMode::Blacklist);

    // Add blocked recipient to blacklist
    client.add_to_blacklist(&admin, &blocked_recipient);

    // Try to propose to normal recipient - should succeed
    let result = client.try_propose_transfer(
        &treasurer,
        &normal_recipient,
        &token,
        &100,
        &Symbol::new(&env, "normal"),
    );
    assert!(result.is_ok());

    // Try to propose to blocked recipient - should fail
    let result = client.try_propose_transfer(
        &treasurer,
        &blocked_recipient,
        &token,
        &100,
        &Symbol::new(&env, "blocked"),
    );
    assert!(result.is_err());
    assert_eq!(result.err(), Some(Ok(VaultError::RecipientBlacklisted)));
}

#[test]
fn test_list_management() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let address1 = Address::generate(&env);
    let address2 = Address::generate(&env);

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

    // Test whitelist operations
    assert!(!client.is_whitelisted(&address1));
    client.add_to_whitelist(&admin, &address1);
    assert!(client.is_whitelisted(&address1));

    // Try to add again - should fail
    let result = client.try_add_to_whitelist(&admin, &address1);
    assert!(result.is_err());
    assert_eq!(result.err(), Some(Ok(VaultError::AddressAlreadyOnList)));

    client.remove_from_whitelist(&admin, &address1);
    assert!(!client.is_whitelisted(&address1));

    // Test blacklist operations
    assert!(!client.is_blacklisted(&address2));
    client.add_to_blacklist(&admin, &address2);
    assert!(client.is_blacklisted(&address2));

    client.remove_from_blacklist(&admin, &address2);
    assert!(!client.is_blacklisted(&address2));

    // Test list mode changes
    assert_eq!(client.get_list_mode(), ListMode::Disabled);
    client.set_list_mode(&admin, &ListMode::Whitelist);
    assert_eq!(client.get_list_mode(), ListMode::Whitelist);
    client.set_list_mode(&admin, &ListMode::Blacklist);
    assert_eq!(client.get_list_mode(), ListMode::Blacklist);
}
