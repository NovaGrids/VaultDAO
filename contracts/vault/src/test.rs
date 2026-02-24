#![cfg(test)]

use super::*;
use crate::types::{
    DexConfig, RetryConfig, SwapProposal, TimeBasedThreshold, TransferDetails, VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Env, Symbol, Vec,
};

// ---------------------------------------------------------------------------
// Helper: build a default InitConfig with quorum = 0 (disabled) so that all
// pre-existing tests continue to compile without changes.
// ---------------------------------------------------------------------------
#[allow(dead_code)]
fn default_init_config(
    _env: &Env,
    signers: soroban_sdk::Vec<Address>,
    threshold: u32,
) -> InitConfig {
    InitConfig {
        signers,
        threshold,
        quorum: 0, // disabled by default — existing tests are unaffected
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
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
    }
}

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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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
        threshold: 1,
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

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

    assert_eq!(client.get_proposal(&low_id).priority, Priority::Low);
    assert_eq!(client.get_proposal(&normal_id).priority, Priority::Normal);
    assert_eq!(client.get_proposal(&high_id).priority, Priority::High);
    assert_eq!(
        client.get_proposal(&critical_id).priority,
        Priority::Critical
    );
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

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

    let comment_text = Symbol::new(&env, "Looksgood");
    let comment_id = client.add_comment(&signer1, &proposal_id, &comment_text, &0);
    assert_eq!(comment_id, 1);

    let comments = client.get_proposal_comments(&proposal_id);
    assert_eq!(comments.len(), 1);

    let comment = comments.get(0).unwrap();
    assert_eq!(comment.proposal_id, proposal_id);
    assert_eq!(comment.author, signer1);
    assert_eq!(comment.parent_id, 0);

    let reply_text = Symbol::new(&env, "Agreed");
    let reply_id = client.add_comment(&admin, &proposal_id, &reply_text, &comment_id);
    assert_eq!(reply_id, 2);

    env.ledger().set_sequence_number(10);

    let new_text = Symbol::new(&env, "Needsreview");
    client.edit_comment(&signer1, &comment_id, &new_text);

    let updated_comment = client.get_comment(&comment_id);
    assert_eq!(updated_comment.text, new_text);

    let res = client.try_edit_comment(&admin, &comment_id, &Symbol::new(&env, "hack"));
    assert_eq!(res.err(), Some(Ok(VaultError::Unauthorized)));
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    client.set_list_mode(&admin, &ListMode::Blacklist);
    client.add_to_blacklist(&admin, &blocked_recipient);

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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
    };
    client.initialize(&admin, &config);

    client.set_list_mode(&admin, &ListMode::Whitelist);
    assert!(!client.is_whitelisted(&address1));
    client.add_to_whitelist(&admin, &address1);
    assert!(client.is_whitelisted(&address1));
    client.remove_from_whitelist(&admin, &address1);
    assert!(!client.is_whitelisted(&address1));

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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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

    client.approve_proposal(&signer1, &proposal_id);

    let res = client.try_abstain_from_proposal(&signer1, &proposal_id);
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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

    client.abstain_from_proposal(&signer1, &proposal_id);

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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer, &Role::Treasurer);

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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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
    let result = client.try_add_attachment(&signer1, &proposal_id, &ipfs_hash);
    assert_eq!(result.err(), Some(Ok(VaultError::AlreadyApproved)));
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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
    let result = client.try_add_attachment(&signer1, &proposal_id, &invalid_hash);
    assert_eq!(result.err(), Some(Ok(VaultError::InvalidAmount)));
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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
#[ignore]
fn test_amount_based_threshold_strategy() {
    // TODO: Debug amount-based threshold calculation
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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

    client.approve_proposal(&signer1, &proposal_id);
    client.approve_proposal(&signer2, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending);

    env.ledger().set_sequence_number(201);
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
    assert_eq!(proposal.conditions.len(), 1);

    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert!(result.is_err());

    env.ledger().set_sequence_number(201);
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
    assert_eq!(proposal.conditions.len(), 2);
    assert_eq!(proposal.condition_logic, ConditionLogic::And);

    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert!(result.is_err());

    env.ledger().set_sequence_number(200);
    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert_ne!(result.err(), Some(Ok(VaultError::ConditionsNotMet)));

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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
    assert_eq!(proposal.condition_logic, ConditionLogic::Or);

    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert!(result.is_err());

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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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

    client.approve_proposal(&signer1, &proposal_id);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert!(result.is_err());
    assert_ne!(result.err(), Some(Ok(VaultError::ConditionsNotMet)));
}

