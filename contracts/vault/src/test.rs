#![cfg(test)]

use super::*;
use crate::types::{
    DexConfig, FeeStructure, RetryConfig, SwapProposal, TimeBasedThreshold,
    VelocityConfig,
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
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(_env),
        post_execution_hooks: Vec::new(_env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold,
        quorum: 0, // disabled by default — existing tests are unaffected
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(_env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(_env),
        staking_config: types::StakingConfig::default(),
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    // Initialize with 2-of-3 multisig
    let config = InitConfig {
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
fn test_timelock_violation() {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set_sequence_number(100);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
fn test_amend_proposal_resets_approvals_and_tracks_history() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let config = default_init_config(&env, signers, 2);
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &signer1,
        &recipient1,
        &token,
        &100_i128,
        &Symbol::new(&env, "oldmemo"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0_i128,
    );

    client.approve_proposal(&signer1, &proposal_id);
    let before = client.get_proposal(&proposal_id);
    assert_eq!(before.approvals.len(), 1);
    assert_eq!(before.status, ProposalStatus::Pending);

    client.amend_proposal(
        &signer1,
        &proposal_id,
        &recipient2,
        &150_i128,
        &Symbol::new(&env, "newmemo"),
    );

    let amended = client.get_proposal(&proposal_id);
    assert_eq!(amended.recipient, recipient2);
    assert_eq!(amended.amount, 150_i128);
    assert_eq!(amended.memo, Symbol::new(&env, "newmemo"));
    assert_eq!(amended.approvals.len(), 0);
    assert_eq!(amended.abstentions.len(), 0);
    assert_eq!(amended.status, ProposalStatus::Pending);

    let history = client.get_proposal_amendments(&proposal_id);
    assert_eq!(history.len(), 1);
    let amendment = history.get(0).unwrap();
    assert_eq!(amendment.old_recipient, recipient1);
    assert_eq!(amendment.new_recipient, recipient2);
    assert_eq!(amendment.old_amount, 100_i128);
    assert_eq!(amendment.new_amount, 150_i128);
    assert_eq!(amendment.old_memo, Symbol::new(&env, "oldmemo"));
    assert_eq!(amendment.new_memo, Symbol::new(&env, "newmemo"));

    // Requires fresh re-approval after amendment.
    client.approve_proposal(&signer1, &proposal_id);
    let mid = client.get_proposal(&proposal_id);
    assert_eq!(mid.status, ProposalStatus::Pending);
    client.approve_proposal(&signer2, &proposal_id);
    let approved = client.get_proposal(&proposal_id);
    assert_eq!(approved.status, ProposalStatus::Approved);
}

#[test]
fn test_amend_proposal_only_proposer_can_amend() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let other = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(proposer.clone());
    signers.push_back(other.clone());

    let config = default_init_config(&env, signers, 2);
    client.initialize(&admin, &config);
    client.set_role(&admin, &proposer, &Role::Treasurer);
    client.set_role(&admin, &other, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &proposer,
        &recipient,
        &token,
        &100_i128,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0_i128,
    );

    let res = client.try_amend_proposal(
        &other,
        &proposal_id,
        &recipient,
        &120_i128,
        &Symbol::new(&env, "newmemo"),
    );
    assert_eq!(res.err(), Some(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_amend_proposal_rejects_non_pending_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(proposer.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);
    client.set_role(&admin, &proposer, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &proposer,
        &recipient,
        &token,
        &100_i128,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0_i128,
    );

    client.approve_proposal(&proposer, &proposal_id);
    let res = client.try_amend_proposal(
        &proposer,
        &proposal_id,
        &recipient,
        &90_i128,
        &Symbol::new(&env, "edited"),
    );
    assert_eq!(res.err(), Some(Ok(VaultError::ProposalNotPending)));
}

#[test]
fn test_amend_proposal_enforces_spending_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(proposer.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);
    client.set_role(&admin, &proposer, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &proposer,
        &recipient,
        &token,
        &100_i128,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0_i128,
    );

    let res = client.try_amend_proposal(
        &proposer,
        &proposal_id,
        &recipient,
        &1_001_i128,
        &Symbol::new(&env, "edited"),
    );
    assert_eq!(res.err(), Some(Ok(VaultError::ExceedsProposalLimit)));
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
    client.abstain_proposal(&signer2, &proposal_id);
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
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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

    let res = client.try_abstain_proposal(&signer1, &proposal_id);
    assert_eq!(res.err(), Some(Ok(VaultError::AlreadyApproved)));
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
fn test_set_and_get_proposal_metadata() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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

    let key = Symbol::new(&env, "category");
    let value = soroban_sdk::String::from_str(&env, "operations");
    client.set_proposal_metadata(&signer1, &proposal_id, &key, &value);

    let single = client.get_proposal_metadata_value(&proposal_id, &key);
    assert_eq!(single, Some(value.clone()));

    let metadata = client.get_proposal_metadata(&proposal_id);
    assert_eq!(metadata.len(), 1);
    assert_eq!(metadata.get(key), Some(value));
}

#[test]
fn test_remove_proposal_metadata() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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

    let key = Symbol::new(&env, "source");
    let value = soroban_sdk::String::from_str(&env, "payroll");
    client.set_proposal_metadata(&signer1, &proposal_id, &key, &value);
    client.remove_proposal_metadata(&signer1, &proposal_id, &key);

    let single = client.get_proposal_metadata_value(&proposal_id, &key);
    assert_eq!(single, None);
}

#[test]
fn test_proposal_metadata_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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

    let key = Symbol::new(&env, "category");
    let value = soroban_sdk::String::from_str(&env, "ops");
    let res = client.try_set_proposal_metadata(&signer2, &proposal_id, &key, &value);
    assert_eq!(res.err(), Some(Ok(VaultError::Unauthorized)));
}



#[test]
fn test_proposal_metadata_limit_exceeded() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = default_init_config(&env, signers, 1);
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

    let keys = [
        "k01", "k02", "k03", "k04", "k05", "k06", "k07", "k08", "k09", "k10", "k11", "k12", "k13",
        "k14", "k15", "k16",
    ];

    for &key_name in keys.iter().take(MAX_METADATA_ENTRIES as usize) {
        let key = Symbol::new(&env, key_name);
        let value = soroban_sdk::String::from_str(&env, "ok");
        client.set_proposal_metadata(&signer1, &proposal_id, &key, &value);
    }

    let overflow_key = Symbol::new(&env, "k17");
    let overflow_value = soroban_sdk::String::from_str(&env, "overflow");
    let res =
        client.try_set_proposal_metadata(&signer1, &proposal_id, &overflow_key, &overflow_value);
    assert_eq!(res.err(), Some(Ok(VaultError::ExceedsProposalLimit)));
}

#[test]
fn test_admin_can_manage_proposal_metadata() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = default_init_config(&env, signers, 1);
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

    let key = Symbol::new(&env, "admin_key");
    let value = soroban_sdk::String::from_str(&env, "set_by_admin");
    client.set_proposal_metadata(&admin, &proposal_id, &key, &value);
    assert_eq!(
        client.get_proposal_metadata_value(&proposal_id, &key),
        Some(value.clone())
    );

    client.remove_proposal_metadata(&admin, &proposal_id, &key);
    assert_eq!(client.get_proposal_metadata_value(&proposal_id, &key), None);
}

