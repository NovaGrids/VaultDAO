//! Tests for recalling unstreamed funds from a stream (Issue #1443).
//!
//! Unstreamed funds can be recalled two ways: `cancel_stream` refunds everything
//! not yet earned to the stream sender, and a multi-signer clawback request
//! (`request_stream_clawback` -> `vote_clawback` -> `execute_clawback`) recalls
//! only the requested, unvested portion. These tests cover both paths:
//! 1. Cancelling refunds the unearned remainder to the sender
//! 2. Cancelling pays the recipient's accrued but unclaimed funds
//! 3. Tokens already claimed by the recipient are kept
//! 4. Only the sender or an Admin can recall
//! 5. A stream cannot be recalled twice, or after it completed
//! 6. Recalling a nonexistent stream fails
//! 7. Clawback votes need the threshold, reject revotes, block self-approval
//!    and never allow a request to be executed twice (Issue #1911)
#![cfg(test)]

use crate::errors::VaultError;
use crate::types::{
    ClawbackStatus, RecoveryConfig, RetryConfig, Role, StakingConfig, StreamStatus,
    ThresholdStrategy, VelocityConfig, VoteWeight,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Symbol, Vec,
};

const RATE: i128 = 1;
const TOTAL: i128 = 1_000;
const DURATION: u64 = 1_000;

fn make_config(env: &Env, signers: Vec<Address>) -> InitConfig {
    InitConfig {
        quorum_percentage: 0,
        veto_window_ledgers: 0,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        veto_addresses: Vec::new(env),
        signers,
        threshold: 2,
        quorum: 0,
        default_voting_deadline: 0,
        spending_limit: 50_000,
        daily_limit: 100_000,
        weekly_limit: 200_000,
        timelock_threshold: 5_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            per_token_limit: 0,
            limit: 100,
            window: 3600,
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
    }
}

struct Fixture<'a> {
    client: VaultDAOClient<'a>,
    admin: Address,
    sender: Address,
    recipient: Address,
    token: TokenClient<'a>,
    stream_id: u64,
}

fn setup(env: &Env) -> Fixture<'_> {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let sender = Address::generate(env);
    let recipient = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(sender.clone());
    client.initialize(&admin, &make_config(env, signers));
    client.set_role(&admin, &sender, &Role::Treasurer);

    let token_addr = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(env, &token_addr).mint(&sender, &TOTAL);

    let stream_id =
        client.create_stream(&sender, &recipient, &token_addr, &RATE, &TOTAL, &DURATION);

    Fixture {
        client,
        admin,
        sender,
        recipient,
        token: TokenClient::new(env, &token_addr),
        stream_id,
    }
}

fn advance(env: &Env, secs: u64) {
    env.ledger().with_mut(|l| l.timestamp += secs);
}

#[test]
fn test_recall_before_any_accrual_refunds_everything() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    let refunded = f.client.cancel_stream(&f.sender, &f.stream_id);

    assert_eq!(refunded, TOTAL);
    assert_eq!(f.token.balance(&f.sender), TOTAL);
    assert_eq!(
        f.client.get_stream(&f.stream_id).status,
        StreamStatus::Cancelled
    );
}

#[test]
fn test_recall_refunds_only_unearned_remainder() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    advance(&env, 300);
    let refunded = f.client.cancel_stream(&f.sender, &f.stream_id);

    assert_eq!(refunded, TOTAL - 300 * RATE);
    assert_eq!(f.token.balance(&f.sender), TOTAL - 300 * RATE);
}

#[test]
fn test_claimed_tokens_are_kept_by_recipient() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    advance(&env, 200);
    let claimed = f.client.claim_stream(&f.recipient, &f.stream_id);
    assert_eq!(claimed, 200 * RATE);

    advance(&env, 100);
    let refunded = f.client.cancel_stream(&f.admin, &f.stream_id);

    assert_eq!(refunded, TOTAL - 300 * RATE);
    assert_eq!(f.token.balance(&f.recipient), 300 * RATE);
    assert_eq!(f.token.balance(&f.sender), TOTAL - 300 * RATE);
}

#[test]
fn test_cancel_pays_recipient_accrued_but_unclaimed() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    advance(&env, 300);
    f.client.cancel_stream(&f.sender, &f.stream_id);

    // Accrued since the last claim goes to the recipient, not the vault
    assert_eq!(f.token.balance(&f.recipient), 300 * RATE);
    assert_eq!(f.token.balance(&f.sender), TOTAL - 300 * RATE);
    assert_eq!(f.token.balance(&f.client.address), 0);
}

