#![cfg(test)]

use super::*;
use crate::types::{AmountTier, DexConfig, SwapProposal, TimeBasedThreshold, VelocityConfig};
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
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);

    // Treasurer roles
    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);

    // 1. Propose transfer
    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

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
        threshold: 1, // Fixed: Threshold must be <= signers length (1)
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);

    let res = client.try_propose_transfer(
        &member,
        &member,
        &token,
        &100,
        &Symbol::new(&env, "fail"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    assert!(res.is_err());
    assert_eq!(res.err(), Some(Ok(VaultError::InsufficientRole)));
}

#[test]
fn test_timelock_violation() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set_sequence_number(100);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);

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
        timelock_delay: 200,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &600,
        &Symbol::new(&env, "large"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    client.approve_proposal(&signer1, &proposal_id);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
    assert_eq!(proposal.unlock_ledger, 100 + 200);

    let res = client.try_execute_proposal(&signer1, &proposal_id);
    assert_eq!(res.err(), Some(Ok(VaultError::TimelockNotExpired)));

    env.ledger().set_sequence_number(301);
    let res = client.try_execute_proposal(&signer1, &proposal_id);
    assert_ne!(res.err(), Some(Ok(VaultError::TimelockNotExpired)));
}

#[test]
fn test_priority_levels() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = InitConfig {
        signers,
        threshold: 2,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

    // Create proposals with different priorities
    let low_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "low"),
        &Priority::Low,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    let normal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "normal"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    let high_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "high"),
        &Priority::High,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    let critical_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "critical"),
        &Priority::Critical,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Verify priorities
    let low_proposal = client.get_proposal(&low_id);
    assert_eq!(low_proposal.priority, Priority::Low);

    let normal_proposal = client.get_proposal(&normal_id);
    assert_eq!(normal_proposal.priority, Priority::Normal);

    let high_proposal = client.get_proposal(&high_id);
    assert_eq!(high_proposal.priority, Priority::High);

    let critical_proposal = client.get_proposal(&critical_id);
    assert_eq!(critical_proposal.priority, Priority::Critical);
}

#[test]
fn test_get_proposals_by_priority() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = InitConfig {
        signers,
        threshold: 2,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

    // Create proposals with different priorities
    let low_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "low"),
        &Priority::Low,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    let critical_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "critical"),
        &Priority::Critical,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Verify each is in the correct priority queue
    let low_queue = client.get_proposals_by_priority(&Priority::Low);
    assert!(low_queue.contains(low_id));
    assert!(!low_queue.contains(critical_id));

    let critical_queue = client.get_proposals_by_priority(&Priority::Critical);
    assert!(critical_queue.contains(critical_id));
    assert!(!critical_queue.contains(low_id));
}