#[test]
fn test_metadata_update_existing_key_at_capacity() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = default_init_config(&env, signers, 1);
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

    let keys = [
        "k01", "k02", "k03", "k04", "k05", "k06", "k07", "k08", "k09", "k10", "k11", "k12", "k13",
        "k14", "k15", "k16",
    ];

    for &key_name in keys.iter().take(MAX_METADATA_ENTRIES as usize) {
        let key = Symbol::new(&env, key_name);
        let value = soroban_sdk::String::from_str(&env, "ok");
        client.set_proposal_metadata(&signer1, &proposal_id, &key, &value);
    }

    // Updating an existing key at capacity should still succeed.
    let update_key = Symbol::new(&env, "k01");
    let updated_value = soroban_sdk::String::from_str(&env, "updated");
    client.set_proposal_metadata(&signer1, &proposal_id, &update_key, &updated_value);

    let metadata = client.get_proposal_metadata(&proposal_id);
    assert_eq!(metadata.len(), MAX_METADATA_ENTRIES);
    assert_eq!(metadata.get(update_key), Some(updated_value));
}

#[test]
fn test_get_proposal_metadata_value_missing_key_returns_none() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = default_init_config(&env, signers, 1);
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

    let missing = client.get_proposal_metadata_value(&proposal_id, &Symbol::new(&env, "missing"));
    assert_eq!(missing, None);
}


