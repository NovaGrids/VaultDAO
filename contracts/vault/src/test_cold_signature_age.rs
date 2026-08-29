//! Tests for cold-signature maximum age.
//!
//! `ColdSigUsed` already prevents a cold signature being replayed, but replay
//! prevention only stops a signature being used *twice*. Without a maximum age
//! a signature produced offline long ago and never submitted stays valid
//! forever, so a leaked or stale cold-storage signature can approve a proposal
//! that did not exist when it was signed.
#![cfg(test)]

use super::*;
use crate::types::ColdSignerConfig;
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{testutils::Address as _, testutils::Ledger, Address, BytesN, Env, Vec};

/// Registers a vault with a cold-signer policy using the given maximum age.
fn setup_cold(env: &Env, max_age: u64) -> (VaultDAOClient<'_>, Address, BytesN<32>) {
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let cold_addr = Address::generate(env);
    let pubkey = BytesN::from_array(env, &[7u8; 32]);

    let mut cold_signers = Vec::new(env);
    cold_signers.push_back(pubkey.clone());
    let mut cold_addresses = Vec::new(env);
    cold_addresses.push_back(cold_addr);

    let cold_config = ColdSignerConfig {
        cold_signers,
        cold_signer_addresses: cold_addresses,
        cold_sig_threshold: 1,
        cold_sig_expiry: 17_280,
        max_cold_sig_age_ledgers: max_age,
    };

    client.set_cold_signer_config(&admin, &cold_config);

    (client, admin, pubkey)
}

/// The default policy carries a non-zero maximum age, so a vault that never
/// touches the setting is still protected.
#[test]
fn test_default_config_sets_a_maximum_age() {
    let env = Env::default();
    let config = ColdSignerConfig::default(&env);
    assert!(
        config.max_cold_sig_age_ledgers > 0,
        "default policy must bound signature age"
    );
}

/// A signature dated far in the past is rejected before any verification work.
#[test]
fn test_signature_older_than_max_age_rejected() {
    let env = Env::default();
    let (client, _admin, pubkey) = setup_cold(&env, 1_000);

    // Advance well past the configured window.
    env.ledger().with_mut(|li| {
        li.sequence_number += 5_000;
    });

    let signature = BytesN::from_array(&env, &[1u8; 64]);
    let created_at = 1u32;

    let result = client.try_submit_cold_signature(&0u64, &signature, &pubkey, &created_at);
    assert_eq!(result, Err(Ok(VaultError::ColdSignatureTooOld)));
}

/// A signature dated ahead of the chain is rejected — otherwise a submitter
/// could set an arbitrarily far-future ledger and make the age check
/// unfalsifiable.
#[test]
fn test_future_dated_signature_rejected() {
    let env = Env::default();
    let (client, _admin, pubkey) = setup_cold(&env, 1_000);

    let current = env.ledger().sequence();
    let signature = BytesN::from_array(&env, &[2u8; 64]);

    let result =
        client.try_submit_cold_signature(&0u64, &signature, &pubkey, &(current + 100));
    assert_eq!(result, Err(Ok(VaultError::ColdSignatureFutureDated)));
}

/// A maximum age of zero disables the check, preserving prior behaviour for
/// vaults that have not opted in.
#[test]
fn test_zero_max_age_disables_the_check() {
    let env = Env::default();
    let (client, _admin, pubkey) = setup_cold(&env, 0);

    env.ledger().with_mut(|li| {
        li.sequence_number += 1_000_000;
    });

    let signature = BytesN::from_array(&env, &[3u8; 64]);

    // The age gate must not be what rejects this submission.
    let result = client.try_submit_cold_signature(&0u64, &signature, &pubkey, &1u32);
    assert_ne!(result, Err(Ok(VaultError::ColdSignatureTooOld)));
}

/// A signature exactly at the age limit is still accepted by the age gate —
/// the bound is inclusive.
#[test]
fn test_signature_at_exact_age_limit_passes_age_gate() {
    let env = Env::default();
    let max_age = 1_000u64;
    let (client, _admin, pubkey) = setup_cold(&env, max_age);

    let created_at = env.ledger().sequence();
    env.ledger().with_mut(|li| {
        li.sequence_number += max_age as u32;
    });

    let signature = BytesN::from_array(&env, &[4u8; 64]);

    let result = client.try_submit_cold_signature(&0u64, &signature, &pubkey, &created_at);
    assert_ne!(result, Err(Ok(VaultError::ColdSignatureTooOld)));
}

/// One ledger past the limit flips to rejection, pinning the boundary.
#[test]
fn test_signature_one_ledger_past_limit_rejected() {
    let env = Env::default();
    let max_age = 1_000u64;
    let (client, _admin, pubkey) = setup_cold(&env, max_age);

    let created_at = env.ledger().sequence();
    env.ledger().with_mut(|li| {
        li.sequence_number += max_age as u32 + 1;
    });

    let signature = BytesN::from_array(&env, &[5u8; 64]);

    let result = client.try_submit_cold_signature(&0u64, &signature, &pubkey, &created_at);
    assert_eq!(result, Err(Ok(VaultError::ColdSignatureTooOld)));
}

/// The age check runs before signer lookup, so an unconfigured vault still
/// reports the configuration problem first.
#[test]
fn test_unconfigured_vault_reports_config_error() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let signature = BytesN::from_array(&env, &[6u8; 64]);
    let pubkey = BytesN::from_array(&env, &[7u8; 32]);

    let result = client.try_submit_cold_signature(&0u64, &signature, &pubkey, &1u32);
    assert_eq!(result, Err(Ok(VaultError::ColdSignerConfigNotSet)));
}

/// The configured maximum age round-trips through storage.
#[test]
fn test_max_age_persists_in_config() {
    let env = Env::default();
    let (client, _admin, _pubkey) = setup_cold(&env, 4_242);

    let stored = client.get_cold_signer_config();
    assert_eq!(stored.max_cold_sig_age_ledgers, 4_242);
}
