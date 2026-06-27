use super::*;
use crate::types::{RetryConfig, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Env, Vec,
};

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    let config = InitConfig {
        signers,
        threshold: 1,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig { limit: 100, window: 3600, per_token_limit: 0 },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        veto_window_ledgers: 0,
        retry_config: RetryConfig { enabled: false, max_retries: 0, initial_backoff_ledgers: 0 },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
    };

    env.mock_all_auths();
    client.initialize(&admin, &config);
    client.set_role(&admin, &admin, &(Role::Admin as u32));

    (client, admin)
}

#[test]
fn test_set_snapshot_interval() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    client.set_snapshot_interval(&admin, &200);
}

#[test]
#[should_panic]
fn test_set_snapshot_interval_too_small() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    client.set_snapshot_interval(&admin, &50);
}

#[test]
fn test_take_manual_snapshot() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    env.ledger().with_mut(|li| { li.sequence_number = 200; li.timestamp = 1000; });
    let snap = client.take_manual_snapshot(&admin);
    assert_eq!(snap.ledger, 200);
}

#[test]
#[should_panic]
fn test_take_manual_snapshot_too_soon() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    env.ledger().with_mut(|li| { li.sequence_number = 200; });
    client.take_manual_snapshot(&admin);
    env.ledger().with_mut(|li| { li.sequence_number = 250; });
    client.take_manual_snapshot(&admin);
}

#[test]
fn test_get_snapshot_at_exact() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    env.ledger().with_mut(|li| { li.sequence_number = 200; li.timestamp = 1000; });
    client.take_manual_snapshot(&admin);
    env.ledger().with_mut(|li| { li.sequence_number = 400; li.timestamp = 2000; });
    client.take_manual_snapshot(&admin);

    let snap = client.get_snapshot_at(&200).unwrap();
    assert_eq!(snap.ledger, 200);
}

#[test]
fn test_get_snapshot_at_approximate() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    env.ledger().with_mut(|li| { li.sequence_number = 200; li.timestamp = 1000; });
    client.take_manual_snapshot(&admin);
    env.ledger().with_mut(|li| { li.sequence_number = 400; li.timestamp = 2000; });
    client.take_manual_snapshot(&admin);

    let snap = client.get_snapshot_at(&350).unwrap();
    assert_eq!(snap.ledger, 200);
}

#[test]
fn test_get_latest_snapshot() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    env.ledger().with_mut(|li| { li.sequence_number = 200; li.timestamp = 1000; });
    client.take_manual_snapshot(&admin);
    env.ledger().with_mut(|li| { li.sequence_number = 400; li.timestamp = 2000; });
    client.take_manual_snapshot(&admin);

    let snap = client.get_latest_snapshot().unwrap();
    assert_eq!(snap.ledger, 400);
}

#[test]
fn test_get_snapshot_none() {
    let env = Env::default();
    let (client, _admin) = setup(&env);
    assert!(client.get_latest_snapshot().is_none());
    assert!(client.get_snapshot_at(&100).is_none());
}

#[test]
fn test_snapshot_overflow_eviction() {
    let env = Env::default();
    env.budget().reset_unlimited();
    let (client, admin) = setup(&env);

    for i in 0..95u32 {
        let ledger = (i + 1) as u32 * 100 + 100;
        env.ledger().with_mut(|li| { li.sequence_number = ledger; li.timestamp = ledger as u64 * 5; });
        client.take_manual_snapshot(&admin);
    }

    let latest = client.get_latest_snapshot().unwrap();
    assert_eq!(latest.ledger, 9600);

    // First snapshots should have been evicted (max 90)
    let earliest = client.get_snapshot_at(&200);
    assert!(earliest.is_none() || earliest.unwrap().ledger > 200);
}
