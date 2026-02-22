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
fn test_delegation_basic() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let _token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

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

    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);

    // Signer1 delegates to Signer2 (permanent delegation)
    let delegation_id = client.delegate_voting_power(&signer1, &signer2, &0);
    assert_eq!(delegation_id, 1);

    // Verify delegation
    let delegation = client.get_delegation(&delegation_id);
    assert_eq!(delegation.delegator, signer1);
    assert_eq!(delegation.delegate, signer2);
    assert_eq!(delegation.expiry_ledger, 0);
    assert!(delegation.is_active);

    // Verify effective voter
    let effective = client.get_effective_voter(&signer1);
    assert_eq!(effective, signer2);
}

#[test]
fn test_delegation_temporary() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

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

    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);

    // Temporary delegation (expires at ledger 200)
    let _delegation_id = client.delegate_voting_power(&signer1, &signer2, &200);

    // Before expiry: delegation is active
    let effective = client.get_effective_voter(&signer1);
    assert_eq!(effective, signer2);

    // After expiry: delegation is inactive
    env.ledger().set_sequence_number(201);
    let effective = client.get_effective_voter(&signer1);
    assert_eq!(effective, signer1); // Back to original
}

#[test]
fn test_delegation_chain() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

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

    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);
    client.set_role(&admin, &signer3, &Role::Treasurer);

    // Create delegation chain: signer1 -> signer2 -> signer3
    client.delegate_voting_power(&signer1, &signer2, &0);
    client.delegate_voting_power(&signer2, &signer3, &0);

    // Verify chain resolution
    let effective = client.get_effective_voter(&signer1);
    assert_eq!(effective, signer3);

    let effective = client.get_effective_voter(&signer2);
    assert_eq!(effective, signer3);
}

#[test]
fn test_delegation_circular_prevention() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

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

    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);

    // Signer1 delegates to Signer2
    client.delegate_voting_power(&signer1, &signer2, &0);

    // Signer2 tries to delegate back to Signer1 (circular!)
    let res = client.try_delegate_voting_power(&signer2, &signer1, &0);
    assert_eq!(res.err(), Some(Ok(VaultError::CircularDelegation)));
}

#[test]
fn test_delegation_max_depth() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);
    let signer4 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());
    signers.push_back(signer4.clone());

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

    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);
    client.set_role(&admin, &signer3, &Role::Treasurer);
    client.set_role(&admin, &signer4, &Role::Treasurer);

    // Create chain: signer1 -> signer2 -> signer3 -> signer4
    client.delegate_voting_power(&signer1, &signer2, &0);
    client.delegate_voting_power(&signer2, &signer3, &0);
    client.delegate_voting_power(&signer3, &signer4, &0);

    // Resolving signer1 should hit max depth (3 levels)
    let res = client.try_get_effective_voter(&signer1);
    assert_eq!(res.err(), Some(Ok(VaultError::DelegationChainTooDeep)));
}

#[test]
fn test_delegation_revocation() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

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

    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);

    // Create delegation
    let delegation_id = client.delegate_voting_power(&signer1, &signer2, &0);

    // Verify delegation is active
    let effective = client.get_effective_voter(&signer1);
    assert_eq!(effective, signer2);

    // Revoke delegation
    client.revoke_delegation(&signer1, &delegation_id);

    // Verify delegation is revoked
    let delegation = client.get_delegation(&delegation_id);
    assert!(!delegation.is_active);

    // Effective voter should be back to original
    let effective = client.get_effective_voter(&signer1);
    assert_eq!(effective, signer1);
}

#[test]
fn test_delegation_with_proposal_approval() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

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

    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);
    client.set_role(&admin, &signer3, &Role::Treasurer);

    // Signer1 delegates to Signer2
    client.delegate_voting_power(&signer1, &signer2, &0);

    // Create proposal
    let proposal_id =
        client.propose_transfer(&signer3, &user, &token, &100, &Symbol::new(&env, "test"));

    // Signer1 approves (but their vote goes to Signer2 via delegation)
    client.approve_proposal(&signer1, &proposal_id);

    // Check that Signer2 is recorded as approver (effective voter)
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.approvals.len(), 1);
    assert_eq!(proposal.approvals.get(0).unwrap(), signer2);

    // Signer2 cannot approve again (already approved via delegation)
    let res = client.try_approve_proposal(&signer2, &proposal_id);
    assert_eq!(res.err(), Some(Ok(VaultError::AlreadyApproved)));

    // Signer3 approves to meet threshold
    client.approve_proposal(&signer3, &proposal_id);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
}

#[test]
fn test_delegation_cannot_delegate_to_self() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

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

    client.set_role(&admin, &signer1, &Role::Treasurer);

    // Try to delegate to self
    let res = client.try_delegate_voting_power(&signer1, &signer1, &0);
    assert_eq!(res.err(), Some(Ok(VaultError::CannotDelegateToSelf)));
}

#[test]
fn test_delegation_non_signer_cannot_delegate() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let non_signer = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

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

    client.set_role(&admin, &signer1, &Role::Treasurer);

    // Non-signer tries to delegate
    let res = client.try_delegate_voting_power(&non_signer, &signer1, &0);
    assert_eq!(res.err(), Some(Ok(VaultError::DelegatorNotSigner)));
}

#[test]
fn test_delegation_cannot_delegate_to_non_signer() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let non_signer = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

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

    client.set_role(&admin, &signer1, &Role::Treasurer);

    // Signer tries to delegate to non-signer
    let res = client.try_delegate_voting_power(&signer1, &non_signer, &0);
    assert_eq!(res.err(), Some(Ok(VaultError::DelegateNotSigner)));
}

#[test]
fn test_delegation_already_exists() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

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

    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);
    client.set_role(&admin, &signer3, &Role::Treasurer);

    // Create first delegation
    client.delegate_voting_power(&signer1, &signer2, &0);

    // Try to create another delegation (should fail)
    let res = client.try_delegate_voting_power(&signer1, &signer3, &0);
    assert_eq!(res.err(), Some(Ok(VaultError::DelegationAlreadyExists)));
}
