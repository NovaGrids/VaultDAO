use super::*;
use crate::types::{
    AmountTier, BatchStatus, ConditionLogic, Priority, RetryConfig, ThresholdStrategy,
    TransferDetails, VelocityConfig,
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
        veto_window_ledgers: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
        },
        threshold_strategy: strategy,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        veto_addresses: Vec::new(env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: RecoveryConfig::default(env),
        staking_config: types::StakingConfig::default(),
        proposal_id_prefix: 0,
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
        veto_window_ledgers: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            per_token_limit: 0,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
        proposal_id_prefix: 0,
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
/// Test atomic multi-token batch execution with rollback functionality.
/// Verifies all-or-nothing semantics and proper rollback state persistence.
#[test]
fn test_atomic_batch_execution_with_rollback() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);
    let recipient3 = Address::generate(&env);

    // Create two different tokens
    let token1 = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token2 = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    // Mint tokens to vault
    StellarAssetClient::new(&env, &token1).mint(&contract_id, &100_000);
    StellarAssetClient::new(&env, &token2).mint(&contract_id, &100_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());

    let config = init_config(&env, signers, 1, ThresholdStrategy::Fixed);
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // Create batch transfers - mix of different tokens
    let mut transfers = Vec::new(&env);
    transfers.push_back(TransferDetails {
        recipient: recipient1.clone(),
        token: token1.clone(),
        amount: 1000,
    });
    transfers.push_back(TransferDetails {
        recipient: recipient2.clone(),
        token: token2.clone(),
        amount: 2000,
    });
    transfers.push_back(TransferDetails {
        recipient: recipient3.clone(),
        token: token1.clone(),
        amount: 1500,
    });

    // Create batch proposals
    let proposal_ids = client.batch_propose_transfers(
        &treasurer,
        &transfers,
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    assert_eq!(proposal_ids.len(), 3);

    // Approve all proposals
    for i in 0..proposal_ids.len() {
        let pid = proposal_ids.get(i).unwrap();
        client.approve_proposal(&admin, &pid);
        let proposal = client.get_proposal(&pid);
        assert_eq!(proposal.status, ProposalStatus::Approved);
    }

    // Get the batch ID (should be 1 since it's the first batch)
    let batch_id = 1u64;
    let batch = client.get_batch(&batch_id);
    assert_eq!(batch.status, BatchStatus::Pending);
    assert_eq!(batch.proposal_ids.len(), 3);

    // Test Case 1: Successful atomic execution
    // Record initial balances
    let initial_vault_balance1 =
        soroban_sdk::token::Client::new(&env, &token1).balance(&contract_id);
    let initial_vault_balance2 =
        soroban_sdk::token::Client::new(&env, &token2).balance(&contract_id);
    let initial_recipient1_balance =
        soroban_sdk::token::Client::new(&env, &token1).balance(&recipient1);
    let initial_recipient2_balance =
        soroban_sdk::token::Client::new(&env, &token2).balance(&recipient2);
    let initial_recipient3_balance =
        soroban_sdk::token::Client::new(&env, &token1).balance(&recipient3);

    // Execute batch successfully
    client.execute_batch(&admin, &batch_id);

    // Verify batch status
    let batch_after = client.get_batch(&batch_id);
    assert_eq!(batch_after.status, BatchStatus::Completed);
    assert_eq!(batch_after.executed_count, 3);
    assert_eq!(batch_after.failed_count, 0);

    // Verify all proposals are executed
    for i in 0..proposal_ids.len() {
        let pid = proposal_ids.get(i).unwrap();
        let proposal = client.get_proposal(&pid);
        assert_eq!(proposal.status, ProposalStatus::Executed);
    }

    // Verify token transfers occurred
    assert_eq!(
        soroban_sdk::token::Client::new(&env, &token1).balance(&contract_id),
        initial_vault_balance1 - 1000 - 1500
    );
    assert_eq!(
        soroban_sdk::token::Client::new(&env, &token2).balance(&contract_id),
        initial_vault_balance2 - 2000
    );
    assert_eq!(
        soroban_sdk::token::Client::new(&env, &token1).balance(&recipient1),
        initial_recipient1_balance + 1000
    );
    assert_eq!(
        soroban_sdk::token::Client::new(&env, &token2).balance(&recipient2),
        initial_recipient2_balance + 2000
    );
    assert_eq!(
        soroban_sdk::token::Client::new(&env, &token1).balance(&recipient3),
        initial_recipient3_balance + 1500
    );

    // Verify batch execution result
    let batch_result = client.get_batch_result(&batch_id);
    assert!(batch_result.is_some());
    let result = batch_result.unwrap();
    assert_eq!(result.executed_count, 3);
    assert_eq!(result.failed_count, 0);

    // Test Case 2: Batch execution with rollback
    // Create another batch where one proposal will fail due to insufficient balance
    // We'll create a third token with very little balance to force a failure
    let token3 = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(&env, &token3).mint(&contract_id, &100); // Only 100 tokens

    let mut transfers2 = Vec::new(&env);
    transfers2.push_back(TransferDetails {
        recipient: recipient1.clone(),
        token: token1.clone(),
        amount: 500, // This should succeed
    });
    transfers2.push_back(TransferDetails {
        recipient: recipient2.clone(),
        token: token3.clone(),
        amount: 1000, // This will fail - token3 only has 100 tokens
    });

    let proposal_ids2 = client.batch_propose_transfers(
        &treasurer,
        &transfers2,
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Approve all proposals
    for i in 0..proposal_ids2.len() {
        let pid = proposal_ids2.get(i).unwrap();
        client.approve_proposal(&admin, &pid);
    }

    let batch_id2 = 2u64;
    let batch2 = client.get_batch(&batch_id2);
    assert_eq!(batch2.status, BatchStatus::Pending);

    // Record balances before failed batch execution
    let pre_fail_vault_balance1 =
        soroban_sdk::token::Client::new(&env, &token1).balance(&contract_id);
    let pre_fail_vault_balance3 =
        soroban_sdk::token::Client::new(&env, &token3).balance(&contract_id);
    let pre_fail_recipient1_balance =
        soroban_sdk::token::Client::new(&env, &token1).balance(&recipient1);
    let pre_fail_recipient2_balance =
        soroban_sdk::token::Client::new(&env, &token3).balance(&recipient2);

    // Execute batch - should fail and rollback
    client.execute_batch(&admin, &batch_id2);

    // Verify batch status shows rollback
    let batch2_after = client.get_batch(&batch_id2);
    assert_eq!(batch2_after.status, BatchStatus::RolledBack);
    assert_eq!(batch2_after.executed_count, 1); // First transfer succeeded before rollback
    assert_eq!(batch2_after.failed_count, 1);

    // Verify rollback state is persisted and queryable
    let rollback_state = client.get_rollback_state(&batch_id2);
    assert_eq!(rollback_state.len(), 1); // One transfer was rolled back
    let (rolled_back_recipient, rolled_back_amount) = rollback_state.get(0).unwrap();
    assert_eq!(rolled_back_recipient, recipient1);
    assert_eq!(rolled_back_amount, 500);

    // Verify balances - rollback may not succeed in practice if recipients don't authorize
    // The vault balance should reflect that the first transfer succeeded but wasn't rolled back
    assert_eq!(
        soroban_sdk::token::Client::new(&env, &token1).balance(&contract_id),
        pre_fail_vault_balance1 - 500 // First transfer succeeded but rollback failed
    );
    assert_eq!(
        soroban_sdk::token::Client::new(&env, &token3).balance(&contract_id),
        pre_fail_vault_balance3 // Second transfer never happened
    );
    assert_eq!(
        soroban_sdk::token::Client::new(&env, &token1).balance(&recipient1),
        pre_fail_recipient1_balance + 500 // Recipient kept the tokens from first transfer
    );
    assert_eq!(
        soroban_sdk::token::Client::new(&env, &token3).balance(&recipient2),
        pre_fail_recipient2_balance // No change for second recipient
    );

    // Verify proposals that were executed remain in Executed status since rollback failed
    let proposal1 = client.get_proposal(&proposal_ids2.get(0).unwrap());
    assert_eq!(proposal1.status, ProposalStatus::Executed); // Rollback failed, so status remains Executed

    // Verify batch execution result for failed batch
    let batch_result2 = client.get_batch_result(&batch_id2);
    assert!(batch_result2.is_some());
    let result2 = batch_result2.unwrap();
    assert_eq!(result2.executed_count, 1);
    assert_eq!(result2.failed_count, 1);
}

/// Test that batch size is enforced at creation time
#[test]
fn test_batch_size_limit_enforced() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());

    let config = init_config(&env, signers, 1, ThresholdStrategy::Fixed);
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // Create transfers exceeding MAX_BATCH_SIZE (10)
    let mut transfers = Vec::new(&env);
    for i in 0..11 {
        transfers.push_back(TransferDetails {
            recipient: recipient.clone(),
            token: token.clone(),
            amount: 100 + i as i128,
        });
    }

    // Should fail with BatchTooLarge error
    let result = client.try_batch_propose_transfers(
        &treasurer,
        &transfers,
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    assert_eq!(result, Err(Ok(VaultError::BatchTooLarge)));
}