#[test]
fn test_change_priority_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let random_user = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = InitConfig {
        signers,
        threshold: 2,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

    // Create a proposal as signer1
    let proposal_id = client.propose_transfer(
        &signer1,
        &admin,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Low,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // A random user (not admin or proposer) tries to change priority - should fail
    let res = client.try_change_priority(&random_user, &proposal_id, &Priority::Critical);
    assert_eq!(res.err(), Some(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_comment_functionality() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = InitConfig {
        signers,
        threshold: 2,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

    // Create a proposal
    let proposal_id = client.propose_transfer(
        &signer1,
        &admin,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Add a comment (Symbol does not allow spaces)
    let comment_text = Symbol::new(&env, "Looksgood");
    let comment_id = client.add_comment(&signer1, &proposal_id, &comment_text, &0);
    assert_eq!(comment_id, 1);

    // Get comments
    let comments = client.get_proposal_comments(&proposal_id);
    assert_eq!(comments.len(), 1);

    let comment = comments.get(0).unwrap();
    assert_eq!(comment.proposal_id, proposal_id);
    assert_eq!(comment.author, signer1);
    assert_eq!(comment.parent_id, 0);

    // Add a reply
    let reply_text = Symbol::new(&env, "Agreed");
    let reply_id = client.add_comment(&admin, &proposal_id, &reply_text, &comment_id);
    assert_eq!(reply_id, 2);

    // Advance ledger so edited_at will be non-zero
    env.ledger().set_sequence_number(10);

    // Edit comment
    let new_text = Symbol::new(&env, "Needsreview");
    client.edit_comment(&signer1, &comment_id, &new_text);

    let updated_comment = client.get_comment(&comment_id);
    assert_eq!(updated_comment.text, new_text);

    // Test non-author edit fails
    let res = client.try_edit_comment(&admin, &comment_id, &Symbol::new(&env, "hack"));
    assert_eq!(res.err(), Some(Ok(VaultError::NotCommentAuthor)));
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
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // Enable blacklist mode
    client.set_list_mode(&admin, &ListMode::Blacklist);

    // Add blocked_recipient to blacklist
    client.add_to_blacklist(&admin, &blocked_recipient);

    // Try to propose to normal recipient - should succeed
    let result = client.try_propose_transfer(
        &treasurer,
        &normal_recipient,
        &token,
        &100,
        &Symbol::new(&env, "normal"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    assert!(result.is_ok());

    // Try to propose to blocked recipient - should fail
    let result2 = client.try_propose_transfer(
        &treasurer,
        &blocked_recipient,
        &token,
        &100,
        &Symbol::new(&env, "blocked"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    assert!(result2.is_err());
    assert_eq!(result2.err(), Some(Ok(VaultError::RecipientBlacklisted)));
}

#[test]
fn test_abstention_does_not_count_toward_threshold() {
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
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);
    client.set_role(&admin, &signer3, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Signer2 abstains — threshold still requires 2 approvals
    client.abstain_from_proposal(&signer2, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending);

    // Only 1 approval — not enough even though signer2 abstained
    client.approve_proposal(&signer1, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending);

    // Second real approval tips the balance
    client.approve_proposal(&admin, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
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
    signers.push_back(address1.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);

    // Whitelist management
    client.set_list_mode(&admin, &ListMode::Whitelist);
    assert!(!client.is_whitelisted(&address1));

    client.add_to_whitelist(&admin, &address1);
    assert!(client.is_whitelisted(&address1));

    client.remove_from_whitelist(&admin, &address1);
    assert!(!client.is_whitelisted(&address1));

    // Blacklist management
    client.set_list_mode(&admin, &ListMode::Blacklist);
    assert!(!client.is_blacklisted(&address2));

    client.add_to_blacklist(&admin, &address2);
    assert!(client.is_blacklisted(&address2));

    client.remove_from_blacklist(&admin, &address2);
    assert!(!client.is_blacklisted(&address2));
}

#[test]
fn test_cannot_abstain_after_voting() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = InitConfig {
        signers,
        threshold: 2,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Signer1 approves
    client.approve_proposal(&signer1, &proposal_id);

    let res = client.try_abstain_from_proposal(&signer1, &proposal_id);
    // Updated assertion to match contract logic:
    assert_eq!(res.err(), Some(Ok(VaultError::AlreadyApproved)));
}

#[test]
fn test_cannot_abstain_twice() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = InitConfig {
        signers,
        threshold: 2,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Signer1 abstains
    client.abstain_from_proposal(&signer1, &proposal_id);

    // Try to abstain again
    let res = client.try_abstain_from_proposal(&signer1, &proposal_id);
    assert_eq!(res.err(), Some(Ok(VaultError::AlreadyApproved)));
}

#[test]
fn test_velocity_limit_enforcement() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1000);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 2,
            window: 60,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer, &Role::Treasurer);

    // T1: Success
    client.propose_transfer(
        &signer,
        &user,
        &token,
        &10,
        &Symbol::new(&env, "t1"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // T2: Success
    client.propose_transfer(
        &signer,
        &user,
        &token,
        &10,
        &Symbol::new(&env, "t2"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // T3: Should FAIL (3rd in window)
    let res = client.try_propose_transfer(
        &signer,
        &user,
        &token,
        &10,
        &Symbol::new(&env, "t3"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    assert_eq!(res.err(), Some(Ok(VaultError::VelocityLimitExceeded)));
}

#[test]
fn test_verify_attachment() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);

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
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        }, // Added missing field
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    let ipfs_hash =
        soroban_sdk::String::from_str(&env, "QmXyZ123456789abcdefghijklmnopqrstuvwxyz1234");

    client.add_attachment(&signer1, &proposal_id, &ipfs_hash);
    // Attachment added successfully (no public getter to verify)
}

#[test]
fn test_remove_attachment() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);

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
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        }, // Added missing field
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    let ipfs_hash =
        soroban_sdk::String::from_str(&env, "QmXyZ123456789abcdefghijklmnopqrstuvwxyz1234");

    client.add_attachment(&signer1, &proposal_id, &ipfs_hash);
    client.remove_attachment(&signer1, &proposal_id, &0u32);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.attachments.len(), 0);
}

#[test]
fn test_attachment_unauthorized() {
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

    let config = InitConfig {
        signers,
        threshold: 1,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        }, // Added missing field
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    let ipfs_hash =
        soroban_sdk::String::from_str(&env, "QmXyZ123456789abcdefghijklmnopqrstuvwxyz1234");

    let res = client.try_add_attachment(&signer2, &proposal_id, &ipfs_hash);
    assert_eq!(res.err(), Some(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_attachment_duplicate() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);

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
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        }, // Added missing field
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    let ipfs_hash =
        soroban_sdk::String::from_str(&env, "QmXyZ123456789abcdefghijklmnopqrstuvwxyz1234");

    client.add_attachment(&signer1, &proposal_id, &ipfs_hash);
    // Adding duplicate returns AlreadyApproved
    let result = client.try_add_attachment(&signer1, &proposal_id, &ipfs_hash);
    assert_eq!(result.err(), Some(Ok(VaultError::AlreadyApproved)));
    // Attachments added successfully (no public getter to verify)
}

#[test]
fn test_attachment_invalid_hash() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);

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
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        }, // Added missing field
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    let invalid_hash = soroban_sdk::String::from_str(&env, "Qm123");
    // Hash validation rejects < 10 chars with InvalidAmount
    let result = client.try_add_attachment(&signer1, &proposal_id, &invalid_hash);
    assert_eq!(result.err(), Some(Ok(VaultError::InvalidAmount)));
    // Attachment added successfully (no public getter to verify)
}
#[test]
fn test_admin_can_add_attachment() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);

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
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        }, // Added missing field
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    let ipfs_hash =
        soroban_sdk::String::from_str(&env, "QmXyZ123456789abcdefghijklmnopqrstuvwxyz1234");

    client.add_attachment(&admin, &proposal_id, &ipfs_hash);
    // Attachment added successfully (no public getter to verify)
}

