//! Tests for Issue #1637: get_signers_with_roles query function.

use crate::types::{InitConfig, Role, ThresholdStrategy, VelocityConfig, VoteWeight};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

fn setup_vault_three_signers() -> (VaultDAOClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let config = InitConfig {
        veto_window_ledgers: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
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
        veto_addresses: Vec::new(&env),
        retry_config: crate::types::RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: crate::types::StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
    };

    client.initialize(&admin, &config);

    (client, admin, signer1, signer2)
}

#[test]
fn test_default_roles_admin_and_members() {
    let (client, admin, signer1, signer2) = setup_vault_three_signers();

    let pairs = client.get_signers_with_roles();

    assert_eq!(pairs.len(), 3);
    assert_eq!(pairs.get(0).unwrap(), (admin, Role::Admin));
    assert_eq!(pairs.get(1).unwrap(), (signer1, Role::Member));
    assert_eq!(pairs.get(2).unwrap(), (signer2, Role::Member));
}

#[test]
fn test_reflects_role_assignment_changes() {
    let (client, admin, signer1, signer2) = setup_vault_three_signers();

    client.set_role(&admin, &signer1, &Role::Treasurer);

    let pairs = client.get_signers_with_roles();

    assert_eq!(pairs.get(1).unwrap(), (signer1, Role::Treasurer));
    assert_eq!(pairs.get(2).unwrap(), (signer2, Role::Member));
}

#[test]
fn test_excludes_removed_signer() {
    let (client, admin, signer1, signer2) = setup_vault_three_signers();

    client.remove_signer(&admin, &signer2);

    let pairs = client.get_signers_with_roles();

    assert_eq!(pairs.len(), 2);
    assert_eq!(pairs.get(0).unwrap(), (admin, Role::Admin));
    assert_eq!(pairs.get(1).unwrap(), (signer1, Role::Member));
}

#[test]
fn test_order_matches_config_signers_order() {
    let (client, admin, signer1, signer2) = setup_vault_three_signers();

    client.set_role(&admin, &signer2, &Role::Treasurer);
    client.set_role(&admin, &signer1, &Role::DisputeArbitrator);

    let pairs = client.get_signers_with_roles();

    assert_eq!(pairs.get(0).unwrap().0, admin);
    assert_eq!(pairs.get(1).unwrap().0, signer1);
    assert_eq!(pairs.get(2).unwrap().0, signer2);
}

#[test]
fn test_single_signer_vault() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    let config = InitConfig {
        veto_window_ledgers: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 1,
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
        veto_addresses: Vec::new(&env),
        retry_config: crate::types::RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(&env),
        staking_config: crate::types::StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
    };

    client.initialize(&admin, &config);

    let pairs = client.get_signers_with_roles();
    assert_eq!(pairs.len(), 1);
    assert_eq!(pairs.get(0).unwrap(), (admin, Role::Admin));
}
