//! Issue #1902: funding rounds can be linked to a proposal, and the
//! proposal-to-rounds index must reflect that link.

use crate::errors::VaultError;
use crate::types::{
    ConditionLogic, FundingMilestone, FundingMilestoneStatus, InitConfig, Priority, RetryConfig,
    Role, VelocityConfig,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::Address as _, token::StellarAssetClient, Address, Env, String, Symbol, Vec,
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
}

fn setup(env: &Env) -> Ctx {
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
    StellarAssetClient::new(env, &token).mint(&vault, &1_000_000);
    client.initialize(&admin, &init_config(env, signers));
    client.set_role(&admin, &signer2, &Role::Treasurer);
    Ctx {
        client,
        admin,
        signer2,
        token,
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

/// Create a proposal and return its ID. Approval is left to the caller.
fn propose(env: &Env, ctx: &Ctx) -> u64 {
    ctx.client.propose_transfer(
        &ctx.admin,
        &Address::generate(env),
        &ctx.token,
        &100,
        &Symbol::new(env, "memo"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    )
}

#[test]
fn test_round_without_proposal_is_not_indexed() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env);

    let round_id = ctx.client.create_funding_round(
        &ctx.admin,
        &Address::generate(&env),
        &ctx.token,
        &500,
        &milestones(&env, 500),
        &None,
    );

    assert_eq!(ctx.client.get_funding_round(&round_id).proposal_id, 0);
    let pid = propose(&env, &ctx);
    assert!(ctx.client.get_proposal_funding_rounds(&pid).is_empty());
}

#[test]
fn test_round_linked_to_approved_proposal_is_indexed() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env);

    let pid = propose(&env, &ctx);
    ctx.client.approve_proposal(&ctx.admin, &pid);
    ctx.client.approve_proposal(&ctx.signer2, &pid);
    assert_eq!(
        ctx.client.get_proposal(&pid).status,
        crate::types::ProposalStatus::Approved
    );

    let first = ctx.client.create_funding_round(
        &ctx.admin,
        &Address::generate(&env),
        &ctx.token,
        &500,
        &milestones(&env, 500),
        &Some(pid),
    );
    let second = ctx.client.create_funding_round(
        &ctx.admin,
        &Address::generate(&env),
        &ctx.token,
        &300,
        &milestones(&env, 300),
        &Some(pid),
    );

    assert_eq!(ctx.client.get_funding_round(&first).proposal_id, pid);
    let rounds = ctx.client.get_proposal_funding_rounds(&pid);
    assert_eq!(rounds.len(), 2);
    assert_eq!(rounds.get(0), Some(first));
    assert_eq!(rounds.get(1), Some(second));
}

#[test]
fn test_round_linked_to_pending_proposal_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env);

    // Not approved: no approvals have been recorded
    let pid = propose(&env, &ctx);
    let result = ctx.client.try_create_funding_round(
        &ctx.admin,
        &Address::generate(&env),
        &ctx.token,
        &500,
        &milestones(&env, 500),
        &Some(pid),
    );
    assert_eq!(result, Err(Ok(VaultError::ProposalNotApproved)));
    assert!(ctx.client.get_proposal_funding_rounds(&pid).is_empty());
}

#[test]
fn test_round_linked_to_unknown_proposal_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let ctx = setup(&env);

    let result = ctx.client.try_create_funding_round(
        &ctx.admin,
        &Address::generate(&env),
        &ctx.token,
        &500,
        &milestones(&env, 500),
        &Some(999),
    );
    assert_eq!(result, Err(Ok(VaultError::ProposalNotFound)));
}