#[test]
fn test_cancel_accounting_invariant_holds() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    advance(&env, 300);
    f.client.claim_stream(&f.recipient, &f.stream_id);
    advance(&env, 250);

    let refunded = f.client.cancel_stream(&f.sender, &f.stream_id);
    let stream = f.client.get_stream(&f.stream_id);
    let paid_to_recipient = f.token.balance(&f.recipient);

    // refund + recipient payout + claimed == total, and nothing stays in the vault
    assert_eq!(refunded + paid_to_recipient, TOTAL);
    assert_eq!(stream.claimed_amount, paid_to_recipient);
    assert_eq!(refunded + stream.claimed_amount, TOTAL);
    assert_eq!(f.token.balance(&f.client.address), 0);
}

#[test]
fn test_recall_by_unrelated_address_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    let outsider = Address::generate(&env);
    assert_eq!(
        f.client.try_cancel_stream(&outsider, &f.stream_id),
        Err(Ok(VaultError::Unauthorized))
    );
    assert_eq!(
        f.client.try_cancel_stream(&f.recipient, &f.stream_id),
        Err(Ok(VaultError::Unauthorized))
    );
}

#[test]
fn test_cannot_recall_twice() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    f.client.cancel_stream(&f.sender, &f.stream_id);
    assert_eq!(
        f.client.try_cancel_stream(&f.sender, &f.stream_id),
        Err(Ok(VaultError::ProposalAlreadyCancelled))
    );
    assert_eq!(f.token.balance(&f.sender), TOTAL);
}

#[test]
fn test_cannot_recall_completed_stream() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    advance(&env, DURATION);
    f.client.claim_stream(&f.recipient, &f.stream_id);
    assert_eq!(
        f.client.get_stream(&f.stream_id).status,
        StreamStatus::Completed
    );

    assert_eq!(
        f.client.try_cancel_stream(&f.sender, &f.stream_id),
        Err(Ok(VaultError::ProposalAlreadyExecuted))
    );
}

#[test]
fn test_recall_nonexistent_stream_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    assert!(f.client.try_cancel_stream(&f.admin, &999u64).is_err());
}

/// Requests a clawback from `admin` and approves it with two Treasurer votes,
/// meeting the signer threshold of 2.
fn approve_clawback(f: &Fixture<'_>, env: &Env, amount: i128) -> u64 {
    let id = request_clawback(f, env, amount);
    f.client.vote_clawback(&f.sender, &id, &true);
    let second = Address::generate(env);
    f.client.set_role(&f.admin, &second, &Role::Treasurer);
    f.client.vote_clawback(&second, &id, &true);
    id
}

/// Requests a clawback from `admin` without voting on it.
fn request_clawback(f: &Fixture<'_>, env: &Env, amount: i128) -> u64 {
    f.client.request_stream_clawback(
        &f.admin,
        &f.stream_id,
        &amount,
        &Symbol::new(env, "recall"),
    )
}

#[test]
fn test_clawback_stays_pending_until_threshold_reached() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    let id = request_clawback(&f, &env, 200);
    f.client.vote_clawback(&f.sender, &id, &true);
    assert_eq!(
        f.client.get_clawback_request(&id).status,
        ClawbackStatus::Pending
    );
    assert_eq!(
        f.client.try_execute_clawback(&f.admin, &id),
        Err(Ok(VaultError::ProposalNotPending))
    );

    let second = Address::generate(&env);
    f.client.set_role(&f.admin, &second, &Role::Treasurer);
    f.client.vote_clawback(&second, &id, &true);
    assert_eq!(
        f.client.get_clawback_request(&id).status,
        ClawbackStatus::Approved
    );
}

#[test]
fn test_clawback_revote_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    let id = request_clawback(&f, &env, 200);
    f.client.vote_clawback(&f.sender, &id, &true);
    assert_eq!(
        f.client.try_vote_clawback(&f.sender, &id, &true),
        Err(Ok(VaultError::ClaimAlreadyVoted))
    );
    assert_eq!(
        f.client.try_vote_clawback(&f.sender, &id, &false),
        Err(Ok(VaultError::ClaimAlreadyVoted))
    );
    assert_eq!(f.client.get_clawback_request(&id).approvals, 1);
}

#[test]
fn test_requester_cannot_approve_own_clawback() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    let id = request_clawback(&f, &env, 200);
    assert_eq!(
        f.client.try_vote_clawback(&f.admin, &id, &true),
        Err(Ok(VaultError::ClaimSelfVote))
    );
    assert_eq!(
        f.client.get_clawback_request(&id).status,
        ClawbackStatus::Pending
    );
}

