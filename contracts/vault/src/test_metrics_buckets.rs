use super::*;
use crate::types::{RetryConfig, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::{Address as _, Ledger}, token::StellarAssetClient, Env, Symbol, Vec};

fn setup_metrics(env: &Env) -> (VaultDAOClient, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let signer = Address::generate(env);

    let token_admin = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = sac.address();
    let sac_client = StellarAssetClient::new(env, &token);
    sac_client.mint(&contract_id, &100_000);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 5000,
        daily_limit: 50000,
        weekly_limit: 100000,
        timelock_threshold: 100000,
        timelock_delay: 0,
        velocity_limit: VelocityConfig { limit: 100, window: 3600, per_token_limit: 0 },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        retry_config: RetryConfig { enabled: false, max_retries: 0, initial_backoff_ledgers: 0 },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
    };
    client.initialize(&admin, &config);
    client.set_role(&admin, &signer, &Role::Treasurer);

    (client, admin, signer, token)
}

#[test]
fn test_metrics_after_3_executions_same_week() {
    let env = Env::default();
    env.mock_all_auths();
    // Set timestamp to week 1 (604800 seconds)
    env.ledger().set_timestamp(604800);
    let (client, admin, signer, token) = setup_metrics(&env);

    let recipient = Address::generate(&env);

    for i in 0..3u32 {
        let pid = client.propose_transfer(
            &signer,
            &recipient,
            &token,
            &100,
            &Symbol::new(&env, "t"),
            &Priority::Normal,
            &Vec::new(&env),
            &ConditionLogic::And,
            &0i128,
        );
        client.approve_proposal(&signer, &pid);
        client.execute_proposal(&admin, &pid);
        let _ = i;
    }

    let week = storage::get_week_number(&env);
    let bucket = storage::get_metrics_bucket(&env, week);
    assert_eq!(bucket.executed_count, 3);

    // Cumulative metrics unchanged
    let cumulative = client.get_metrics();
    assert_eq!(cumulative.executed_count, 3);
}

#[test]
fn test_metrics_spanning_2_weeks() {
    let env = Env::default();
    env.mock_all_auths();

    // Week 1
    env.ledger().set_timestamp(604800);
    let (client, admin, signer, token) = setup_metrics(&env);
    let recipient = Address::generate(&env);

    let pid1 = client.propose_transfer(
        &signer, &recipient, &token, &100,
        &Symbol::new(&env, "w1"), &Priority::Normal,
        &Vec::new(&env), &ConditionLogic::And, &0i128,
    );
    client.approve_proposal(&signer, &pid1);
    client.execute_proposal(&admin, &pid1);

    // Week 2 (advance timestamp by 1 week)
    env.ledger().set_timestamp(604800 * 2);

    let pid2 = client.propose_transfer(
        &signer, &recipient, &token, &100,
        &Symbol::new(&env, "w2"), &Priority::Normal,
        &Vec::new(&env), &ConditionLogic::And, &0i128,
    );
    client.approve_proposal(&signer, &pid2);
    client.execute_proposal(&admin, &pid2);

    // Query period spanning both weeks
    let period_metrics = client.get_metrics_for_period(&1u64, &2u64);
    assert_eq!(period_metrics.executed_count, 2);
}

#[test]
fn test_pruning_at_52_buckets() {
    let env = Env::default();
    env.mock_all_auths();

    // Directly insert 53 buckets into storage
    for week in 0u64..53 {
        let metrics = VaultMetrics {
            total_proposals: 1,
            executed_count: 1,
            rejected_count: 0,
            expired_count: 0,
            total_execution_time_ledgers: 10,
            total_gas_used: 0,
            last_updated_ledger: week * 100,
        };
        storage::set_metrics_bucket(&env, week, &metrics);
    }

    // After inserting 53, the oldest (week 0) should be pruned
    let oldest = storage::get_metrics_bucket(&env, 0);
    // Week 0 was pruned — should return default (zeros)
    assert_eq!(oldest.executed_count, 0);

    // Week 52 should still exist
    let newest = storage::get_metrics_bucket(&env, 52);
    assert_eq!(newest.executed_count, 1);
}

#[test]
fn test_get_metrics_cumulative_unchanged() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(604800);
    let (client, admin, signer, token) = setup_metrics(&env);

    let recipient = Address::generate(&env);
    let pid = client.propose_transfer(
        &signer, &recipient, &token, &100,
        &Symbol::new(&env, "t"), &Priority::Normal,
        &Vec::new(&env), &ConditionLogic::And, &0i128,
    );
    client.approve_proposal(&signer, &pid);
    client.execute_proposal(&admin, &pid);

    // get_metrics still returns cumulative totals
    let metrics = client.get_metrics();
    assert_eq!(metrics.executed_count, 1);
    assert_eq!(metrics.total_proposals, 1);
}
