//! Issue #1705: time-weighted locks must only accept the governance token.
//!
//! Before the fix `lock_tokens` accepted any token, so an attacker could lock a
//! worthless self-minted token and receive large voting power.

use crate::errors::VaultError;
use crate::types::{
    InitConfig, RetryConfig, ThresholdStrategy, TimeWeightedConfig, VelocityConfig,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};

const LOCK_DURATION: u64 = 30 * 17_280;

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
        threshold_strategy: ThresholdStrategy::Fixed,
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

fn new_token(env: &Env) -> Address {
    env.register_stellar_asset_contract_v2(Address::generate(env))
        .address()
}

/// Vault with time-weighted voting enabled for a supported governance token.
fn setup(env: &Env) -> (VaultDAOClient<'static>, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(Address::generate(env));
    client.initialize(&admin, &init_config(env, signers));

    let gov_token = new_token(env);
    client.add_supported_token(&admin, &gov_token, &1_000_000, &5_000_000);
    client.set_time_weighted_config(
        &admin,
        &TimeWeightedConfig {
            enabled: true,
            governance_token: Some(gov_token.clone()),
            ..TimeWeightedConfig::default()
        },
    );
    (client, admin, gov_token)
}

#[test]
fn test_fake_self_minted_token_cannot_be_locked() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _gov_token) = setup(&env);

    let attacker = Address::generate(&env);
    let fake_token = new_token(&env);
    StellarAssetClient::new(&env, &fake_token).mint(&attacker, &i128::MAX);

    let result = client.try_lock_tokens(&attacker, &fake_token, &1_000_000_000, &LOCK_DURATION);
    assert_eq!(result, Err(Ok(VaultError::TokenNotSupported)));
    assert!(client.get_token_lock(&attacker).is_none());
    // Attacker has only the baseline power of an address with no lock
    let baseline = client.get_voting_power(&Address::generate(&env));
    assert_eq!(client.get_voting_power(&attacker), baseline);
}

#[test]
fn test_supported_non_governance_token_cannot_be_locked() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _gov_token) = setup(&env);

    let other = new_token(&env);
    client.add_supported_token(&admin, &other, &1_000_000, &5_000_000);
    let owner = Address::generate(&env);
    StellarAssetClient::new(&env, &other).mint(&owner, &1_000);

    let result = client.try_lock_tokens(&owner, &other, &1_000, &LOCK_DURATION);
    assert_eq!(result, Err(Ok(VaultError::TokenNotSupported)));
}

#[test]
fn test_unsupported_governance_token_cannot_be_locked() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _gov_token) = setup(&env);

    // Governance token pointed at a token the vault does not support
    let unsupported = new_token(&env);
    client.set_time_weighted_config(
        &admin,
        &TimeWeightedConfig {
            enabled: true,
            governance_token: Some(unsupported.clone()),
            ..TimeWeightedConfig::default()
        },
    );
    let owner = Address::generate(&env);
    StellarAssetClient::new(&env, &unsupported).mint(&owner, &1_000);

    let result = client.try_lock_tokens(&owner, &unsupported, &1_000, &LOCK_DURATION);
    assert_eq!(result, Err(Ok(VaultError::TokenNotSupported)));
}

#[test]
fn test_no_governance_token_rejects_all_locks() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, gov_token) = setup(&env);

    client.set_time_weighted_config(
        &admin,
        &TimeWeightedConfig {
            enabled: true,
            ..TimeWeightedConfig::default()
        },
    );
    let owner = Address::generate(&env);
    StellarAssetClient::new(&env, &gov_token).mint(&owner, &1_000);

    let result = client.try_lock_tokens(&owner, &gov_token, &1_000, &LOCK_DURATION);
    assert_eq!(result, Err(Ok(VaultError::TokenNotSupported)));
}