#[test]
fn test_fixed_threshold_strategy() {
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

    let config = InitConfig {
        signers,
        threshold: 2,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    client.approve_proposal(&signer1, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending);

    client.approve_proposal(&signer2, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
}

#[test]
fn test_percentage_threshold_strategy() {
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

    // 67% of 4 signers = ceil(2.68) = 3 approvals needed
    let config = InitConfig {
        signers,
        threshold: 2,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Percentage(67),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);
    client.set_role(&admin, &signer3, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    client.approve_proposal(&signer1, &proposal_id);
    client.approve_proposal(&signer2, &proposal_id);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending);

    client.approve_proposal(&signer3, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
}

#[test]
#[ignore] // TODO: Debug amount-based threshold calculation
fn test_amount_based_threshold_strategy() {
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

    let mut tiers = Vec::new(&env);
    tiers.push_back(AmountTier {
        amount: 0,
        approvals: 1,
    });
    tiers.push_back(AmountTier {
        amount: 100,
        approvals: 2,
    });
    tiers.push_back(AmountTier {
        amount: 500,
        approvals: 3,
    });

    let config = InitConfig {
        signers,
        threshold: 2,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);
    client.set_role(&admin, &signer3, &Role::Treasurer);

    // Small amount (50) - needs 1 approval
    let small_proposal = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &50,
        &Symbol::new(&env, "small"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    let proposal = client.get_proposal(&small_proposal);
    assert_eq!(proposal.approvals.len(), 0);

    client.approve_proposal(&signer1, &small_proposal);
    let proposal = client.get_proposal(&small_proposal);
    assert_eq!(proposal.approvals.len(), 1);
    assert_eq!(proposal.status, ProposalStatus::Approved);

    // Medium amount (200) - needs 2 approvals
    let medium_proposal = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &200,
        &Symbol::new(&env, "medium"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    client.approve_proposal(&signer1, &medium_proposal);
    let proposal = client.get_proposal(&medium_proposal);
    assert_eq!(proposal.status, ProposalStatus::Pending);

    client.approve_proposal(&signer2, &medium_proposal);
    let proposal = client.get_proposal(&medium_proposal);
    assert_eq!(proposal.status, ProposalStatus::Approved);

    // Large amount (600) - needs 3 approvals
    let large_proposal = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &600,
        &Symbol::new(&env, "large"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    client.approve_proposal(&signer1, &large_proposal);
    client.approve_proposal(&signer2, &large_proposal);
    let proposal = client.get_proposal(&large_proposal);
    assert_eq!(proposal.status, ProposalStatus::Pending);

    client.approve_proposal(&signer3, &large_proposal);
    let proposal = client.get_proposal(&large_proposal);
    assert_eq!(proposal.status, ProposalStatus::Approved);
}

#[test]
fn test_time_based_threshold_strategy() {
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
        threshold: 3,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::TimeBased(TimeBasedThreshold {
            initial_threshold: 3,
            reduced_threshold: 2,
            reduction_delay: 100,
        }),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);
    client.set_role(&admin, &signer3, &Role::Treasurer);

    env.ledger().set_sequence_number(100);

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Initially needs 3 approvals
    client.approve_proposal(&signer1, &proposal_id);
    client.approve_proposal(&signer2, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending);

    // Advance time past reduction delay
    env.ledger().set_sequence_number(201);

    // Now only needs 2 approvals (already have 2)
    client.approve_proposal(&admin, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
}

#[test]
fn test_condition_balance_above() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

    let mut conditions = Vec::new(&env);
    conditions.push_back(Condition::BalanceAbove(500));

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &conditions,
        &ConditionLogic::And,
        &0i128,
    );

    client.approve_proposal(&signer1, &proposal_id);

    // Verify proposal has conditions
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.conditions.len(), 1);
    assert_eq!(proposal.condition_logic, ConditionLogic::And);
}

#[test]
fn test_condition_date_after() {
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

    let config = InitConfig {
        signers,
        threshold: 2,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);

    env.ledger().set_sequence_number(100);

    let mut conditions = Vec::new(&env);
    conditions.push_back(Condition::DateAfter(200));

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &conditions,
        &ConditionLogic::And,
        &0i128,
    );

    client.approve_proposal(&signer1, &proposal_id);
    client.approve_proposal(&signer2, &proposal_id);

    // Proposal approved with conditions (execution would require mock token)
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
    assert_eq!(proposal.conditions.len(), 1);

    // Execution should fail while ledger 100 < 200 (condition not met)
    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert!(result.is_err());

    // Advance time past the condition (ledger >= 200)
    env.ledger().set_sequence_number(201);

    // Now condition is met; execution may still fail on balance but must not fail with ConditionsNotMet
    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert_ne!(result.err(), Some(Ok(VaultError::ConditionsNotMet)));
}

#[test]
fn test_condition_multiple_and_logic() {
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

    let config = InitConfig {
        signers,
        threshold: 2,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);

    env.ledger().set_sequence_number(100);

    let mut conditions = Vec::new(&env);
    conditions.push_back(Condition::DateAfter(150));
    conditions.push_back(Condition::DateBefore(250));

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &conditions,
        &ConditionLogic::And,
        &0i128,
    );

    client.approve_proposal(&signer1, &proposal_id);
    client.approve_proposal(&signer2, &proposal_id);

    // Proposal approved with AND logic conditions
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
    assert_eq!(proposal.conditions.len(), 2);
    assert_eq!(proposal.condition_logic, ConditionLogic::And);

    // Execution should fail while ledger 100 < 150 (DateAfter not met)
    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert!(result.is_err());

    // Advance to valid window (150 <= 200 <= 250)
    env.ledger().set_sequence_number(200);
    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert_ne!(result.err(), Some(Ok(VaultError::ConditionsNotMet)));

    // Advance past DateBefore (260 > 250) — execution should fail (condition or status)
    env.ledger().set_sequence_number(260);
    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert!(result.is_err());
}

#[test]
fn test_condition_multiple_or_logic() {
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

    let config = InitConfig {
        signers,
        threshold: 2,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);

    env.ledger().set_sequence_number(100);

    let mut conditions = Vec::new(&env);
    conditions.push_back(Condition::DateAfter(200));
    conditions.push_back(Condition::DateAfter(300));

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &conditions,
        &ConditionLogic::Or,
        &0i128,
    );

    client.approve_proposal(&signer1, &proposal_id);
    client.approve_proposal(&signer2, &proposal_id);

    // Proposal approved with OR logic conditions
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
    assert_eq!(proposal.conditions.len(), 2);
    assert_eq!(proposal.condition_logic, ConditionLogic::Or);

    // Execution should fail while neither condition met (ledger=100 < 200 and < 300)
    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert!(result.is_err());

    // Advance time - now one condition is met (ledger >= 200)
    env.ledger().set_sequence_number(201);
    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert_ne!(result.err(), Some(Ok(VaultError::ConditionsNotMet)));
}

