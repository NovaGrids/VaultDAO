//! Tests for Issue #1940: state changes that previously emitted no event.

#![cfg(test)]

use crate::types::{
    ConditionLogic, FundingRoundConfig, InitConfig, Priority, RetryConfig, StakingConfig,
    ThresholdStrategy, VelocityConfig,
};
use crate::{Role, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    token::StellarAssetClient,
    Address, Env, String, Symbol, TryFromVal, TryIntoVal, Val, Vec,
};

const CID: &str = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address) {
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let proposer = Address::generate(env);
    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(proposer.clone());

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
            quorum_percentage: 0,
            default_voting_deadline: 0,
            spending_limit: 10_000_000,
            daily_limit: 50_000_000,
            weekly_limit: 100_000_000,
            timelock_threshold: 9_999_999,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 1000,
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
            upgrade_timelock_delay: 17_280,
        },
    );

    client.set_role(&admin, &proposer, &Role::Treasurer);
    StellarAssetClient::new(env, &token).mint(&contract_id, &10_000_000);

    (client, admin, proposer, token)
}

fn new_proposal(
    env: &Env,
    client: &VaultDAOClient<'_>,
    proposer: &Address,
    token: &Address,
) -> u64 {
    client.propose_transfer(
        proposer,
        &Address::generate(env),
        token,
        &1_000i128,
        &Symbol::new(env, "evt"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    )
}

/// Topics and payload of the first event whose first topic is `name`.
fn event_data(env: &Env, name: &str) -> Option<(Vec<Val>, Val)> {
    let expected = Symbol::new(env, name);
    env.events().all().iter().find_map(|(_, topics, data)| {
        let first = topics.first()?;
        let sym = Symbol::try_from_val(env, &first).ok()?;
        (sym == expected).then(|| (topics.clone(), data))
    })
}

#[test]
fn test_1940_add_attachment_emits_event() {
    let env = Env::default();
    let (client, _admin, proposer, token) = setup(&env);
    let pid = new_proposal(&env, &client, &proposer, &token);

    client.add_attachment(&proposer, &pid, &String::from_str(&env, CID));

    let (topics, data) = event_data(&env, "attachment_added").expect("attachment_added");
    assert_eq!(topics.get(1).unwrap().try_into_val(&env), Ok(pid));
    let (actor, cid): (Address, String) = data.try_into_val(&env).unwrap();
    assert_eq!(actor, proposer);
    assert_eq!(cid, String::from_str(&env, CID));
}

#[test]
fn test_1940_remove_attachment_emits_event() {
    let env = Env::default();
    let (client, _admin, proposer, token) = setup(&env);
    let pid = new_proposal(&env, &client, &proposer, &token);
    client.add_attachment(&proposer, &pid, &String::from_str(&env, CID));

    client.remove_attachment(&proposer, &pid, &String::from_str(&env, CID));

    let (_, data) = event_data(&env, "attachment_removed").expect("attachment_removed");
    let (actor, cid): (Address, String) = data.try_into_val(&env).unwrap();
    assert_eq!(actor, proposer);
    assert_eq!(cid, String::from_str(&env, CID));
}

#[test]
fn test_1940_set_and_remove_proposal_metadata_emit_events() {
    let env = Env::default();
    let (client, _admin, proposer, token) = setup(&env);
    let pid = new_proposal(&env, &client, &proposer, &token);
    let key = Symbol::new(&env, "ref");

    client.set_proposal_metadata(&proposer, &pid, &key, &String::from_str(&env, "inv-7"));
    let (_, data) = event_data(&env, "metadata_set").expect("metadata_set");
    let (actor, emitted_key): (Address, Symbol) = data.try_into_val(&env).unwrap();
    assert_eq!(actor, proposer);
    assert_eq!(emitted_key, key);

    client.remove_proposal_metadata(&proposer, &pid, &key);
    let (_, data) = event_data(&env, "metadata_removed").expect("metadata_removed");
    let (actor, emitted_key): (Address, Symbol) = data.try_into_val(&env).unwrap();
    assert_eq!(actor, proposer);
    assert_eq!(emitted_key, key);
}

#[test]
fn test_1940_set_whitelist_mode_emits_event() {
    let env = Env::default();
    let (client, admin, _proposer, _token) = setup(&env);

    client.set_whitelist_mode(&admin, &true);

    let (_, data) = event_data(&env, "whitelist_mode").expect("whitelist_mode");
    let (actor, enabled): (Address, bool) = data.try_into_val(&env).unwrap();
    assert_eq!(actor, admin);
    assert!(enabled);
}

#[test]
fn test_1940_set_funding_round_config_emits_event() {
    let env = Env::default();
    let (client, admin, _proposer, _token) = setup(&env);
    let config = FundingRoundConfig {
        enabled: true,
        min_milestones: 1,
        max_milestones: 5,
        min_milestone_amount: 100,
        max_rounds_per_proposal: 2,
    };

    client.set_funding_round_config(&admin, &config);

    let (_, data) = event_data(&env, "funding_cfg_updated").expect("funding_cfg_updated");
    let (signer, emitted): (Address, FundingRoundConfig) = data.try_into_val(&env).unwrap();
    assert_eq!(signer, admin);
    assert_eq!(emitted.max_milestones, 5);
}

#[test]
fn test_1940_set_template_status_emits_event() {
    let env = Env::default();
    let (client, admin, _proposer, token) = setup(&env);
    let recipient = Address::generate(&env);
    let template_id = client.create_template(
        &admin,
        &Symbol::new(&env, "payroll"),
        &Symbol::new(&env, "monthly_payroll"),
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "salary"),
        &0,
        &0,
    );

    client.set_template_status(&admin, &template_id, &false);

    let (topics, data) = event_data(&env, "template_status").expect("template_status");
    assert_eq!(topics.get(1).unwrap().try_into_val(&env), Ok(template_id));
    let (_name, is_active, actor): (Symbol, bool, Address) = data.try_into_val(&env).unwrap();
    assert!(!is_active);
    assert_eq!(actor, admin);
}

