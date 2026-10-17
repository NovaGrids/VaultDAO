//! Issue #1903: tokens held in time-weighted locks must be reserved so that
//! proposal execution cannot spend them when the governance token is also a
//! spendable treasury token.

use crate::errors::VaultError;
use crate::types::{
    ConditionLogic, InitConfig, Priority, ProposalStatus, RetryConfig, Role, TimeWeightedConfig,
    VelocityConfig,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Symbol, Vec,
};

const LOCK_DURATION: u64 = 30 * 17_280;

fn init_config(env: &Env, signers: Vec<Address>) -> InitConfig {
    InitConfig {
        signers,
        threshold: 2,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1_000_000,
        daily_limit: 5_000_000,
        weekly_limit: 10_000_000,
        timelock_threshold: 1_000_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 10_000_000,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: crate::types::ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        veto_window_ledgers: 0,
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
            max_retry_delay: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 100,
        admin_rotation_delay: 1440,
    }
}

struct Ctx {
    client: VaultDAOClient<'static>,
    admin: Address,
    signer2: Address,
    gov_token: Address,
    vault: Address,
}

/// Vault with time-weighted locks enabled for `gov_token`, which is also a
/// supported treasury token, and `free` unlocked tokens held by the vault.
fn setup(env: &Env, free: i128) -> Ctx {
    env.ledger().set_sequence_number(100);
    let vault = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &vault);
    let admin = Address::generate(env);
    let signer2 = Address::generate(env);
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer2.clone());
    let gov_token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    if free > 0 {
        StellarAssetClient::new(env, &gov_token).mint(&vault, &free);
    }
    client.initialize(&admin, &init_config(env, signers));
    client.set_role(&admin, &signer2, &Role::Treasurer);
    client.add_supported_token(&admin, &gov_token, &1_000_000, &5_000_000);
    client.set_time_weighted_config(
        &admin,
        &TimeWeightedConfig {
            enabled: true,
            governance_token: Some(gov_token.clone()),
            ..TimeWeightedConfig::default()
        },
    );
    Ctx {
        client,
        admin,
        signer2,
        gov_token,
        vault,
    }
}

fn approved_transfer(env: &Env, ctx: &Ctx, recipient: &Address, amount: i128) -> u64 {
    let pid = ctx.client.propose_transfer(
        &ctx.admin,
        recipient,
        &ctx.gov_token,
        &amount,
        &Symbol::new(env, "memo"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    );
    ctx.client.approve_proposal(&ctx.admin, &pid);
    ctx.client.approve_proposal(&ctx.signer2, &pid);
    pid
}

#[test]
fn test_locked_governance_tokens_cannot_be_spent_by_execution() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env, 500);

    let owner = Address::generate(&env);
    StellarAssetClient::new(&env, &ctx.gov_token).mint(&owner, &1_000);
    ctx.client
        .lock_tokens(&owner, &ctx.gov_token, &1_000, &LOCK_DURATION);
    assert_eq!(
        TokenClient::new(&env, &ctx.gov_token).balance(&ctx.vault),
        1_500
    );

    // Only the 500 unlocked tokens are spendable
    let recipient = Address::generate(&env);
    let too_big = approved_transfer(&env, &ctx, &recipient, 600);
    assert_eq!(
        ctx.client.try_execute_proposal(&ctx.admin, &too_big),
        Err(Ok(VaultError::InsufficientBalance))
    );

    let fits = approved_transfer(&env, &ctx, &recipient, 500);
    ctx.client.execute_proposal(&ctx.admin, &fits);
    assert_eq!(
        ctx.client.get_proposal(&fits).status,
        ProposalStatus::Executed
    );
    assert_eq!(
        TokenClient::new(&env, &ctx.gov_token).balance(&ctx.vault),
        1_000
    );

    // The locker still gets the full amount back after the lock period
    env.ledger()
        .set_sequence_number(100 + LOCK_DURATION as u32);
    assert_eq!(ctx.client.unlock_tokens(&owner), 1_000);
    assert_eq!(TokenClient::new(&env, &ctx.gov_token).balance(&owner), 1_000);
    assert_eq!(TokenClient::new(&env, &ctx.gov_token).balance(&ctx.vault), 0);
}

#[test]
fn test_early_unlock_releases_lock_reservation() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env, 0);

    let owner = Address::generate(&env);
    StellarAssetClient::new(&env, &ctx.gov_token).mint(&owner, &1_000);
    ctx.client
        .lock_tokens(&owner, &ctx.gov_token, &1_000, &LOCK_DURATION);

    // Early unlock returns 90% (10% default penalty). The penalty stays in the
    // vault as insurance, so nothing becomes free to spend.
    assert_eq!(ctx.client.unlock_early(&owner), 900);
    assert_eq!(
        TokenClient::new(&env, &ctx.gov_token).balance(&ctx.vault),
        100
    );

    let recipient = Address::generate(&env);
    let pid = approved_transfer(&env, &ctx, &recipient, 1);
    assert_eq!(
        ctx.client.try_execute_proposal(&ctx.admin, &pid),
        Err(Ok(VaultError::InsufficientBalance))
    );

    // Newly deposited tokens are fully spendable: the lock reservation was released
    StellarAssetClient::new(&env, &ctx.gov_token).mint(&ctx.vault, &300);
    let spend = approved_transfer(&env, &ctx, &recipient, 300);
    ctx.client.execute_proposal(&ctx.admin, &spend);
    assert_eq!(
        TokenClient::new(&env, &ctx.gov_token).balance(&recipient),
        300
    );
}
