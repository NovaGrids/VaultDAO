//! Issue #1698: balances earmarked for vesting, escrows and streams must not be
//! spendable by proposal execution.

use crate::errors::VaultError;
use crate::types::{
    ConditionLogic, InitConfig, Milestone, Priority, ProposalStatus, RetryConfig, Role,
    VelocityConfig,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Symbol, Vec,
};

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
    token: Address,
    vault: Address,
}

/// Vault initialised with `free` unreserved tokens.
fn setup(env: &Env, free: i128) -> Ctx {
    env.ledger().set_sequence_number(100);
    let vault = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &vault);
    let admin = Address::generate(env);
    let signer2 = Address::generate(env);
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer2.clone());
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    if free > 0 {
        StellarAssetClient::new(env, &token).mint(&vault, &free);
    }
    client.initialize(&admin, &init_config(env, signers));
    client.add_supported_token(&admin, &token, &1_000_000, &10_000_000);
    client.set_role(&admin, &signer2, &Role::Treasurer);
    Ctx {
        client,
        admin,
        signer2,
        token,
        vault,
    }
}

fn approved_transfer(env: &Env, ctx: &Ctx, recipient: &Address, amount: i128) -> u64 {
    let pid = ctx.client.propose_transfer(
        &ctx.admin,
        recipient,
        &ctx.token,
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

fn create_escrow(env: &Env, ctx: &Ctx, amount: i128) -> u64 {
    let funder = Address::generate(env);
    StellarAssetClient::new(env, &ctx.token).mint(&funder, &amount);
    let mut milestones = Vec::new(env);
    milestones.push_back(Milestone {
        id: 1,
        percentage: 100,
        release_ledger: 0,
        is_completed: false,
        completion_ledger: 0,
    });
    ctx.client.create_escrow(
        &funder,
        &Address::generate(env),
        &ctx.token,
        &amount,
        &milestones,
        &1_000u64,
        &ctx.admin,
    )
}

#[test]
fn test_vesting_reservation_cannot_be_spent_by_execution() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env, 1_000);

    // Vesting is created through an approved proposal.
    let vesting_proposal = ctx.client.create_vesting_schedule(
        &ctx.admin,
        &Address::generate(&env),
        &ctx.token,
        &950,
        &150u32,
        &100u32,
        &1_000u32,
    );
    ctx.client.approve_proposal(&ctx.admin, &vesting_proposal);
    ctx.client.approve_proposal(&ctx.signer2, &vesting_proposal);
    ctx.client
        .execute_multi_phase_proposal(&ctx.admin, &vesting_proposal);

    let recipient = Address::generate(&env);
    let pid = approved_transfer(&env, &ctx, &recipient, 100);
    assert_eq!(
        ctx.client.try_execute_proposal(&ctx.admin, &pid),
        Err(Ok(VaultError::InsufficientBalance))
    );
    assert_eq!(
        TokenClient::new(&env, &ctx.token).balance(&ctx.vault),
        1_000
    );
}

#[test]
fn test_escrow_reservation_cannot_be_spent_by_execution() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env, 500);
    create_escrow(&env, &ctx, 1_000);

    let recipient = Address::generate(&env);
    let too_big = approved_transfer(&env, &ctx, &recipient, 600);
    assert_eq!(
        ctx.client.try_execute_proposal(&ctx.admin, &too_big),
        Err(Ok(VaultError::InsufficientBalance))
    );

    // Batch execution is guarded as well
    let mut ids = Vec::new(&env);
    ids.push_back(too_big);
    let (executed, failed) = ctx.client.batch_execute_proposals(&ctx.admin, &ids);
    assert_eq!((executed.len(), failed), (0, 1));

    // Unreserved funds remain spendable
    let fits = approved_transfer(&env, &ctx, &recipient, 400);
    ctx.client.execute_proposal(&ctx.admin, &fits);
    assert_eq!(
        ctx.client.get_proposal(&fits).status,
        ProposalStatus::Executed
    );
    assert_eq!(
        TokenClient::new(&env, &ctx.token).balance(&ctx.vault),
        1_100
    );
}

#[test]
fn test_escrow_reservation_released_on_refund() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env, 0);
    let escrow_id = create_escrow(&env, &ctx, 1_000);
    let funder = ctx.client.get_escrow_info(&escrow_id).funder;

    // Refund on expiry returns the escrowed tokens and frees the reservation
    env.ledger().set_sequence_number(2_000);
    ctx.client.release_escrow(&funder, &escrow_id);
    assert_eq!(TokenClient::new(&env, &ctx.token).balance(&ctx.vault), 0);

    // New free funds are fully spendable again
    StellarAssetClient::new(&env, &ctx.token).mint(&ctx.vault, &500);
    let recipient = Address::generate(&env);
    let pid = approved_transfer(&env, &ctx, &recipient, 500);
    ctx.client.execute_proposal(&ctx.admin, &pid);
    assert_eq!(TokenClient::new(&env, &ctx.token).balance(&recipient), 500);
}

