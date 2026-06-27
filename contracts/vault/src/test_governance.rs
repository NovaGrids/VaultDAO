use super::*;
use crate::types::{RetryConfig, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Env, Vec,
};

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let signer_a = Address::generate(env);
    let signer_b = Address::generate(env);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer_a.clone());
    signers.push_back(signer_b.clone());

    let config = InitConfig {
        signers,
        threshold: 2,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1000,
        daily_limit: 5000,
        weekly_limit: 10000,
        timelock_threshold: 100_000,
        timelock_delay: 0,
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

    (client, admin, signer_a, signer_b)
}

#[test]
fn test_set_governance_threshold() {
    let env = Env::default();
    let (client, admin, _, _) = setup(&env);
    client.set_governance_threshold(&admin, &75);
}

#[test]
#[should_panic]
fn test_governance_threshold_too_low() {
    let env = Env::default();
    let (client, admin, _, _) = setup(&env);
    client.set_governance_threshold(&admin, &50);
}

#[test]
fn test_propose_config_change() {
    let env = Env::default();
    let (client, admin, _, _) = setup(&env);
    let id = client.propose_config_change(&admin, &ConfigParam::SpendingLimit, &2000);
    assert_eq!(id, 1);
    let gp = client.get_governance_proposal(&1).unwrap();
    assert_eq!(gp.new_value, 2000);
    assert_eq!(gp.status, ProposalStatus::Pending);
}

#[test]
fn test_supermajority_met_succeeds() {
    let env = Env::default();
    let (client, admin, signer_a, signer_b) = setup(&env);

    // Default governance threshold is 67%, with 3 signers need ceil(3*67/100) = 3
    let id = client.propose_config_change(&admin, &ConfigParam::SpendingLimit, &2000);
    client.approve_config_change(&admin, &id);
    client.approve_config_change(&signer_a, &id);
    client.approve_config_change(&signer_b, &id);

    let gp = client.get_governance_proposal(&id).unwrap();
    assert_eq!(gp.status, ProposalStatus::Approved);

    client.execute_config_change(&admin, &id);
    let gp = client.get_governance_proposal(&id).unwrap();
    assert_eq!(gp.status, ProposalStatus::Executed);
}

#[test]
fn test_quorum_not_met_stays_pending() {
    let env = Env::default();
    let (client, admin, _signer_a, _signer_b) = setup(&env);

    let id = client.propose_config_change(&admin, &ConfigParam::SpendingLimit, &2000);
    client.approve_config_change(&admin, &id);

    let gp = client.get_governance_proposal(&id).unwrap();
    assert_eq!(gp.status, ProposalStatus::Pending);
}

#[test]
#[should_panic]
fn test_execute_unapproved_fails() {
    let env = Env::default();
    let (client, admin, _, _) = setup(&env);
    let id = client.propose_config_change(&admin, &ConfigParam::SpendingLimit, &2000);
    client.execute_config_change(&admin, &id);
}

#[test]
#[should_panic]
fn test_invalid_threshold_value_rejected() {
    let env = Env::default();
    let (client, admin, _, _) = setup(&env);
    // Threshold 0 is invalid
    client.propose_config_change(&admin, &ConfigParam::Threshold, &0);
}

#[test]
#[should_panic]
fn test_threshold_exceeds_signers_rejected() {
    let env = Env::default();
    let (client, admin, _, _) = setup(&env);
    // 10 exceeds 3 signers
    client.propose_config_change(&admin, &ConfigParam::Threshold, &10);
}

#[test]
fn test_threshold_boundary_enforcement() {
    let env = Env::default();
    let (client, admin, signer_a, signer_b) = setup(&env);

    // Valid: threshold = 3 (equal to signer count)
    let id = client.propose_config_change(&admin, &ConfigParam::Threshold, &3);
    client.approve_config_change(&admin, &id);
    client.approve_config_change(&signer_a, &id);
    client.approve_config_change(&signer_b, &id);
    client.execute_config_change(&admin, &id);
}

#[test]
#[should_panic]
fn test_max_3_active_governance_proposals() {
    let env = Env::default();
    let (client, admin, _, _) = setup(&env);
    client.propose_config_change(&admin, &ConfigParam::SpendingLimit, &2000);
    client.propose_config_change(&admin, &ConfigParam::DailyLimit, &20000);
    client.propose_config_change(&admin, &ConfigParam::WeeklyLimit, &50000);
    client.propose_config_change(&admin, &ConfigParam::Quorum, &1);
}

#[test]
#[should_panic]
fn test_duplicate_approval_fails() {
    let env = Env::default();
    let (client, admin, _, _) = setup(&env);
    let id = client.propose_config_change(&admin, &ConfigParam::SpendingLimit, &2000);
    client.approve_config_change(&admin, &id);
    client.approve_config_change(&admin, &id);
}
