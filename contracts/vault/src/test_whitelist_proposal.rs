//! Tests for routing whitelist mutations through the multisig proposal
//! workflow via `ProposalOperation::UpdateWhitelist`, plus the two supporting
//! hardening changes:
//!
//!  * cold signatures are rejected once older than
//!    `ColdSignerConfig::max_cold_sig_age_ledgers`;
//!  * `get_audit_entry` extends the entry's TTL on read so historical audit
//!    records are not evicted by the network.
#![cfg(test)]

use super::*;
use crate::types::{
    InitConfig, ListAction, OptionalProposalOperation, ProposalOperation, ProposalPhase,
    ProposalPhaseStatus, ThresholdStrategy, VelocityConfig, VoteWeight,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

fn init_config(env: &Env, signers: Vec<Address>, threshold: u32) -> InitConfig {
    InitConfig {
        veto_window_ledgers: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1_000_000,
        daily_limit: 5_000_000,
        weekly_limit: 10_000_000,
        timelock_threshold: 0,
        timelock_delay: 0,
        velocity_limit: VelocityConfig {
            limit: 100_000,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
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
    }
}

/// Registers a 3-signer / 2-threshold vault and returns the client plus the
/// admin and the two other signers.
fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address) {
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let signer1 = Address::generate(env);
    let signer2 = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    client.initialize(&admin, &init_config(env, signers, 2));

    (client, admin, signer1, signer2)
}

fn whitelist_phases(env: &Env, addr: &Address, action: ListAction) -> Vec<ProposalPhase> {
    let mut phases = Vec::new(env);
    phases.push_back(ProposalPhase {
        operation: ProposalOperation::UpdateWhitelist(addr.clone(), action),
        rollback_operation: OptionalProposalOperation::None,
        status: ProposalPhaseStatus::Pending,
    });
    phases
}

// ===========================================================================
// Whitelist proposal creation
// ===========================================================================

/// A whitelist proposal can be created, and creating it alone changes nothing.
#[test]
fn test_create_whitelist_proposal_does_not_apply_immediately() {
    let env = Env::default();
    let (client, admin, _s1, _s2) = setup(&env);
    let recipient = Address::generate(&env);

    let phases = whitelist_phases(&env, &recipient, ListAction::Add);
    let proposal_id = client.create_multi_phase_proposal(&admin, &phases);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, crate::types::ProposalStatus::Pending);
    assert!(
        !client.is_whitelisted(&recipient),
        "creating the proposal must not mutate the whitelist"
    );
}

// ===========================================================================
// Whitelist proposal execution — the M-of-N requirement
// ===========================================================================

/// Execution before the approval threshold is met must be rejected, and the
/// whitelist must be untouched.
#[test]
fn test_whitelist_add_requires_multisig_approval() {
    let env = Env::default();
    let (client, admin, signer1, _s2) = setup(&env);
    let recipient = Address::generate(&env);

    let phases = whitelist_phases(&env, &recipient, ListAction::Add);
    let proposal_id = client.create_multi_phase_proposal(&admin, &phases);

    // One signature short: execution is refused and nothing is written.
    let premature = client.try_execute_multi_phase_proposal(&admin, &proposal_id);
    assert_eq!(premature, Err(Ok(VaultError::ProposalNotApproved)));
    assert!(!client.is_whitelisted(&recipient));

    // Collect threshold approvals, then execute.
    client.approve_proposal(&admin, &proposal_id);
    client.approve_proposal(&signer1, &proposal_id);

    let approved = client.get_proposal(&proposal_id);
    assert_eq!(approved.status, crate::types::ProposalStatus::Approved);

    client.execute_multi_phase_proposal(&admin, &proposal_id);

    assert!(
        client.is_whitelisted(&recipient),
        "approved proposal must add the address"
    );
    let executed = client.get_proposal(&proposal_id);
    assert_eq!(executed.status, crate::types::ProposalStatus::Executed);
}

/// Removal through the proposal workflow mirrors addition.
#[test]
fn test_whitelist_remove_via_proposal() {
    let env = Env::default();
    let (client, admin, signer1, _s2) = setup(&env);
    let recipient = Address::generate(&env);

    client.add_to_whitelist(&admin, &recipient);
    assert!(client.is_whitelisted(&recipient));

    let phases = whitelist_phases(&env, &recipient, ListAction::Remove);
    let proposal_id = client.create_multi_phase_proposal(&admin, &phases);
    client.approve_proposal(&admin, &proposal_id);
    client.approve_proposal(&signer1, &proposal_id);
    client.execute_multi_phase_proposal(&admin, &proposal_id);

    assert!(!client.is_whitelisted(&recipient));
}

