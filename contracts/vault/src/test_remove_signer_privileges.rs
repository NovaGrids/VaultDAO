//! Removing a signer must strip every privilege it held.
//!
//! `remove_signer_internal` used to drop the address from `config.signers`
//! only, leaving its role, delegations, permissions, tier and capability tokens
//! in place, so a removed Treasurer could still call `create_stream`. Each test
//! below grants one kind of privilege, removes the signer, and checks the
//! privileged action is refused afterwards.
#![cfg(test)]

use super::*;
use crate::types::{
    Capability, CapabilityToken, InitConfig, Permission, SignerTier, ThresholdStrategy,
    VelocityConfig, VoteWeight,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, BytesN, Env, Vec};

fn init_config(env: &Env, signers: Vec<Address>) -> InitConfig {
    InitConfig {
        veto_window_ledgers: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
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
            limit: 100_000,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
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
    }
}

struct Setup<'a> {
    env: Env,
    client: VaultDAOClient<'a>,
    admin: Address,
    /// Treasurer that gets removed in every test.
    treasurer: Address,
    other: Address,
}

/// Three signers, threshold 2, so exactly one signer can be removed.
fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasurer = Address::generate(&env);
    let other = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(treasurer.clone());
    signers.push_back(other.clone());
    client.initialize(&admin, &init_config(&env, signers));
    client.set_role(&admin, &treasurer, &Role::Treasurer);

    Setup {
        env,
        client,
        admin,
        treasurer,
        other,
    }
}

#[test]
fn test_removed_signer_role_reset_to_member() {
    let s = setup();
    assert_eq!(s.client.get_role(&s.treasurer), Role::Treasurer);

    s.client.remove_signer(&s.admin, &s.treasurer);

    assert!(!s.client.is_signer(&s.treasurer));
    assert_eq!(s.client.get_role(&s.treasurer), Role::Member);
}

#[test]
fn test_removed_treasurer_cannot_create_stream() {
    let s = setup();
    let token = s
        .env
        .register_stellar_asset_contract_v2(Address::generate(&s.env))
        .address();
    StellarAssetClient::new(&s.env, &token).mint(&s.treasurer, &10_000);
    let recipient = Address::generate(&s.env);

    // Control: allowed while still a Treasurer.
    s.client
        .create_stream(&s.treasurer, &recipient, &token, &1, &1_000, &1_000);

    s.client.remove_signer(&s.admin, &s.treasurer);

    let result = s
        .client
        .try_create_stream(&s.treasurer, &recipient, &token, &1, &1_000, &1_000);
    assert_eq!(result, Err(Ok(VaultError::InsufficientRole)));
}

#[test]
fn test_removed_treasurer_cannot_release_round_funds() {
    let s = setup();
    s.client.remove_signer(&s.admin, &s.treasurer);

    let result = s.client.try_release_round_funds(&s.treasurer, &1, &0);
    assert_eq!(result, Err(Ok(VaultError::NotASigner)));
}

#[test]
fn test_removed_signer_tier_is_cleared() {
    let s = setup();
    s.client
        .set_signer_tier(&s.admin, &s.treasurer, &SignerTier::Senior(500_000));

    s.client.remove_signer(&s.admin, &s.treasurer);

    // Principal is the default and carries no unilateral spending authority.
    assert_eq!(
        s.client.get_signer_tier(&s.treasurer),
        SignerTier::Principal
    );
}

#[test]
fn test_removed_signer_plain_delegations_revoked_both_directions() {
    let s = setup();
    // Outgoing: treasurer -> other. Incoming: admin -> treasurer.
    s.client.delegate_voting_power(&s.treasurer, &s.other, &0);
    s.client.delegate_voting_power(&s.admin, &s.treasurer, &0);
    assert_eq!(s.client.get_delegation_chain(&s.treasurer).len(), 1);
    assert_eq!(s.client.get_delegation_chain(&s.admin).len(), 2);

    s.client.remove_signer(&s.admin, &s.treasurer);

    assert_eq!(s.client.get_delegation_chain(&s.treasurer).len(), 0);
    assert_eq!(s.client.get_delegation_chain(&s.admin).len(), 0);
}

#[test]
fn test_removed_signer_scoped_delegations_revoked_both_directions() {
    let s = setup();
    let outgoing = s.client.create_scoped_delegation(
        &s.treasurer,
        &s.other,
        &1_000,
        &10_000,
        &Vec::new(&s.env),
    );
    let incoming = s.client.create_scoped_delegation(
        &s.other,
        &s.treasurer,
        &1_000,
        &10_000,
        &Vec::new(&s.env),
    );

    s.client.remove_signer(&s.admin, &s.treasurer);

    assert!(!s.client.get_scoped_delegation(&outgoing).unwrap().is_active);
    assert!(!s.client.get_scoped_delegation(&incoming).unwrap().is_active);
}

#[test]
fn test_removed_signer_direct_and_delegated_permissions_revoked() {
    let s = setup();
    s.client
        .grant_permission(&s.admin, &s.treasurer, &Permission::ManageEscrow, &None);
    s.client
        .delegate_permission(&s.admin, &s.treasurer, &Permission::ManageRoles, &100_000);
    assert!(s
        .client
        .has_permission(&s.treasurer, &Permission::ManageEscrow));
    assert!(s
        .client
        .has_permission(&s.treasurer, &Permission::ManageRoles));

    s.client.remove_signer(&s.admin, &s.treasurer);

    assert!(!s
        .client
        .has_permission(&s.treasurer, &Permission::ManageEscrow));
    assert!(!s
        .client
        .has_permission(&s.treasurer, &Permission::ManageRoles));
}

#[test]
fn test_removed_signer_capability_tokens_revoked() {
    let s = setup();
    let id = BytesN::from_array(&s.env, &[7u8; 32]);
    let mut capabilities = Vec::new(&s.env);
    capabilities.push_back(Capability::InitiateStream(1_000));
    s.client.grant_capability(
        &s.admin,
        &CapabilityToken {
            id: id.clone(),
            granted_to: s.treasurer.clone(),
            capabilities,
            expires_at: 0,
            max_uses: 0,
            uses_count: 0,
            revoked: false,
        },
    );
    // Control: usable before removal.
    s.client
        .use_capability(&s.treasurer, &id, &Capability::InitiateStream(10));

    s.client.remove_signer(&s.admin, &s.treasurer);

    assert!(s.client.get_capability(&id).unwrap().revoked);
    let result = s
        .client
        .try_use_capability(&s.treasurer, &id, &Capability::InitiateStream(10));
    assert_eq!(result, Err(Ok(VaultError::CapabilityRevoked)));
}