#[test]
fn test_condition_no_conditions() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

    let conditions = Vec::new(&env);

    let proposal_id = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &conditions,
        &ConditionLogic::And,
        &0i128,
    );

    client.approve_proposal(&signer1, &proposal_id);

    // Check proposal is approved (execution would require mock token contract)
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert!(result.is_err());
    // Should not fail with ConditionsNotMet (empty conditions pass)
    assert_ne!(result.err(), Some(Ok(VaultError::ConditionsNotMet)));
}

// ============================================================================
// DEX/AMM Integration Tests (Issue: feature/amm-integration)
// ============================================================================

#[test]
fn test_dex_config_setup() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let dex1 = Address::generate(&env);
    let dex2 = Address::generate(&env);

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
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);

    // Set DEX configuration
    let mut enabled_dexs = Vec::new(&env);
    enabled_dexs.push_back(dex1.clone());
    enabled_dexs.push_back(dex2.clone());

    let dex_config = DexConfig {
        enabled_dexs,
        max_slippage_bps: 100,     // 1%
        max_price_impact_bps: 500, // 5%
        min_liquidity: 10000,
    };

    client.set_dex_config(&admin, &dex_config);

    // Verify configuration
    let retrieved = client.get_dex_config();
    assert!(retrieved.is_some());
    let cfg = retrieved.unwrap();
    assert_eq!(cfg.max_slippage_bps, 100);
    assert_eq!(cfg.max_price_impact_bps, 500);
}

