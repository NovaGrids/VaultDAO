use super::*;
use crate::types::{
    FundingMilestone, FundingMilestoneStatus, InitConfig, RecoveryConfig, RetryConfig,
    StakingConfig, VelocityConfig,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env, String, Vec,
};

fn fixed_milestone(env: &Env, amount: i128) -> FundingMilestone {
    FundingMilestone {
        description: String::from_str(env, "milestone"),
        amount,
        release_percentage_bps: 0,
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
fn test_release_marks_milestone_released() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id, token) = setup(&env);
    let recipient = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(fixed_milestone(&env, 1_000));
    milestones.push_back(fixed_milestone(&env, 2_000));

    let round_id = client.create_funding_round(&admin, &recipient, &token, &3_000, &milestones);
    client.approve_funding_round(&admin, &round_id);
    client.submit_milestone(&recipient, &round_id, &0);
    client.verify_milestone(&admin, &round_id, &0);
    client.release_round_funds(&admin, &round_id, &0);

    let round = client.get_funding_round(&round_id);
    assert_eq!(
        round.milestones.get(0).unwrap().status,
        FundingMilestoneStatus::Released
    );
    assert_eq!(
        round.milestones.get(1).unwrap().status,
        FundingMilestoneStatus::Pending
    );
    assert_eq!(round.status, crate::types::FundingRoundStatus::Active);
}

#[test]
fn test_second_release_of_same_milestone_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, contract_id, token) = setup(&env);
    let recipient = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(fixed_milestone(&env, 1_000));
    milestones.push_back(fixed_milestone(&env, 2_000));

    let round_id = client.create_funding_round(&admin, &recipient, &token, &3_000, &milestones);
    client.approve_funding_round(&admin, &round_id);
    client.submit_milestone(&recipient, &round_id, &0);
    client.verify_milestone(&admin, &round_id, &0);
    client.release_round_funds(&admin, &round_id, &0);

    let token_client = TokenClient::new(&env, &token);
    let recipient_before = token_client.balance(&recipient);
    let vault_before = token_client.balance(&contract_id);

    let retry = client.try_release_round_funds(&admin, &round_id, &0);
    assert_eq!(retry, Err(Ok(VaultError::InvalidStatusTransition)));

    assert_eq!(token_client.balance(&recipient), recipient_before);
    assert_eq!(token_client.balance(&contract_id), vault_before);
    assert_eq!(client.get_funding_round(&round_id).released_amount, 1_000);
}

#[test]
fn test_release_rejects_milestone_not_verified() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id, token) = setup(&env);
    let recipient = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(fixed_milestone(&env, 1_000));

    let round_id = client.create_funding_round(&admin, &recipient, &token, &1_000, &milestones);
    client.approve_funding_round(&admin, &round_id);
    client.submit_milestone(&recipient, &round_id, &0);

    let result = client.try_release_round_funds(&admin, &round_id, &0);
    assert_eq!(result, Err(Ok(VaultError::InvalidStatusTransition)));
}
