//! Tests for Issue #1541: Add `get_escrows_by_recipient` Query Function
#![cfg(test)]

use super::*;
use crate::types::{RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Symbol, Vec};

fn setup_with_escrows(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let sender = Address::generate(env);
    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(sender.clone());

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
            threshold: 1,
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
            staking_config: crate::types::StakingConfig::default(),
            proposal_id_prefix: 0,
        },
    );

    client.set_role(&admin, &sender, &Role::Treasurer);

    (client, admin, sender, token, contract_id)
}

#[test]
fn test_get_escrows_by_recipient_empty_initially() {
    let env = Env::default();
    env.mock_all_auths();

    let (_client, _admin, _sender, _token, _contract_id) = setup_with_escrows(&env);
    let recipient = Address::generate(&env);

    let escrows = _client.get_escrows_by_recipient(&recipient);
    assert!(escrows.is_empty(), "Recipient should have no escrows initially");
}

#[test]
fn test_get_escrows_by_recipient_single_escrow() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, sender, token, contract_id) = setup_with_escrows(&env);
    let recipient = Address::generate(&env);

    // Mint funds to sender
    StellarAssetClient::new(&env, &token).mint(&sender, &1000);

    // Create escrow
    let escrow_id = client.create_escrow(
        &sender,
        &recipient,
        &token,
        &500i128,
        &100u64,
        &Symbol::new(&env, "test"),
    );

    // Query escrows by recipient
    let escrows = client.get_escrows_by_recipient(&recipient);
    assert_eq!(
        escrows.len(),
        1,
        "Recipient should have exactly one escrow"
    );
    assert_eq!(escrows.get(0).unwrap(), escrow_id);
}

#[test]
fn test_get_escrows_by_recipient_multiple_escrows() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, sender, token, _contract_id) = setup_with_escrows(&env);
    let recipient = Address::generate(&env);

    // Mint funds to sender
    StellarAssetClient::new(&env, &token).mint(&sender, &5000);

    // Create multiple escrows for same recipient
    let escrow_id_1 = client.create_escrow(
        &sender,
        &recipient,
        &token,
        &500i128,
        &100u64,
        &Symbol::new(&env, "escrow1"),
    );

    let escrow_id_2 = client.create_escrow(
        &sender,
        &recipient,
        &token,
        &600i128,
        &200u64,
        &Symbol::new(&env, "escrow2"),
    );

    let escrow_id_3 = client.create_escrow(
        &sender,
        &recipient,
        &token,
        &700i128,
        &300u64,
        &Symbol::new(&env, "escrow3"),
    );

    // Query escrows by recipient
    let escrows = client.get_escrows_by_recipient(&recipient);
    assert_eq!(
        escrows.len(),
        3,
        "Recipient should have exactly three escrows"
    );

    // Verify all escrow IDs are present
    assert_eq!(escrows.get(0).unwrap(), escrow_id_1);
    assert_eq!(escrows.get(1).unwrap(), escrow_id_2);
    assert_eq!(escrows.get(2).unwrap(), escrow_id_3);
}

#[test]
fn test_get_escrows_by_recipient_different_recipients_isolated() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, sender, token, _contract_id) = setup_with_escrows(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);

    StellarAssetClient::new(&env, &token).mint(&sender, &5000);

    // Create escrows for recipient A
    let escrow_a_1 = client.create_escrow(
        &sender,
        &recipient_a,
        &token,
        &500i128,
        &100u64,
        &Symbol::new(&env, "a1"),
    );

    let escrow_a_2 = client.create_escrow(
        &sender,
        &recipient_a,
        &token,
        &600i128,
        &200u64,
        &Symbol::new(&env, "a2"),
    );

    // Create escrows for recipient B
    let escrow_b_1 = client.create_escrow(
        &sender,
        &recipient_b,
        &token,
        &700i128,
        &300u64,
        &Symbol::new(&env, "b1"),
    );

    // Query for recipient A
    let escrows_a = client.get_escrows_by_recipient(&recipient_a);
    assert_eq!(escrows_a.len(), 2, "Recipient A should have 2 escrows");
    assert_eq!(escrows_a.get(0).unwrap(), escrow_a_1);
    assert_eq!(escrows_a.get(1).unwrap(), escrow_a_2);

    // Query for recipient B
    let escrows_b = client.get_escrows_by_recipient(&recipient_b);
    assert_eq!(escrows_b.len(), 1, "Recipient B should have 1 escrow");
    assert_eq!(escrows_b.get(0).unwrap(), escrow_b_1);
}

#[test]
fn test_get_escrows_by_recipient_sender_has_no_escrows_as_recipient() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _admin, sender, token, _contract_id) = setup_with_escrows(&env);
    let recipient = Address::generate(&env);

    StellarAssetClient::new(&env, &token).mint(&sender, &1000);

    // Create escrow where sender is the sender, recipient is recipient
    client.create_escrow(
        &sender,
        &recipient,
        &token,
        &500i128,
        &100u64,
        &Symbol::new(&env, "test"),
    );

    // Sender should have no escrows as recipient
    let sender_escrows = client.get_escrows_by_recipient(&sender);
    assert!(
        sender_escrows.is_empty(),
        "Sender should have no escrows as recipient"
    );

    // But recipient should have the escrow
    let recipient_escrows = client.get_escrows_by_recipient(&recipient);
    assert_eq!(
        recipient_escrows.len(),
        1,
        "Recipient should have the escrow"
    );
}
