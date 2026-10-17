//! Regression tests for swap and subscription controls (#1925, #1926, #1927, #1928).

use crate::errors::VaultError;
use crate::types::{
    Condition, ConditionLogic, DexConfig, InsuranceConfig, Priority, ProposalStatus, RetryConfig,
    Role, StakingConfig, SubscriptionTier, SwapProposal, ThresholdStrategy, VelocityConfig,
    VoteWeight,
};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Symbol, Vec,
};

struct Ctx<'a> {
    client: VaultDAOClient<'a>,
    contract_id: Address,
    admin: Address,
    treasurer: Address,
    dex: Address,
}

fn setup(env: &Env) -> Ctx<'_> {
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let treasurer = Address::generate(env);
    let dex = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());

    client.initialize(
        &admin,
        &InitConfig {
            veto_window_ledgers: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers,
            threshold: 2,
            quorum: 0,
            default_voting_deadline: 0,
            spending_limit: 10_000,
            daily_limit: 50_000,
            weekly_limit: 100_000,
            timelock_threshold: 5_000,
            timelock_delay: 100,
            velocity_limit: VelocityConfig {
                limit: 100,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            veto_addresses: Vec::new(env),
            retry_config: RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(env),
            staking_config: StakingConfig::default(),
            proposal_id_prefix: 0,
            quorum_percentage: 0,
        },
    );
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    let mut enabled_dexs = Vec::new(env);
    enabled_dexs.push_back(dex.clone());
    client.set_dex_config(
        &admin,
        &DexConfig {
            enabled_dexs,
            max_slippage_bps: 100,
            max_price_impact_bps: 500,
            min_liquidity: 1000,
        },
    );

    Ctx {
        client,
        contract_id,
        admin,
        treasurer,
        dex,
    }
}

fn swap_op(ctx: &Ctx, token_in: &Address, token_out: &Address, amount: i128) -> SwapProposal {
    SwapProposal::Swap(
        ctx.dex.clone(),
        token_in.clone(),
        token_out.clone(),
        amount,
        0,
    )
}

// ============================================================================
// #1925: subscriptions only accept supported tokens
// ============================================================================

#[test]
fn test_subscription_rejects_unsupported_token() {
    let env = Env::default();
    let ctx = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &1000);

    let res = ctx.client.try_create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &false,
        &0u64,
    );
    assert_eq!(res, Err(Ok(VaultError::TokenNotSupported)));
    assert_eq!(TokenClient::new(&env, &token).balance(&subscriber), 1000);
}

#[test]
fn test_subscription_first_payment_goes_straight_to_provider() {
    let env = Env::default();
    let ctx = setup(&env);
    let subscriber = Address::generate(&env);
    let provider = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &1000);
    ctx.client.add_supported_token(&ctx.admin, &token, &10_000, &100_000);

    ctx.client.create_subscription(
        &subscriber,
        &provider,
        &SubscriptionTier::Basic,
        &token,
        &100i128,
        &1000u64,
        &false,
        &0u64,
    );

    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&provider), 100);
    assert_eq!(token_client.balance(&subscriber), 900);
    assert_eq!(token_client.balance(&ctx.contract_id), 0);
}

// ============================================================================
// #1926: swaps are subject to the same controls as transfers
// ============================================================================

#[test]
fn test_propose_swap_rejects_unsupported_token() {
    let env = Env::default();
    let ctx = setup(&env);
    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);

    let res = ctx.client.try_propose_swap(
        &ctx.treasurer,
        &swap_op(&ctx, &token_in, &token_out, 100),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    assert_eq!(res, Err(Ok(VaultError::TokenNotSupported)));
}

#[test]
fn test_propose_swap_enforces_per_proposal_limit() {
    let env = Env::default();
    let ctx = setup(&env);
    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);
    ctx.client.add_supported_token(&ctx.admin, &token_in, &1_000_000, &1_000_000);
    ctx.client.add_supported_token(&ctx.admin, &token_out, &1_000_000, &1_000_000);

    // spending_limit is 10_000, so a 20_000 swap must be refused
    let res = ctx.client.try_propose_swap(
        &ctx.treasurer,
        &swap_op(&ctx, &token_in, &token_out, 20_000),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    assert_eq!(res, Err(Ok(VaultError::ExceedsProposalLimit)));
}

