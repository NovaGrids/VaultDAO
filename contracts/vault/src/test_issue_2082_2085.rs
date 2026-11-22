#![cfg(test)]

use super::*;
use crate::errors::VaultError;
use crate::types::{
    ColdSignerConfig, InitConfig, ProposalStatus, RetryConfig, ThresholdStrategy, VoteWeight,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    Address, BytesN, Env, Symbol, TryFromVal, Vec,
};

fn init_config(env: &Env, high_impact_threshold: u32) -> (InitConfig, Address) {
    let admin = Address::generate(env);
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(Address::generate(env));
    signers.push_back(Address::generate(env));
    (
        InitConfig {
            signers,
            threshold: 2,
            quorum: 0,
            quorum_percentage: 0,
            spending_limit: 1_000_000,
            daily_limit: 5_000_000,
            weekly_limit: 10_000_000,
            timelock_threshold: 0,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 1_000_000,
                window: 3_600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            default_voting_deadline: 0,
            veto_addresses: Vec::new(env),
            veto_window_ledgers: 0,
            retry_config: RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: RecoveryConfig::default(env),
            staking_config: StakingConfig::default(),
            proposal_id_prefix: 0,
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: VoteWeight::Flat,
            high_impact_threshold,
            admin_rotation_delay: 1_440,
            upgrade_timelock_delay: 17_280,
        },
        admin,
    )
}

fn initialized_vault(
    env: &Env,
    high_impact_threshold: u32,
) -> (VaultDAOClient<'_>, Address, Address) {
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let (config, admin) = init_config(env, high_impact_threshold);
    client.initialize(&admin, &config);
    (client, admin, contract_id)
}

#[test]
fn migrate_emits_from_and_to_versions() {
    let env = Env::default();
    let (client, admin, _) = initialized_vault(&env, 70);
    env.events().all();

    client.migrate(&admin, &1);

    let migrated = Symbol::new(&env, "migrated");
    let found = env.events().all().iter().any(|(_, topics, data)| {
        let is_migrated = topics
            .first()
            .and_then(|topic| Symbol::try_from_val(&env, &topic).ok())
            == Some(migrated.clone());
        let versions: Option<(u32, u32)> = TryFromVal::try_from_val(&env, &data).ok();
        is_migrated && versions == Some((1, 1))
    });
    assert!(found, "migration event must include the source and target versions");
}

#[test]
fn initialize_accepts_high_impact_threshold_boundaries() {
    for threshold in [0, 100] {
        let env = Env::default();
        let (config, admin) = init_config(&env, threshold);
        env.mock_all_auths();
        let contract_id = env.register(VaultDAO, ());
        let client = VaultDAOClient::new(&env, &contract_id);
        client.initialize(&admin, &config);
        assert_eq!(client.get_config().high_impact_threshold, threshold);
    }

    let env = Env::default();
    let (config, admin) = init_config(&env, 101);
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    assert_eq!(
        client.try_initialize(&admin, &config),
        Err(Ok(VaultError::InvalidThresholdConfig))
    );
}

#[test]
fn config_change_rejects_high_impact_threshold_above_100() {
    let env = Env::default();
    let (client, admin, _) = initialized_vault(&env, 70);
    let mut config = client.get_config();
    config.high_impact_threshold = 101;
    assert_eq!(
        client.try_propose_vault_config_change(&admin, &config),
        Err(Ok(VaultError::InvalidThresholdConfig))
    );
}

#[test]
fn vesting_rejects_equal_and_reversed_ledger_ranges() {
    let env = Env::default();
    let (client, admin, _) = initialized_vault(&env, 70);
    let beneficiary = Address::generate(&env);
    let token = Address::generate(&env);

    for (start, end) in [(10, 10), (20, 10)] {
        assert_eq!(
            client.try_create_vesting_schedule(
                &admin,
                &beneficiary,
                &token,
                &100,
                &start,
                &start,
                &end,
            ),
            Err(Ok(VaultError::InvalidLedgerRange))
        );
    }
}

#[test]
fn scoped_delegation_rejects_expiry_at_current_ledger() {
    let env = Env::default();
    let (client, admin, _) = initialized_vault(&env, 70);
    assert_eq!(
        client.try_create_scoped_delegation(
            &admin,
            &Address::generate(&env),
            &100,
            &0,
            &Vec::new(&env),
        ),
        Err(Ok(VaultError::InvalidLedgerRange))
    );
}

#[test]
fn cold_signer_rotation_requires_threshold_and_delay() {
    let env = Env::default();
    let (client, admin, contract_id) = initialized_vault(&env, 70);
    let config = client.get_config();
    let approver = config.signers.get(1).unwrap();
    let old_signer = Address::generate(&env);
    let new_signer = Address::generate(&env);
    let public_key = BytesN::from_array(&env, &[7; 32]);
    let mut cold_config = ColdSignerConfig::default(&env);
    cold_config.cold_signers.push_back(public_key.clone());
    cold_config.cold_signer_addresses.push_back(old_signer.clone());
    cold_config.cold_sig_threshold = 1;
    env.as_contract(&contract_id, || {
        storage::set_cold_signer_config(&env, &cold_config);
    });
    let audit_before = client.get_audit_entry_count();

    let rotation_id =
        client.propose_cold_signer_rotation(&admin, &old_signer, &new_signer);
    client.approve_cold_signer_rotation(&admin, &rotation_id);
    let pending = client.get_cold_signer_rotation(&rotation_id).unwrap();
    assert_eq!(pending.status, ProposalStatus::Pending);
    assert_eq!(
        client.try_execute_cold_signer_rotation(&admin, &rotation_id),
        Err(Ok(VaultError::ProposalNotApproved))
    );

    client.approve_cold_signer_rotation(&approver, &rotation_id);
    let approved = client.get_cold_signer_rotation(&rotation_id).unwrap();
    assert_eq!(approved.status, ProposalStatus::Approved);
    assert_eq!(
        client.try_execute_cold_signer_rotation(&admin, &rotation_id),
        Err(Ok(VaultError::TimelockNotExpired))
    );

    env.ledger()
        .set_sequence_number(approved.execute_after_ledger as u32);
    client.execute_cold_signer_rotation(&admin, &rotation_id);

    let updated = client.get_cold_signer_config();
    assert_eq!(updated.cold_signer_addresses.get(0), Some(new_signer));
    assert_eq!(updated.cold_signers.get(0), Some(public_key));
    assert_eq!(
        client
            .get_cold_signer_rotation(&rotation_id)
            .unwrap()
            .status,
        ProposalStatus::Executed
    );
    assert_eq!(client.get_audit_entry_count(), audit_before + 4);
}