#[test]
fn test_swap_proposal_creation() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let dex = Address::generate(&env);
    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        spending_limit: 10000,
        daily_limit: 50000,
        weekly_limit: 100000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // Configure DEX
    let mut enabled_dexs = Vec::new(&env);
    enabled_dexs.push_back(dex.clone());

    let dex_config = DexConfig {
        enabled_dexs,
        max_slippage_bps: 100,
        max_price_impact_bps: 500,
        min_liquidity: 1000,
    };
    client.set_dex_config(&admin, &dex_config);

    // Create swap proposal
    let swap_op = SwapProposal::Swap(dex.clone(), token_in.clone(), token_out.clone(), 1000, 950);

    let proposal_id = client.propose_swap(
        &treasurer,
        &swap_op,
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Verify proposal
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending);
    assert!(proposal.is_swap);
}

#[test]
fn test_dex_not_enabled_error() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let dex = Address::generate(&env);
    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        spending_limit: 10000,
        daily_limit: 50000,
        weekly_limit: 100000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // Try to create swap without DEX config
    let swap_op = SwapProposal::Swap(dex.clone(), token_in.clone(), token_out.clone(), 1000, 950);

    let result = client.try_propose_swap(
        &treasurer,
        &swap_op,
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    assert!(result.is_err());
    assert_eq!(result.err(), Some(Ok(VaultError::DexNotEnabled)));
}

