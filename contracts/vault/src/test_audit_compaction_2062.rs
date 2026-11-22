//! Tests for Issue #2062: audit log compaction with inclusion proofs.
//!
//! 1. Compaction commits a Merkle root and keeps the hot window intact.
//! 2. Every archived leaf verifies against its epoch root (including leaves
//!    whose path crosses a promoted node of an odd-sized level).
//! 3. A tampered leaf, or a genuine leaf at the wrong position, fails.
//! 4. Existing audit getters and chain checks keep working for the hot window.
#![cfg(test)]

use crate::types::{
    AuditEntry, AuditRetentionPolicy, InitConfig, RecoveryConfig, RetryConfig, StakingConfig,
    ThresholdStrategy, VelocityConfig, VoteWeight,
};
use crate::errors::VaultError;
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    Address, Env, Symbol, TryFromVal, Val, Vec,
};

const HOT: u64 = 5;
const BATCH: u32 = 7; // odd on purpose: exercises promoted nodes
const ENTRIES: u64 = 12;

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(Address::generate(env));

    let client = VaultDAOClient::new(env, &env.register(VaultDAO, ()));
    client.initialize(
        &admin,
        &InitConfig {
            upgrade_timelock_delay: 17_280,
            veto_window_ledgers: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers,
            threshold: 2,
            quorum: 0,
            quorum_percentage: 0,
            default_voting_deadline: 0,
            spending_limit: 100_000_000,
            daily_limit: 500_000_000,
            weekly_limit: 1_000_000_000,
            timelock_threshold: 50_000_000,
            timelock_delay: 100,
            velocity_limit: VelocityConfig {
                limit: 1000,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            retry_config: RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: RecoveryConfig::default(env),
            staking_config: StakingConfig::default(),
            proposal_id_prefix: 0,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            veto_addresses: Vec::new(env),
        },
    );
    (client, admin)
}

/// Write audit entries until exactly `target` exist.
fn fill_audit_log(env: &Env, client: &VaultDAOClient<'_>, admin: &Address, target: u64) {
    let token = Address::generate(env);
    client.add_supported_token(admin, &token, &1_000, &5_000);
    let mut daily = 1_000i128;
    while client.get_audit_entry_count() < target {
        daily += 1;
        client.set_token_limits(admin, &token, &daily, &5_000);
    }
    assert_eq!(client.get_audit_entry_count(), target);
}

fn archive(client: &VaultDAOClient<'_>, upto: u64) -> Vec<AuditEntry> {
    client.get_audit_trail(&0, &(upto as u32))
}

fn compacted_fixture(env: &Env) -> (VaultDAOClient<'_>, Address, Vec<AuditEntry>) {
    let (client, admin) = setup(env);
    client.set_audit_retention_policy(
        &admin,
        &AuditRetentionPolicy {
            hot_window_entries: HOT,
            batch_size: BATCH,
        },
    );
    fill_audit_log(env, &client, &admin, ENTRIES);
    // Off-chain archiver copies the cold entries before compaction.
    let archived = archive(&client, BATCH as u64);
    client.compact_audit_epoch(&admin);
    (client, admin, archived)
}

#[test]
fn test_compaction_commits_root_and_exports_leaves() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    client.set_audit_retention_policy(
        &admin,
        &AuditRetentionPolicy {
            hot_window_entries: HOT,
            batch_size: BATCH,
        },
    );
    fill_audit_log(&env, &client, &admin, ENTRIES);
    let archived = archive(&client, BATCH as u64);

    let cp_id = client.compact_audit_epoch(&admin);
    let wanted = Symbol::new(&env, "audit_compacted");
    let emitted = env.events().all().iter().any(|(_, topics, _)| {
        topics
            .get(0)
            .and_then(|t: Val| Symbol::try_from_val(&env, &t).ok())
            .map(|s| s == wanted)
            .unwrap_or(false)
    });
    assert!(emitted);

    let cp = client.get_audit_checkpoint(&cp_id);
    assert_eq!(cp.from_entry_id, 1);
    assert_eq!(cp.to_entry_id, BATCH as u64);

    let leaves = client.get_audit_checkpoint_leaves(&cp_id);
    assert_eq!(leaves.len(), BATCH);
    for i in 0..BATCH {
        assert_eq!(leaves.get_unchecked(i), archived.get_unchecked(i).hash);
    }
}