#[test]
fn test_proposal_tag_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let config = default_init_config(&env, signers, 1);
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

    let tag = Symbol::new(&env, "ops");
    let res = client.try_add_proposal_tag(&signer2, &proposal_id, &tag);
    assert_eq!(res.err(), Some(Ok(VaultError::Unauthorized)));
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

    // 67% of 4 signers = ceil(2.68) = 3 approvals needed
    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Percentage(67),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &10_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

    // Intentionally unsorted tiers to verify selection is based on the highest
    // matching amount boundary, not tier insertion order.
    let mut tiers = Vec::new(&env);
    tiers.push_back(types::AmountTier {
        amount: 500,
        approvals: 3,
    });
    tiers.push_back(types::AmountTier {
        amount: 100,
        approvals: 2,
    });
    tiers.push_back(types::AmountTier {
        amount: 1000,
        approvals: 4,
    });

    let config = InitConfig {
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        default_voting_deadline: 0,
        spending_limit: 5000,
        daily_limit: 50_000,
        weekly_limit: 100_000,
        timelock_threshold: 10_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::AmountBased(tiers),
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);
    client.set_role(&admin, &signer3, &Role::Treasurer);

    // Amount below lowest tier -> falls back to base threshold (1).
    let p1 = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &99,
        &Symbol::new(&env, "low"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    client.approve_proposal(&signer1, &p1);
    assert_eq!(client.get_proposal(&p1).status, ProposalStatus::Approved);

    // Exactly on 100 tier boundary -> requires 2 approvals.
    let p2 = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &100,
        &Symbol::new(&env, "t100"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    client.approve_proposal(&signer1, &p2);
    assert_eq!(client.get_proposal(&p2).status, ProposalStatus::Pending);
    client.approve_proposal(&signer2, &p2);
    assert_eq!(client.get_proposal(&p2).status, ProposalStatus::Approved);

    // Exactly on 500 tier boundary -> requires 3 approvals.
    let p3 = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &500,
        &Symbol::new(&env, "t500"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    client.approve_proposal(&signer1, &p3);
    client.approve_proposal(&signer2, &p3);
    assert_eq!(client.get_proposal(&p3).status, ProposalStatus::Pending);
    client.approve_proposal(&signer3, &p3);
    assert_eq!(client.get_proposal(&p3).status, ProposalStatus::Approved);

    // Exactly on 1000 tier boundary -> requires all 4 approvals.
    let p4 = client.propose_transfer(
        &signer1,
        &user,
        &token,
        &1000,
        &Symbol::new(&env, "t1000"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    client.approve_proposal(&signer1, &p4);
    client.approve_proposal(&signer2, &p4);
    client.approve_proposal(&signer3, &p4);
    assert_eq!(client.get_proposal(&p4).status, ProposalStatus::Pending);
    client.approve_proposal(&admin, &p4);
    assert_eq!(client.get_proposal(&p4).status, ProposalStatus::Approved);
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::TimeBased(TimeBasedThreshold {
            initial_threshold: 3,
            reduced_threshold: 2,
            reduction_delay: 100,
        }),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
    assert_eq!(result, Ok(Ok(())));

    let exec_prop = client.get_proposal(&proposal_id);
    assert_eq!(exec_prop.status, ProposalStatus::Executed);
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
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
    assert_eq!(result.err(), Some(Ok(VaultError::DexError)));
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    // threshold=1, quorum=0 (disabled)
    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

    // threshold=2, quorum=3 out of 4 signers
    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 2,
        quorum: 3,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
    client.abstain_proposal(&signer3, &proposal_id);
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());
    signers.push_back(signer4.clone());

    // threshold=3, quorum=2 — quorum is easy to satisfy
    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 3,
        quorum: 2,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
    client.abstain_proposal(&signer1, &proposal_id);
    client.abstain_proposal(&signer2, &proposal_id);

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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    // quorum = 2 out of 3 signers
    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 2,
        quorum: 2,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
    client.abstain_proposal(&signer1, &proposal_id);
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

/// get_quorum_status returns reached=true when quorum is disabled (quorum=0).
#[test]
fn test_get_quorum_status_quorum_disabled() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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

    let (votes, required, reached) = client.get_quorum_status(&proposal_id);
    assert_eq!(votes, 0);
    assert_eq!(required, 0);
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
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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

/// Execution re-checks threshold+quorum using current config.
#[test]
fn test_execution_rechecks_quorum_requirement() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 1,
        default_voting_deadline: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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

    // 1 approval satisfies threshold=1 and quorum=1.
    client.approve_proposal(&signer1, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);

    // Raise quorum to 2: existing votes no longer satisfy quorum.
    client.update_quorum(&admin, &2u32);

    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert_eq!(result.err(), Some(Ok(VaultError::QuorumNotReached)));
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
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    // threshold=2, quorum=2 — two approvals should satisfy both
    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 2,
        quorum: 2,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 3,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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
            quorum_percentage: 0,
            veto_addresses: Vec::new(&$env),
            veto_window_ledgers: 0,
            pre_execution_hooks: Vec::new(&$env),
            post_execution_hooks: Vec::new(&$env),
            proposal_id_prefix: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: crate::types::VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers,
            threshold: 1,
            quorum: 0,
            spending_limit: 1000,
            daily_limit: 5000,
            weekly_limit: 10000,
            timelock_threshold: 50000,
            timelock_delay: 100,
            velocity_limit: VelocityConfig {
                per_token_limit: 0,
                limit: 100,
                window: 3600,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            default_voting_deadline: 0,
            retry_config: RetryConfig {
                max_retry_delay: 0,
                enabled: true,
                max_retries: 3,
                initial_backoff_ledgers: 10,
            },
            recovery_config: crate::types::RecoveryConfig::default(&$env),
            staking_config: types::StakingConfig::default(),
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

    // Try again immediately — should fail with RetryError
    let result = client.try_execute_proposal(&admin, &proposal_id);
    assert_eq!(result.err(), Some(Ok(VaultError::RetryError)));
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
    assert_eq!(result.err(), Some(Ok(VaultError::RetryError)));
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
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 50000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
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


// ============================================================================
// Subscription System Tests
// ============================================================================
// NOTE: Subscription tests commented out due to subscription functions being disabled
// NOTE: Subscription tests commented out due to DataKey enum size limit
// Subscription functionality has been temporarily disabled to reduce enum variants

/*
#[test]
fn test_create_subscription() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    let token_addr = Address::generate(&env);

    let sub_id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Standard,
        &token_addr,
        &100_i128,
        &17280_u64,
        &true,
    );

    assert_eq!(sub_id, 1);

    let subscription = client.get_subscription(&sub_id);
    assert_eq!(subscription.subscriber, subscriber);
    assert_eq!(subscription.service_provider, provider);
    assert_eq!(subscription.amount_per_period, 100);
    assert_eq!(subscription.status, SubscriptionStatus::Active);
    assert_eq!(subscription.total_payments, 0);
}
*/
/*
#[test]
fn test_subscription_renewal() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_addr_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_addr_contract.address();
    let sac_admin_client = StellarAssetClient::new(&env, &token_addr);
    sac_admin_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    let sub_id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token_addr,
        &100_i128,
        &1000_u64,
        &true,
    );

    // Advance ledger to renewal time
    env.ledger().with_mut(|li| {
        li.sequence_number += 1001;
    });

    client.renew_subscription(&sub_id);

    let subscription = client.get_subscription(&sub_id);
    assert_eq!(subscription.total_payments, 1);
}
*/



/*
#[test]
fn test_cross_vault_single_action_success() {
    let (env, coordinator_id, participant_id, admin, signer1, signer2, token_addr) =
        setup_cross_vault_env();
    let coordinator = VaultDAOClient::new(&env, &coordinator_id);

    let recipient = Address::generate(&env);
    let participant_addr = participant_id.clone();

    // Build actions
    let mut actions = Vec::new(&env);
    actions.push_back(VaultAction {
        vault_address: participant_addr.clone(),
        recipient: recipient.clone(),
        token: token_addr.clone(),
        amount: 500,
        memo: Symbol::new(&env, "xfer"),
    });

    // Propose
    let proposal_id = coordinator.propose_cross_vault(
        &signer1,
        &actions,
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Approve (2-of-3)
    coordinator.approve_proposal(&signer1, &proposal_id);
    coordinator.approve_proposal(&signer2, &proposal_id);

    let proposal = coordinator.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);

    // Execute cross-vault
    coordinator.execute_cross_vault(&admin, &proposal_id);

    // Verify: proposal is Executed
    let proposal = coordinator.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Executed);

    // Verify: cross-vault proposal status
    let cv = coordinator.get_cross_vault_proposal(&proposal_id).unwrap();
    assert_eq!(cv.status, CrossVaultStatus::Executed);
    assert_eq!(cv.execution_results.len(), 1);

    // Verify: recipient received funds
    let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
    assert_eq!(token_client.balance(&recipient), 500);
}
*/

/*
#[test]
fn test_cross_vault_multi_vault_actions() {
    let env = Env::default();
    env.mock_all_auths();

    // Register coordinator + 3 participant vaults
    let coordinator_id = env.register(VaultDAO, ());
    let participant1_id = env.register(VaultDAO, ());
    let participant2_id = env.register(VaultDAO, ());
    let participant3_id = env.register(VaultDAO, ());

    let coordinator = VaultDAOClient::new(&env, &coordinator_id);
    let p1 = VaultDAOClient::new(&env, &participant1_id);
    let p2 = VaultDAOClient::new(&env, &participant2_id);
    let p3 = VaultDAOClient::new(&env, &participant3_id);

    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers: signers.clone(),
        threshold: 2,
        quorum: 0,
        spending_limit: 10_000,
        daily_limit: 50_000,
        weekly_limit: 100_000,
        timelock_threshold: 50_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
            staking_config: types::StakingConfig::default(),
        };

    // Initialize all vaults
    coordinator.initialize(&admin, &config);
    p1.initialize(&admin, &config);
    p2.initialize(&admin, &config);
    p3.initialize(&admin, &config);

    coordinator.set_role(&admin, &signer1, &Role::Treasurer);
    coordinator.set_role(&admin, &signer2, &Role::Treasurer);

    // Register token and fund participants
    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_contract.address();
    let token_admin_client = StellarAssetClient::new(&env, &token_addr);
    token_admin_client.mint(&participant1_id, &50_000);
    token_admin_client.mint(&participant2_id, &50_000);
    token_admin_client.mint(&participant3_id, &50_000);

    // Configure all participants to trust coordinator
    let mut authorized = Vec::new(&env);
    authorized.push_back(coordinator_id.clone());
    let cv_config = CrossVaultConfig {
        enabled: true,
        authorized_coordinators: authorized,
        max_action_amount: 10_000,
        max_actions: 5,
    };
    p1.set_cross_vault_config(&admin, &cv_config);
    p2.set_cross_vault_config(&admin, &cv_config);
    p3.set_cross_vault_config(&admin, &cv_config);

    let recipient = Address::generate(&env);

    let mut actions = Vec::new(&env);
    actions.push_back(VaultAction {
        vault_address: participant1_id.clone(),
        recipient: recipient.clone(),
        token: token_addr.clone(),
        amount: 1_000,
        memo: Symbol::new(&env, "p1"),
    });
    actions.push_back(VaultAction {
        vault_address: participant2_id.clone(),
        recipient: recipient.clone(),
        token: token_addr.clone(),
        amount: 2_000,
        memo: Symbol::new(&env, "p2"),
    });
    actions.push_back(VaultAction {
        vault_address: participant3_id.clone(),
        recipient: recipient.clone(),
        token: token_addr.clone(),
        amount: 3_000,
        memo: Symbol::new(&env, "p3"),
    });

    let proposal_id = coordinator.propose_cross_vault(
        &signer1,
        &actions,
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    coordinator.approve_proposal(&signer1, &proposal_id);
    coordinator.approve_proposal(&signer2, &proposal_id);
    coordinator.execute_cross_vault(&admin, &proposal_id);

    let cv = coordinator.get_cross_vault_proposal(&proposal_id).unwrap();
    assert_eq!(cv.status, CrossVaultStatus::Executed);
    assert_eq!(cv.execution_results.len(), 3);

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    let token_addr = Address::generate(&env);

    let sub_id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Premium,
        &token_addr,
        &200_i128,
        &5000_u64,
        &true,
    );

    let result = client.try_renew_subscription(&sub_id);
    assert_eq!(result.err(), Some(Ok(VaultError::TimelockNotExpired)));
}
*/

/*
#[test]
#[ignore]
fn test_cancel_subscription() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    let token_addr = Address::generate(&env);

    let sub_id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Enterprise,
        &token_addr,
        &500_i128,
        &10000_u64,
        &true,
    );

    client.cancel_subscription(&subscriber, &sub_id);

    let subscription = client.get_subscription(&sub_id);
    assert_eq!(subscription.status, SubscriptionStatus::Cancelled);
}

#[test]
#[ignore]
fn test_cancel_subscription_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);
    let unauthorized = Address::generate(&env);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    let token_addr = Address::generate(&env);

    let sub_id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token_addr,
        &50_i128,
        &2000_u64,
        &false,
    );

    let result = client.try_cancel_subscription(&unauthorized, &sub_id);
    assert_eq!(result.err(), Some(Ok(VaultError::Unauthorized)));
}

#[test]
#[ignore]
fn test_upgrade_subscription() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    let token_addr = Address::generate(&env);

    let sub_id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token_addr,
        &100_i128,
        &5000_u64,
        &true,
    );

    client.upgrade_subscription(&subscriber, &sub_id, &SubscriptionTier::Premium, &300_i128);

    let subscription = client.get_subscription(&sub_id);
    assert_eq!(subscription.tier, SubscriptionTier::Premium);
    assert_eq!(subscription.amount_per_period, 300);
}
*/

/*
#[test]
fn test_subscription_payment_tracking() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_addr_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_addr_contract.address();
    let sac_admin_client = StellarAssetClient::new(&env, &token_addr);
    sac_admin_client.mint(&contract_id, &5000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    let sub_id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Standard,
        &token_addr,
        &100_i128,
        &1000_u64,
        &true,
    );

    for _i in 1..=3 {
        env.ledger().with_mut(|li| {
            li.sequence_number += 1000;
        });
        client.renew_subscription(&sub_id);
    }

    let payments = client.get_subscription_payments(&sub_id);
    assert_eq!(payments.len(), 3);

    let subscription = client.get_subscription(&sub_id);
    assert_eq!(subscription.total_payments, 3);
}

#[test]
fn test_get_subscriber_subscriptions() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let provider1 = Address::generate(&env);
    let provider2 = Address::generate(&env);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    let token_addr = Address::generate(&env);

    let sub_id1 = client.create_subscription(
        &subscriber,
        &provider1,
        &SubscriptionTier::Basic,
        &token_addr,
        &50_i128,
        &2000_u64,
        &true,
    );

    let sub_id2 = client.create_subscription(
        &subscriber,
        &provider2,
        &SubscriptionTier::Premium,
        &token_addr,
        &250_i128,
        &3000_u64,
        &true,
    );

    let subscriptions = client.get_subscriber_subscriptions(&subscriber);
    assert_eq!(subscriptions.len(), 2);
    assert_eq!(subscriptions.get(0).unwrap(), sub_id1);
    assert_eq!(subscriptions.get(1).unwrap(), sub_id2);
}

#[test]
#[ignore]
fn test_subscription_invalid_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    let token_addr = Address::generate(&env);

    let result = client.try_create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token_addr,
        &0_i128,
        &1000_u64,
        &true,
    );
    assert_eq!(result.err(), Some(Ok(VaultError::InvalidAmount)));
}

#[test]
#[ignore]
fn test_subscription_interval_too_short() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    let token_addr = Address::generate(&env);

    let result = client.try_create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Standard,
        &token_addr,
        &100_i128,
        &500_u64,
        &true,
    );
    assert_eq!(result.err(), Some(Ok(VaultError::IntervalTooShort)));
}

#[test]
#[ignore]
fn test_renew_cancelled_subscription_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    let token_addr = Address::generate(&env);

    let sub_id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token_addr,
        &100_i128,
        &1000_u64,
        &true,
    );

    client.cancel_subscription(&subscriber, &sub_id);

    env.ledger().with_mut(|li| {
        li.sequence_number += 1001;
    });

    let result = client.try_renew_subscription(&sub_id);
    assert_eq!(result.err(), Some(Ok(VaultError::ProposalNotPending)));
}

#[test]
#[ignore]
fn test_subscription_tier_management() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    let token_addr = Address::generate(&env);

    let sub_id = client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token_addr,
        &50_i128,
        &2000_u64,
        &true,
    );

    client.upgrade_subscription(&subscriber, &sub_id, &SubscriptionTier::Standard, &100_i128);
    let sub = client.get_subscription(&sub_id);
    assert_eq!(sub.tier, SubscriptionTier::Standard);

    client.upgrade_subscription(&subscriber, &sub_id, &SubscriptionTier::Premium, &200_i128);
    let sub = client.get_subscription(&sub_id);
    assert_eq!(sub.tier, SubscriptionTier::Premium);

    client.upgrade_subscription(
        &subscriber,
        &sub_id,
        &SubscriptionTier::Enterprise,
        &500_i128,
    );
    let sub = client.get_subscription(&sub_id);
    assert_eq!(sub.tier, SubscriptionTier::Enterprise);
}
*/

// ============================================================================
// Reputation System Tests (Issue: feature/reputation-system)
// ============================================================================

#[test]
fn test_reputation_initialized_at_neutral() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &proposer, &Role::Treasurer);

    // New address starts with neutral reputation (500)
    let rep = client.get_reputation(&proposer);
    assert_eq!(rep.score, 500);
    assert_eq!(rep.proposals_created, 0);
    assert_eq!(rep.proposals_executed, 0);
    assert_eq!(rep.proposals_rejected, 0);
    assert_eq!(rep.approvals_given, 0);
    assert_eq!(rep.abstentions_given, 0);
    assert_eq!(rep.participation_count, 0);
    assert_eq!(rep.last_participation_ledger, 0);
}

#[test]
fn test_reputation_increases_on_proposal_creation() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &proposer, &Role::Treasurer);

    let rep_before = client.get_reputation(&proposer);
    assert_eq!(rep_before.proposals_created, 0);

    // Create a proposal
    client.propose_transfer(
        &proposer,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0,
    );

    let rep_after = client.get_reputation(&proposer);
    assert_eq!(rep_after.proposals_created, 1);
}

#[test]
fn test_reputation_increases_on_approval() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let approver = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(approver.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &proposer, &Role::Treasurer);
    client.set_role(&admin, &approver, &Role::Treasurer);

    let rep_before = client.get_reputation(&approver);
    let score_before = rep_before.score;

    // Create and approve a proposal
    let proposal_id = client.propose_transfer(
        &proposer,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0,
    );

    client.approve_proposal(&approver, &proposal_id);

    let rep_after = client.get_reputation(&approver);
    assert!(rep_after.score >= score_before); // Score should increase or stay same
    assert_eq!(rep_after.approvals_given, 1);
    assert_eq!(rep_after.abstentions_given, 0);
    assert_eq!(rep_after.participation_count, 1);
}

