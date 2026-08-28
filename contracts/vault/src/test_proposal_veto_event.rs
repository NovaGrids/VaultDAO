//! Tests for Issue #1524: Add Proposal Veto Event Emission
//!
//! Off-chain indexers cannot detect vetoes without polling storage unless a
//! `proposal_vetoed` event is emitted on the veto execution path.
#![cfg(test)]

use super::*;
use crate::types::{ConditionLogic, InitConfig, Priority, ThresholdStrategy, VelocityConfig, VoteWeight};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    token::StellarAssetClient,
    Address, Env, Symbol, TryFromVal, Vec,
};

fn setup(env: &Env) -> (VaultDAOClient<'static>, Address, Address, Address, Address) {
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let signer1 = Address::generate(env);
    let vetoer = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());

    let mut veto_addresses = Vec::new(env);
    veto_addresses.push_back(vetoer.clone());

    let config = InitConfig {
        veto_window_ledgers: 1000,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 2,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1_000_000,
        daily_limit: 5_000_000,
        weekly_limit: 10_000_000,
        timelock_threshold: 0,
        timelock_delay: 0,
        velocity_limit: VelocityConfig {
            limit: 100_000,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses,
        retry_config: crate::types::RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
    };

    client.initialize(&admin, &config);

    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    StellarAssetClient::new(env, &token).mint(&admin, &10_000);

    (client, admin, signer1, vetoer, token)
}

#[test]
fn test_veto_emits_proposal_vetoed_event_with_correct_fields() {
    let env = Env::default();
    let (client, admin, _signer1, vetoer, token) = setup(&env);
    let recipient = Address::generate(&env);

    let proposal_id = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100i128,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    env.events().all(); // flush prior events (initialize, propose_transfer, etc.)

    client.veto_proposal(&vetoer, &proposal_id);

    let vetoed_topic = Symbol::new(&env, "proposal_vetoed");
    let found = env.events().all().iter().any(|(_, topics, data)| {
        let is_vetoed = topics
            .first()
            .and_then(|t| Symbol::try_from_val(&env, &t).ok())
            .map(|s| s == vetoed_topic)
            .unwrap_or(false);
        if !is_vetoed {
            return false;
        }
        let topic_proposal_id = topics
            .get(1)
            .and_then(|t| u64::try_from_val(&env, &t).ok());
        let event_vetoer = Address::try_from_val(&env, &data).ok();
        topic_proposal_id == Some(proposal_id) && event_vetoer == Some(vetoer.clone())
    });

    assert!(
        found,
        "expected a proposal_vetoed event carrying the proposal_id and vetoer"
    );

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, crate::types::ProposalStatus::Vetoed);
}
