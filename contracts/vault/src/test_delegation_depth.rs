//! Tests for Issue #1354: delegation chain depth limit and cycle prevention.
#![cfg(test)]

use crate::errors::VaultError;
use crate::types::{
    ConditionLogic, Permission, Priority, RecoveryConfig, RetryConfig, StakingConfig,
    ThresholdStrategy, VelocityConfig, VoteWeight,
};
use crate::{InitConfig, Role, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, testutils::Events as _, Address, Env, Symbol, TryFromVal, TryIntoVal, Vec};

fn make_config(env: &Env, signers: Vec<Address>) -> InitConfig {
    InitConfig {
        upgrade_timelock_delay: 17_280,
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 2,
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
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();
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
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();
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

#[test]
fn test_delegator_abstains_delegate_approves_still_counts() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, members) = setup(&env, 3);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();
    let delegator = members.get(0).unwrap();
    let delegate = members.get(1).unwrap();
    let other = members.get(2).unwrap();

    // Voting-power delegation: the delegate votes on the delegator's behalf.
    client.delegate_voting_power(&delegator, &delegate, &0u64);

    let proposal_id = client.propose_transfer(
        &delegator,
        &other,
        &token,
        &100,
        &Symbol::new(&env, "delegation"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // The delegate's single approval counts for both delegate and delegator,
    // reaching the threshold of 2 without any other direct vote.
    client.approve_proposal(&delegate, &proposal_id);

    let proposal = client.get_proposal(&proposal_id);
    assert!(proposal.approvals.contains(&delegator));
    assert!(proposal.approvals.contains(&delegate));
    assert!(proposal.status == crate::types::ProposalStatus::Approved);
}

#[test]
fn test_delegator_approves_delegate_abstains_still_counts() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, members) = setup(&env, 3);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();
    let delegator = members.get(0).unwrap();
    let delegate = members.get(1).unwrap();
    let other = members.get(2).unwrap();

    // Voting-power delegation: the delegate votes on the delegator's behalf.
    client.delegate_voting_power(&delegator, &delegate, &0u64);

    let proposal_id = client.propose_transfer(
        &delegator,
        &other,
        &token,
        &100,
        &Symbol::new(&env, "delegation"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Symmetric case: the delegator approves directly while the delegate
    // abstains. The delegate's abstention is recorded for the delegate only;
    // the delegator's approval is skipped (already cast) rather than
    // cancelled, and the proposal still reaches quorum via `other`.
    client.approve_proposal(&delegator, &proposal_id);
    client.abstain_proposal(&delegate, &proposal_id);
    client.approve_proposal(&other, &proposal_id);

    let proposal = client.get_proposal(&proposal_id);
    assert!(proposal.approvals.contains(&delegator));
    assert!(proposal.abstentions.contains(&delegate));
    assert!(!proposal.abstentions.contains(&delegator));
    assert!(proposal.status == crate::types::ProposalStatus::Approved);
}

#[test]
fn test_delegated_vote_skipped_event_emitted() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, members) = setup(&env, 3);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();
    let delegator = members.get(0).unwrap();
    let delegate = members.get(1).unwrap();
    let other = members.get(2).unwrap();

    // Voting-power delegation: the delegate votes on the delegator's behalf.
    client.delegate_voting_power(&delegator, &delegate, &0u64);

    let proposal_id = client.propose_transfer(
        &delegator,
        &other,
        &token,
        &100,
        &Symbol::new(&env, "delegation"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // The delegator approves first, so when the delegate later abstains the
    // delegator's vote is skipped and a `delegated_vote_skipped` event is
    // emitted naming the skipped voter and the conflicting vote as reason.
    // (The reverse order hard-errors on the approve path instead.)
    client.approve_proposal(&delegator, &proposal_id);
    client.abstain_proposal(&delegate, &proposal_id);

    let events = env.events().all();
    let mut found = false;
    for event in events.iter() {
        let (_, topics, data) = event;
        if topics.len() < 2 {
            continue;
        }
        let Ok(name) = soroban_sdk::Symbol::try_from_val(&env, &topics.get(0).unwrap()) else {
            continue;
        };
        if name == soroban_sdk::Symbol::new(&env, "delegated_vote_skipped") {
            // Topics are (name, proposal_id); data is (voter, signer, reason).
            // The skipped voter is the delegator (already approved); the
            // reason names the conflicting vote.
            let (voter, _signer, reason): (Address, Address, soroban_sdk::Symbol) =
                data.try_into_val(&env).unwrap();
            assert_eq!(voter, delegator);
            assert_eq!(reason, soroban_sdk::symbol_short!("approved"));
            found = true;
        }
    }
    assert!(found, "delegated_vote_skipped event was not emitted");
}

#[test]
fn test_conflicting_votes_approve_errors_abstain_skips() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, members) = setup(&env, 2);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();
    let delegator = members.get(0).unwrap();
    let delegate = members.get(1).unwrap();

    // Voting-power delegation: the delegate votes on the delegator's behalf.
    client.delegate_voting_power(&delegator, &delegate, &0u64);

    let proposal_id = client.propose_transfer(
        &delegator,
        &delegate,
        &token,
        &100,
        &Symbol::new(&env, "delegation"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Conflict on the approve path hard-errors, naming the existing vote:
    // the delegator abstained, so the delegate cannot approve for them.
    client.abstain_proposal(&delegator, &proposal_id);
    let result = client.try_approve_proposal(&delegate, &proposal_id);
    assert_eq!(result.err(), Some(Ok(VaultError::AlreadyAbstained)));

    // Conflict on the abstain path is lenient instead: the delegate's own
    // abstention is recorded while the delegator's approval is skipped.
    // (Different amount to dodge the proposal fingerprint dedup.)
    let proposal_id2 = client.propose_transfer(
        &delegator,
        &delegate,
        &token,
        &101,
        &Symbol::new(&env, "delegation"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    client.approve_proposal(&delegator, &proposal_id2);
    let result2 = client.try_abstain_proposal(&delegate, &proposal_id2);
    assert!(result2.is_ok());
    let after = client.get_proposal(&proposal_id2);
    assert!(after.abstentions.contains(&delegate));
    assert!(after.approvals.contains(&delegator));
}

// ============================================================================
// Issue #1939: delegation set and revocation emit events
// ============================================================================

/// Return the `(delegator, delegate, expiry)` payloads of every
/// `delegation_set` event with the given delegator in its topics.
fn delegation_set_payloads(env: &Env, delegator: &Address) -> Vec<(Address, u64)> {
    let mut out = Vec::new(env);
    for (_, topics, data) in env.events().all().iter() {
        if topics.len() != 2 {
            continue;
        }
        let name: soroban_sdk::Symbol = topics.get(0).unwrap().try_into_val(env).unwrap();
        if name != soroban_sdk::Symbol::new(env, "delegation_set") {
            continue;
        }
        let topic_delegator: Address = topics.get(1).unwrap().try_into_val(env).unwrap();
        if &topic_delegator == delegator {
            out.push_back(data.try_into_val(env).unwrap());
        }
    }
    out
}

#[test]
fn test_1939_delegate_voting_power_emits_delegation_set() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, members) = setup(&env, 3);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();
    let delegator = members.get(0).unwrap();
    let delegate = members.get(1).unwrap();

    client.delegate_voting_power(&delegator, &delegate, &500u64);

    let payloads = delegation_set_payloads(&env, &delegator);
    assert_eq!(payloads.len(), 1);
    let (emitted_delegate, emitted_expiry) = payloads.get(0).unwrap();
    assert_eq!(emitted_delegate, delegate);
    assert_eq!(emitted_expiry, 500u64);
}

#[test]
fn test_1939_delegate_vote_alias_emits_delegation_set() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, members) = setup(&env, 3);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();
    let delegator = members.get(0).unwrap();
    let delegate = members.get(1).unwrap();

    client.delegate_vote(&delegator, &delegate, &0u64);

    assert_eq!(delegation_set_payloads(&env, &delegator).len(), 1);
}

#[test]
fn test_1939_revoke_delegation_emits_delegation_revoked() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, members) = setup(&env, 3);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin).address();
    let delegator = members.get(0).unwrap();
    let delegate = members.get(1).unwrap();
    client.delegate_voting_power(&delegator, &delegate, &0u64);

    client.revoke_delegation(&delegator);

    let mut found = false;
    for (_, topics, data) in env.events().all().iter() {
        if topics.len() != 2 {
            continue;
        }
        let name: soroban_sdk::Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        if name != soroban_sdk::Symbol::new(&env, "delegation_revoked") {
            continue;
        }
        let topic_delegator: Address = topics.get(1).unwrap().try_into_val(&env).unwrap();
        let emitted_delegate: Address = data.try_into_val(&env).unwrap();
        assert_eq!(topic_delegator, delegator);
        assert_eq!(emitted_delegate, delegate);
        found = true;
    }
    assert!(found, "delegation_revoked event was not emitted");
}
