//! Tests for Issue #2059: recovery ceremony.
//!
//! 1. Overlapping recoveries resolve per the competition policy
//!    (`Reject` refuses, `Supersede` cancels a Pending one, never an Approved one).
//! 2. Removed signers lose their roles in the same invocation that swaps the set.
//! 3. Old recovery approvals cannot be replayed: a signature is single-use and
//!    bound to the proposal and the recovery epoch.
//! 4. Expiry closes a recovery and clears its pending votes.
#![cfg(test)]

use crate::errors::VaultError;
use crate::test_cold_signer_pop::{pop_proof, public_key, signing_key};
use crate::types::{
    ColdSignerConfig, InitConfig, RecoveryCompetitionPolicy, RecoveryConfig, RecoveryStatus,
    RetryConfig, Role, StakingConfig, ThresholdStrategy, VelocityConfig, VoteWeight,
};
use crate::{VaultDAO, VaultDAOClient};
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    xdr::ToXdr,
    Address, Bytes, BytesN, Env, Vec,
};

struct Setup<'a> {
    env: Env,
    client: VaultDAOClient<'a>,
    admin: Address,
    signer: Address,
    guardians: [Address; 3],
}

fn setup<'a>(ttl_ledgers: u64) -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer = Address::generate(&env);
    let guardians = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    let mut guardian_list = Vec::new(&env);
    for g in guardians.iter() {
        guardian_list.push_back(g.clone());
    }

    let config = InitConfig {
        upgrade_timelock_delay: 17_280,
        signers,
        threshold: 2,
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
        veto_addresses: Vec::new(&env),
        veto_window_ledgers: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        proposal_id_prefix: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
            max_retry_delay: 0,
        },
        recovery_config: RecoveryConfig {
            guardians: guardian_list,
            threshold: 2,
            delay: 0,
            recovery_ttl_ledgers: ttl_ledgers,
        },
        staking_config: StakingConfig::default(),
    };

    client.initialize(&admin, &config);

    Setup {
        env,
        client,
        admin,
        signer,
        guardians,
    }
}

fn new_signers(env: &Env, n: u32) -> Vec<Address> {
    let mut v = Vec::new(env);
    for _ in 0..n {
        v.push_back(Address::generate(env));
    }
    v
}

/// Register `guardians[0]` as a cold signer backed by `key`.
fn register_cold_guardian(s: &Setup<'_>, key: &SigningKey, max_age: u64) {
    let guardian = &s.guardians[0];
    let mut cold_signers = Vec::new(&s.env);
    cold_signers.push_back(public_key(&s.env, key));
    let mut addrs = Vec::new(&s.env);
    addrs.push_back(guardian.clone());
    let mut proofs = Vec::new(&s.env);
    proofs.push_back(pop_proof(&s.env, &s.client.address, guardian, key));
    s.client.set_cold_signer_config(
        &s.admin,
        &ColdSignerConfig {
            cold_signers,
            cold_signer_addresses: addrs,
            cold_sig_threshold: 1,
            cold_sig_expiry: 17_280,
            max_cold_sig_age_ledgers: max_age,
        },
        &proofs,
    );
}

/// Sign the recovery approval message for `proposal_id` in `epoch`.
fn sign_approval(
    s: &Setup<'_>,
    key: &SigningKey,
    proposal_id: u64,
    epoch: u64,
    created_at: u32,
) -> BytesN<64> {
    let mut msg = Bytes::from_slice(&s.env, b"VaultDAO:recovery-approve:v1");
    msg.append(&s.client.address.clone().to_xdr(&s.env));
    msg.extend_from_array(&proposal_id.to_be_bytes());
    msg.extend_from_array(&epoch.to_be_bytes());
    msg.extend_from_array(&created_at.to_be_bytes());
    let mut buf = [0u8; 256];
    let len = msg.len() as usize;
    msg.copy_into_slice(&mut buf[..len]);
    BytesN::from_array(&s.env, &key.sign(&buf[..len]).to_bytes())
}

// ---------------------------------------------------------------------------
// Competing recoveries
// ---------------------------------------------------------------------------

#[test]
fn test_reject_policy_refuses_second_recovery() {
    let s = setup(0);
    assert_eq!(
        s.client.get_recovery_competition_policy(),
        RecoveryCompetitionPolicy::Reject
    );
    s.client
        .initiate_recovery(&s.guardians[0], &new_signers(&s.env, 2), &2);
    assert_eq!(
        s.client
            .try_initiate_recovery(&s.guardians[1], &new_signers(&s.env, 2), &2),
        Err(Ok(VaultError::RecoveryAlreadyActive))
    );
}