#[test]
fn test_every_archived_leaf_verifies() {
    let env = Env::default();
    let (client, _, archived) = compacted_fixture(&env);

    for entry in archived.iter() {
        let proof = client.get_audit_inclusion_proof(&1, &entry.id);
        assert!(client.verify_archived_audit_entry(&1, &entry, &proof));
        // The hash-only verifier agrees.
        assert!(client.verify_audit_entry(&1, &entry.hash, &proof, &(entry.id - 1)));
    }
}

#[test]
fn test_tampered_leaf_fails_verification() {
    let env = Env::default();
    let (client, _, archived) = compacted_fixture(&env);

    let entry = archived.get_unchecked(2);
    let proof = client.get_audit_inclusion_proof(&1, &entry.id);

    let mut wrong_target = entry.clone();
    wrong_target.target += 1;
    assert!(!client.verify_archived_audit_entry(&1, &wrong_target, &proof));

    let mut wrong_hash = entry.clone();
    wrong_hash.hash ^= 1;
    assert!(!client.verify_archived_audit_entry(&1, &wrong_hash, &proof));
    assert!(!client.verify_audit_entry(&1, &wrong_hash.hash, &proof, &(entry.id - 1)));

    let mut wrong_actor = entry.clone();
    wrong_actor.actor = Address::generate(&env);
    assert!(!client.verify_archived_audit_entry(&1, &wrong_actor, &proof));

    // A genuine leaf presented with another leaf's proof fails.
    let other = archived.get_unchecked(3);
    assert!(!client.verify_archived_audit_entry(&1, &other, &proof));

    // A truncated proof fails.
    let mut short = proof.clone();
    short.pop_back();
    assert!(!client.verify_archived_audit_entry(&1, &entry, &short));
}

#[test]
fn test_hot_window_getters_survive_compaction() {
    let env = Env::default();
    let (client, _, _) = compacted_fixture(&env);
    let first_hot = BATCH as u64 + 1;

    assert_eq!(client.get_audit_hot_range(), (first_hot, ENTRIES));
    assert!(client.try_get_audit_entry(&1).is_err());
    for id in first_hot..=ENTRIES {
        assert_eq!(client.get_audit_entry(&id).id, id);
    }

    let page = client.get_audit_trail(&(BATCH as u64), &50);
    assert_eq!(page.len() as u64, ENTRIES - BATCH as u64);
    assert_eq!(page.get_unchecked(0).id, first_hot);

    // Chain checks start from the anchor left by compaction.
    client.verify_audit_chain(&first_hot, &ENTRIES);
    assert_eq!(client.verify_audit_trail_full(), None);
    assert_eq!(client.get_audit_entry_count(), ENTRIES);
}

#[test]
fn test_hot_window_is_never_compacted() {
    let env = Env::default();
    let (client, admin, _) = compacted_fixture(&env);
    // Only 5 hot entries remain, all inside the hot window.
    assert_eq!(
        client.try_compact_audit_epoch(&admin),
        Err(Ok(VaultError::InvalidAmount))
    );
}

#[test]
fn test_retention_policy_validation() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    assert_eq!(
        client.try_set_audit_retention_policy(
            &admin,
            &AuditRetentionPolicy {
                hot_window_entries: 10,
                batch_size: 0,
            },
        ),
        Err(Ok(VaultError::InvalidAmount))
    );
    let outsider = Address::generate(&env);
    assert_eq!(
        client.try_set_audit_retention_policy(
            &outsider,
            &AuditRetentionPolicy {
                hot_window_entries: 10,
                batch_size: 10,
            },
        ),
        Err(Ok(VaultError::Unauthorized))
    );
    // Default keeps the historical behaviour: 100-entry batches, no hot window.
    let default = client.get_audit_retention_policy();
    assert_eq!(default.batch_size, 100);
    assert_eq!(default.hot_window_entries, 0);
}