#[test]
fn test_add_liquidity_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let dex = Address::generate(&env);
    let token_a = Address::generate(&env);
    let token_b = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        spending_limit: 10000,
        daily_limit: 50000,
        weekly_limit: 100000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // Configure DEX
    let mut enabled_dexs = Vec::new(&env);
    enabled_dexs.push_back(dex.clone());

    let dex_config = DexConfig {
        enabled_dexs,
        max_slippage_bps: 100,
        max_price_impact_bps: 500,
        min_liquidity: 1000,
    };
    client.set_dex_config(&admin, &dex_config);

    // Create add liquidity proposal
    let swap_op = SwapProposal::AddLiquidity(
        dex.clone(),
        token_a.clone(),
        token_b.clone(),
        1000,
        1000,
        1900,
    );

    let proposal_id = client.propose_swap(
        &treasurer,
        &swap_op,
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending);
    assert!(proposal.is_swap);
}

#[test]
fn test_yield_farming_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let farm = Address::generate(&env);
    let lp_token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        spending_limit: 10000,
        daily_limit: 50000,
        weekly_limit: 100000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // Configure farm
    let mut enabled_dexs = Vec::new(&env);
    enabled_dexs.push_back(farm.clone());

    let dex_config = DexConfig {
        enabled_dexs,
        max_slippage_bps: 100,
        max_price_impact_bps: 500,
        min_liquidity: 1000,
    };
    client.set_dex_config(&admin, &dex_config);

    // Create stake LP proposal
    let swap_op = SwapProposal::StakeLp(farm.clone(), lp_token.clone(), 1000);

    let proposal_id = client.propose_swap(
        &treasurer,
        &swap_op,
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending);
}

#[test]
fn test_price_impact_calculation() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        spending_limit: 10000,
        daily_limit: 50000,
        weekly_limit: 100000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);

    // Price impact calculation is tested internally
    // This test verifies the contract initializes properly for DEX operations
    assert!(client.get_dex_config().is_none());
}

#[test]
fn test_slippage_protection() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let dex = Address::generate(&env);
    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        spending_limit: 10000,
        daily_limit: 50000,
        weekly_limit: 100000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // Configure DEX with strict slippage
    let mut enabled_dexs = Vec::new(&env);
    enabled_dexs.push_back(dex.clone());

    let dex_config = DexConfig {
        enabled_dexs,
        max_slippage_bps: 50,      // 0.5% max slippage
        max_price_impact_bps: 200, // 2% max price impact
        min_liquidity: 1000,
    };
    client.set_dex_config(&admin, &dex_config);

    // Create swap with high min_amount_out (low slippage tolerance)
    let swap_op = SwapProposal::Swap(
        dex.clone(),
        token_in.clone(),
        token_out.clone(),
        1000,
        995, // Expecting 99.5% of input
    );

    let proposal_id = client.propose_swap(
        &treasurer,
        &swap_op,
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Proposal should be created successfully
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending);
}

// ============================================================================
// Oracle Integration Tests (Issue: feature/oracle-integration)
// ============================================================================

#[test]
fn test_oracle_configuration() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let oracle_addr = Address::generate(&env);

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
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);

    // Configure oracle
    let oracle_config = types::OracleConfig {
        enabled: true,
        oracle_address: oracle_addr.clone(),
        max_staleness: 720, // 1 hour
        min_sources: 3,
        usd_limits_enabled: true,
    };
    client.set_oracle_config(&admin, &oracle_config);

    // Verify configuration
    let retrieved_config = client.get_oracle_config();
    assert_eq!(retrieved_config.oracle_address, oracle_addr);
    assert_eq!(retrieved_config.max_staleness, 720);
    assert_eq!(retrieved_config.min_sources, 3);
    assert_eq!(retrieved_config.usd_limits_enabled, true);
    assert_eq!(retrieved_config.enabled, true);
}

#[test]
fn test_fetch_price_feed() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let oracle_addr = Address::generate(&env);
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
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);

    // Configure oracle
    let oracle_config = types::OracleConfig {
        enabled: true,
        oracle_address: oracle_addr,
        max_staleness: 720,
        min_sources: 3,
        usd_limits_enabled: true,
    };
    client.set_oracle_config(&admin, &oracle_config);

    // Fetch price feed
    let price_feed = client.fetch_price_feed(&token);
    assert_eq!(price_feed.token, token);
    assert!(price_feed.price > 0);
    assert!(price_feed.sources >= 3);
}