#[test]
fn test_stream_reservation_cannot_be_spent_by_execution() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env, 0);

    let sender = ctx.signer2.clone();
    StellarAssetClient::new(&env, &ctx.token).mint(&sender, &1_000);
    ctx.client.create_stream(
        &sender,
        &Address::generate(&env),
        &ctx.token,
        &1,
        &1_000,
        &1_000u64,
    );

    let recipient = Address::generate(&env);
    let pid = approved_transfer(&env, &ctx, &recipient, 100);
    assert_eq!(
        ctx.client.try_execute_proposal(&ctx.admin, &pid),
        Err(Ok(VaultError::InsufficientBalance))
    );
    assert_eq!(
        TokenClient::new(&env, &ctx.token).balance(&ctx.vault),
        1_000
    );
}

#[test]
fn test_blacklisted_recipient_cannot_receive_earmarked_funds() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env, 1_000);

    let blocked = Address::generate(&env);
    ctx.client.set_blacklist(&ctx.admin, &blocked, &true);

    let pid = approved_transfer(&env, &ctx, &blocked, 100);
    assert_eq!(
        ctx.client.try_execute_proposal(&ctx.admin, &pid),
        Err(Ok(VaultError::Blacklisted))
    );
    assert_eq!(
        ctx.client.get_proposal(&pid).status,
        ProposalStatus::Approved
    );
    assert_eq!(
        TokenClient::new(&env, &ctx.token).balance(&ctx.vault),
        1_000
    );
}

#[test]
fn test_earmarked_balances_block_over_limit_phases() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env, 1_000);

    // Earmark 900 via an escrow so only 100 remains free.
    create_escrow(&env, &ctx, 900);

    let recipient = Address::generate(&env);
    let pid = approved_transfer(&env, &ctx, &recipient, 500);
    assert_eq!(
        ctx.client.try_execute_proposal(&ctx.admin, &pid),
        Err(Ok(VaultError::InsufficientBalance))
    );
    assert_eq!(
        ctx.client.get_proposal(&pid).status,
        ProposalStatus::Approved
    );

    // A phase that fits within the free balance still succeeds.
    let fits = approved_transfer(&env, &ctx, &recipient, 100);
    ctx.client.execute_proposal(&ctx.admin, &fits);
    assert_eq!(
        ctx.client.get_proposal(&fits).status,
        ProposalStatus::Executed
    );
}

#[test]
fn test_first_phase_failure_records_status() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env, 100);

    let recipient = Address::generate(&env);
    let pid = approved_transfer(&env, &ctx, &recipient, 500);
    assert_eq!(
        ctx.client.try_execute_proposal(&ctx.admin, &pid),
        Err(Ok(VaultError::InsufficientBalance))
    );
    assert_eq!(
        ctx.client.get_proposal(&pid).status,
        ProposalStatus::Approved
    );
}

#[test]
fn test_middle_phase_failure_records_status() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env, 1_000);

    // Earmark most of the balance so a later phase cannot be funded.
    create_escrow(&env, &ctx, 800);

    let recipient = Address::generate(&env);
    let pid = approved_transfer(&env, &ctx, &recipient, 300);
    assert_eq!(
        ctx.client.try_execute_proposal(&ctx.admin, &pid),
        Err(Ok(VaultError::InsufficientBalance))
    );
    assert_eq!(
        ctx.client.get_proposal(&pid).status,
        ProposalStatus::Approved
    );
}

#[test]
fn test_last_phase_failure_records_status() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env, 1_000);

    // Drain the free balance with a successful transfer first.
    let recipient = Address::generate(&env);
    let ok = approved_transfer(&env, &ctx, &recipient, 1_000);
    ctx.client.execute_proposal(&ctx.admin, &ok);
    assert_eq!(
        ctx.client.get_proposal(&ok).status,
        ProposalStatus::Executed
    );

    let pid = approved_transfer(&env, &recipient, 1);
    assert_eq!(
        ctx.client.try_execute_proposal(&ctx.admin, &pid),
        Err(Ok(VaultError::InsufficientBalance))
    );
    assert_eq!(
        ctx.client.get_proposal(&pid).status,
        ProposalStatus::Approved
    );
}

#[test]
fn test_expiration_with_many_settled_proposals() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env, 10_000);

    let recipient = Address::generate(&env);
    let mut settled = Vec::new(&env);
    for _ in 0..5 {
        let pid = approved_transfer(&env, &ctx, &recipient, 100);
        ctx.client.execute_proposal(&ctx.admin, &pid);
        assert_eq!(
            ctx.client.get_proposal(&pid).status,
            ProposalStatus::Executed
        );
        settled.push_back(pid);
    }

    // A pending proposal expires once its deadline passes.
    let pending = ctx.client.propose_transfer(
        &ctx.admin,
        &recipient,
        &ctx.token,
        &100,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    ctx.client.approve_proposal(&ctx.admin, &pending);
    ctx.client.approve_proposal(&ctx.signer2, &pending);

    env.ledger().set_sequence_number(10_000);
    ctx.client.expire_proposal(&ctx.admin, &pending);
    assert_eq!(
        ctx.client.get_proposal(&pending).status,
        ProposalStatus::Expired
    );

    // Previously settled proposals keep their terminal status.
    for pid in settled.iter() {
        assert_eq!(
            ctx.client.get_proposal(&pid).status,
            ProposalStatus::Executed
        );
    }
}