// ============================================================================
// DEX/AMM Tests (unchanged, just updated InitConfig to include quorum: 0)
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
    };
    client.initialize(&admin, &config);

    let mut enabled_dexs = Vec::new(&env);
    enabled_dexs.push_back(dex1.clone());
    enabled_dexs.push_back(dex2.clone());

    let dex_config = DexConfig {
        enabled_dexs,
        max_slippage_bps: 100,
        max_price_impact_bps: 500,
        min_liquidity: 10000,
    };

    client.set_dex_config(&admin, &dex_config);

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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    let mut enabled_dexs = Vec::new(&env);
    enabled_dexs.push_back(dex.clone());
    let dex_config = DexConfig {
        enabled_dexs,
        max_slippage_bps: 100,
        max_price_impact_bps: 500,
        min_liquidity: 1000,
    };
    client.set_dex_config(&admin, &dex_config);

    let swap_op = SwapProposal::Swap(dex.clone(), token_in.clone(), token_out.clone(), 1000, 950);
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    let swap_op = SwapProposal::Swap(dex.clone(), token_in.clone(), token_out.clone(), 1000, 950);
    let result = client.try_propose_swap(
        &treasurer,
        &swap_op,
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    assert_eq!(result.err(), Some(Ok(VaultError::DexNotEnabled)));
}

