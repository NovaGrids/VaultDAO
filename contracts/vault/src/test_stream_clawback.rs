//! Tests for recalling unstreamed funds from a stream (Issue #1443).
//!
//! The contract has no separate clawback-vote flow; unstreamed funds are
//! recalled with `cancel_stream`, which refunds everything not yet earned to
//! the stream sender. These tests cover that recall path:
//! 1. Cancelling refunds the unearned remainder to the sender
//! 2. Tokens already claimed by the recipient are kept
//! 3. Only the sender or an Admin can recall
//! 4. A stream cannot be recalled twice, or after it completed
//! 5. Recalling a nonexistent stream fails
#![cfg(test)]

use crate::errors::VaultError;
use crate::types::{
    RecoveryConfig, RetryConfig, Role, StakingConfig, StreamStatus, ThresholdStrategy,
    VelocityConfig, VoteWeight,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Vec,
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
    assert_eq!(f.token.balance(&f.recipient), 200 * RATE);
    assert_eq!(f.token.balance(&f.sender), TOTAL - 300 * RATE);
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