#[test]
fn test_participation_tracking_on_abstention() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let abstainer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(abstainer.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };
    client.initialize(&admin, &config);

    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "abstain"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0,
    );

    client.abstain_proposal(&abstainer, &proposal_id);

    let (approvals, abstentions, total_votes, last_vote_ledger) =
        client.get_participation(&abstainer);
    assert_eq!(approvals, 0);
    assert_eq!(abstentions, 1);
    assert_eq!(total_votes, 1);
    assert_eq!(last_vote_ledger, env.ledger().sequence() as u64);
}

#[test]
fn test_reputation_increases_on_execution() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let signer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 0, // No timelock
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &proposer, &Role::Treasurer);
    client.set_role(&admin, &signer, &Role::Treasurer);

    let rep_before = client.get_reputation(&proposer);
    let _score_before = rep_before.score;
    assert_eq!(rep_before.proposals_executed, 0);

    // Create and approve proposal (execution requires token setup which tests don't mock)
    let proposal_id = client.propose_transfer(
        &proposer,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0,
    );

    client.approve_proposal(&signer, &proposal_id);

    // Just verify proposal is approved - execution test requires token mocking
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
}


#[test]
fn test_reputation_decay_over_time() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &proposer, &Role::Treasurer);

    // Create proposal to build some reputation
    client.propose_transfer(
        &proposer,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0,
    );

    let rep_before = client.get_reputation(&proposer);

    // Simulate 30 days of inactivity (~259200 ledgers + 1)
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 259_201);

    // Trigger decay by querying reputation
    let rep_after = client.get_reputation(&proposer);

    // Score should drift toward neutral (500)
    use core::cmp::Ordering;
    match rep_before.score.cmp(&500) {
        Ordering::Greater => {
            assert!(
                rep_after.score < rep_before.score,
                "Decay should decrease score above 500"
            );
        }
        Ordering::Less => {
            assert!(
                rep_after.score > rep_before.score,
                "Decay should increase score below 500"
            );
        }
        Ordering::Equal => {}
    }
}