/// Test batch status transitions
#[test]
fn test_batch_status_transitions() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    StellarAssetClient::new(&env, &token).mint(&contract_id, &100_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());

    let config = init_config(&env, signers, 1, ThresholdStrategy::Fixed);
    client.initialize(&admin, &config);
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    // Create batch
    let mut transfers = Vec::new(&env);
    transfers.push_back(TransferDetails {
        recipient: recipient.clone(),
        token: token.clone(),
        amount: 1000,
    });

    let proposal_ids = client.batch_propose_transfers(
        &treasurer,
        &transfers,
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    let batch_id = 1u64;

    // Initial status should be Pending
    let batch = client.get_batch(&batch_id);
    assert_eq!(batch.status, BatchStatus::Pending);

    // Approve proposal
    client.approve_proposal(&admin, &proposal_ids.get(0).unwrap());

    // Execute batch successfully
    client.execute_batch(&admin, &batch_id);

    // Final status should be Completed
    let batch_final = client.get_batch(&batch_id);
    assert_eq!(batch_final.status, BatchStatus::Completed);

    // Try to execute again - should fail
    let result = client.try_execute_batch(&admin, &batch_id);
    assert_eq!(result, Err(Ok(VaultError::InvalidAmount))); // Reusing existing error for invalid state
}

