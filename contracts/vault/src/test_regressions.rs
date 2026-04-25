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

// ============================================================================
// Security Regression Tests — Issue #711
// ============================================================================

/// Regression: calling `initialize` a second time must fail with
/// `VaultError::AlreadyInitialized` and leave the contract state intact.
#[test]
fn test_reinit_fails_with_already_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    client.initialize(
        &admin,
        &init_config(&env, signers.clone(), 1, ThresholdStrategy::Fixed),
    );

    // Second call must be rejected
    let result = client.try_initialize(
        &admin,
        &init_config(&env, signers, 1, ThresholdStrategy::Fixed),
    );
    assert_eq!(result, Err(Ok(VaultError::AlreadyInitialized)));
}

/// Regression: the same signer approving a proposal twice must fail with
/// `VaultError::AlreadyApproved` on the second attempt.
#[test]
fn test_double_approval_by_same_signer_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&contract_id, &100_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    // threshold=2 so one approval keeps the proposal Pending
    client.initialize(
        &admin,
        &init_config(&env, signers, 2, ThresholdStrategy::Fixed),
    );
    client.set_role(&admin, &signer, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "pay"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // First approval succeeds and proposal stays Pending (threshold not met)
    client.approve_proposal(&admin, &proposal_id);
    assert_eq!(
        client.get_proposal(&proposal_id).status,
        ProposalStatus::Pending
    );

    // Second approval by the same signer must fail
    let result = client.try_approve_proposal(&admin, &proposal_id);
    assert_eq!(result, Err(Ok(VaultError::AlreadyApproved)));
}

/// Regression: executing a proposal whose `expires_at` has passed must fail
/// with `VaultError::ProposalExpired`, even if the proposal was already
/// Approved.
#[test]
fn test_execute_expired_proposal_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&contract_id, &100_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    client.initialize(
        &admin,
        &init_config(&env, signers, 1, ThresholdStrategy::Fixed),
    );
    client.set_role(&admin, &signer, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &signer,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "pay"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Approve so the proposal moves to Approved status (threshold = 1)
    client.approve_proposal(&signer, &proposal_id);
    assert_eq!(
        client.get_proposal(&proposal_id).status,
        ProposalStatus::Approved
    );

    // Extend TTL so the proposal record survives the ledger jump
    env.as_contract(&contract_id, || {
        let key = crate::storage::DataKey::Proposal(proposal_id);
        env.storage().persistent().extend_ttl(
            &key,
            crate::storage::PROPOSAL_TTL,
            crate::storage::PROPOSAL_TTL * 2,
        );
        crate::storage::extend_instance_ttl(&env);
    });

    // Advance past expires_at (PROPOSAL_EXPIRY_LEDGERS = 120_960)
    env.ledger().with_mut(|li| {
        li.sequence_number += 121_000;
    });

    let result = client.try_execute_proposal(&signer, &proposal_id);
    assert_eq!(result, Err(Ok(VaultError::ProposalExpired)));
}

/// Regression: attempting to execute a proposal that has been cancelled must
/// fail with `VaultError::ProposalAlreadyCancelled`.
#[test]
fn test_execute_cancelled_proposal_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&contract_id, &100_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    client.initialize(
        &admin,
        &init_config(&env, signers, 1, ThresholdStrategy::Fixed),
    );
    client.set_role(&admin, &signer, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &signer,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "pay"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Proposer cancels the proposal
    client.cancel_proposal(&signer, &proposal_id, &Symbol::new(&env, "test"));
    assert_eq!(
        client.get_proposal(&proposal_id).status,
        ProposalStatus::Cancelled
    );

    // Attempting to execute a cancelled proposal must yield ProposalAlreadyCancelled
    let result = client.try_execute_proposal(&signer, &proposal_id);
    assert_eq!(result, Err(Ok(VaultError::ProposalAlreadyCancelled)));
}

/// Regression: an address with `Role::Member` (default for non-admin signers)
/// must not be allowed to call `propose_transfer` — it requires Treasurer or
/// Admin role.
#[test]
fn test_member_role_cannot_propose_transfer() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let member = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&contract_id, &100_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(member.clone());

    client.initialize(
        &admin,
        &init_config(&env, signers, 1, ThresholdStrategy::Fixed),
    );
    // `member` retains the default Role::Member — insufficient to propose

    let result = client.try_propose_transfer(
        &member,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "pay"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    assert_eq!(result, Err(Ok(VaultError::InsufficientRole)));
}

/// Regression: `update_threshold` must reject a threshold value that exceeds
/// the current number of registered signers with `VaultError::ThresholdTooHigh`.
#[test]
fn test_threshold_above_signers_count_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    // 2 signers, threshold = 1 (valid)
    client.initialize(
        &admin,
        &init_config(&env, signers, 1, ThresholdStrategy::Fixed),
    );

    // Attempt to raise threshold to 3, which exceeds the 2-signer count
    let result = client.try_update_threshold(&admin, &3u32);
    assert_eq!(result, Err(Ok(VaultError::ThresholdTooHigh)));
}

/// Regression: proposing a transfer with amount = 0 must fail immediately
/// with `VaultError::InvalidAmount`.
#[test]
fn test_zero_amount_proposal_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    client.initialize(
        &admin,
        &init_config(&env, signers, 1, ThresholdStrategy::Fixed),
    );

    let result = client.try_propose_transfer(
        &admin,
        &recipient,
        &token,
        &0i128,
        &Symbol::new(&env, "pay"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    assert_eq!(result, Err(Ok(VaultError::InvalidAmount)));
}

/// Regression: executing an Approved proposal before its `unlock_ledger` has
/// been reached must fail with `VaultError::TimelockNotExpired`.
#[test]
fn test_execute_before_timelock_expires_fails() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&contract_id, &100_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    // Use a config where timelock_threshold (500) < spending_limit (10_000) so
    // any proposal with amount >= 500 is subject to the timelock.
    let config = InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        default_voting_deadline: 0,
        spending_limit: 10_000,
        daily_limit: 100_000,
        weekly_limit: 500_000,
        timelock_threshold: 500,
        timelock_delay: 200,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
    };

    client.initialize(&admin, &config);
    client.set_role(&admin, &signer, &Role::Treasurer);

    // amount (600) >= timelock_threshold (500) → unlock_ledger = 100 + 200 = 300
    let proposal_id = client.propose_transfer(
        &signer,
        &recipient,
        &token,
        &600,
        &Symbol::new(&env, "locked"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    client.approve_proposal(&signer, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
    assert_eq!(proposal.unlock_ledger, 300); // 100 + 200

    // Ledger is still at 100, which is before the unlock point (300)
    let result = client.try_execute_proposal(&signer, &proposal_id);
    assert_eq!(result, Err(Ok(VaultError::TimelockNotExpired)));
}