#[test]
fn test_batch_propose_multi_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);

    let client = VaultDAOClient::new(&env, &env.register(VaultDAO, ()));
    let token1 = Address::generate(&env);
    let token2 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());

    let config = InitConfig {
        signers,
        threshold: 2,
        quorum: 0,
        default_voting_deadline: 0,
        spending_limit: 5_000,
        daily_limit: 20_000,
        weekly_limit: 50_000,
        timelock_threshold: 10_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    let mut transfers = Vec::new(&env);
    transfers.push_back(TransferDetails {
        recipient: recipient1.clone(),
        token: token1.clone(),
        amount: 1000,
        memo: Symbol::new(&env, "payment1"),
    });
    transfers.push_back(TransferDetails {
        recipient: recipient2.clone(),
        token: token2.clone(),
        amount: 2000,
        memo: Symbol::new(&env, "payment2"),
    });

    let proposal_ids = client.batch_propose_transfers(
        &treasurer,
        &transfers,
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    assert_eq!(proposal_ids.len(), 2);

    let proposal1 = client.get_proposal(&proposal_ids.get(0).unwrap());
    assert_eq!(proposal1.recipient, recipient1);
    assert_eq!(proposal1.token, token1);
    assert_eq!(proposal1.amount, 1000);
    assert_eq!(proposal1.status, ProposalStatus::Pending);

    let proposal2 = client.get_proposal(&proposal_ids.get(1).unwrap());
    assert_eq!(proposal2.recipient, recipient2);
    assert_eq!(proposal2.token, token2);
    assert_eq!(proposal2.amount, 2000);
    assert_eq!(proposal2.status, ProposalStatus::Pending);
}

#[test]
fn test_batch_propose_exceeds_max_size() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient = Address::generate(&env);

    let client = VaultDAOClient::new(&env, &env.register(VaultDAO, ()));
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());

    let config = InitConfig {
        signers,
        threshold: 2,
        quorum: 0,
        default_voting_deadline: 0,
        spending_limit: 5_000,
        daily_limit: 100_000,
        weekly_limit: 500_000,
        timelock_threshold: 10_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    let mut transfers = Vec::new(&env);
    for _ in 0..11 {
        transfers.push_back(TransferDetails {
            recipient: recipient.clone(),
            token: token.clone(),
            amount: 100,
            memo: Symbol::new(&env, "payment"),
        });
    }

    let result = client.try_batch_propose_transfers(
        &treasurer,
        &transfers,
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    assert_eq!(result, Err(Ok(VaultError::BatchTooLarge)));
}

// ============================================================================
// NEW TESTS — Abstention Votes & Quorum (Issue #117)
// ============================================================================

/// Quorum disabled (quorum=0): proposals approve on threshold alone, same as before.
#[test]
fn test_quorum_disabled_behaves_like_fixed_threshold() {
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

    // threshold=1, quorum=0 (disabled)
    let config = InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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

    // Single approval satisfies threshold=1, quorum disabled → Approved immediately
    client.approve_proposal(&signer1, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
}

/// Quorum blocks approval even when threshold is met.
/// Setup: 4 signers, threshold=2, quorum=3.
/// After 2 approvals, threshold is met but quorum (3) is not → stays Pending.
/// After a 3rd vote (abstention), quorum is reached → transitions to Approved.
#[test]
fn test_quorum_blocks_approval_until_satisfied() {
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

    // threshold=2, quorum=3 out of 4 signers
    let config = InitConfig {
        signers,
        threshold: 2,
        quorum: 3,
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
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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

    // 2 approvals → threshold met, but quorum (3) not yet reached
    client.approve_proposal(&signer1, &proposal_id);
    client.approve_proposal(&signer2, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(
        proposal.status,
        ProposalStatus::Pending,
        "Should stay Pending: threshold met but quorum not yet (2 < 3)"
    );

    // Abstention from signer3 pushes quorum_votes to 3 → both threshold and quorum now satisfied
    client.abstain_from_proposal(&signer3, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(
        proposal.status,
        ProposalStatus::Approved,
        "Should be Approved: quorum reached via abstention"
    );

    // Verify abstention is recorded and NOT counted in approvals
    assert_eq!(proposal.approvals.len(), 2);
    assert_eq!(proposal.abstentions.len(), 1);
    assert!(proposal.abstentions.contains(signer3.clone()));
}

/// Abstentions count toward quorum but NOT toward the approval threshold.
/// With threshold=3, quorum=2: two abstentions satisfy quorum but threshold still needs 3 approvals.
#[test]
fn test_abstentions_count_toward_quorum_but_not_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);
    let signer4 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());
    signers.push_back(signer4.clone());

    // threshold=3, quorum=2 — quorum is easy to satisfy
    let config = InitConfig {
        signers,
        threshold: 3,
        quorum: 2,
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
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);
    client.set_role(&admin, &signer3, &Role::Treasurer);
    client.set_role(&admin, &signer4, &Role::Treasurer);

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

    // Two abstentions satisfy quorum (2) but NOT threshold (3)
    client.abstain_from_proposal(&signer1, &proposal_id);
    client.abstain_from_proposal(&signer2, &proposal_id);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(
        proposal.status,
        ProposalStatus::Pending,
        "Quorum met by abstentions, but threshold (3 approvals) not reached"
    );
    assert_eq!(proposal.abstentions.len(), 2);
    assert_eq!(proposal.approvals.len(), 0);

    // Now add 3 approvals to also satisfy the threshold
    client.approve_proposal(&signer3, &proposal_id);
    client.approve_proposal(&signer4, &proposal_id);
    // Still only 2 approvals out of 3 needed
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending);

    client.approve_proposal(&admin, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(
        proposal.status,
        ProposalStatus::Approved,
        "Now threshold=3 approvals AND quorum=2 both satisfied"
    );
}

/// get_quorum_status view returns correct counts and reached flag.
#[test]
fn test_get_quorum_status() {
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

    // quorum = 2 out of 3 signers
    let config = InitConfig {
        signers,
        threshold: 2,
        quorum: 2,
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
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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

    // Initially: 0 votes, quorum=2, not reached
    let (votes, required, reached) = client.get_quorum_status(&proposal_id);
    assert_eq!(votes, 0);
    assert_eq!(required, 2);
    assert!(!reached);

    // One abstention: 1 vote, quorum not reached
    client.abstain_from_proposal(&signer1, &proposal_id);
    let (votes, required, reached) = client.get_quorum_status(&proposal_id);
    assert_eq!(votes, 1);
    assert_eq!(required, 2);
    assert!(!reached);

    // One approval: 2 total votes (1 abstention + 1 approval), quorum reached
    client.approve_proposal(&signer2, &proposal_id);
    let (votes, required, reached) = client.get_quorum_status(&proposal_id);
    assert_eq!(votes, 2);
    assert_eq!(required, 2);
    assert!(reached);
}

/// update_quorum admin function works and rejects invalid values.
#[test]
fn test_update_quorum() {
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
        quorum: 0,
        default_voting_deadline: 0,
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
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
    };
    client.initialize(&admin, &config);

    // Admin can update quorum to a valid value
    client.update_quorum(&admin, &2u32);

    // Quorum > total signers (2) should fail
    let result = client.try_update_quorum(&admin, &3u32);
    assert_eq!(result.err(), Some(Ok(VaultError::QuorumTooHigh)));

    // Non-admin is rejected
    let result = client.try_update_quorum(&signer1, &1u32);
    assert_eq!(result.err(), Some(Ok(VaultError::Unauthorized)));
}

/// Quorum satisfied purely by approvals (no abstentions needed).
#[test]
fn test_quorum_satisfied_by_approvals_alone() {
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

    // threshold=2, quorum=2 — two approvals should satisfy both
    let config = InitConfig {
        signers,
        threshold: 2,
        quorum: 2,
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
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
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
    assert_eq!(proposal.status, ProposalStatus::Pending); // 1 approval < threshold=2

    client.approve_proposal(&signer2, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    // 2 approvals = threshold AND 2 total votes = quorum → Approved
    assert_eq!(proposal.status, ProposalStatus::Approved);
}

/// Init rejects quorum > signers count.
#[test]
fn test_initialize_rejects_quorum_too_high() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    // quorum=3 but only 2 signers — should fail
    let config = InitConfig {
        signers,
        threshold: 1,
        quorum: 3,
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
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
    };

    let result = client.try_initialize(&admin, &config);
    assert_eq!(result.err(), Some(Ok(VaultError::QuorumTooHigh)));
}

// ============================================================================
// Retry Tests (feature/execution-retry)
// ============================================================================

/// Macro: set up a vault with retry enabled and a properly registered token.
/// Must be called at the beginning of each retry test since we can't return
/// borrowed references from a helper in no_std.
macro_rules! setup_retry_test {
    ($env:ident, $client:ident, $admin:ident, $signer1:ident, $token_addr:ident, $contract_id:ident) => {
        let $env = Env::default();
        $env.mock_all_auths();

        let $contract_id = $env.register(VaultDAO, ());
        let $client = VaultDAOClient::new(&$env, &$contract_id);

        let $admin = Address::generate(&$env);
        let $signer1 = Address::generate(&$env);

        // Register a real SAC token so balance() calls don't abort
        let token_admin = Address::generate(&$env);
        let sac = $env.register_stellar_asset_contract_v2(token_admin.clone());
        let $token_addr = sac.address();
        let sac_admin_client = StellarAssetClient::new(&$env, &$token_addr);

        let mut signers = Vec::new(&$env);
        signers.push_back($admin.clone());
        signers.push_back($signer1.clone());

        let config = InitConfig {
            signers,
            threshold: 1,
            quorum: 0,
            spending_limit: 1000,
            daily_limit: 5000,
            weekly_limit: 10000,
            timelock_threshold: 50000,
            timelock_delay: 100,
            velocity_limit: VelocityConfig {
                limit: 100,
                window: 3600,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            default_voting_deadline: 0,
            retry_config: RetryConfig {
                enabled: true,
                max_retries: 3,
                initial_backoff_ledgers: 10,
            },
        };

        $client.initialize(&$admin, &config);
        $client.set_role(&$admin, &$signer1, &Role::Treasurer);

        // Mint some tokens to the vault for partial tests
        sac_admin_client.mint(&$contract_id, &500);
    };
}

#[test]
fn test_retry_schedules_on_retryable_failure() {
    setup_retry_test!(env, client, admin, _signer1, token_addr, _contract_id);

    // Propose transfer of 1000 but vault only has 500 → InsufficientBalance (retryable)
    let recipient = Address::generate(&env);
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token_addr,
        &1000_i128,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0_i128,
    );

    // Approve to reach threshold
    client.approve_proposal(&admin, &proposal_id);

    // Execute — should schedule retry (returns Ok) instead of failing
    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert!(result.is_ok(), "Expected Ok when retry is scheduled");

    // Verify retry state was persisted
    let retry_state = client.get_retry_state(&proposal_id);
    assert!(retry_state.is_some());
    let state = retry_state.unwrap();
    assert_eq!(state.retry_count, 1);
    assert!(state.next_retry_ledger > 0);
}

#[test]
fn test_retry_backoff_enforced() {
    setup_retry_test!(env, client, admin, _signer1, token_addr, _contract_id);

    let recipient = Address::generate(&env);
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token_addr,
        &1000_i128,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0_i128,
    );

    client.approve_proposal(&admin, &proposal_id);

    // First execution — schedules retry
    client.execute_proposal(&admin, &proposal_id);

    // Try again immediately — should fail with RetryBackoffNotElapsed
    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert_eq!(result.err(), Some(Ok(VaultError::RetryBackoffNotElapsed)));
}

#[test]
fn test_retry_max_retries_exhausted() {
    setup_retry_test!(env, client, admin, _signer1, token_addr, _contract_id);

    let recipient = Address::generate(&env);
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token_addr,
        &1000_i128,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0_i128,
    );

    client.approve_proposal(&admin, &proposal_id);

    // Exhaust all 3 retries by advancing ledger past backoff each time
    for i in 0..3u32 {
        let backoff = 10u32 * (1 << i); // 10, 20, 40
        env.ledger().with_mut(|li| {
            li.sequence_number += backoff + 1;
        });
        client.execute_proposal(&admin, &proposal_id);
    }

    // 4th attempt — max retries exhausted
    env.ledger().with_mut(|li| {
        li.sequence_number += 100;
    });
    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert_eq!(result.err(), Some(Ok(VaultError::MaxRetriesExceeded)));
}

#[test]
fn test_retry_exponential_backoff_increases() {
    setup_retry_test!(env, client, admin, _signer1, token_addr, _contract_id);

    let recipient = Address::generate(&env);
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token_addr,
        &1000_i128,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0_i128,
    );

    client.approve_proposal(&admin, &proposal_id);

    // First retry — backoff = 10
    client.execute_proposal(&admin, &proposal_id);
    let state1 = client.get_retry_state(&proposal_id).unwrap();
    let backoff1 = state1.next_retry_ledger - state1.last_retry_ledger;
    assert_eq!(backoff1, 10);

    // Advance and trigger second retry — backoff = 20
    env.ledger().with_mut(|li| {
        li.sequence_number += 11;
    });
    client.execute_proposal(&admin, &proposal_id);
    let state2 = client.get_retry_state(&proposal_id).unwrap();
    let backoff2 = state2.next_retry_ledger - state2.last_retry_ledger;
    assert_eq!(backoff2, 20);

    // Advance and trigger third retry — backoff = 40
    env.ledger().with_mut(|li| {
        li.sequence_number += 21;
    });
    client.execute_proposal(&admin, &proposal_id);
    let state3 = client.get_retry_state(&proposal_id).unwrap();
    let backoff3 = state3.next_retry_ledger - state3.last_retry_ledger;
    assert_eq!(backoff3, 40);
}