#[test]
fn test_1940_set_stream_auto_complete_emits_event() {
    let env = Env::default();
    let (client, admin, _proposer, token) = setup(&env);
    StellarAssetClient::new(&env, &token).mint(&admin, &10_000);
    let stream_id = client.create_stream(
        &admin,
        &Address::generate(&env),
        &token,
        &1,
        &10_000,
        &10_000,
    );

    client.set_stream_auto_complete(&admin, &stream_id, &true);

    let (_, data) = event_data(&env, "stream_auto_complete").expect("stream_auto_complete");
    let (actor, enabled): (Address, bool) = data.try_into_val(&env).unwrap();
    assert_eq!(actor, admin);
    assert!(enabled);
}

#[test]
fn test_1940_create_batch_emits_event() {
    let env = Env::default();
    let (client, _admin, proposer, token) = setup(&env);
    let first = new_proposal(&env, &client, &proposer, &token);
    let second = new_proposal(&env, &client, &proposer, &token);
    let mut ids = Vec::new(&env);
    ids.push_back(first);
    ids.push_back(second);

    let batch_id = client.create_batch(&proposer, &ids);

    let (topics, data) = event_data(&env, "batch_created").expect("batch_created");
    assert_eq!(topics.get(1).unwrap().try_into_val(&env), Ok(batch_id));
    let (creator, emitted_ids): (Address, Vec<u64>) = data.try_into_val(&env).unwrap();
    assert_eq!(creator, proposer);
    assert_eq!(emitted_ids, ids);
}

#[test]
fn test_1940_create_audit_checkpoint_emits_event() {
    let env = Env::default();
    let (client, admin, _proposer, _token) = setup(&env);
    // Each quorum change writes an audit entry; 120 entries cover one checkpoint batch.
    for i in 0..120u32 {
        client.update_quorum(&admin, &(i % 2));
    }

    let checkpoint_id = client.create_audit_checkpoint(&admin);

    let (topics, data) = event_data(&env, "audit_checkpoint").expect("audit_checkpoint");
    assert_eq!(topics.get(1).unwrap().try_into_val(&env), Ok(checkpoint_id));
    let (actor, from, to): (Address, u64, u64) = data.try_into_val(&env).unwrap();
    assert_eq!(actor, admin);
    assert_eq!(from, 1);
    assert_eq!(to, 100);
}

#[test]
fn test_1940_clear_gas_price_oracle_emits_event() {
    let env = Env::default();
    let (client, admin, _proposer, _token) = setup(&env);

    client.clear_gas_price_oracle(&admin);

    let (_, data) = event_data(&env, "gas_oracle_cleared").expect("gas_oracle_cleared");
    let actor: Address = data.try_into_val(&env).unwrap();
    assert_eq!(actor, admin);
}
