//! Reentrancy guard on `execute_proposal` (#1414).
//!
//! `execute_proposal` marks a proposal as in progress before the external token
//! transfer and clears the mark once state updates finish. A re-entrant call for
//! the same proposal while the mark is set must be refused.
use super::*;
use crate::types::{ConditionLogic, Priority};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Symbol, Vec};

struct Setup<'a> {
    env: Env,
    client: VaultDAOClient<'a>,
    contract_id: Address,
    admin: Address,
    signer: Address,
    token: Address,
}

/// Two signers with threshold 2, and a vault funded with 20,000 tokens.
fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signer = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

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
            veto_addresses: Vec::new(&env),
            retry_config: crate::types::RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(&env),
            staking_config: crate::types::StakingConfig::default(),
            proposal_id_prefix: 0,
            pre_execution_hooks: Vec::new(&env),
            post_execution_hooks: Vec::new(&env),
            quorum_percentage: 0,
        },
    );

    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    StellarAssetClient::new(&env, &token).mint(&contract_id, &20_000);

    Setup {
        env,
        client,
        contract_id,
        admin,
        signer,
        token,
    }
}

/// Propose a 100-token transfer and approve it with both signers.
fn approved_proposal(s: &Setup) -> u64 {
    let proposal_id = s.client.propose_transfer(
        &s.admin,
        &Address::generate(&s.env),
        &s.token,
        &100i128,
        &Symbol::new(&s.env, "memo"),
        &Priority::Normal,
        &Vec::new(&s.env),
        &ConditionLogic::And,
        &0i128,
    );
    s.client.approve_proposal(&s.admin, &proposal_id);
    s.client.approve_proposal(&s.signer, &proposal_id);
    assert_eq!(
        s.client.get_proposal(&proposal_id).status,
        ProposalStatus::Approved
    );
    proposal_id
}

#[test]
fn test_reentrant_execution_is_refused_while_guard_is_set() {
    let s = setup();
    let proposal_id = approved_proposal(&s);

    // Simulate being mid-execution: the guard is set for this proposal.
    s.env.as_contract(&s.contract_id, || {
        storage::set_proposal_in_progress(&s.env, proposal_id);
    });

    let result = s.client.try_execute_proposal(&s.admin, &proposal_id);
    assert_eq!(result, Err(Ok(VaultError::ProposalNotApproved)));
    assert_eq!(
        s.client.get_proposal(&proposal_id).status,
        ProposalStatus::Approved,
        "a refused re-entrant call must not change the proposal"
    );
}

#[test]
fn test_reentrancy_guard_cleared_after_execution() {
    let s = setup();
    let proposal_id = approved_proposal(&s);

    s.client.execute_proposal(&s.admin, &proposal_id);

    assert_eq!(
        s.client.get_proposal(&proposal_id).status,
        ProposalStatus::Executed
    );
    let in_progress = s.env.as_contract(&s.contract_id, || {
        storage::is_proposal_in_progress(&s.env, proposal_id)
    });
    assert!(
        !in_progress,
        "guard must be cleared once execution finishes"
    );
}

#[test]
fn test_proposal_already_executed_prevents_reexecution() {
    let s = setup();
    let proposal_id = approved_proposal(&s);
    s.client.execute_proposal(&s.admin, &proposal_id);

    let result = s.client.try_execute_proposal(&s.admin, &proposal_id);
    assert_eq!(result, Err(Ok(VaultError::ProposalAlreadyExecuted)));
}

#[test]
fn test_reentrancy_guard_is_per_proposal() {
    let s = setup();
    let first = approved_proposal(&s);
    let second = approved_proposal(&s);

    // A guard held for one proposal must not block a different proposal.
    s.env.as_contract(&s.contract_id, || {
        storage::set_proposal_in_progress(&s.env, first);
    });
    s.client.execute_proposal(&s.admin, &second);

    assert_eq!(
        s.client.get_proposal(&second).status,
        ProposalStatus::Executed
    );
    assert_eq!(
        s.client.get_proposal(&first).status,
        ProposalStatus::Approved
    );
}
