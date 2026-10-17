use super::*;
use crate::types::{
    FundingMilestone, FundingMilestoneStatus, InitConfig, RecoveryConfig, RetryConfig,
    StakingConfig, VelocityConfig,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, String, Vec};

fn fixed_milestone(env: &Env, amount: i128) -> FundingMilestone {
    milestone_with(env, amount, 0)
}

fn percentage_milestone(env: &Env, bps: u32) -> FundingMilestone {
    milestone_with(env, 0, bps)
}

fn milestone_with(env: &Env, amount: i128, release_percentage_bps: u32) -> FundingMilestone {
    FundingMilestone {
        description: String::from_str(env, "milestone"),
        amount,
        release_percentage_bps,
        status: FundingMilestoneStatus::Pending,
        submitted_at: 0,
        verified_at: 0,
        required_verifiers: 1,
        verifications: Vec::new(env),
        rejection_reason: None,
    }
}

/// Initializes a vault whose admin is also a signer, and returns the client,
/// the admin, the vault contract address and a funded token.
fn setup(env: &Env) -> (VaultDAOClient<'static>, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(Address::generate(env));

    client.initialize(
        &admin,
        &InitConfig {
            veto_window_ledgers: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: crate::types::VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers,
            threshold: 2,
            quorum: 0,
            spending_limit: 100_000,
            daily_limit: 500_000,
            weekly_limit: 1_000_000,
            timelock_threshold: 0,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 1_000_000,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: crate::types::ThresholdStrategy::Fixed,
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
            proposal_id_prefix: 0,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            quorum_percentage: 0,
        },
    );

    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    client.add_supported_token(&admin, &token, &1_000_000, &10_000_000);
    StellarAssetClient::new(env, &token).mint(&contract_id, &10_000);

    (client, admin, contract_id, token)
}

#[test]
fn test_percentage_round_derives_milestone_amounts_at_creation() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id, token) = setup(&env);
    let recipient = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(percentage_milestone(&env, 2_500));
    milestones.push_back(percentage_milestone(&env, 2_500));
    milestones.push_back(percentage_milestone(&env, 5_000));

    let round_id = client.create_funding_round(&admin, &recipient, &token, &10_000, &milestones);
    let round = client.get_funding_round(&round_id);

    assert_eq!(round.total_amount, 10_000);
    assert_eq!(round.milestones.get(0).unwrap().amount, 2_500);
    assert_eq!(round.milestones.get(1).unwrap().amount, 2_500);
    assert_eq!(round.milestones.get(2).unwrap().amount, 5_000);
}

#[test]
fn test_percentage_round_assigns_truncation_remainder_to_last_milestone() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id, token) = setup(&env);
    let recipient = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(percentage_milestone(&env, 3_333));
    milestones.push_back(percentage_milestone(&env, 3_333));
    milestones.push_back(percentage_milestone(&env, 3_334));

    let round_id = client.create_funding_round(&admin, &recipient, &token, &10_001, &milestones);
    let round = client.get_funding_round(&round_id);

    assert_eq!(round.milestones.get(0).unwrap().amount, 3_333);
    assert_eq!(round.milestones.get(1).unwrap().amount, 3_333);
    assert_eq!(round.milestones.get(2).unwrap().amount, 3_335);
    let sum: i128 = round.milestones.iter().map(|m| m.amount).sum();
    assert_eq!(sum, 10_001);
}

#[test]
fn test_percentage_round_rejects_bps_not_summing_to_10000() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id, token) = setup(&env);
    let recipient = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(percentage_milestone(&env, 5_000));
    milestones.push_back(percentage_milestone(&env, 4_000));

    let result = client.try_create_funding_round(&admin, &recipient, &token, &10_000, &milestones);
    assert_eq!(result, Err(Ok(VaultError::FundingRoundError)));
}

#[test]
fn test_percentage_round_rejects_milestone_carrying_fixed_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id, token) = setup(&env);
    let recipient = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(milestone_with(&env, 2_500, 2_500));
    milestones.push_back(percentage_milestone(&env, 7_500));

    let result = client.try_create_funding_round(&admin, &recipient, &token, &10_000, &milestones);
    assert_eq!(result, Err(Ok(VaultError::FundingRoundError)));
}

#[test]
fn test_percentage_round_rejects_mixed_fixed_and_percentage_milestones() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id, token) = setup(&env);
    let recipient = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(percentage_milestone(&env, 5_000));
    milestones.push_back(fixed_milestone(&env, 5_000));

    let result = client.try_create_funding_round(&admin, &recipient, &token, &10_000, &milestones);
    assert_eq!(result, Err(Ok(VaultError::FundingRoundError)));
}

#[test]
fn test_fixed_round_still_sums_milestone_amounts() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id, token) = setup(&env);
    let recipient = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(fixed_milestone(&env, 1_000));
    milestones.push_back(fixed_milestone(&env, 2_000));

    let round_id = client.create_funding_round(&admin, &recipient, &token, &999, &milestones);
    assert_eq!(client.get_funding_round(&round_id).total_amount, 3_000);
}
