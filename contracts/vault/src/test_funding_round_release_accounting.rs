use super::*;
use crate::types::{
    FundingMilestone, FundingMilestoneStatus, InitConfig, RecoveryConfig, RetryConfig,
    StakingConfig, VelocityConfig,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Events},
    token::{StellarAssetClient, TokenClient},
    Address, Env, String, Symbol, TryFromVal, Vec,
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
fn test_release_round_funds_counts_each_payout_once() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, contract_id, token) = setup(&env);
    let recipient = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(fixed_milestone(&env, 1_000));
    milestones.push_back(fixed_milestone(&env, 2_000));
    milestones.push_back(fixed_milestone(&env, 3_000));

    let round_id = client.create_funding_round(&admin, &recipient, &token, &6_000, &milestones);
    client.approve_funding_round(&admin, &round_id);

    let token_client = TokenClient::new(&env, &token);
    let mut expected_released: i128 = 0;

    for index in 0..3u32 {
        client.submit_milestone(&recipient, &round_id, &index);
        client.verify_milestone(&admin, &round_id, &index);
        let paid = client.release_round_funds(&admin, &round_id, &index);
        expected_released += paid;

        let round = client.get_funding_round(&round_id);
        assert_eq!(round.released_amount, expected_released);
        assert!(round.released_amount <= round.total_amount);
        assert_eq!(token_client.balance(&recipient), expected_released);
    }

    let round = client.get_funding_round(&round_id);
    assert_eq!(round.released_amount, 6_000);
    assert_eq!(round.status, crate::types::FundingRoundStatus::Completed);
    assert_eq!(token_client.balance(&contract_id), 10_000 - 6_000);
}

#[test]
fn test_funding_round_completed_event_matches_transferred_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id, token) = setup(&env);
    let recipient = Address::generate(&env);

    let mut milestones = Vec::new(&env);
    milestones.push_back(fixed_milestone(&env, 1_000));
    milestones.push_back(fixed_milestone(&env, 2_000));

    let round_id = client.create_funding_round(&admin, &recipient, &token, &3_000, &milestones);
    client.approve_funding_round(&admin, &round_id);

    for index in 0..2u32 {
        client.submit_milestone(&recipient, &round_id, &index);
        client.verify_milestone(&admin, &round_id, &index);
        client.release_round_funds(&admin, &round_id, &index);
    }

    let completed_symbol = Symbol::new(&env, "funding_round_completed");
    let completed_amounts: Vec<i128> = {
        let mut out = Vec::new(&env);
        for (_contract, topics, data) in env.events().all().iter() {
            let is_completed = topics
                .get(0)
                .map(|t| Symbol::try_from_val(&env, &t).ok() == Some(completed_symbol.clone()))
                .unwrap_or(false);
            if is_completed {
                out.push_back(i128::try_from_val(&env, &data).unwrap());
            }
        }
        out
    };

    assert_eq!(completed_amounts.len(), 1);
    assert_eq!(completed_amounts.get(0).unwrap(), 3_000);
    assert_eq!(client.get_funding_round(&round_id).released_amount, 3_000);
}