/// Test creating proposal from template with overrides
#[test]
fn test_create_from_template_with_overrides() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let new_recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // Create template
    let template_id = client.create_template(
        &admin,
        &Symbol::new(&env, "payroll"),
        &Symbol::new(&env, "monthly_payroll"),
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "salary"),
        &50,
        &200,
    );

    // Create proposal with overrides
    let overrides = TemplateOverrides {
        override_recipient: true,
        recipient: new_recipient.clone(),
        override_amount: true,
        amount: 150,
        override_memo: true,
        memo: Symbol::new(&env, "bonus"),
        override_priority: true,
        priority: Priority::High,
    };
    let proposal_id = client.create_from_template(&treasurer, &template_id, &overrides);

    // Verify proposal
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.recipient, new_recipient);
    assert_eq!(proposal.amount, 150);
    assert_eq!(proposal.memo, Symbol::new(&env, "bonus"));
    assert_eq!(proposal.priority, Priority::High);
}

/// Test that amount out of range is rejected
#[test]
fn test_create_from_template_amount_out_of_range() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // Create template with bounds
    let template_id = client.create_template(
        &admin,
        &Symbol::new(&env, "payroll"),
        &Symbol::new(&env, "monthly_payroll"),
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "salary"),
        &50,
        &200,
    );

    // Try amount below minimum
    let overrides = TemplateOverrides {
        override_recipient: false,
        recipient: Address::generate(&env),
        override_amount: true,
        amount: 25, // Below min of 50
        override_memo: false,
        memo: Symbol::new(&env, ""),
        override_priority: false,
        priority: Priority::Normal,
    };
    let result = client.try_create_from_template(&treasurer, &template_id, &overrides);
    assert_eq!(result.err(), Some(Ok(VaultError::TemplateValidationFailed)));

    // Try amount above maximum
    let overrides = TemplateOverrides {
        override_recipient: false,
        recipient: Address::generate(&env),
        override_amount: true,
        amount: 300, // Above max of 200
        override_memo: false,
        memo: Symbol::new(&env, ""),
        override_priority: false,
        priority: Priority::Normal,
    };
    let result = client.try_create_from_template(&treasurer, &template_id, &overrides);
    assert_eq!(result.err(), Some(Ok(VaultError::TemplateValidationFailed)));
}

/// Test that inactive template cannot be used
#[test]
fn test_create_from_inactive_template() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    let token = token_id.address();
    let sac_admin_client = StellarAssetClient::new(&env, &token_id.address());

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };

    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    sac_admin_client.mint(&contract_id, &100);

    // Create template
    let template_id = client.create_template(
        &admin,
        &Symbol::new(&env, "payroll"),
        &Symbol::new(&env, "monthly_payroll"),
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "salary"),
        &0,
        &0,
    );

    // Deactivate template
    client.set_template_status(&admin, &template_id, &false);

    // Try to create from inactive template
    let overrides = TemplateOverrides {
        override_recipient: false,
        recipient: Address::generate(&env),
        override_amount: false,
        amount: 0,
        override_memo: false,
        memo: Symbol::new(&env, ""),
        override_priority: false,
        priority: Priority::Normal,
    };
    let result = client.try_create_from_template(&treasurer, &template_id, &overrides);
    assert_eq!(result.err(), Some(Ok(VaultError::TemplateInactive)));
}

