//! Issue #1703: execution must re-check the recipient whitelist/blacklist.

use crate::errors::VaultError;
use crate::types::{
    ConditionLogic, InitConfig, ListMode, Priority, ProposalStatus, RetryConfig, Role,
    VelocityConfig,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env, Symbol, Vec,
};

fn make_config(env: &Env, signers: Vec<Address>) -> InitConfig {
    InitConfig {
        upgrade_timelock_delay: 17_280,
        signers,
        threshold: 2,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1_000_000,
        daily_limit: 5_000_000,
        weekly_limit: 10_000_000,
        timelock_threshold: 1_000_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 10_000_000,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: crate::types::ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        veto_window_ledgers: 0,
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
            max_retry_delay: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 100,
        admin_rotation_delay: 1440,
    }
}

/// Returns (client, admin, token, recipient, approved proposal id).
fn setup_approved_proposal(env: &Env) -> (VaultDAOClient<'static>, Address, Address, Address, u64) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let signer2 = Address::generate(env);
    let recipient = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer2.clone());

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(env, &token).mint(&contract_id, &10_000);

    client.initialize(&admin, &make_config(env, signers));
    client.set_role(&admin, &signer2, &Role::Treasurer);

    let pid = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100,
        &Symbol::new(env, "memo"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    );
    client.approve_proposal(&admin, &pid);
    client.approve_proposal(&signer2, &pid);
    assert_eq!(client.get_proposal(&pid).status, ProposalStatus::Approved);

    (client, admin, token, recipient, pid)
}

#[test]
fn test_execute_fails_when_recipient_blacklisted_after_approval() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, recipient, pid) = setup_approved_proposal(&env);

    client.set_list_mode(&admin, &ListMode::Blacklist);
    client.add_to_blacklist(&admin, &recipient);

    let result = client.try_execute_proposal(&admin, &pid);
    assert_eq!(result, Err(Ok(VaultError::RecipientBlacklisted)));
    assert_eq!(TokenClient::new(&env, &token).balance(&recipient), 0);
    assert_eq!(client.get_proposal(&pid).status, ProposalStatus::Approved);
}

#[test]
fn test_batch_execute_skips_recipient_blacklisted_after_approval() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, recipient, pid) = setup_approved_proposal(&env);

    client.set_list_mode(&admin, &ListMode::Blacklist);
    client.add_to_blacklist(&admin, &recipient);

    let mut ids = Vec::new(&env);
    ids.push_back(pid);
    let (executed, failed) = client.batch_execute_proposals(&admin, &ids);

    assert_eq!(executed.len(), 0);
    assert_eq!(failed, 1);
    assert_eq!(TokenClient::new(&env, &token).balance(&recipient), 0);
    assert_eq!(client.get_proposal(&pid).status, ProposalStatus::Approved);
}

#[test]
fn test_execute_succeeds_for_allowed_recipient() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, recipient, pid) = setup_approved_proposal(&env);

    client.set_list_mode(&admin, &ListMode::Blacklist);
    client.execute_proposal(&admin, &pid);

    assert_eq!(TokenClient::new(&env, &token).balance(&recipient), 100);
    assert_eq!(client.get_proposal(&pid).status, ProposalStatus::Executed);
}

