use super::*;
use crate::types::Role;
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Vec};

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
            spending_limit: 100_000,
            daily_limit: 500_000,
            weekly_limit: 1_000_000,
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
            arbitration_timeout_ledgers: 0,
        },
    );

    (client, admin, contract_id)
}

#[test]
fn test_role_hierarchy_admin_satisfies_treasurer() {
    assert!(Role::role_satisfies(Role::Treasurer, Role::Admin), "Admin should satisfy Treasurer requirement");
}

#[test]
fn test_role_hierarchy_treasurer_not_satisfy_admin() {
    assert!(!Role::role_satisfies(Role::Admin, Role::Treasurer), "Treasurer should not satisfy Admin requirement");
}

#[test]
fn test_role_hierarchy_member_not_satisfy_treasurer() {
    assert!(!Role::role_satisfies(Role::Treasurer, Role::Member), "Member should not satisfy Treasurer requirement");
}

#[test]
fn test_dispute_arbitrator_can_resolve_disputes() {
    assert!(Role::role_satisfies(Role::DisputeArbitrator, Role::DisputeArbitrator), "DisputeArbitrator should satisfy DisputeArbitrator requirement");
}

#[test]
fn test_admin_can_resolve_disputes() {
    assert!(Role::role_satisfies(Role::DisputeArbitrator, Role::Admin), "Admin should satisfy DisputeArbitrator requirement");
}

#[test]
fn test_dispute_arbitrator_not_admin() {
    assert!(!Role::role_satisfies(Role::Admin, Role::DisputeArbitrator), "DisputeArbitrator should NOT satisfy Admin requirement");
}

#[test]
fn test_dispute_arbitrator_not_treasurer() {
    assert!(!Role::role_satisfies(Role::Treasurer, Role::DisputeArbitrator), "DisputeArbitrator should NOT satisfy Treasurer requirement");
}

#[test]
fn test_admin_cannot_use_dispute_arbitrator_as_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _contract_id) = setup(&env);

    let dispute_arbitrator = Address::generate(&env);
    client.set_role(&admin, &dispute_arbitrator, &Role::DisputeArbitrator);

    // DisputeArbitrator should not be able to perform admin operations
    let addr_to_veto = Address::generate(&env);
    let result = client.try_add_veto_address(&dispute_arbitrator, &addr_to_veto);
    assert!(result.is_err(), "DisputeArbitrator should not be able to add veto address");
}

#[test]
fn test_observer_hierarchy() {
    assert!(Role::role_satisfies(Role::Observer, Role::Admin), "Admin should satisfy Observer requirement");
    assert!(Role::role_satisfies(Role::Observer, Role::Treasurer), "Treasurer should satisfy Observer requirement");
    assert!(Role::role_satisfies(Role::Observer, Role::Member), "Member should satisfy Observer requirement");
    assert!(Role::role_satisfies(Role::Observer, Role::Observer), "Observer should satisfy Observer requirement");
    assert!(!Role::role_satisfies(Role::Observer, Role::DisputeArbitrator), "DisputeArbitrator should not satisfy Observer requirement");
}

#[test]
fn test_role_satisfies_symmetric_for_same_role() {
    assert!(Role::role_satisfies(Role::Admin, Role::Admin), "Admin should satisfy Admin");
    assert!(Role::role_satisfies(Role::Treasurer, Role::Treasurer), "Treasurer should satisfy Treasurer");
    assert!(Role::role_satisfies(Role::Member, Role::Member), "Member should satisfy Member");
    assert!(Role::role_satisfies(Role::Observer, Role::Observer), "Observer should satisfy Observer");
    assert!(Role::role_satisfies(Role::DisputeArbitrator, Role::DisputeArbitrator), "DisputeArbitrator should satisfy DisputeArbitrator");
}

#[test]
fn test_dispute_arbitrator_privilege_boundary() {
    // DisputeArbitrator should only have dispute-resolution powers
    // Verify it doesn't accidentally get admin powers through numeric comparison
    let dispute_arbitrator_discriminant = Role::DisputeArbitrator as u32;
    let admin_discriminant = Role::Admin as u32;

    // The bug would be if discriminant > caused privilege escalation
    assert!(dispute_arbitrator_discriminant > admin_discriminant, "DisputeArbitrator has higher discriminant");

    // But role_satisfies should handle this correctly
    assert!(!Role::role_satisfies(Role::Admin, Role::DisputeArbitrator), "Higher discriminant should not grant Admin privileges");
}
