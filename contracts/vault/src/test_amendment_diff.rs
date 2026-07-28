#![cfg(test)]

use super::*;
use crate::types::{Priority, Role};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, Vec};

fn setup(env: &Env) -> (VaultDAOClient<'static>, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let signer1 = Address::generate(env);
    let signer2 = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

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
            threshold: 2,
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

    (client, admin, signer1, signer2)
}

fn make_proposal(
    env: &Env,
    client: &VaultDAOClient,
    proposer: &Address,
    token: &Address,
    recipient: &Address,
    amount: i128,
) -> u64 {
    client.set_role(proposer, proposer, &Role::Treasurer);
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

/// Amendment reason/comment is stored and retrievable in history.
#[test]
fn test_amendment_records_reason() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let recipient = Address::generate(&env);
    let new_recipient = Address::generate(&env);

    let proposal_id = make_proposal(&env, &client, &admin, &token, &recipient, 1000);

    let reason = Symbol::new(&env, "typo_fix");
    client.amend_proposal(
        &admin,
        &proposal_id,
        &new_recipient,
        &1000i128,
        &Symbol::new(&env, "memo"),
        &reason,
    );

    let history = client.get_proposal_amendments(&proposal_id);
    assert_eq!(history.len(), 1);
    assert_eq!(history.get(0).unwrap().reason, reason);
}

/// compare_amendments highlights which fields changed and the amount delta.
#[test]
fn test_compare_amendments_highlights_changes() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let recipient = Address::generate(&env);
    let new_recipient1 = Address::generate(&env);
    let new_recipient2 = Address::generate(&env);

    let proposal_id = make_proposal(&env, &client, &admin, &token, &recipient, 1000);

    // Amendment 0: bump amount only.
    client.amend_proposal(
        &admin,
        &proposal_id,
        &recipient,
        &1500i128,
        &Symbol::new(&env, "memo"),
        &Symbol::new(&env, "amount_bump"),
    );

    // Amendment 1: change recipient and amount.
    client.amend_proposal(
        &admin,
        &proposal_id,
        &new_recipient1,
        &2000i128,
        &Symbol::new(&env, "memo"),
        &Symbol::new(&env, "recipient_change"),
    );

    let diff = client.compare_amendments(&proposal_id, &0, &1);
    assert_eq!(diff.proposal_id, proposal_id);
    assert_eq!(diff.from_index, 0);
    assert_eq!(diff.to_index, 1);
    assert!(diff.recipient_changed);
    assert_eq!(diff.old_recipient, recipient);
    assert_eq!(diff.new_recipient, new_recipient1);
    assert!(diff.amount_changed);
    assert_eq!(diff.old_amount, 1500);
    assert_eq!(diff.new_amount, 2000);
    assert_eq!(diff.amount_delta, 500);
    assert!(!diff.memo_changed);

    // Amendment 2: only memo changes.
    client.amend_proposal(
        &admin,
        &proposal_id,
        &new_recipient2,
        &2000i128,
        &Symbol::new(&env, "newmemo"),
        &Symbol::new(&env, "memo_tweak"),
    );

    let diff2 = client.compare_amendments(&proposal_id, &1, &2);
    assert!(diff2.recipient_changed);
    assert!(!diff2.amount_changed);
    assert_eq!(diff2.amount_delta, 0);
    assert!(diff2.memo_changed);
    assert_eq!(diff2.old_memo, Symbol::new(&env, "memo"));
    assert_eq!(diff2.new_memo, Symbol::new(&env, "newmemo"));

    // Comparing an index to itself yields no changes.
    let diff_self = client.compare_amendments(&proposal_id, &1, &1);
    assert!(!diff_self.recipient_changed);
    assert!(!diff_self.amount_changed);
    assert!(!diff_self.memo_changed);
    assert!(!diff_self.reason_changed);
}

/// compare_amendments rejects out-of-range indexes.
#[test]
fn test_compare_amendments_out_of_bounds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2) = setup(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let recipient = Address::generate(&env);

    let proposal_id = make_proposal(&env, &client, &admin, &token, &recipient, 1000);

    client.amend_proposal(
        &admin,
        &proposal_id,
        &recipient,
        &1500i128,
        &Symbol::new(&env, "memo"),
        &Symbol::new(&env, "bump"),
    );

    let res = client.try_compare_amendments(&proposal_id, &0, &5);
    assert_eq!(res.err(), Some(Ok(VaultError::AmendmentIndexOutOfBounds)));
}