#[test]
fn test_executed_clawback_cannot_be_voted_or_executed_again() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    advance(&env, 300);
    let id = approve_clawback(&f, &env, 200);
    f.client.execute_clawback(&f.admin, &id);

    assert_eq!(
        f.client.try_vote_clawback(&f.sender, &id, &true),
        Err(Ok(VaultError::ProposalNotPending))
    );
    assert_eq!(
        f.client.try_execute_clawback(&f.admin, &id),
        Err(Ok(VaultError::ProposalNotPending))
    );
    // Only the single recall happened
    assert_eq!(f.token.balance(&f.sender), 200);
    assert_eq!(f.client.get_stream(&f.stream_id).total_amount, TOTAL - 200);
}

#[test]
fn test_rejected_clawback_cannot_be_approved_later() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    let id = request_clawback(&f, &env, 200);
    f.client.vote_clawback(&f.sender, &id, &false);
    assert_eq!(
        f.client.get_clawback_request(&id).status,
        ClawbackStatus::Rejected
    );

    let second = Address::generate(&env);
    f.client.set_role(&f.admin, &second, &Role::Treasurer);
    assert_eq!(
        f.client.try_vote_clawback(&second, &id, &true),
        Err(Ok(VaultError::ProposalNotPending))
    );
    assert_eq!(
        f.client.try_execute_clawback(&f.admin, &id),
        Err(Ok(VaultError::ProposalNotPending))
    );
}

#[test]
fn test_partial_clawback_recalls_only_requested_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    advance(&env, 300);
    let id = approve_clawback(&f, &env, 200);
    f.client.execute_clawback(&f.admin, &id);

    // Recalled tokens go back to the sender; the stream is reduced by the same amount
    assert_eq!(f.token.balance(&f.sender), 200);
    assert_eq!(f.client.get_stream(&f.stream_id).total_amount, TOTAL - 200);

    // The recipient keeps streaming and receives the reduced schedule in full
    advance(&env, 700);
    let claimed = f.client.claim_stream(&f.recipient, &f.stream_id);
    assert_eq!(claimed, TOTAL - 200);
    assert_eq!(f.token.balance(&f.recipient), TOTAL - 200);
    assert_eq!(f.token.balance(&f.client.address), 0);
    assert_eq!(
        f.client.get_clawback_request(&id).status,
        ClawbackStatus::Executed
    );
}

#[test]
fn test_full_clawback_is_capped_at_unvested_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    advance(&env, 300);
    // Requested amount exceeds what is unvested, so only the unvested 700 is recalled
    let id = approve_clawback(&f, &env, TOTAL);
    f.client.execute_clawback(&f.admin, &id);

    assert_eq!(f.token.balance(&f.sender), TOTAL - 300 * RATE);
    assert_eq!(f.client.get_stream(&f.stream_id).total_amount, 300 * RATE);

    advance(&env, 100);
    let claimed = f.client.claim_stream(&f.recipient, &f.stream_id);
    assert_eq!(claimed, 300 * RATE);
    assert_eq!(f.token.balance(&f.client.address), 0);
}

#[test]
fn test_clawback_with_nothing_unvested_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    advance(&env, DURATION);
    let id = approve_clawback(&f, &env, 100);

    assert_eq!(
        f.client.try_execute_clawback(&f.admin, &id),
        Err(Ok(VaultError::InvalidAmount))
    );
    assert_eq!(f.token.balance(&f.sender), 0);
}

#[test]
fn test_close_fully_claimed_stream_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    advance(&env, DURATION);
    f.client.claim_stream(&f.recipient, &f.stream_id);
    assert_eq!(
        f.client.get_stream(&f.stream_id).status,
        StreamStatus::Completed
    );

    f.client.close_stream(&f.sender, &f.stream_id);

    assert_eq!(
        f.client.get_stream(&f.stream_id).status,
        StreamStatus::Completed
    );
    assert_eq!(f.token.balance(&f.recipient), TOTAL);
    assert_eq!(f.token.balance(&f.client.address), 0);
}

#[test]
fn test_close_funded_stream_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    advance(&env, 300);
    assert_eq!(
        f.client.try_close_stream(&f.sender, &f.stream_id),
        Err(Ok(VaultError::StreamNotFullyClaimed))
    );

    // The stream stays live and the recipient can still claim what is owed
    assert_eq!(
        f.client.get_stream(&f.stream_id).status,
        StreamStatus::Active
    );
    let claimed = f.client.claim_stream(&f.recipient, &f.stream_id);
    assert_eq!(claimed, 300 * RATE);
    assert_eq!(f.token.balance(&f.recipient), 300 * RATE);
}

#[test]
fn test_close_by_unrelated_address_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let f = setup(&env);

    let outsider = Address::generate(&env);
    advance(&env, DURATION);
    f.client.claim_stream(&f.recipient, &f.stream_id);

    assert_eq!(
        f.client.try_close_stream(&outsider, &f.stream_id),
        Err(Ok(VaultError::Unauthorized))
    );
}