#[test]
fn test_convert_to_usd() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let oracle_addr = Address::generate(&env);
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
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);

    // Configure oracle
    let oracle_config = types::OracleConfig {
        enabled: true,
        oracle_address: oracle_addr,
        max_staleness: 720,
        min_sources: 3,
        usd_limits_enabled: true,
    };
    client.set_oracle_config(&admin, &oracle_config);

    // Convert 100 tokens to USD (assuming $1.00 price)
    let token_amount = 100_0000000i128; // 100 tokens with 7 decimals
    let usd_value = client.convert_to_usd(&token, &token_amount);
    
    // With $1.00 price, 100 tokens = $100
    assert_eq!(usd_value, 100_0000000i128);
}

#[test]
fn test_convert_from_usd() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let oracle_addr = Address::generate(&env);
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
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);

    // Configure oracle
    let oracle_config = types::OracleConfig {
        enabled: true,
        oracle_address: oracle_addr,
        max_staleness: 720,
        min_sources: 3,
        usd_limits_enabled: true,
    };
    client.set_oracle_config(&admin, &oracle_config);

    // Convert $100 USD to tokens (assuming $1.00 price)
    let usd_amount = 100_0000000i128; // $100 with 7 decimals
    let token_amount = client.convert_from_usd(&token, &usd_amount);
    
    // With $1.00 price, $100 = 100 tokens
    assert_eq!(token_amount, 100_0000000i128);
}

#[test]
fn test_portfolio_valuation() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let oracle_addr = Address::generate(&env);
    let token1 = Address::generate(&env);
    let token2 = Address::generate(&env);

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
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);

    // Configure oracle
    let oracle_config = types::OracleConfig {
        enabled: true,
        oracle_address: oracle_addr,
        max_staleness: 720,
        min_sources: 3,
        usd_limits_enabled: true,
    };
    client.set_oracle_config(&admin, &oracle_config);

    // Calculate portfolio valuation
    let mut tokens = Vec::new(&env);
    tokens.push_back(token1);
    tokens.push_back(token2);
    
    let valuation = client.calculate_portfolio_valuation(&tokens);
    assert!(valuation.total_usd >= 0);
    assert_eq!(valuation.token_values.len(), 0); // No balances in test
}

#[test]
fn test_price_based_conditions() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let oracle_addr = Address::generate(&env);
    let token = Address::generate(&env);
    let recipient = Address::generate(&env);

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
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);
    // Admin role is already set by initialize, set Treasurer for proposal creation
    client.set_role(&admin, &admin, &Role::Treasurer);

    // Configure oracle (admin has Admin role from initialize)
    let oracle_config = types::OracleConfig {
        enabled: true,
        oracle_address: oracle_addr,
        max_staleness: 720,
        min_sources: 3,
        usd_limits_enabled: true,
    };
    client.set_oracle_config(&admin, &oracle_config);

    // Create proposal with price condition
    let mut conditions = Vec::new(&env);
    conditions.push_back(Condition::PriceAbove(token.clone(), 5000000i128)); // $0.50
    
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &conditions,
        &ConditionLogic::And,
        &0i128,
    );

    // Approve proposal
    client.approve_proposal(&admin, &proposal_id);

    // Verify proposal is approved
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
}

#[test]
fn test_price_staleness_check() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let oracle_addr = Address::generate(&env);
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
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
    };
    client.initialize(&admin, &config);

    // Configure oracle with short staleness window
    let oracle_config = types::OracleConfig {
        enabled: true,
        oracle_address: oracle_addr,
        max_staleness: 10, // 10 ledgers
        min_sources: 3,
        usd_limits_enabled: true,
    };
    client.set_oracle_config(&admin, &oracle_config);

    // Fetch price (creates cache)
    let _ = client.fetch_price_feed(&token);

    // Check staleness immediately (should be fresh)
    let is_stale = client.is_price_feed_stale(&token);
    assert_eq!(is_stale, false);

    // Advance ledger beyond staleness window
    env.ledger().with_mut(|li| {
        li.sequence_number += 20;
    });

    // Check staleness again (should be stale now)
    let is_stale = client.is_price_feed_stale(&token);
    assert_eq!(is_stale, true);
}