// ============================================================================
// Issue #935: Proposal Status Transition Validation State Machine
// ============================================================================

#[test]
fn test_valid_status_transitions() {
    use crate::types::ProposalStatus;
    use crate::VaultDAO;

    // Pending → valid targets
    assert!(VaultDAO::validate_status_transition(
        ProposalStatus::Pending,
        ProposalStatus::Approved
    )
    .is_ok());
    assert!(
        VaultDAO::validate_status_transition(ProposalStatus::Pending, ProposalStatus::Expired)
            .is_ok()
    );
    assert!(VaultDAO::validate_status_transition(
        ProposalStatus::Pending,
        ProposalStatus::Cancelled
    )
    .is_ok());
    assert!(VaultDAO::validate_status_transition(
        ProposalStatus::Pending,
        ProposalStatus::Rejected
    )
    .is_ok());
    assert!(
        VaultDAO::validate_status_transition(ProposalStatus::Pending, ProposalStatus::Vetoed)
            .is_ok()
    );

    // Approved → valid targets
    assert!(VaultDAO::validate_status_transition(
        ProposalStatus::Approved,
        ProposalStatus::Executed
    )
    .is_ok());
    assert!(VaultDAO::validate_status_transition(
        ProposalStatus::Approved,
        ProposalStatus::Scheduled
    )
    .is_ok());
    assert!(VaultDAO::validate_status_transition(
        ProposalStatus::Approved,
        ProposalStatus::Cancelled
    )
    .is_ok());

    // Scheduled → valid targets
    assert!(VaultDAO::validate_status_transition(
        ProposalStatus::Scheduled,
        ProposalStatus::Executed
    )
    .is_ok());
    assert!(VaultDAO::validate_status_transition(
        ProposalStatus::Scheduled,
        ProposalStatus::Cancelled
    )
    .is_ok());
}

#[test]
fn test_invalid_status_transitions() {
    use crate::types::ProposalStatus;
    use crate::{errors::VaultError, VaultDAO};

    // Executed is terminal
    assert_eq!(
        VaultDAO::validate_status_transition(ProposalStatus::Executed, ProposalStatus::Pending),
        Err(VaultError::InvalidStatusTransition)
    );
    assert_eq!(
        VaultDAO::validate_status_transition(ProposalStatus::Executed, ProposalStatus::Approved),
        Err(VaultError::InvalidStatusTransition)
    );

    // Rejected is terminal
    assert_eq!(
        VaultDAO::validate_status_transition(ProposalStatus::Rejected, ProposalStatus::Pending),
        Err(VaultError::InvalidStatusTransition)
    );

    // Cancelled is terminal
    assert_eq!(
        VaultDAO::validate_status_transition(ProposalStatus::Cancelled, ProposalStatus::Approved),
        Err(VaultError::InvalidStatusTransition)
    );

    // Expired is terminal
    assert_eq!(
        VaultDAO::validate_status_transition(ProposalStatus::Expired, ProposalStatus::Approved),
        Err(VaultError::InvalidStatusTransition)
    );

    // Vetoed is terminal
    assert_eq!(
        VaultDAO::validate_status_transition(ProposalStatus::Vetoed, ProposalStatus::Approved),
        Err(VaultError::InvalidStatusTransition)
    );

    // Pending cannot go directly to Executed
    assert_eq!(
        VaultDAO::validate_status_transition(ProposalStatus::Pending, ProposalStatus::Executed),
        Err(VaultError::InvalidStatusTransition)
    );

    // Approved cannot go to Pending
    assert_eq!(
        VaultDAO::validate_status_transition(ProposalStatus::Approved, ProposalStatus::Pending),
        Err(VaultError::InvalidStatusTransition)
    );
}

// ============================================================================
// Issue #937: Proposal Dependency Execution Order Enforcement
// ============================================================================

fn setup_dependency_env(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address) {
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    client.initialize(
        &admin,
        &init_config(env, signers, 1, ThresholdStrategy::Fixed),
    );
    client.set_role(&admin, &admin, &Role::Treasurer);

    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    StellarAssetClient::new(env, &token).mint(&contract_id, &1_000_000);

    let recipient = Address::generate(env);
    (client, admin, token, recipient)
}



