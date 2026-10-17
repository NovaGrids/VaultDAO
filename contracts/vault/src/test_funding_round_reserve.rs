//! Issue #1901: funding rounds must reserve their total when approved, and every
//! payout must pass the recipient list, spending limits and circuit breaker.

use crate::errors::VaultError;
use crate::types::{
    ConditionLogic, FundingMilestone, FundingMilestoneStatus, FundingRoundStatus, InitConfig,
    ListMode, Priority, RetryConfig, Role, VelocityConfig,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env, String, Symbol, Vec,
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

/// Vault holding `free` tokens, with two Admin signers (quorum 2).
fn setup(env: &Env, free: i128) -> Ctx {
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
    client.set_role(&admin, &signer2, &Role::Admin);
    Ctx {
        client,
        admin,
        signer2,
        token,
        vault,
    }
}

fn milestones(env: &Env, amount: i128) -> Vec<FundingMilestone> {
    let mut list = Vec::new(env);
    list.push_back(FundingMilestone {
        description: String::from_str(env, "delivery"),
        amount,
        release_percentage_bps: 0,
        status: FundingMilestoneStatus::Pending,
        submitted_at: 0,
        verified_at: 0,
        required_verifiers: 1,
        verifications: Vec::new(env),
        rejection_reason: None,
    });
    list
}

fn create_round(env: &Env, ctx: &Ctx, recipient: &Address, amount: i128) -> u64 {
    ctx.client.create_funding_round(
        &ctx.admin,
        recipient,
        &ctx.token,
        &amount,
        &milestones(env, amount),
        &None,
    )
}

/// Both Admin signers approve, which meets the quorum of 2.
fn approve_round(ctx: &Ctx, round_id: u64) {
    ctx.client.approve_funding_round(&ctx.admin, &round_id);
    ctx.client.approve_funding_round(&ctx.signer2, &round_id);
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

/// Submit, verify and release milestone 0 of a round, returning the amount paid.
fn release_milestone(ctx: &Ctx, round_id: u64, recipient: &Address) -> i128 {
    ctx.client.submit_milestone(recipient, &round_id, &0);
    ctx.client.verify_milestone(&ctx.admin, &round_id, &0);
    ctx.client.release_round_funds(&ctx.admin, &round_id, &0)
}

#[test]
fn test_single_approval_does_not_reserve_funds() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env, 1_000);

    let round_id = create_round(&env, &ctx, &Address::generate(&env), 500);
    ctx.client.approve_funding_round(&ctx.admin, &round_id);

    // Quorum not reached: the round is still pending and nothing is earmarked
    assert_eq!(
        ctx.client.get_funding_round(&round_id).status,
        FundingRoundStatus::Pending
    );
    let recipient = Address::generate(&env);
    let pid = approved_transfer(&env, &ctx, &recipient, 1_000);
    ctx.client.execute_proposal(&ctx.admin, &pid);
    assert_eq!(TokenClient::new(&env, &ctx.token).balance(&recipient), 1_000);
}

#[test]
fn test_duplicate_approval_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env, 1_000);

    let round_id = create_round(&env, &ctx, &Address::generate(&env), 500);
    ctx.client.approve_funding_round(&ctx.admin, &round_id);
    assert_eq!(
        ctx.client
            .try_approve_funding_round(&ctx.admin, &round_id),
        Err(Ok(VaultError::AlreadyApproved))
    );
}

#[test]
fn test_round_reservation_blocks_treasury_spend() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env, 1_000);

    let round_id = create_round(&env, &ctx, &Address::generate(&env), 500);
    approve_round(&ctx, round_id);
    assert_eq!(
        ctx.client.get_funding_round(&round_id).status,
        FundingRoundStatus::Active
    );

    // Only 500 of the 1000 is unearmarked
    let recipient = Address::generate(&env);
    let too_big = approved_transfer(&env, &ctx, &recipient, 600);
    assert_eq!(
        ctx.client.try_execute_proposal(&ctx.admin, &too_big),
        Err(Ok(VaultError::InsufficientBalance))
    );
    let fits = approved_transfer(&env, &ctx, &recipient, 500);
    ctx.client.execute_proposal(&ctx.admin, &fits);

    // The round can still pay its milestone from the reserved balance
    let round_recipient = ctx.client.get_funding_round(&round_id).recipient;
    assert_eq!(release_milestone(&ctx, round_id, &round_recipient), 500);
    assert_eq!(TokenClient::new(&env, &ctx.token).balance(&ctx.vault), 0);
}

#[test]
fn test_blacklisted_recipient_cannot_receive_round_funds() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env, 1_000);

    let recipient = Address::generate(&env);
    let round_id = create_round(&env, &ctx, &recipient, 500);
    approve_round(&ctx, round_id);

    ctx.client.set_list_mode(&ctx.admin, &ListMode::Blacklist);
    ctx.client.add_to_blacklist(&ctx.admin, &recipient);

    ctx.client.submit_milestone(&recipient, &round_id, &0);
    ctx.client.verify_milestone(&ctx.admin, &round_id, &0);
    assert_eq!(
        ctx.client
            .try_release_round_funds(&ctx.admin, &round_id, &0),
        Err(Ok(VaultError::RecipientBlacklisted))
    );
    assert_eq!(TokenClient::new(&env, &ctx.token).balance(&recipient), 0);
}

#[test]
fn test_over_limit_round_payout_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    // Enough balance to reserve the round, but the round is above the per-proposal limit
    let ctx = setup(&env, 2_000_000);

    let recipient = Address::generate(&env);
    let round_id = create_round(&env, &ctx, &recipient, 1_500_000);
    approve_round(&ctx, round_id);

    ctx.client.submit_milestone(&recipient, &round_id, &0);
    ctx.client.verify_milestone(&ctx.admin, &round_id, &0);
    assert_eq!(
        ctx.client
            .try_release_round_funds(&ctx.admin, &round_id, &0),
        Err(Ok(VaultError::ExceedsProposalLimit))
    );
    assert_eq!(TokenClient::new(&env, &ctx.token).balance(&recipient), 0);
}

#[test]
fn test_cancel_releases_round_reservation() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env, 1_000);

    let round_id = create_round(&env, &ctx, &Address::generate(&env), 500);
    approve_round(&ctx, round_id);
    ctx.client.cancel_funding_round(&ctx.admin, &round_id);

    // The full 1000 is spendable again
    let recipient = Address::generate(&env);
    let pid = approved_transfer(&env, &ctx, &recipient, 1_000);
    ctx.client.execute_proposal(&ctx.admin, &pid);
    assert_eq!(TokenClient::new(&env, &ctx.token).balance(&recipient), 1_000);
}
