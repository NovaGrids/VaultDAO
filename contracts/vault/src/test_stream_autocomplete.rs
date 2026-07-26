//! Tests for Issue #1359: streaming payment auto-completion on balance drop.
#![cfg(test)]

use crate::types::{
    RecoveryConfig, RetryConfig, StakingConfig, StreamStatus, ThresholdStrategy, VelocityConfig,
    VoteWeight,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{Address, Env, Vec};

const TOTAL: i128 = 10_000;
const RATE: i128 = 1; // 1 token per second
const DURATION: u64 = 10_000;

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
        spending_limit: 100_000,
        daily_limit: 1_000_000,
        weekly_limit: 5_000_000,
        timelock_threshold: 90_000,
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

struct Fixture<'a> {
    client: VaultDAOClient<'a>,
    contract_id: Address,
    admin: Address,
    recipient: Address,
    token: Address,
    stream_id: u64,
}

/// Vault with a funded, active stream of `TOTAL` at `RATE` per second.
fn setup(env: &Env) -> Fixture<'_> {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let recipient = Address::generate(env);
    let token_admin = Address::generate(env);

    let mut signers: Vec<Address> = Vec::new(env);
    signers.push_back(admin.clone());
    client.initialize(&admin, &make_config(env, signers));

    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    StellarAssetClient::new(env, &token).mint(&admin, &TOTAL);

    let stream_id = client.create_stream(&admin, &recipient, &token, &RATE, &TOTAL, &DURATION);

    Fixture {
        client,
        contract_id,
        admin,
        recipient,
        token,
        stream_id,
    }
}

/// Moves every token out of the vault so the next claim cannot be covered.
fn drain_vault(env: &Env, fx: &Fixture<'_>) {
    let token = TokenClient::new(env, &fx.token);
    let balance = token.balance(&fx.contract_id);
    if balance > 0 {
        let sink = Address::generate(env);
        token.transfer(&fx.contract_id, &sink, &balance);
    }
}

#[test]
fn test_auto_complete_is_opt_in() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);

    assert!(!fx.client.get_stream_auto_complete(&fx.stream_id));

    fx.client
        .set_stream_auto_complete(&fx.admin, &fx.stream_id, &true);
    assert!(fx.client.get_stream_auto_complete(&fx.stream_id));
}

#[test]
fn test_stream_auto_completes_when_balance_insufficient() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);

    fx.client
        .set_stream_auto_complete(&fx.admin, &fx.stream_id, &true);

    // Accrue 1000 tokens of claimable value, then drop the vault balance to 0.
    env.ledger().with_mut(|l| l.timestamp += 1000);
    drain_vault(&env, &fx);

    // The claim does not fail: the stream retires itself instead of staying
    // active at a loss.
    assert_eq!(fx.client.claim_stream(&fx.recipient, &fx.stream_id), 0);

    let stream = fx.client.get_stream(&fx.stream_id);
    assert_eq!(stream.status, StreamStatus::Completed);
    assert_eq!(stream.claimed_amount, 0);
}

#[test]
fn test_stream_stays_active_when_balance_is_sufficient() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);

    fx.client
        .set_stream_auto_complete(&fx.admin, &fx.stream_id, &true);

    // Vault still holds the full escrow, so a normal claim goes through.
    env.ledger().with_mut(|l| l.timestamp += 1000);

    assert_eq!(fx.client.claim_stream(&fx.recipient, &fx.stream_id), 1000);

    let stream = fx.client.get_stream(&fx.stream_id);
    assert_eq!(stream.status, StreamStatus::Active);
    assert_eq!(stream.claimed_amount, 1000);
}

#[test]
fn test_claim_without_flag_does_not_auto_complete() {
    let env = Env::default();
    env.mock_all_auths();
    let fx = setup(&env);

    env.ledger().with_mut(|l| l.timestamp += 1000);
    drain_vault(&env, &fx);

    // Flag off: the claim fails and the stream is left Active, which is the
    // pre-#1359 behaviour and stays the default.
    assert!(fx.client.try_claim_stream(&fx.recipient, &fx.stream_id).is_err());
    assert_eq!(
        fx.client.get_stream(&fx.stream_id).status,
        StreamStatus::Active
    );
}
