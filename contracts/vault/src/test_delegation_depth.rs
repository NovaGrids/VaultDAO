//! Tests for Issue #1354: delegation chain depth limit and cycle prevention.
#![cfg(test)]

use crate::types::{
    Permission, RecoveryConfig, RetryConfig, StakingConfig, ThresholdStrategy, VelocityConfig,
    VoteWeight,
};
use crate::{InitConfig, Role, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

fn make_config(env: &Env, signers: Vec<Address>) -> InitConfig {
    InitConfig {
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
        quorum: 0,
        spending_limit: 10_000,
        daily_limit: 100_000,
        weekly_limit: 500_000,
        timelock_threshold: 9_000,
        timelock_delay: 10,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
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
        recovery_config: RecoveryConfig::default(env),
        staking_config: StakingConfig::default(),
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
    }
}

/// Builds a vault with `admin` plus `count` generated signers, all of which
/// hold `Permission::CreateProposal`.
fn setup(env: &Env, count: u32) -> (VaultDAOClient<'_>, Address, Vec<Address>) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let mut members: Vec<Address> = Vec::new(env);
    let mut signers: Vec<Address> = Vec::new(env);
    signers.push_back(admin.clone());
    for _ in 0..count {
        let member = Address::generate(env);
        signers.push_back(member.clone());
        members.push_back(member);
    }

    client.initialize(&admin, &make_config(env, signers));
    for member in members.iter() {
        client.set_role(&admin, &member, &Role::Treasurer);
        client.grant_permission(&admin, &member, &Permission::CreateProposal, &None);
    }

    (client, admin, members)
}

#[test]
fn test_delegation_within_max_depth_is_allowed() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, members) = setup(&env, 3);
    let a = members.get(0).unwrap();
    let b = members.get(1).unwrap();
    let c = members.get(2).unwrap();

    // A -> B -> C is two hops, comfortably inside MAX_DELEGATION_DEPTH.
    client.delegate_permission(&a, &b, &Permission::CreateProposal, &10_000);
    client.delegate_permission(&b, &c, &Permission::CreateProposal, &10_000);

    assert!(client.has_permission(&c, &Permission::CreateProposal));
}

#[test]
fn test_delegation_beyond_max_depth_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, members) = setup(&env, 5);

    // Chain the first MAX_DELEGATION_DEPTH (3) hops successfully.
    for i in 0..3u32 {
        let from = members.get(i).unwrap();
        let to = members.get(i + 1).unwrap();
        assert!(
            client
                .try_delegate_permission(&from, &to, &Permission::CreateProposal, &10_000)
                .is_ok(),
            "hop {i} should be allowed"
        );
    }

    // The fourth hop would walk the chain past the limit and must be refused
    // rather than silently truncated.
    let from = members.get(3).unwrap();
    let to = members.get(4).unwrap();
    assert!(client
        .try_delegate_permission(&from, &to, &Permission::CreateProposal, &10_000)
        .is_err());
}

#[test]
fn test_self_delegation_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, members) = setup(&env, 1);
    let a = members.get(0).unwrap();

    assert!(client
        .try_delegate_permission(&a, &a, &Permission::CreateProposal, &10_000)
        .is_err());
}

#[test]
fn test_circular_delegation_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, members) = setup(&env, 3);
    let a = members.get(0).unwrap();
    let b = members.get(1).unwrap();
    let c = members.get(2).unwrap();

    client.delegate_permission(&a, &b, &Permission::CreateProposal, &10_000);
    client.delegate_permission(&b, &c, &Permission::CreateProposal, &10_000);

    // C -> A would close the cycle A -> B -> C -> A. Before the fix this was
    // only caught (if at all) once traversal had already started; it must now
    // be rejected at delegation-set time.
    assert!(client
        .try_delegate_permission(&c, &a, &Permission::CreateProposal, &10_000)
        .is_err());

    // The existing chain is untouched and still resolvable.
    assert!(client.has_permission(&c, &Permission::CreateProposal));
}
