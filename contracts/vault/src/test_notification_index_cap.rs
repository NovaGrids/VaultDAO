//! Issue #1704: notification registration is restricted and the index is capped.

use crate::errors::VaultError;
use crate::storage::MAX_NOTIFICATION_SUBSCRIBERS;
use crate::types::{
    ConditionLogic, InitConfig, NotificationPreferences, Priority, ProposalStatus, RetryConfig,
    Role, VelocityConfig,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Symbol, Vec};

fn init_config(env: &Env, signers: Vec<Address>) -> InitConfig {
    InitConfig {
        signers,
        threshold: 2,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1_000_000,
        daily_limit: 5_000_000,
        weekly_limit: 10_000_000,
        timelock_threshold: 1_000_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 10_000_000,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: crate::types::ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        veto_window_ledgers: 0,
        retry_config: RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
            max_retry_delay: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        proposal_id_prefix: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 100,
        admin_rotation_delay: 1440,
    }
}

fn all_prefs() -> NotificationPreferences {
    NotificationPreferences {
        notify_on_proposal: true,
        notify_on_approval: true,
        notify_on_execution: true,
        notify_on_rejection: true,
        notify_on_expiry: true,
    }
}

fn setup(env: &Env) -> (VaultDAOClient<'static>, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let signer2 = Address::generate(env);
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer2.clone());
    client.initialize(&admin, &init_config(env, signers));
    client.set_role(&admin, &signer2, &Role::Treasurer);
    (client, admin, signer2, contract_id)
}

/// Registers signers plus fresh role holders until the index is full.
fn fill_index(env: &Env, client: &VaultDAOClient, admin: &Address, signer2: &Address) {
    client.set_notification_preferences(admin, &all_prefs());
    client.set_notification_preferences(signer2, &all_prefs());
    for _ in 2..MAX_NOTIFICATION_SUBSCRIBERS {
        let holder = Address::generate(env);
        client.set_role(admin, &holder, &Role::Treasurer);
        client.set_notification_preferences(&holder, &all_prefs());
    }
}

#[test]
fn test_non_signer_cannot_register() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _signer2, _) = setup(&env);

    let outsider = Address::generate(&env);
    let result = client.try_set_notification_preferences(&outsider, &all_prefs());
    assert_eq!(result, Err(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_index_is_capped() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, signer2, _) = setup(&env);
    fill_index(&env, &client, &admin, &signer2);

    // A new role holder is rejected once the cap is reached
    let extra = Address::generate(&env);
    client.set_role(&admin, &extra, &Role::Treasurer);
    let result = client.try_set_notification_preferences(&extra, &all_prefs());
    assert_eq!(result, Err(Ok(VaultError::NotificationIndexFull)));

    // Existing registrants can still update their preferences
    client.set_notification_preferences(&admin, &all_prefs());
}

#[test]
fn test_proposal_lifecycle_within_budget_with_full_index() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, signer2, contract_id) = setup(&env);
    fill_index(&env, &client, &admin, &signer2);

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&contract_id, &10_000);
    let recipient = Address::generate(&env);

    // Each call must fit in the default per-invocation resource budget
    env.cost_estimate().budget().reset_default();
    let pid = client.propose_transfer(
        &admin,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "memo"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    env.cost_estimate().budget().reset_default();
    client.approve_proposal(&admin, &pid);
    client.approve_proposal(&signer2, &pid);

    env.cost_estimate().budget().reset_default();
    client.execute_proposal(&admin, &pid);
    assert_eq!(client.get_proposal(&pid).status, ProposalStatus::Executed);
}