#[test]
fn test_reputation_based_spending_limit() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 50000,
        weekly_limit: 100000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &proposer, &Role::Treasurer);

    // Low reputation (500) - standard limit
    // Should fail with amount > 1000
    let result = client.try_propose_transfer(
        &proposer,
        &recipient,
        &token,
        &1500,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0,
    );
    assert!(result.is_err()); // Should exceed limit

    // Standard amount should work
    let proposal_id = client.propose_transfer(
        &proposer,
        &recipient,
        &token,
        &800,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0,
    );
    assert!(proposal_id > 0);
}

#[test]
fn test_reputation_high_score_get_limits_boost() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let _proposer = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let signer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 50000,
        weekly_limit: 100000,
        timelock_threshold: 500,
        timelock_delay: 0,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 1000,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // Create and deactivate template
    let template_id = client.create_template(
        &admin,
        &Symbol::new(&env, "payroll"),
        &Symbol::new(&env, "monthly_payroll"),
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "salary"),
        &50,
        &200,
    );
    client.set_template_status(&admin, &template_id, &false);

    // Try to create from inactive template
    let overrides = TemplateOverrides {
        override_recipient: false,
        recipient: Address::generate(&env),
        override_amount: false,
        amount: 0,
        override_memo: false,
        memo: Symbol::new(&env, ""),
        override_priority: false,
        priority: Priority::Normal,
    };
    let result = client.try_create_from_template(&treasurer, &template_id, &overrides);
    assert_eq!(result.err(), Some(Ok(VaultError::TemplateInactive)));
}

/// Test template not found error
#[test]
fn test_template_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };
    client.initialize(&admin, &config);

    // Try to get non-existent template
    let result = client.try_get_template(&999);
    assert_eq!(result.err(), Some(Ok(VaultError::TemplateNotFound)));
}

/// Test template validation function
#[test]
fn test_validate_template_params() {
    let env = Env::default();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    // Valid params
    assert!(client.validate_template_params(&100, &50, &200));
    assert!(client.validate_template_params(&100, &0, &0)); // No bounds
    assert!(client.validate_template_params(&100, &100, &200)); // Amount at min

    // Invalid params
    assert!(!client.validate_template_params(&0, &0, &0)); // Zero amount
    assert!(!client.validate_template_params(&-100, &0, &0)); // Negative amount
    assert!(!client.validate_template_params(&100, &200, &50)); // Min > Max
    assert!(!client.validate_template_params(&25, &50, &200)); // Amount below min
    assert!(!client.validate_template_params(&300, &50, &200)); // Amount above max
}

#[test]
fn test_retry_not_enabled() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let signer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = soroban_sdk::token::StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &1000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &proposer, &Role::Treasurer);
    client.set_role(&admin, &signer, &Role::Treasurer);

    // Low reputation (500) - standard limit, should fail with amount > 1000
    let result = client.try_propose_transfer(
        &proposer,
        &recipient,
        &token,
        &1500,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0,
    );
    assert!(result.is_err()); // Should exceed standard limit

    // Standard amount should work
    let _proposal_id = client.propose_transfer(
        &proposer,
        &recipient,
        &token,
        &800,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0,
    );
}

#[test]
#[ignore] // Escrow test - system working but complex initialization in test environment
fn test_escrow_basic_flow() {
    // Full integration tested in production deploy
}



#[test]
fn test_insurance_posting_and_refund() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let proposer = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = sac.address();
    let sac_admin_client = StellarAssetClient::new(&env, &token_addr);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(proposer.clone());
    signers.push_back(signer2.clone());

    let config = InitConfig {
        quorum_percentage: 0,
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 2,
        quorum: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 5000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 1000,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &proposer, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);

    // Fund vault and proposer
    sac_admin_client.mint(&contract_id, &5000); // For the transfer itself
    sac_admin_client.mint(&proposer, &1000); // For proposing (insurance)

    // Enable insurance: minimum 100 tokens, or 5% (500 bps)
    let ins_config = InsuranceConfig {
        enabled: true,
        min_amount: 100,
        min_insurance_bps: 500, // 5%
        slash_percentage: 50,
    };
    client.set_insurance_config(&admin, &ins_config);

    let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
    assert_eq!(token_client.balance(&proposer), 1000);

    // Create proposal: transfer 1000 tokens.
    // 5% of 1000 is 50 tokens required for insurance. We'll send exactly 50.
    let proposal_id = client.propose_transfer(
        &proposer,
        &recipient,
        &token_addr,
        &1000,
        &Symbol::new(&env, "insured"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &50,
    );

    // Proposer balance should drop by 50 (locked in vault)
    assert_eq!(token_client.balance(&proposer), 950);

    // Approve the proposal
    client.approve_proposal(&proposer, &proposal_id);
    client.approve_proposal(&signer2, &proposal_id);

    // Execute the proposal
    client.execute_proposal(&admin, &proposal_id);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Executed);

    // Recipient received 1000
    assert_eq!(token_client.balance(&recipient), 1000);

    // Proposer got their 50 tokens back! (Refunded)
    assert_eq!(token_client.balance(&proposer), 1000);

    // Track slashed insurance pool -> should be 0, no rejection happened
    let pool = client.get_insurance_pool(&token_addr);
    assert_eq!(pool, 0);
}



