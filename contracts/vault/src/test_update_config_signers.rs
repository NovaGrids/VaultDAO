//! Tests for Issue #1692: update_config_signers security fix.
//!
//! Before the fix, `update_config_signers` let a single Admin overwrite the
//! signer set without validation or governance approval.  After the fix:
//!
//! - The call creates a `propose_vault_config_change` governance proposal
//!   (requires threshold-of-N approvals before the new config is applied).
//! - Empty signer lists are rejected with [`VaultError::NoSigners`].
//! - Lists shorter than the current threshold are rejected with
//!   [`VaultError::ThresholdTooHigh`].
//! - Lists with duplicate addresses are rejected with
//!   [`VaultError::SignerAlreadyExists`].
//! - An `AuditAction::SignersReplaced` entry is written and a `signers_replaced`
//!   event is emitted once the proposal is executed.

#![cfg(test)]

use super::*;
use crate::errors::VaultError;
use crate::types::{
    AuditAction, InitConfig, ProposalStatus, RetryConfig, ThresholdStrategy, VelocityConfig,
    VoteWeight,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

// ============================================================================
// Helpers
// ============================================================================

/// Initialise a vault with `signers` (all generated from `env`) and the given
/// `threshold`.  Returns `(client, admin, signers_vec)`.
fn make_vault(
    env: &Env,
    threshold: u32,
    signer_count: u32,
) -> (VaultDAOClient<'static>, Address, Vec<Address>) {
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let mut signers: Vec<Address> = Vec::new(env);
    signers.push_back(admin.clone());
    for _ in 1..signer_count {
        signers.push_back(Address::generate(env));
    }

    client.initialize(
        &admin,
        &InitConfig {
            veto_window_ledgers: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers: signers.clone(),
            threshold,
            quorum: 0,
            quorum_percentage: 0,
            spending_limit: 1_000_000,
            daily_limit: 5_000_000,
            weekly_limit: 10_000_000,
            timelock_threshold: 0,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 1_000_000,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            default_voting_deadline: 0,
            veto_addresses: Vec::new(env),
            retry_config: RetryConfig {
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
        },
    );

    (client, admin, signers)
}

// ============================================================================
// Rejection path 1: empty signer list
// ============================================================================

/// Passing an empty `signers` vector must be rejected with `NoSigners` before
/// any state change occurs.
#[test]
fn test_update_config_signers_rejects_empty_list() {
    let env = Env::default();
    let (client, admin, _signers) = make_vault(&env, 2, 3);

    let empty: Vec<Address> = Vec::new(&env);
    let result = client.try_update_config_signers(&admin, &empty);

    assert_eq!(
        result,
        Err(Ok(VaultError::NoSigners)),
        "empty signer list must return NoSigners"
    );
}

// ============================================================================
// Rejection path 2: list shorter than current threshold
// ============================================================================

/// If the vault threshold is 2 and the proposed list has only 1 signer, the
/// vault would be unexecutable — this must be rejected with `ThresholdTooHigh`.
#[test]
fn test_update_config_signers_rejects_list_shorter_than_threshold() {
    let env = Env::default();
    // threshold = 2, 3 signers initially
    let (client, admin, _signers) = make_vault(&env, 2, 3);

    // Only one signer in the new list — shorter than threshold of 2.
    let mut too_few: Vec<Address> = Vec::new(&env);
    too_few.push_back(Address::generate(&env));

    let result = client.try_update_config_signers(&admin, &too_few);

    assert_eq!(
        result,
        Err(Ok(VaultError::ThresholdTooHigh)),
        "list shorter than threshold must return ThresholdTooHigh"
    );
}

// ============================================================================
// Rejection path 3: duplicate addresses in the proposed signer list
// ============================================================================

/// Passing the same address twice must be rejected with `SignerAlreadyExists`.
#[test]
fn test_update_config_signers_rejects_duplicate_addresses() {
    let env = Env::default();
    let (client, admin, _signers) = make_vault(&env, 2, 3);

    let dup = Address::generate(&env);
    let mut with_dups: Vec<Address> = Vec::new(&env);
    with_dups.push_back(dup.clone());
    with_dups.push_back(dup.clone()); // duplicate

    let result = client.try_update_config_signers(&admin, &with_dups);

    assert_eq!(
        result,
        Err(Ok(VaultError::SignerAlreadyExists)),
        "duplicate signer address must return SignerAlreadyExists"
    );
}

// ============================================================================
// Rejection path 4: non-admin/non-treasurer caller
// ============================================================================

/// A plain signer (Member role) must not be able to initiate a signer-set
/// replacement even with valid inputs.
#[test]
fn test_update_config_signers_rejects_insufficient_role() {
    let env = Env::default();
    let (client, _admin, signers) = make_vault(&env, 1, 3);

    // Use the second signer (index 1) which has no elevated role.
    let plain_member = signers.get(1).unwrap();

    let mut new_list: Vec<Address> = Vec::new(&env);
    new_list.push_back(Address::generate(&env));

    let result = client.try_update_config_signers(&plain_member, &new_list);

    assert_eq!(
        result,
        Err(Ok(VaultError::InsufficientRole)),
        "member without Admin/Treasurer role must be rejected"
    );
}

// ============================================================================
// Governance gate: second config-change in flight is blocked
// ============================================================================

/// If a config-change proposal is already pending, a second call to
/// `update_config_signers` must fail with `ConfigChangeInProgress`.
#[test]
fn test_update_config_signers_blocked_while_config_change_in_progress() {
    let env = Env::default();
    let (client, admin, _signers) = make_vault(&env, 1, 3);

    // First proposal — valid, should create a governance proposal.
    let mut new_list: Vec<Address> = Vec::new(&env);
    new_list.push_back(Address::generate(&env));
    new_list.push_back(Address::generate(&env));

    let result1 = client.try_update_config_signers(&admin, &new_list);
    assert!(
        result1.is_ok(),
        "first update_config_signers should create a proposal"
    );

    // Second attempt while first is still pending.
    let mut another_list: Vec<Address> = Vec::new(&env);
    another_list.push_back(Address::generate(&env));
    another_list.push_back(Address::generate(&env));

    let result2 = client.try_update_config_signers(&admin, &another_list);
    assert_eq!(
        result2,
        Err(Ok(VaultError::ConfigChangeInProgress)),
        "second call while proposal is pending must return ConfigChangeInProgress"
    );
}

// ============================================================================
// Governance gate: single-signer cannot self-approve and bypass multisig
// ============================================================================

/// Even if the Admin approves the created proposal, executing it before
/// reaching `threshold` approvals must fail with `ProposalNotApproved`.
#[test]
fn test_update_config_signers_single_admin_cannot_execute_without_multisig() {
    let env = Env::default();
    // threshold = 2 so both admin + signer1 must approve.
    let (client, admin, _signers) = make_vault(&env, 2, 3);

    let mut new_list: Vec<Address> = Vec::new(&env);
    new_list.push_back(Address::generate(&env));
    new_list.push_back(Address::generate(&env));

    let proposal_id = client.update_config_signers(&admin, &new_list);

    // Admin approves — only one approval, threshold is 2.
    client.approve_proposal(&admin, &proposal_id);

    // Single approval is not enough; execution must fail.
    let exec_result = client.try_execute_proposal(&admin, &proposal_id);
    assert_eq!(
        exec_result,
        Err(Ok(VaultError::ProposalNotApproved)),
        "proposal with only one approval must not be executable"
    );
}

// ============================================================================
// Happy path: valid replacement goes through governance and applies correctly
// ============================================================================

/// A valid signer-set replacement:
/// 1. Creates a governance proposal (proposal ID returned).
/// 2. Requires `threshold` approvals before execution.
/// 3. On execution, the new signer set is applied.
/// 4. The old signers are no longer signers; the new ones are.
#[test]
fn test_update_config_signers_happy_path_requires_governance_and_applies() {
    let env = Env::default();
    // threshold = 2, 3 initial signers (admin, s1, s2).
    let (client, admin, initial_signers) = make_vault(&env, 2, 3);
    let signer1 = initial_signers.get(1).unwrap();
    let signer2 = initial_signers.get(2).unwrap();

    // Brand-new replacement signer set.
    let new_s1 = Address::generate(&env);
    let new_s2 = Address::generate(&env);
    let new_s3 = Address::generate(&env);
    let mut new_list: Vec<Address> = Vec::new(&env);
    new_list.push_back(new_s1.clone());
    new_list.push_back(new_s2.clone());
    new_list.push_back(new_s3.clone());

    // Step 1: Call update_config_signers → creates a governance proposal.
    let proposal_id = client.update_config_signers(&admin, &new_list);

    // The proposal should be Pending (not yet approved).
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(
        proposal.status,
        ProposalStatus::Pending,
        "proposal should be Pending immediately after creation"
    );

    // Step 2: Collect threshold (2) approvals.
    client.approve_proposal(&admin, &proposal_id);
    client.approve_proposal(&signer1, &proposal_id);

    let approved = client.get_proposal(&proposal_id);
    assert_eq!(
        approved.status,
        ProposalStatus::Approved,
        "proposal should be Approved after threshold approvals"
    );

    // Step 3: Execute the proposal.
    client.execute_proposal(&admin, &proposal_id);

    let executed = client.get_proposal(&proposal_id);
    assert_eq!(
        executed.status,
        ProposalStatus::Executed,
        "proposal should be Executed"
    );

    // Step 4: New signers should now be recognised; old ones should not.
    assert!(
        client.is_signer(&new_s1),
        "new_s1 should now be a signer"
    );
    assert!(
        client.is_signer(&new_s2),
        "new_s2 should now be a signer"
    );
    assert!(
        client.is_signer(&new_s3),
        "new_s3 should now be a signer"
    );
    assert!(
        !client.is_signer(&signer2),
        "old signer2 should no longer be a signer"
    );
}

// ============================================================================
// Audit trail: SignersReplaced entry written on execution
// ============================================================================

/// After execution the audit trail must contain an entry with
/// `AuditAction::SignersReplaced`.
#[test]
fn test_update_config_signers_creates_audit_entry_on_execution() {
    let env = Env::default();
    let (client, admin, initial_signers) = make_vault(&env, 1, 2);
    let signer1 = initial_signers.get(1).unwrap();

    let new_s1 = Address::generate(&env);
    let new_s2 = Address::generate(&env);
    let mut new_list: Vec<Address> = Vec::new(&env);
    new_list.push_back(new_s1.clone());
    new_list.push_back(new_s2.clone());

    // Threshold = 1: a single admin approval is enough.
    let proposal_id = client.update_config_signers(&admin, &new_list);
    client.approve_proposal(&admin, &proposal_id);
    client.execute_proposal(&admin, &proposal_id);

    // Walk the audit trail looking for SignersReplaced.
    let total_entries = client.get_audit_entry_count();
    let mut found = false;
    for i in 1..=total_entries {
        if let Ok(entry) = client.try_get_audit_entry(&i) {
            if entry.action == AuditAction::SignersReplaced {
                found = true;
                break;
            }
        }
    }

    assert!(
        found,
        "audit trail must contain AuditAction::SignersReplaced after execution"
    );

    // Suppress unused-variable warning for signer1.
    let _ = signer1;
}

// ============================================================================
// validate_config duplicate check (via propose_vault_config_change directly)
// ============================================================================

/// Calling `propose_vault_config_change` directly with duplicate signers in the
/// new config should also be rejected — the duplicate check lives in
/// `validate_config` which is invoked by that path too.
#[test]
fn test_propose_vault_config_change_rejects_duplicate_signers() {
    let env = Env::default();
    let (client, admin, _signers) = make_vault(&env, 1, 2);

    let dup = Address::generate(&env);

    // Build a config that is otherwise valid but has a duplicate signer.
    let current_config = client.get_config();
    let mut bad_config = current_config.clone();
    let mut dup_signers: Vec<Address> = Vec::new(&env);
    dup_signers.push_back(dup.clone());
    dup_signers.push_back(dup.clone()); // same address twice
    bad_config.signers = dup_signers;

    let result = client.try_propose_vault_config_change(&admin, &bad_config);
    assert_eq!(
        result,
        Err(Ok(VaultError::SignerAlreadyExists)),
        "propose_vault_config_change must reject duplicate signers via validate_config"
    );
}