#[test]
fn test_supersede_policy_cancels_pending_recovery() {
    let s = setup(0);
    s.client
        .set_recovery_competition_policy(&s.admin, &RecoveryCompetitionPolicy::Supersede);

    let first = s
        .client
        .initiate_recovery(&s.guardians[0], &new_signers(&s.env, 2), &2);
    s.client.approve_recovery(&s.guardians[0], &first);

    let second = s
        .client
        .initiate_recovery(&s.guardians[1], &new_signers(&s.env, 2), &2);

    let old = s.client.get_recovery_proposal(&first);
    assert_eq!(old.status, RecoveryStatus::Cancelled);
    assert_eq!(old.approvals.len(), 0);
    assert_eq!(
        s.client.try_approve_recovery(&s.guardians[1], &first),
        Err(Ok(VaultError::ProposalNotPending))
    );
    assert_eq!(
        s.client.get_recovery_proposal(&second).status,
        RecoveryStatus::Pending
    );
}

#[test]
fn test_supersede_never_overrides_approved_recovery() {
    let s = setup(0);
    s.client
        .set_recovery_competition_policy(&s.admin, &RecoveryCompetitionPolicy::Supersede);

    let first = s
        .client
        .initiate_recovery(&s.guardians[0], &new_signers(&s.env, 2), &2);
    s.client.approve_recovery(&s.guardians[0], &first);
    s.client.approve_recovery(&s.guardians[1], &first);

    assert_eq!(
        s.client
            .try_initiate_recovery(&s.guardians[2], &new_signers(&s.env, 2), &2),
        Err(Ok(VaultError::RecoveryAlreadyActive))
    );
    assert_eq!(
        s.client.get_recovery_proposal(&first).status,
        RecoveryStatus::Approved
    );
}

#[test]
fn test_competition_policy_is_admin_only() {
    let s = setup(0);
    assert_eq!(
        s.client
            .try_set_recovery_competition_policy(&s.guardians[0], &RecoveryCompetitionPolicy::Supersede),
        Err(Ok(VaultError::Unauthorized))
    );
}

// ---------------------------------------------------------------------------
// Atomic signer swap + role revocation
// ---------------------------------------------------------------------------

#[test]
fn test_removed_signers_lose_roles_in_same_invocation() {
    let s = setup(0);
    s.client.set_role(&s.admin, &s.signer, &Role::Treasurer);
    assert_eq!(s.client.get_role(&s.admin), Role::Admin);

    let replacement = new_signers(&s.env, 2);
    let id = s
        .client
        .initiate_recovery(&s.guardians[0], &replacement, &2);
    s.client.approve_recovery(&s.guardians[0], &id);
    s.client.approve_recovery(&s.guardians[1], &id);
    assert_eq!(s.client.get_recovery_epoch(), 0);

    s.client.execute_recovery(&id);

    // One call: new signer set in place, old signers stripped, epoch advanced.
    assert_eq!(s.client.get_signers(), replacement);
    assert_eq!(s.client.get_role(&s.admin), Role::Member);
    assert_eq!(s.client.get_role(&s.signer), Role::Member);
    assert_eq!(s.client.get_recovery_epoch(), 1);
}

// ---------------------------------------------------------------------------
// Replay defences
// ---------------------------------------------------------------------------

#[test]
fn test_cold_signed_approval_counts_once() {
    let s = setup(0);
    let key = signing_key(41);
    register_cold_guardian(&s, &key, 0);

    let id = s
        .client
        .initiate_recovery(&s.guardians[1], &new_signers(&s.env, 2), &2);
    let sig = sign_approval(&s, &key, id, 0, 0);
    let pk = public_key(&s.env, &key);

    s.client
        .approve_recovery_with_signature(&s.guardians[0], &id, &pk, &sig, &0);
    assert_eq!(s.client.get_recovery_proposal(&id).approvals.len(), 1);

    // Replaying the same approval is rejected.
    assert_eq!(
        s.client
            .try_approve_recovery_with_signature(&s.guardians[0], &id, &pk, &sig, &0),
        Err(Ok(VaultError::RecoverySignatureReplayed))
    );
}