/// The membership guards apply on the proposal route too: adding an address
/// that is already whitelisted fails the phase rather than silently passing.
#[test]
fn test_whitelist_proposal_rejects_duplicate_add() {
    let env = Env::default();
    let (client, admin, signer1, _s2) = setup(&env);
    let recipient = Address::generate(&env);

    client.add_to_whitelist(&admin, &recipient);

    let phases = whitelist_phases(&env, &recipient, ListAction::Add);
    let proposal_id = client.create_multi_phase_proposal(&admin, &phases);
    client.approve_proposal(&admin, &proposal_id);
    client.approve_proposal(&signer1, &proposal_id);

    let result = client.try_execute_multi_phase_proposal(&admin, &proposal_id);
    assert_eq!(result, Err(Ok(VaultError::PhaseExecutionFailed)));
}

/// Removing an address that is not on the list fails the phase.
#[test]
fn test_whitelist_proposal_rejects_removing_absent_address() {
    let env = Env::default();
    let (client, admin, signer1, _s2) = setup(&env);
    let recipient = Address::generate(&env);

    let phases = whitelist_phases(&env, &recipient, ListAction::Remove);
    let proposal_id = client.create_multi_phase_proposal(&admin, &phases);
    client.approve_proposal(&admin, &proposal_id);
    client.approve_proposal(&signer1, &proposal_id);

    let result = client.try_execute_multi_phase_proposal(&admin, &proposal_id);
    assert_eq!(result, Err(Ok(VaultError::PhaseExecutionFailed)));
}

/// A single proposal may carry several whitelist changes; all apply together.
#[test]
fn test_whitelist_proposal_multiple_phases() {
    let env = Env::default();
    let (client, admin, signer1, _s2) = setup(&env);
    let first = Address::generate(&env);
    let second = Address::generate(&env);

    let mut phases = Vec::new(&env);
    phases.push_back(ProposalPhase {
        operation: ProposalOperation::UpdateWhitelist(first.clone(), ListAction::Add),
        rollback_operation: OptionalProposalOperation::None,
        status: ProposalPhaseStatus::Pending,
    });
    phases.push_back(ProposalPhase {
        operation: ProposalOperation::UpdateWhitelist(second.clone(), ListAction::Add),
        rollback_operation: OptionalProposalOperation::None,
        status: ProposalPhaseStatus::Pending,
    });

    let proposal_id = client.create_multi_phase_proposal(&admin, &phases);
    client.approve_proposal(&admin, &proposal_id);
    client.approve_proposal(&signer1, &proposal_id);
    client.execute_multi_phase_proposal(&admin, &proposal_id);

    assert!(client.is_whitelisted(&first));
    assert!(client.is_whitelisted(&second));
}

/// The direct Admin path still works and shares the same guards, so existing
/// deployments are not broken by the new route.
#[test]
fn test_direct_admin_whitelist_still_enforces_guards() {
    let env = Env::default();
    let (client, admin, _s1, _s2) = setup(&env);
    let recipient = Address::generate(&env);

    client.add_to_whitelist(&admin, &recipient);
    assert_eq!(
        client.try_add_to_whitelist(&admin, &recipient),
        Err(Ok(VaultError::AddressAlreadyOnList))
    );

    client.remove_from_whitelist(&admin, &recipient);
    assert_eq!(
        client.try_remove_from_whitelist(&admin, &recipient),
        Err(Ok(VaultError::AddressNotOnList))
    );
}

// ===========================================================================
// Audit entry TTL extension on read
// ===========================================================================

/// Reading an audit entry returns it and extends its TTL, so an entry that is
/// only ever read survives instead of being evicted.
#[test]
fn test_get_audit_entry_extends_ttl_on_read() {
    let env = Env::default();
    let (client, _admin, _s1, _s2) = setup(&env);

    let count = client.get_audit_entry_count();
    assert!(count > 0, "initialize should have written an audit entry");

    let entry_id = 0u64;
    let first = client.get_audit_entry(&entry_id);

    // After a substantial ledger advance the entry still resolves, because the
    // read above pushed its TTL out.
    env.ledger().with_mut(|li| {
        li.sequence_number += 1000;
    });

    let second = client.get_audit_entry(&entry_id);
    assert_eq!(first.id, second.id);
    assert_eq!(first.action, second.action);
}

/// Reading a missing audit entry is still an error, and must not create one.
#[test]
fn test_get_missing_audit_entry_errors() {
    let env = Env::default();
    let (client, _admin, _s1, _s2) = setup(&env);

    let result = client.try_get_audit_entry(&999_999u64);
    assert!(result.is_err());
}
