//! Issue #1630: Velocity warning event when a signer approaches their
//! velocity limit (one transfer away from the sliding-window cap).

use super::*;
use crate::types::Priority;
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, Vec};

fn setup(
    env: &Env,
    velocity_limit: u32,
) -> (VaultDAOClient<'static>, Address, Address, Address, Address) {
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
                limit: velocity_limit,
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

    (client, admin, signer1, signer2, contract_id)
}

// Helper: check if any event in the list has topic[0] matching the given
// symbol name (mirrors the helper used in test_voting_deadline.rs).
fn has_event_with_topic(env: &Env, topic_name: &str) -> bool {
    use soroban_sdk::testutils::Events;
    use soroban_sdk::IntoVal;
    let all_events = env.events().all();
    let expected: soroban_sdk::Val = Symbol::new(env, topic_name).into_val(env);
    all_events.iter().any(|e| {
        let topics = e.1;
        !topics.is_empty() && topics.get(0).unwrap().get_payload() == expected.get_payload()
    })
}

fn make_transfer(
    env: &Env,
    client: &VaultDAOClient<'static>,
    admin: &Address,
    token: &Address,
) -> u64 {
    let recipient = Address::generate(env);
    client.propose_transfer(
        admin,
        &recipient,
        token,
        &100i128,
        &Symbol::new(env, "memo"),
        &Priority::Normal,
        &Vec::new(env),
        &crate::types::ConditionLogic::And,
        &0i128,
    )
}

/// With a velocity limit of 3, the 2nd transfer in the window leaves exactly
/// one transfer of remaining capacity and must emit `velocity_warning`.
#[test]
fn test_velocity_warning_emitted_one_away_from_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2, _contract_id) = setup(&env, 3);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    client.set_role(&admin, &admin, &crate::types::Role::Treasurer);

    // 1st transfer: 2 remaining after this write — no warning yet.
    make_transfer(&env, &client, &admin, &token);
    assert!(!has_event_with_topic(&env, "velocity_warning"));

    // 2nd transfer: 1 remaining after this write — warning must fire.
    env.events().start_recording();
    make_transfer(&env, &client, &admin, &token);
    assert!(has_event_with_topic(&env, "velocity_warning"));
}

/// The warning must not fire while remaining capacity is still 2 or more,
/// and must not fire again once the limit has already been exhausted.
#[test]
fn test_velocity_warning_not_emitted_when_not_close_to_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2, _contract_id) = setup(&env, 10);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    client.set_role(&admin, &admin, &crate::types::Role::Treasurer);

    env.events().start_recording();
    make_transfer(&env, &client, &admin, &token);
    assert!(!has_event_with_topic(&env, "velocity_warning"));
}

/// After the warning-triggering transfer, the next transfer hits the cap
/// and is rejected with `VelocityLimitExceeded` rather than emitting
/// another warning.
#[test]
fn test_velocity_warning_then_limit_exceeded() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _signer1, _signer2, _contract_id) = setup(&env, 2);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    client.set_role(&admin, &admin, &crate::types::Role::Treasurer);

    // 1st transfer (limit = 2): 1 remaining after this write — warning fires.
    env.events().start_recording();
    make_transfer(&env, &client, &admin, &token);
    assert!(has_event_with_topic(&env, "velocity_warning"));

    // 2nd transfer consumes the last slot.
    make_transfer(&env, &client, &admin, &token);

    // 3rd transfer is over the cap and must fail.
    let recipient = Address::generate(&env);
    let result = client.try_propose_transfer(
        &admin,
        &recipient,
        &token,
        &100i128,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &crate::types::ConditionLogic::And,
        &0i128,
    );
    assert_eq!(
        result,
        Err(Ok(crate::errors::VaultError::VelocityLimitExceeded))
    );
}
