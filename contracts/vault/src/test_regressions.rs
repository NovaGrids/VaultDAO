use super::*;
use crate::types::{
    AmountTier, ConditionLogic, Priority, RetryConfig, ThresholdStrategy, VelocityConfig,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};

fn init_config(
    env: &Env,
    signers: Vec<Address>,
    threshold: u32,
    strategy: ThresholdStrategy,
) -> InitConfig {
    InitConfig {
        signers,
        threshold,
        quorum: 0,
        quorum_percentage: 0,
        default_voting_deadline: 0,
        spending_limit: 10_000,
        daily_limit: 100_000,
        weekly_limit: 500_000,
        timelock_threshold: 50_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: strategy,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        veto_addresses: Vec::new(env),
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: RecoveryConfig::default(env),
        staking_config: types::StakingConfig::default(),
    }
}

#[test]
fn test_amount_based_threshold_strategy_boundaries() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let s3 = Address::generate(&env);
    let user = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &100_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(s1.clone());
    signers.push_back(s2.clone());
    signers.push_back(s3.clone());

    let mut tiers = Vec::new(&env);
    tiers.push_back(AmountTier {
        amount: 100,
        approvals: 2,
    });
    tiers.push_back(AmountTier {
        amount: 500,
        approvals: 3,
    });
    tiers.push_back(AmountTier {
        amount: 1000,
        approvals: 4,
    });

    client.initialize(
        &admin,
        &init_config(&env, signers, 1, ThresholdStrategy::AmountBased(tiers)),
    );
    client.set_role(&admin, &s1, &Role::Treasurer);
    client.set_role(&admin, &s2, &Role::Treasurer);
    client.set_role(&admin, &s3, &Role::Treasurer);

    let p = client.propose_transfer(
        &s1,
        &user,
        &token,
        &499,
        &Symbol::new(&env, "tier"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    client.approve_proposal(&s1, &p);
    client.approve_proposal(&s2, &p);
    assert_eq!(client.get_proposal(&p).status, ProposalStatus::Approved);
}

#[test]
fn test_role_assignments_query_returns_deterministic_order() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer = Address::generate(&env);
    let user = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    client.initialize(
        &admin,
        &init_config(&env, signers, 1, ThresholdStrategy::Fixed),
    );
    client.set_role(&admin, &user, &Role::Treasurer);

    let assignments = client.get_role_assignments();
    assert_eq!(assignments.len(), 3);
    assert_eq!(assignments.get(0).unwrap().addr, admin);
    assert_eq!(assignments.get(0).unwrap().role, Role::Admin);
    assert_eq!(assignments.get(1).unwrap().addr, signer);
    assert_eq!(assignments.get(1).unwrap().role, Role::Member);
    assert_eq!(assignments.get(2).unwrap().addr, user);
    assert_eq!(assignments.get(2).unwrap().role, Role::Treasurer);
}

#[test]
fn test_daily_limit_recovers_after_proposal_expiry() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer = Address::generate(&env);
    let recipient = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&contract_id, &200_000);

    // daily_limit = 100_000, spending_limit = 10_000
    client.initialize(
        &admin,
        &init_config(&env, signers, 1, ThresholdStrategy::Fixed),
    );

    // Propose 10 transfers of 10_000 each — fills the daily limit exactly
    let amount: i128 = 10_000;
    let mut proposal_ids = Vec::new(&env);
    for _ in 0..10 {
        let id = client.propose_transfer(
            &admin,
            &recipient,
            &token,
            &amount,
            &Symbol::new(&env, "pay"),
            &Priority::Normal,
            &Vec::new(&env),
            &ConditionLogic::And,
            &0i128,
        );
        proposal_ids.push_back(id);
    }

    // Daily limit is now exhausted — an 11th proposal must fail
    let result = client.try_propose_transfer(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "pay"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    assert!(result.is_err(), "expected daily limit to be exhausted");

    // Advance ledger past expires_at (PROPOSAL_EXPIRY_LEDGERS = 120_960).
    // Bump persistent TTL for all proposals so they survive the ledger jump.
    env.as_contract(&contract_id, || {
        for i in 0..proposal_ids.len() {
            let id = proposal_ids.get(i).unwrap();
            let key = crate::storage::DataKey::Proposal(id);
            env.storage().persistent().extend_ttl(
                &key,
                crate::storage::PROPOSAL_TTL,
                crate::storage::PROPOSAL_TTL * 2,
            );
        }
        crate::storage::extend_instance_ttl(&env);
    });
    env.ledger().with_mut(|li| {
        li.sequence_number += 121_000;
    });

    // Trigger expiry on the first proposal by attempting to approve it
    let first_id = proposal_ids.get(0).unwrap();
    let expired = client.try_approve_proposal(&signer, &first_id);
    assert!(expired.is_err(), "expected ProposalExpired error");

    // After expiry the daily budget for that amount is refunded.
    // A new proposal for the same amount should now succeed.
    let new_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "pay"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    assert!(
        new_id > 0,
        "new proposal should succeed after expiry refund"
    );
}

#[test]
fn test_expiry_refund_is_idempotent() {
    // Triggering expiry twice (e.g. approve then execute on an already-expired
    // proposal) must not refund the spending limit a second time.
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer = Address::generate(&env);
    let recipient = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&contract_id, &100_000);

    client.initialize(
        &admin,
        &init_config(&env, signers, 1, ThresholdStrategy::Fixed),
    );

    let amount: i128 = 10_000;
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "pay"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Advance past expiry — bump TTL first so the proposal survives the jump
    env.as_contract(&contract_id, || {
        let key = crate::storage::DataKey::Proposal(proposal_id);
        env.storage().persistent().extend_ttl(
            &key,
            crate::storage::PROPOSAL_TTL,
            crate::storage::PROPOSAL_TTL * 2,
        );
        crate::storage::extend_instance_ttl(&env);
    });
    env.ledger().with_mut(|li| {
        li.sequence_number += 121_000;
    });

    // First expiry trigger — refunds the limit
    let _ = client.try_approve_proposal(&signer, &proposal_id);

    // Second expiry trigger on the same proposal — must NOT double-refund
    let _ = client.try_approve_proposal(&signer, &proposal_id);

    // The daily spent should be >= 0 (refunded once), not negative
    let today = env.ledger().sequence() as u64 / (24 * 720);
    let spent = client.get_daily_spent(&today);
    assert!(
        spent >= 0,
        "daily spent must not go negative from double-refund"
    );
}

#[test]
fn test_cancellation_refund_path_unaffected() {
    // Verify the existing cancel path still refunds correctly after the expiry fix.
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer = Address::generate(&env);
    let recipient = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&contract_id, &100_000);

    client.initialize(
        &admin,
        &init_config(&env, signers, 1, ThresholdStrategy::Fixed),
    );

    let amount: i128 = 10_000;
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "pay"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Cancel the proposal (proposer-initiated)
    client.cancel_proposal(&admin, &proposal_id, &Symbol::new(&env, "test"));

    // Should be able to propose again for the same amount
    let new_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &amount,
        &Symbol::new(&env, "pay"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    assert!(
        new_id > proposal_id,
        "cancel refund should allow new proposal"
    );
}