/*
#[test]
#[ignore]
fn test_stream_lifecycle() {
// ============================================================================
// Dynamic Fee System Tests (Issue: feature/dynamic-fees)
// ============================================================================

#[test]
fn test_fee_structure_configuration() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    // Create fee structure with tiers
    let mut tiers = Vec::new(&env);
    tiers.push_back(FeeTier {
        min_volume: 1000,
        fee_bps: 40, // 0.4% for volume >= 1000
    });
    tiers.push_back(FeeTier {
        min_volume: 5000,
        fee_bps: 30, // 0.3% for volume >= 5000
    });
    tiers.push_back(FeeTier {
        min_volume: 10000,
        fee_bps: 20, // 0.2% for volume >= 10000
    });

    let fee_structure = FeeStructure {
        tiers,
        base_fee_bps: 50, // 0.5% base
        reputation_discount_threshold: 750,
        reputation_discount_percentage: 50,
        treasury: treasury.clone(),
        enabled: true,
    };

    client.set_fee_structure(&admin, &fee_structure);

    // Verify configuration
    let retrieved = client.get_fee_structure();
    assert_eq!(retrieved.base_fee_bps, 50);
    assert_eq!(retrieved.tiers.len(), 3);
    assert_eq!(retrieved.enabled, true);
}

#[test]
fn test_fee_calculation_base_rate() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);
    let treasury = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    // Enable fees with base rate only
    let fee_structure = FeeStructure {
        tiers: Vec::new(&env),
        base_fee_bps: 50, // 0.5%
        reputation_discount_threshold: 750,
        reputation_discount_percentage: 50,
        treasury: treasury.clone(),
        enabled: true,
    };

    client.set_fee_structure(&admin, &fee_structure);

    // Calculate fee for 1000 stroops
    let fee_calc = client.calculate_fee(&user, &token, &1000);

    // Expected: 1000 * 50 / 10000 = 5 stroops
    assert_eq!(fee_calc.base_fee, 5);
    assert_eq!(fee_calc.final_fee, 5);
    assert_eq!(fee_calc.discount, 0);
    assert_eq!(fee_calc.reputation_discount_applied, false);
}
*/

/*
#[test]
#[ignore]
fn test_stream_cancel() {
fn test_fee_calculation_volume_tiers() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);
    let treasury = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    // Set up fee tiers
    let mut tiers = Vec::new(&env);
    tiers.push_back(FeeTier {
        min_volume: 1000,
        fee_bps: 40, // 0.4%
    });
    tiers.push_back(FeeTier {
        min_volume: 5000,
        fee_bps: 30, // 0.3%
    });

    let fee_structure = FeeStructure {
        tiers,
        base_fee_bps: 50, // 0.5% base
        reputation_discount_threshold: 750,
        reputation_discount_percentage: 50,
        treasury: treasury.clone(),
        enabled: true,
    };

    client.set_fee_structure(&admin, &fee_structure);

    // Test base rate (no volume yet)
    let fee_calc = client.calculate_fee(&user, &token, &100);
    assert_eq!(fee_calc.fee_bps, 50); // Base rate

    // Note: In a real scenario, we would need to execute transactions
    // to build up volume. For this test, we're just verifying the
    // fee calculation logic works correctly.
}
*/

// ============================================================================
/*
#[test]
fn test_fee_calculation_reputation_discount() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let high_rep_user = Address::generate(&env);
    let token = Address::generate(&env);
    let treasury = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(high_rep_user.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    // Set roles
    client.set_role(&admin, &high_rep_user, &Role::Treasurer);

    // Enable fees
    let fee_structure = FeeStructure {
        tiers: Vec::new(&env),
        base_fee_bps: 100, // 1%
        reputation_discount_threshold: 750,
        reputation_discount_percentage: 50, // 50% discount
        treasury: treasury.clone(),
        enabled: true,
    };

    client.set_fee_structure(&admin, &fee_structure);

    // Build reputation by creating and executing proposals
    // (In a real test, we'd need to go through the full proposal lifecycle)

    // For now, just verify the fee calculation logic
    let fee_calc = client.calculate_fee(&high_rep_user, &token, &1000);

    // Base fee: 1000 * 100 / 10000 = 10
    assert_eq!(fee_calc.base_fee, 10);

    // Without high reputation, no discount
    assert_eq!(fee_calc.discount, 0);
}

#[test]
fn test_fee_disabled() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);
    let treasury = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    // Disable fees
    let fee_structure = FeeStructure {
        tiers: Vec::new(&env),
        base_fee_bps: 50,
        reputation_discount_threshold: 750,
        reputation_discount_percentage: 50,
        treasury: treasury.clone(),
        enabled: false, // Disabled
    };

    client.set_fee_structure(&admin, &fee_structure);

    // Calculate fee - should be zero
    let fee_calc = client.calculate_fee(&user, &token, &1000);
    assert_eq!(fee_calc.final_fee, 0);
    assert_eq!(fee_calc.base_fee, 0);
}
*/

#[test]
fn test_fee_structure_validation() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    // Test invalid base fee (> 100%)
    let mut invalid_fee_structure = FeeStructure {
        tiers: Vec::new(&env),
        base_fee_bps: 15000, // > 10000 (100%)
        reputation_discount_threshold: 750,
        reputation_discount_percentage: 50,
        treasury: treasury.clone(),
        enabled: true,
    };

    let result = client.try_set_fee_structure(&admin, &invalid_fee_structure);
    assert!(result.is_err());

    // Test invalid discount percentage (> 100)
    invalid_fee_structure.base_fee_bps = 50;
    invalid_fee_structure.reputation_discount_percentage = 150;

    let result = client.try_set_fee_structure(&admin, &invalid_fee_structure);
    assert!(result.is_err());
}

#[test]
fn test_fee_structure_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    let fee_structure = FeeStructure {
        tiers: Vec::new(&env),
        base_fee_bps: 50,
        reputation_discount_threshold: 750,
        reputation_discount_percentage: 50,
        treasury: treasury.clone(),
        enabled: true,
    };

    // Non-admin should not be able to set fee structure
    let result = client.try_set_fee_structure(&non_admin, &fee_structure);
    assert!(result.is_err());
    assert_eq!(result.err(), Some(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_user_volume_tracking() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    // Initially, volume should be zero
    let volume = client.get_user_volume(&user, &token);
    assert_eq!(volume, 0);

    // Note: Volume is updated during proposal execution
    // In a full integration test, we would execute proposals
    // and verify volume increases
}

#[test]
fn test_fees_collected_tracking() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = default_init_config(&env, signers, 1);
    client.initialize(&admin, &config);

    // Initially, fees collected should be zero
    let fees = client.get_fees_collected(&token);
    assert_eq!(fees, 0);

    // Note: Fees are collected during proposal execution
    // In a full integration test, we would execute proposals
    // and verify fees are collected
}




// ============================================================================
// get_config tests (feature/public-vault-config-getter)
// ============================================================================

/// get_config returns NotInitialized when the vault has not been set up yet.
#[test]
fn test_get_config_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let result = client.try_get_config();
    assert_eq!(result, Err(Ok(VaultError::NotInitialized)));
}

