//! Regression coverage for changing votes after an approved proposal's
//! execution window has elapsed.

#![cfg(test)]

use crate::errors::VaultError;
use crate::types::{
    ConditionLogic, InitConfig, Priority, RetryConfig, ThresholdStrategy, VelocityConfig,
    VoteChoice, VoteWeight,
};
use crate::{RecoveryConfig, StakingConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::testutils::{Address as _, Events, Ledger};
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{Address, Env, Symbol, Vec};

#[test]
fn change_vote_after_execution_window_returns_error_without_event() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|ledger| ledger.sequence_number = 100);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signer = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    let signers = soroban_sdk::vec![&env, admin.clone(), signer.clone()];
    client.initialize(
        &admin,
        &InitConfig {
            signers,
            threshold: 2,
            quorum: 0,
            quorum_percentage: 0,
            spending_limit: 10_000,
            daily_limit: 100_000,
            weekly_limit: 500_000,
            timelock_threshold: 0,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 1_000,
                window: 3_600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            default_voting_deadline: 100,
            veto_addresses: Vec::new(&env),
            veto_window_ledgers: 0,
            retry_config: RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: RecoveryConfig::default(&env),
            staking_config: StakingConfig::default(),
            pre_execution_hooks: Vec::new(&env),
            post_execution_hooks: Vec::new(&env),
            proposal_id_prefix: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1_440,
            upgrade_timelock_delay: 17_280,
        },
    );
    client.add_supported_token(&admin, &token, &100_000, &500_000);
    StellarAssetClient::new(&env, &token).mint(&admin, &1_000);
    client.set_exec_window_ledgers(&admin, &5);

    let recipient = Address::generate(&env);
    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100i128,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );
    client.approve_proposal(&admin, &proposal_id);
    client.approve_proposal(&signer, &proposal_id);
    assert_eq!(
        client.get_proposal(&proposal_id).status,
        crate::types::ProposalStatus::Approved
    );

    let approved_at = client.get_proposal(&proposal_id).approved_at;
    env.ledger()
        .with_mut(|ledger| ledger.sequence_number = (approved_at + 6) as u32);
    assert_eq!(
        client.try_change_vote(&admin, &proposal_id, &VoteChoice::Abstain),
        Err(Ok(VaultError::ProposalExecutionWindowExpired))
    );
    assert!(
        env.events().all().is_empty(),
        "change_vote must not emit an event after execution-window expiry"
    );
}
