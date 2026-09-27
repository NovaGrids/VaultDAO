//! Tests for Issue #1093: Proposal Analytics Aggregator with Signer
//! Participation Scoring.

use crate::types::{
    ConditionLogic, InitConfig, Priority, Role, ThresholdStrategy, VelocityConfig, VoteWeight,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::testutils::{Address as _, Events as _, Ledger};
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{Address, Env, Symbol, Vec};

/// Whether an event with `name` as its first topic was published.
fn emitted(env: &Env, name: &str) -> bool {
    let expected = Symbol::new(env, name);
    env.events().all().iter().any(|(_, topics, _)| {
        topics
            .first()
            .and_then(|t| soroban_sdk::TryFromVal::try_from_val(env, &t).ok())
            .map(|s: Symbol| s == expected)
            .unwrap_or(false)
    })
}

fn base_init_config(env: &Env, signers: Vec<Address>, threshold: u32) -> InitConfig {
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

/// Two-signer vault: `admin` always votes, `signer2` never votes.
/// Threshold 2 keeps proposals Pending (and thus expirable) when only
/// `admin` approves.
fn setup_two_signer_vault() -> (VaultDAOClient<'static>, Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer2.clone());

    client.initialize(&admin, &base_init_config(&env, signers, 2));
    client.set_role(&admin, &signer2, &Role::Treasurer);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    StellarAssetClient::new(&env, &token).mint(&admin, &10_000_000);

    (client, env, admin, signer2, token)
}

fn create_proposal(env: &Env, client: &VaultDAOClient, proposer: &Address, token: &Address) -> u64 {
    let recipient = Address::generate(env);
    client.propose_transfer(
        proposer,
        &recipient,
        token,
        &100i128,
        &Symbol::new(env, "test"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    )
}

/// Three-signer vault (`admin`, `voter`, `target`) with threshold 3, plus a
/// separate uninvolved `governance_signer` used only to supply the second
/// approval on a force-rotation mini-proposal.
fn setup_degradation_vault() -> (
    VaultDAOClient<'static>,
    Env,
    Address,
    Address,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let target = Address::generate(&env);
    let governance_signer = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(target.clone());
    signers.push_back(governance_signer.clone());

    client.initialize(&admin, &base_init_config(&env, signers, 2));
    client.set_role(&admin, &target, &Role::Treasurer);
    client.set_role(&admin, &governance_signer, &Role::Treasurer);
    client.update_participation_config(&admin, &50u32, &3u32, &4u32);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    StellarAssetClient::new(&env, &token).mint(&admin, &10_000_000);
    let replacement = Address::generate(&env);

    (
        client,
        env,
        admin,
        target,
        governance_signer,
        token,
        replacement,
    )
}

/// Creates one proposal and lets it expire while only `admin` has approved,
/// so `target` (and nobody else) accrues a missed vote.
fn expire_one_round(
    env: &Env,
    client: &VaultDAOClient,
    admin: &Address,
    token: &Address,
    ledger_start: u32,
) {
    env.ledger().with_mut(|l| {
        l.sequence_number = ledger_start;
    });
    client.update_approval_timeout(admin, &10u64);
    let id = create_proposal(env, client, admin, token);
    client.approve_proposal(admin, &id);

    env.ledger().with_mut(|l| {
        l.sequence_number = ledger_start + 11;
    });
    client.auto_expire_proposals(admin, &10u32);
}

#[test]
fn test_get_participation_score_defaults_for_new_signer() {
    let (client, _env, _admin, signer2, _token) = setup_two_signer_vault();

    let score = client.get_participation_score(&signer2);

    assert_eq!(score.proposals_voted, 0);
    assert_eq!(score.proposals_missed, 0);
    assert_eq!(score.last_active_ledger, 0);
}

#[test]
fn test_active_signer_full_participation_rate() {
    let (client, env, admin, _signer2, token) = setup_two_signer_vault();

    for i in 0..5u32 {
        env.ledger().with_mut(|l| {
            l.sequence_number = 100 + i;
        });
        let id = create_proposal(&env, &client, &admin, &token);
        client.approve_proposal(&admin, &id);
    }

    let score = client.get_participation_score(&admin);
    assert_eq!(score.proposals_voted, 5);
    assert_eq!(score.proposals_missed, 0);
    assert_eq!(score.last_active_ledger, 104);

    let rate = client.get_participation_rate(&admin, &5u32);
    assert_eq!(rate, 100);
}

#[test]
fn test_inactive_signer_accumulates_missed_votes() {
    let (client, env, admin, signer2, token) = setup_two_signer_vault();

    for round in 0..4u32 {
        expire_one_round(&env, &client, &admin, &token, 100 + round * 100);
    }

    let score = client.get_participation_score(&signer2);
    assert_eq!(score.proposals_missed, 4);
    assert_eq!(score.proposals_voted, 0);

    let rate = client.get_participation_rate(&signer2, &4u32);
    assert_eq!(rate, 0);
}

#[test]
fn test_window_limited_query_reflects_recent_history_only() {
    let (client, env, admin, signer2, token) = setup_two_signer_vault();

    // 3 rounds where signer2 misses.
    for round in 0..3u32 {
        expire_one_round(&env, &client, &admin, &token, 100 + round * 100);
    }
    // 3 rounds where signer2 explicitly votes.
    for i in 0..3u32 {
        env.ledger().with_mut(|l| {
            l.sequence_number = 1000 + i;
        });
        let id = create_proposal(&env, &client, &admin, &token);
        client.approve_proposal(&signer2, &id);
    }

    // Full history: 3 misses + 3 votes -> 50%.
    assert_eq!(client.get_participation_rate(&signer2, &6u32), 50);
    // Most recent 3 entries are all votes -> 100%.
    assert_eq!(client.get_participation_rate(&signer2, &3u32), 100);
}

#[test]
fn test_participation_rate_rejects_window_over_100() {
    let (client, _env, _admin, signer2, _token) = setup_two_signer_vault();

    let result = client.try_get_participation_rate(&signer2, &101u32);
    assert!(result.is_err());
}

#[test]
fn test_low_participation_alert_fires_after_consecutive_low_periods() {
    let (client, env, admin, target, _gov, token, _replacement) = setup_degradation_vault();

    // min_participation_rate=50, window=4, consecutive threshold=3.
    for round in 0..2u32 {
        expire_one_round(&env, &client, &admin, &token, 100 + round * 100);
        assert!(!emitted(&env, "low_participation_alert"));
    }

    expire_one_round(&env, &client, &admin, &token, 100 + 2 * 100);
    assert!(emitted(&env, "low_participation_alert"));

    let score = client.get_participation_score(&target);
    assert_eq!(score.consecutive_low_periods, 3);
}

#[test]
fn test_force_rotation_blocked_before_30_days_low_participation() {
    let (client, env, admin, target, _gov, token, replacement) = setup_degradation_vault();

    expire_one_round(&env, &client, &admin, &token, 100);

    let result = client.try_propose_force_rotation(&admin, &target, &replacement);
    assert!(result.is_err());
}

#[test]
fn test_force_rotation_executes_after_30_days_and_threshold_approvals() {
    let (client, env, admin, target, gov, token, replacement) = setup_degradation_vault();

    expire_one_round(&env, &client, &admin, &token, 100);
    // expire_one_round's auto_expire_proposals call lands at ledger 111,
    // which is when low_participation_since_ledger gets set.
    let since_ledger: u32 = 111;
    let thirty_days_ledgers: u32 = 17_280 * 30;
    let target_ledger = since_ledger + thirty_days_ledgers + 1;

    // The vault's instance TTL is only ~30 days; jumping straight to
    // `target_ledger` in one leap would archive the contract instance before
    // any call gets a chance to extend it. Hop through an intermediate
    // ledger (still within the original TTL window) and touch the contract
    // with a mutating admin call to extend the TTL first.
    env.ledger().with_mut(|l| {
        l.sequence_number = 400_000;
    });
    client.update_participation_config(&admin, &50u32, &3u32, &4u32);

    env.ledger().with_mut(|l| {
        l.sequence_number = target_ledger;
    });

    let request_id = client.propose_force_rotation(&admin, &target, &replacement);

    // Only admin (the proposer) has approved so far -> not yet executed.
    let signers_before = client.get_signers();
    assert!(signers_before.contains(&target));

    client.approve_force_rotation(&gov, &request_id);

    let signers_after = client.get_signers();
    assert!(!signers_after.contains(&target));
    assert!(signers_after.contains(&replacement));
}