/// Returns (client, admin, token, recipient, approved proposal id) for a
/// multi-phase proposal whose first phase has already been executed.
fn setup_approved_multi_phase_proposal(
    env: &Env,
) -> (VaultDAOClient<'static>, Address, Address, Address, u64) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let signer2 = Address::generate(env);
    let recipient = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer2.clone());

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(env, &token).mint(&contract_id, &10_000);

    client.initialize(&admin, &make_config(env, signers));
    client.set_role(&admin, &signer2, &Role::Treasurer);

    let mut phases = Vec::new(env);
    phases.push_back(crate::types::ProposalPhase {
        operation: crate::types::ProposalOperation::Transfer(
            recipient.clone(),
            token.clone(),
            100,
            Symbol::new(env, "phase1"),
        ),
        rollback_operation: crate::types::OptionalProposalOperation::None,
        status: crate::types::ProposalPhaseStatus::Pending,
    });
    phases.push_back(crate::types::ProposalPhase {
        operation: crate::types::ProposalOperation::Transfer(
            recipient.clone(),
            token.clone(),
            100,
            Symbol::new(env, "phase2"),
        ),
        rollback_operation: crate::types::OptionalProposalOperation::None,
        status: crate::types::ProposalPhaseStatus::Pending,
    });

    let pid = client.create_multi_phase_proposal(&admin, &phases);
    client.approve_proposal(&admin, &pid);
    client.approve_proposal(&signer2, &pid);
    assert_eq!(client.get_proposal(&pid).status, ProposalStatus::Approved);

    // Execute the first phase so the proposal is mid-flight.
    client.execute_proposal(&admin, &pid);
    assert_eq!(TokenClient::new(env, &token).balance(&recipient), 100);

    (client, admin, token, recipient, pid)
}

#[test]
#[ignore] // TODO(#1703-mp): mid-flight continuation via execute_proposal hits host re-entry; rewrite against execute_multi_phase_proposal once continuation is supported.
fn test_multi_phase_execute_fails_when_recipient_blacklisted_after_first_phase() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, recipient, pid) = setup_approved_multi_phase_proposal(&env);

    client.set_list_mode(&admin, &ListMode::Blacklist);
    client.add_to_blacklist(&admin, &recipient);

    let result = client.try_execute_proposal(&admin, &pid);
    assert_eq!(result, Err(Ok(VaultError::RecipientBlacklisted)));
    // Only the first phase's transfer should have gone through.
    assert_eq!(TokenClient::new(&env, &token).balance(&recipient), 100);
}

#[test]
#[ignore] // TODO(#1703-mp): mid-flight continuation via execute_proposal hits host re-entry; rewrite against execute_multi_phase_proposal once continuation is supported.
fn test_multi_phase_batch_execute_skips_recipient_blacklisted_after_first_phase() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, recipient, pid) = setup_approved_multi_phase_proposal(&env);

    client.set_list_mode(&admin, &ListMode::Blacklist);
    client.add_to_blacklist(&admin, &recipient);

    let mut ids = Vec::new(&env);
    ids.push_back(pid);
    let (executed, failed) = client.batch_execute_proposals(&admin, &ids);

    assert_eq!(executed.len(), 0);
    assert_eq!(failed, 1);
    assert_eq!(TokenClient::new(&env, &token).balance(&recipient), 100);
}

#[test]
#[ignore] // TODO(#1703-mp): mid-flight continuation via execute_proposal hits host re-entry; rewrite against execute_multi_phase_proposal once continuation is supported.
fn test_multi_phase_execute_succeeds_for_allowed_recipient() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, recipient, pid) = setup_approved_multi_phase_proposal(&env);

    client.set_list_mode(&admin, &ListMode::Blacklist);
    client.execute_proposal(&admin, &pid);

    assert_eq!(TokenClient::new(&env, &token).balance(&recipient), 200);
    assert_eq!(client.get_proposal(&pid).status, ProposalStatus::Executed);
}

#[test]
#[ignore] // TODO(#1703-mp): mid-flight continuation via execute_proposal hits host re-entry; rewrite against execute_multi_phase_proposal once continuation is supported.
fn test_multi_phase_execute_fails_when_spending_limit_exceeded_after_first_phase() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, token, recipient, pid) = setup_approved_multi_phase_proposal(&env);

    // Tighten the per-proposal spending limit below the remaining phase amount.
    client.update_limits(&admin, &150, &5_000_000, &10_000_000);

    let result = client.try_execute_proposal(&admin, &pid);
    assert_eq!(result, Err(Ok(VaultError::ExceedsProposalLimit)));
    assert_eq!(TokenClient::new(&env, &token).balance(&recipient), 100);
}
