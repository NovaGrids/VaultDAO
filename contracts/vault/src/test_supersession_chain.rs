#![cfg(test)]

use super::*;
use crate::types::Priority;
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, Vec};

fn setup(env: &Env) -> (VaultDAOClient<'static>, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    client.initialize(
        &admin,
        &crate::types::InitConfig {
            veto_window_ledgers: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: crate::types::VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers,
            threshold: 1,
            quorum: 0,
            spending_limit: 1_000_000,
            daily_limit: 5_000_000,
            weekly_limit: 10_000_000,
            timelock_threshold: 0,
            timelock_delay: 0,
            velocity_limit: crate::types::VelocityConfig {
                limit: 1_000_000,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: crate::types::ThresholdStrategy::Fixed,
            default_voting_deadline: 0,
            veto_addresses: Vec::new(env),
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
            quorum_percentage: 0,
        },
    );

    (client, admin, contract_id)
}

#[allow(clippy::too_many_arguments)]
fn make_proposal(
    env: &Env,
    client: &VaultDAOClient,
    proposer: &Address,
    token: &Address,
    recipient: &Address,
    amount: i128,
) -> u64 {
    client.propose_transfer(
        proposer,
        recipient,
        token,
        &amount,
        &Symbol::new(env, "memo"),
        &Priority::Normal,
        &Vec::new(env),
        &crate::types::ConditionLogic::And,
        &0i128,
    )
}

/// A proposal with no supersession history has no ancestors and no child.
#[test]
fn test_no_supersession_is_empty() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let recipient = Address::generate(&env);

    let proposal_id = make_proposal(&env, &client, &admin, &token, &recipient, 1000);

    assert_eq!(client.get_superseded_by(&proposal_id), None);
    assert_eq!(client.get_supercession_chain(&proposal_id).len(), 0);
}

/// A -> B -> C chain: each hop's direct child and full ancestor chain are correct.
#[test]
fn test_chain_traversal_multi_hop() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let recipient = Address::generate(&env);

    let a = make_proposal(&env, &client, &admin, &token, &recipient, 1000);
    let b = client.supersede_proposal(
        &admin,
        &a,
        &recipient,
        &token,
        &1100i128,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );
    let c = client.supersede_proposal(
        &admin,
        &b,
        &recipient,
        &token,
        &1200i128,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );

    // Direct child links.
    assert_eq!(client.get_superseded_by(&a), Some(b));
    assert_eq!(client.get_superseded_by(&b), Some(c));
    assert_eq!(client.get_superseded_by(&c), None);

    // Ancestor chains, nearest ancestor first.
    assert_eq!(client.get_supercession_chain(&a).len(), 0);

    let chain_b = client.get_supercession_chain(&b);
    assert_eq!(chain_b.len(), 1);
    assert_eq!(chain_b.get(0).unwrap(), a);

    let chain_c = client.get_supercession_chain(&c);
    assert_eq!(chain_c.len(), 2);
    assert_eq!(chain_c.get(0).unwrap(), b);
    assert_eq!(chain_c.get(1).unwrap(), a);
}

/// Defensive cycle detection: a corrupted/cyclic chain must error out rather
/// than loop forever. Cycle is fabricated directly via storage since normal
/// operation cannot produce one.
#[test]
fn test_chain_traversal_detects_cycle() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, contract_id) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let recipient = Address::generate(&env);

    let a = make_proposal(&env, &client, &admin, &token, &recipient, 1000);
    // Different amount so this isn't flagged as a duplicate of `a`.
    let b = make_proposal(&env, &client, &admin, &token, &recipient, 2000);

    env.as_contract(&contract_id, || {
        crate::storage::set_supersession_link(&env, a, b);
        crate::storage::set_supersession_link(&env, b, a);
    });

    let res = client.try_get_supercession_chain(&b);
    assert_eq!(res.err(), Some(Ok(VaultError::SupersessionCycleDetected)));
}