#[test]
fn test_governance_token_lock_grants_voting_power() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, gov_token) = setup(&env);

    let owner = Address::generate(&env);
    StellarAssetClient::new(&env, &gov_token).mint(&owner, &1_000);

    client.lock_tokens(&owner, &gov_token, &1_000, &LOCK_DURATION);

    let lock = client.get_token_lock(&owner).unwrap();
    assert_eq!(lock.token, gov_token);
    let baseline = client.get_voting_power(&Address::generate(&env));
    assert!(client.get_voting_power(&owner) > baseline);
}

// ============================================================================
// Issue #1905: lock_tokens, extend_lock and unlock_tokens must honour the pause
//
// Policy: while the vault is paused, deposits (`lock_tokens`) and lock
// extensions (`extend_lock`) are refused so no new voting power enters during
// an incident. Normal `unlock_tokens` after expiry stays available so users can
// always withdraw funds that are already matured.
// ============================================================================

/// Pauses the vault through the emergency signer.
fn pause(env: &Env, client: &VaultDAOClient<'_>, admin: &Address) {
    let emergency = Address::generate(env);
    let mut emergency_signers = Vec::new(env);
    emergency_signers.push_back(emergency.clone());
    emergency_signers.push_back(Address::generate(env));
    client.configure_emergency(admin, &emergency_signers, &i128::MAX);
    client.pause_vault(&emergency, &Symbol::new(env, "exploit"));
    assert!(client.get_pause_state().is_paused);
}

/// Locks `amount` of the governance token for `owner` before any pause.
fn lock_before_pause(
    env: &Env,
    client: &VaultDAOClient<'_>,
    gov_token: &Address,
    owner: &Address,
    amount: i128,
) {
    StellarAssetClient::new(env, gov_token).mint(owner, &amount);
    client.lock_tokens(owner, gov_token, &amount, &LOCK_DURATION);
}

#[test]
fn test_paused_vault_rejects_lock_tokens() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, gov_token) = setup(&env);
    pause(&env, &client, &admin);

    let owner = Address::generate(&env);
    StellarAssetClient::new(&env, &gov_token).mint(&owner, &1_000);

    let result = client.try_lock_tokens(&owner, &gov_token, &1_000, &LOCK_DURATION);
    assert_eq!(result, Err(Ok(VaultError::VaultPaused)));
    assert!(client.get_token_lock(&owner).is_none());
    assert_eq!(
        soroban_sdk::token::Client::new(&env, &gov_token).balance(&owner),
        1_000
    );
}

#[test]
fn test_paused_vault_rejects_extend_lock() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, gov_token) = setup(&env);
    let owner = Address::generate(&env);
    lock_before_pause(&env, &client, &gov_token, &owner, 1_000);
    let unlock_at_before = client.get_token_lock(&owner).unwrap().unlock_at;

    pause(&env, &client, &admin);

    let result = client.try_extend_lock(&owner, &LOCK_DURATION);
    assert_eq!(result, Err(Ok(VaultError::VaultPaused)));
    assert_eq!(
        client.get_token_lock(&owner).unwrap().unlock_at,
        unlock_at_before
    );
}

#[test]
fn test_paused_vault_allows_unlock_after_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, gov_token) = setup(&env);
    let owner = Address::generate(&env);
    lock_before_pause(&env, &client, &gov_token, &owner, 1_000);

    pause(&env, &client, &admin);
    env.ledger()
        .with_mut(|li| li.sequence_number += LOCK_DURATION as u32 + 1);

    let returned = client.unlock_tokens(&owner);
    assert_eq!(returned, 1_000);
    assert_eq!(
        soroban_sdk::token::Client::new(&env, &gov_token).balance(&owner),
        1_000
    );
    assert!(!client.get_token_lock(&owner).unwrap().is_active);
}

#[test]
fn test_paused_vault_unlock_before_expiry_still_times_out() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, gov_token) = setup(&env);
    let owner = Address::generate(&env);
    lock_before_pause(&env, &client, &gov_token, &owner, 1_000);

    pause(&env, &client, &admin);

    // Normal unlock is not a bypass: the lock period still has to elapse.
    let result = client.try_unlock_tokens(&owner);
    assert_eq!(result, Err(Ok(VaultError::TimelockNotExpired)));
}