#[test]
fn test_propose_swap_applies_timelock_to_large_swap() {
    let env = Env::default();
    let ctx = setup(&env);
    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);
    ctx.client.add_supported_token(&ctx.admin, &token_in, &1_000_000, &1_000_000);
    ctx.client.add_supported_token(&ctx.admin, &token_out, &1_000_000, &1_000_000);

    // 6_000 is under spending_limit (10_000) but over timelock_threshold (5_000)
    let proposal_id = ctx.client.propose_swap(
        &ctx.treasurer,
        &swap_op(&ctx, &token_in, &token_out, 6_000),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    let proposal = ctx.client.get_proposal(&proposal_id);
    assert_eq!(proposal.amount, 6_000);
    assert_eq!(proposal.token, token_in);
    assert_eq!(
        proposal.unlock_ledger,
        env.ledger().sequence() as u64 + 100
    );
}

#[test]
fn test_propose_swap_rejected_while_paused() {
    let env = Env::default();
    let ctx = setup(&env);
    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);
    ctx.client.add_supported_token(&ctx.admin, &token_in, &1_000_000, &1_000_000);
    ctx.client.add_supported_token(&ctx.admin, &token_out, &1_000_000, &1_000_000);
    ctx.client.pause_vault(&ctx.admin, &Symbol::new(&env, "manual"));

    let res = ctx.client.try_propose_swap(
        &ctx.treasurer,
        &swap_op(&ctx, &token_in, &token_out, 100),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    assert_eq!(res, Err(Ok(VaultError::VaultPaused)));
}

// ============================================================================
// #1927: execution honours conditions, pause and expiry
// ============================================================================

#[test]
fn test_swap_with_unmet_price_condition_does_not_execute() {
    let env = Env::default();
    let ctx = setup(&env);
    let token_in = Address::generate(&env);
    let token_out = Address::generate(&env);
    ctx.client.add_supported_token(&ctx.admin, &token_in, &1_000_000, &1_000_000);
    ctx.client.add_supported_token(&ctx.admin, &token_out, &1_000_000, &1_000_000);

    let mut conditions = Vec::new(&env);
    conditions.push_back(Condition::PriceAbove(token_in.clone(), i128::MAX));
    let proposal_id = ctx.client.propose_swap(
        &ctx.treasurer,
        &swap_op(&ctx, &token_in, &token_out, 100),
        &Priority::Normal,
        &conditions,
        &ConditionLogic::And,
        &0i128,
    );
    ctx.client.approve_proposal(&ctx.admin, &proposal_id);
    ctx.client.approve_proposal(&ctx.treasurer, &proposal_id);
    assert_eq!(
        ctx.client.get_proposal(&proposal_id).status,
        ProposalStatus::Approved
    );

    let res = ctx.client.try_execute_swap_proposal(&ctx.admin, &proposal_id);
    assert!(res.is_err());
    assert_ne!(
        ctx.client.get_proposal(&proposal_id).status,
        ProposalStatus::Executed
    );
}

// ============================================================================
// #1928: swap insurance is collected, not just recorded
// ============================================================================

#[test]
fn test_propose_swap_collects_insurance() {
    let env = Env::default();
    let ctx = setup(&env);
    let token_in = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let token_out = Address::generate(&env);
    ctx.client.add_supported_token(&ctx.admin, &token_in, &1_000_000, &1_000_000);
    ctx.client.add_supported_token(&ctx.admin, &token_out, &1_000_000, &1_000_000);
    ctx.client.set_insurance_config(
        &ctx.admin,
        &InsuranceConfig {
            enabled: true,
            min_amount: 1_000,
            min_insurance_bps: 1_000, // 10%
            slash_percentage: 50,
        },
    );
    StellarAssetClient::new(&env, &token_in).mint(&ctx.treasurer, &1_000);

    // A 2_000 swap needs at least 200 of insurance
    let short = ctx.client.try_propose_swap(
        &ctx.treasurer,
        &swap_op(&ctx, &token_in, &token_out, 2_000),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &100i128,
    );
    assert_eq!(short, Err(Ok(VaultError::InsuranceInsufficient)));

    let proposal_id = ctx.client.propose_swap(
        &ctx.treasurer,
        &swap_op(&ctx, &token_in, &token_out, 2_000),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &200i128,
    );

    let proposal = ctx.client.get_proposal(&proposal_id);
    assert_eq!(proposal.insurance_amount, 200);
    let token_client = TokenClient::new(&env, &token_in);
    assert_eq!(token_client.balance(&ctx.contract_id), 200);
    assert_eq!(token_client.balance(&ctx.treasurer), 800);
}