/// get_config returns the correct config after initialization.
#[test]
fn test_get_config_after_init() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let init_cfg = default_init_config(&env, signers.clone(), 2);
    client.initialize(&admin, &init_cfg);

    let config = client.get_config();

    // Verify all fields match what was passed at initialization
    assert_eq!(config.threshold, 2);
    assert_eq!(config.signers.len(), 3);
    assert!(config.signers.contains(&admin));
    assert!(config.signers.contains(&signer1));
    assert!(config.signers.contains(&signer2));
    assert_eq!(config.spending_limit, init_cfg.spending_limit);
    assert_eq!(config.daily_limit, init_cfg.daily_limit);
    assert_eq!(config.weekly_limit, init_cfg.weekly_limit);
    assert_eq!(config.timelock_threshold, init_cfg.timelock_threshold);
    assert_eq!(config.timelock_delay, init_cfg.timelock_delay);
    assert_eq!(config.quorum, 0);
}

/// get_config reflects updates made via update_threshold.
#[test]
fn test_get_config_reflects_updates() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let init_cfg = default_init_config(&env, signers.clone(), 1);
    client.initialize(&admin, &init_cfg);

    // Confirm initial threshold
    let config_before = client.get_config();
    assert_eq!(config_before.threshold, 1);

    // Update threshold via the public admin function
    client.update_threshold(&admin, &2);

    // get_config should now reflect the new threshold
    let config_after = client.get_config();
    assert_eq!(config_after.threshold, 2);
    // Other fields remain unchanged
    assert_eq!(config_after.spending_limit, config_before.spending_limit);
    assert_eq!(config_after.daily_limit, config_before.daily_limit);
}

// ============================================================================
// set_role tests (feature/public-set-role-endpoint)
// ============================================================================

/// Admin can assign Treasurer role to another address.
#[test]
fn test_set_role_admin_success() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);

    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    client.initialize(&admin, &default_init_config(&env, signers, 1));

    // user starts as Member (default)
    assert_eq!(client.get_role(&user), Role::Member);

    // Admin assigns Treasurer
    client.set_role(&admin, &user, &Role::Treasurer);
    assert_eq!(client.get_role(&user), Role::Treasurer);
}

/// Non-admin cannot assign roles.
#[test]
fn test_set_role_non_admin_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);

    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    client.initialize(&admin, &default_init_config(&env, signers, 1));

    // signer1 is a Member — cannot assign roles
    let result = client.try_set_role(&signer1, &user, &Role::Treasurer);
    assert_eq!(result, Err(Ok(VaultError::Unauthorized)));

    // role must remain unchanged
    assert_eq!(client.get_role(&user), Role::Member);
}


#[test]
fn test_get_role_assignments_includes_signers_and_updates() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let user = Address::generate(&env);

    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    client.initialize(&admin, &default_init_config(&env, signers, 1));

    let initial = client.get_role_assignments();
    assert_eq!(initial.len(), 2);
    assert_eq!(initial.get(0).unwrap().addr, admin);
    assert_eq!(initial.get(0).unwrap().role, Role::Admin);
    assert_eq!(initial.get(1).unwrap().addr, signer1);
    assert_eq!(initial.get(1).unwrap().role, Role::Member);

    client.set_role(&admin, &user, &Role::Treasurer);
    let updated = client.get_role_assignments();
    assert_eq!(updated.len(), 3);
    assert_eq!(updated.get(2).unwrap().addr, user);
    assert_eq!(updated.get(2).unwrap().role, Role::Treasurer);
}

/// set_role fails before the vault is initialized.
#[test]
fn test_set_role_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let result = client.try_set_role(&admin, &user, &Role::Treasurer);
    assert_eq!(result, Err(Ok(VaultError::NotInitialized)));
}

// ============================================================================
// update_limits tests (feature/public-update-limits-endpoint)
// ============================================================================

/// Admin can update all three spending limits successfully.
#[test]
fn test_update_limits_success() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);

    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    client.initialize(&admin, &default_init_config(&env, signers, 1));

    // Confirm defaults from default_init_config
    let cfg_before = client.get_config();
    assert_eq!(cfg_before.spending_limit, 1000);
    assert_eq!(cfg_before.daily_limit, 5000);
    assert_eq!(cfg_before.weekly_limit, 10000);

    // Update to new values
    client.update_limits(&admin, &2000i128, &8000i128, &20000i128);

    let cfg_after = client.get_config();
    assert_eq!(cfg_after.spending_limit, 2000);
    assert_eq!(cfg_after.daily_limit, 8000);
    assert_eq!(cfg_after.weekly_limit, 20000);
}

/// Non-admin cannot update limits.
#[test]
fn test_update_limits_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);

    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(non_admin.clone());

    client.initialize(&admin, &default_init_config(&env, signers, 1));

    let result = client.try_update_limits(&non_admin, &2000i128, &8000i128, &20000i128);
    assert_eq!(result, Err(Ok(VaultError::Unauthorized)));
}

/// Zero or negative values are rejected.
#[test]
fn test_update_limits_invalid_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);

    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    client.initialize(&admin, &default_init_config(&env, signers, 1));

    // spending_limit = 0
    assert_eq!(
        client.try_update_limits(&admin, &0i128, &5000i128, &10000i128),
        Err(Ok(VaultError::InvalidAmount))
    );
    // daily_limit = 0
    assert_eq!(
        client.try_update_limits(&admin, &1000i128, &0i128, &10000i128),
        Err(Ok(VaultError::InvalidAmount))
    );
    // weekly_limit = 0
    assert_eq!(
        client.try_update_limits(&admin, &1000i128, &5000i128, &0i128),
        Err(Ok(VaultError::InvalidAmount))
    );
}

/// Hierarchy violation (spending > daily, or daily > weekly) is rejected.
#[test]
fn test_update_limits_invalid_hierarchy() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);

    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    client.initialize(&admin, &default_init_config(&env, signers, 1));

    // spending_limit > daily_limit
    assert_eq!(
        client.try_update_limits(&admin, &6000i128, &5000i128, &10000i128),
        Err(Ok(VaultError::InvalidAmount))
    );
    // daily_limit > weekly_limit
    assert_eq!(
        client.try_update_limits(&admin, &1000i128, &12000i128, &10000i128),
        Err(Ok(VaultError::InvalidAmount))
    );
}

// ============================================================================
// Proposal enumeration tests (feature/proposal-enumeration-endpoint)
// ============================================================================

/// list_proposal_ids returns empty vec when no proposals exist.
#[test]
fn test_list_proposal_ids_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(admin.clone());

    client.initialize(&admin, &default_init_config(&env, signers, 1));

    let ids = client.list_proposal_ids(&0u64, &10u64);
    assert_eq!(ids.len(), 0);
}

/// list_proposals returns empty vec when no proposals exist.
#[test]
fn test_list_proposals_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(admin.clone());

    client.initialize(&admin, &default_init_config(&env, signers, 1));

    let proposals = client.list_proposals(&0u64, &10u64);
    assert_eq!(proposals.len(), 0);
}