#[test]
fn test_retry_not_enabled_passes_through_error() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = sac.address();
    let sac_admin_client = StellarAssetClient::new(&env, &token_addr);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    // Retry disabled
    let config = InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 50000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
    };

    client.initialize(&admin, &config);
    client.set_role(&admin, &admin, &Role::Treasurer);

    sac_admin_client.mint(&contract_id, &100);

    let recipient = Address::generate(&env);
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token_addr,
        &500_i128,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0_i128,
    );

    client.approve_proposal(&admin, &proposal_id);

    // Should fail with InsufficientBalance (not retried)
    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert!(result.is_err());
}

#[test]
fn test_retry_execution_function() {
    setup_retry_test!(env, client, admin, _signer1, token_addr, _contract_id);

    let recipient = Address::generate(&env);
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token_addr,
        &1000_i128,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0_i128,
    );

    client.approve_proposal(&admin, &proposal_id);

    // Trigger initial failure → schedules retry
    client.execute_proposal(&admin, &proposal_id);

    // Advance past backoff
    env.ledger().with_mut(|li| {
        li.sequence_number += 11;
    });

    // Use execute_proposal again to trigger second retry (still insufficient balance)
    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert!(
        result.is_ok(),
        "Second retry should be scheduled, got: {:?}",
        result
    );

    let state = client.get_retry_state(&proposal_id).unwrap();
    assert_eq!(state.retry_count, 2);
}

#[test]
fn test_retry_disabled_rejects_retry_execution() {
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
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 50000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
    };

    client.initialize(&admin, &config);

    // retry_execution should fail when retry is disabled
    let result = client.try_retry_execution(&admin, &1_u64);
    assert_eq!(result.err(), Some(Ok(VaultError::RetryNotEnabled)));
}

#[test]
fn test_retry_succeeds_after_balance_funded() {
    setup_retry_test!(env, client, admin, _signer1, token_addr, contract_id);

    let sac_admin_client = StellarAssetClient::new(&env, &token_addr);

    let recipient = Address::generate(&env);
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token_addr,
        &1000_i128,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0_i128,
    );

    client.approve_proposal(&admin, &proposal_id);

    // First attempt fails — insufficient balance (vault has 500, need 1000)
    client.execute_proposal(&admin, &proposal_id);

    // Fund the vault with enough tokens
    sac_admin_client.mint(&contract_id, &1000);

    // Advance past backoff
    env.ledger().with_mut(|li| {
        li.sequence_number += 11;
    });

    // Retry should succeed now
    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert!(result.is_ok(), "Retry should succeed after funding");
}