#[test]
fn test_old_epoch_approval_is_rejected() {
    let s = setup(0);
    let key = signing_key(42);
    register_cold_guardian(&s, &key, 0);
    let pk = public_key(&s.env, &key);

    let old = s
        .client
        .initiate_recovery(&s.guardians[1], &new_signers(&s.env, 2), &2);
    let old_sig = sign_approval(&s, &key, old, 0, 0);

    // A guardian change (governance) starts a new epoch and closes `old`.
    let mut guardians = Vec::new(&s.env);
    for g in s.guardians.iter() {
        guardians.push_back(g.clone());
    }
    let change = s.client.propose_recovery_config_change(
        &s.admin,
        &RecoveryConfig {
            guardians,
            threshold: 2,
            delay: 0,
            recovery_ttl_ledgers: 0,
        },
    );
    s.client.approve_recovery_config_change(&s.admin, &change);
    s.client.approve_recovery_config_change(&s.signer, &change);
    s.client.execute_recovery_config_change(&s.admin, &change);
    assert_eq!(s.client.get_recovery_epoch(), 1);
    assert_eq!(
        s.client.get_recovery_proposal(&old).status,
        RecoveryStatus::Cancelled
    );

    assert_eq!(
        s.client
            .try_approve_recovery_with_signature(&s.guardians[0], &old, &pk, &old_sig, &0),
        Err(Ok(VaultError::RecoveryEpochStale))
    );

    // An approval signed for epoch 0 does not verify for a new-epoch proposal.
    let fresh = s
        .client
        .initiate_recovery(&s.guardians[1], &new_signers(&s.env, 2), &2);
    let wrong_epoch_sig = sign_approval(&s, &key, fresh, 0, 0);
    assert!(s
        .client
        .try_approve_recovery_with_signature(&s.guardians[0], &fresh, &pk, &wrong_epoch_sig, &0)
        .is_err());

    // Signed for the current epoch it is accepted.
    let good_sig = sign_approval(&s, &key, fresh, 1, 0);
    s.client
        .approve_recovery_with_signature(&s.guardians[0], &fresh, &pk, &good_sig, &0);
    assert_eq!(s.client.get_recovery_proposal(&fresh).approvals.len(), 1);
}

#[test]
fn test_cold_approval_age_is_enforced() {
    let s = setup(0);
    let key = signing_key(43);
    register_cold_guardian(&s, &key, 10);
    let pk = public_key(&s.env, &key);

    let id = s
        .client
        .initiate_recovery(&s.guardians[1], &new_signers(&s.env, 2), &2);
    let sig = sign_approval(&s, &key, id, 0, 0);

    s.env.ledger().with_mut(|l| l.sequence_number = 11);
    assert_eq!(
        s.client
            .try_approve_recovery_with_signature(&s.guardians[0], &id, &pk, &sig, &0),
        Err(Ok(VaultError::ColdSignatureTooOld))
    );
}

#[test]
fn test_unregistered_key_cannot_approve() {
    let s = setup(0);
    let key = signing_key(44);
    register_cold_guardian(&s, &key, 0);
    let other = signing_key(45);

    let id = s
        .client
        .initiate_recovery(&s.guardians[1], &new_signers(&s.env, 2), &2);
    let sig = sign_approval(&s, &other, id, 0, 0);
    assert_eq!(
        s.client.try_approve_recovery_with_signature(
            &s.guardians[0],
            &id,
            &public_key(&s.env, &other),
            &sig,
            &0
        ),
        Err(Ok(VaultError::NotAColdSigner))
    );
}

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

#[test]
fn test_expiry_clears_pending_votes() {
    let s = setup(10);
    let id = s
        .client
        .initiate_recovery(&s.guardians[0], &new_signers(&s.env, 2), &2);
    s.client.approve_recovery(&s.guardians[0], &id);

    assert_eq!(
        s.client.try_expire_recovery(&id),
        Err(Ok(VaultError::TimelockNotExpired))
    );

    s.env.ledger().with_mut(|l| l.sequence_number = 11);
    s.client.expire_recovery(&id);

    let p = s.client.get_recovery_proposal(&id);
    assert_eq!(p.status, RecoveryStatus::Expired);
    assert_eq!(p.approvals.len(), 0);
    assert_eq!(p.cancel_votes.len(), 0);

    assert_eq!(
        s.client.try_approve_recovery(&s.guardians[1], &id),
        Err(Ok(VaultError::ProposalNotPending))
    );
    assert_eq!(
        s.client.try_expire_recovery(&id),
        Err(Ok(VaultError::ProposalNotPending))
    );
}
