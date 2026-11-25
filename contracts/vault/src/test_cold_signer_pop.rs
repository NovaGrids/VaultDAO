//! Tests for cold-signer proof-of-possession at registration (#2086).
//!
//! `set_cold_signer_config` must refuse to register an Ed25519 key unless the
//! key's holder has signed the vault-and-address-bound PoP message. Otherwise
//! an admin could register keys they do not control.
#![cfg(test)]

use super::*;
use crate::types::ColdSignerConfig;
use crate::{VaultDAO, VaultDAOClient};
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env, String, Vec};

/// Deterministic Ed25519 key from a one-byte seed.
pub(crate) fn signing_key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

pub(crate) fn public_key(env: &Env, key: &SigningKey) -> BytesN<32> {
    BytesN::from_array(env, &key.verifying_key().to_bytes())
}

/// Build the PoP message exactly as documented in SIGNING_GUIDE.md.
pub(crate) fn pop_message(env: &Env, vault: &Address, signer: &Address, pk: &BytesN<32>) -> Bytes {
    let mut msg = Bytes::from_slice(env, b"VaultDAO:cold-signer-pop:v1");
    msg.append(&vault.clone().to_xdr(env));
    msg.append(&signer.clone().to_xdr(env));
    msg.append(&Bytes::from_array(env, &pk.to_array()));
    msg
}

/// Sign the PoP message for `signer` on `vault` with `key`.
pub(crate) fn pop_proof(
    env: &Env,
    vault: &Address,
    signer: &Address,
    key: &SigningKey,
) -> BytesN<64> {
    let pk = public_key(env, key);
    let msg = pop_message(env, vault, signer, &pk);
    let mut buf = [0u8; 256];
    let len = msg.len() as usize;
    msg.copy_into_slice(&mut buf[..len]);
    BytesN::from_array(env, &key.sign(&buf[..len]).to_bytes())
}

fn init_vault(env: &Env, client: &VaultDAOClient<'_>, admin: &Address) {
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(Address::generate(env));
    client.initialize(admin, &crate::types::InitConfig {
        upgrade_timelock_delay: 17_280,
        veto_window_ledgers: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 2,
        quorum: 0,
        quorum_percentage: 0,
        default_voting_deadline: 0,
        spending_limit: 1_000_000,
        daily_limit: 5_000_000,
        weekly_limit: 10_000_000,
        timelock_threshold: 0,
        timelock_delay: 0,
        velocity_limit: crate::types::VelocityConfig {
            limit: 1_000_000,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: crate::types::ThresholdStrategy::Fixed,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        veto_addresses: Vec::new(env),
        retry_config: crate::types::RetryConfig {
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
            max_retry_delay: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
        proposal_id_prefix: 0,
    });
}

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address) {
    env.mock_all_auths();
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    init_vault(env, &client, &admin);
    (client, admin, contract_id)
}

fn config_for(env: &Env, keys: &[(&SigningKey, &Address)]) -> ColdSignerConfig {
    let mut cold_signers = Vec::new(env);
    let mut cold_signer_addresses = Vec::new(env);
    for (key, addr) in keys {
        cold_signers.push_back(public_key(env, key));
        cold_signer_addresses.push_back((*addr).clone());
    }
    ColdSignerConfig {
        cold_signers,
        cold_signer_addresses,
        cold_sig_threshold: 1,
        cold_sig_expiry: 17_280,
        max_cold_sig_age_ledgers: 0,
        min_cold_sig_age_ledgers: 0,
        cold_min_age_amount_threshold: 0,
    }
}

#[test]
fn test_valid_proofs_register_cold_signers() {
    let env = Env::default();
    let (client, admin, vault) = setup(&env);
    let k1 = signing_key(1);
    let k2 = signing_key(2);
    let a1 = Address::generate(&env);
    let a2 = Address::generate(&env);

    let config = config_for(&env, &[(&k1, &a1), (&k2, &a2)]);
    let mut proofs = Vec::new(&env);
    proofs.push_back(pop_proof(&env, &vault, &a1, &k1));
    proofs.push_back(pop_proof(&env, &vault, &a2, &k2));

    client.set_cold_signer_config(&admin, &config, &proofs);

    let stored = client.get_cold_signer_config();
    assert_eq!(stored.cold_signers, config.cold_signers);
    assert_eq!(stored.cold_signer_addresses, config.cold_signer_addresses);
}

#[test]
fn test_empty_set_needs_no_proofs() {
    let env = Env::default();
    let (client, admin, _vault) = setup(&env);
    let config = config_for(&env, &[]);
    client.set_cold_signer_config(&admin, &config, &Vec::new(&env));
    assert_eq!(client.get_cold_signer_config().cold_signers.len(), 0);
}

/// A key the admin does not control: they can only forge a proof with some
/// other key, which does not verify against the registered public key.
#[test]
fn test_proof_signed_by_different_key_rejected() {
    let env = Env::default();
    let (client, admin, vault) = setup(&env);
    let victim = signing_key(1);
    let attacker = signing_key(9);
    let addr = Address::generate(&env);

    let config = config_for(&env, &[(&victim, &addr)]);
    let mut proofs = Vec::new(&env);
    proofs.push_back(pop_proof(&env, &vault, &addr, &attacker));

    assert!(client.try_set_cold_signer_config(&admin, &config, &proofs).is_err());
    assert_eq!(client.get_cold_signer_config().cold_signers.len(), 0);
}

#[test]
fn test_garbage_proof_rejected() {
    let env = Env::default();
    let (client, admin, _vault) = setup(&env);
    let key = signing_key(1);
    let addr = Address::generate(&env);

    let config = config_for(&env, &[(&key, &addr)]);
    let mut proofs = Vec::new(&env);
    proofs.push_back(BytesN::from_array(&env, &[0u8; 64]));

    assert!(client.try_set_cold_signer_config(&admin, &config, &proofs).is_err());
}

/// A proof is bound to the on-chain address it was produced for.
#[test]
fn test_proof_for_different_address_rejected() {
    let env = Env::default();
    let (client, admin, vault) = setup(&env);
    let key = signing_key(1);
    let intended = Address::generate(&env);
    let swapped = Address::generate(&env);

    let config = config_for(&env, &[(&key, &swapped)]);
    let mut proofs = Vec::new(&env);
    proofs.push_back(pop_proof(&env, &vault, &intended, &key));

    assert!(client.try_set_cold_signer_config(&admin, &config, &proofs).is_err());
}

/// A proof is bound to the vault it was produced for, so it cannot be replayed
/// into another vault.
#[test]
fn test_proof_for_different_vault_rejected() {
    let env = Env::default();
    let (client, admin, _vault) = setup(&env);
    let other_vault = Address::generate(&env);
    let key = signing_key(1);
    let addr = Address::generate(&env);

    let config = config_for(&env, &[(&key, &addr)]);
    let mut proofs = Vec::new(&env);
    proofs.push_back(pop_proof(&env, &other_vault, &addr, &key));

    assert!(client.try_set_cold_signer_config(&admin, &config, &proofs).is_err());
}

#[test]
fn test_proof_count_mismatch_rejected() {
    let env = Env::default();
    let (client, admin, vault) = setup(&env);
    let k1 = signing_key(1);
    let k2 = signing_key(2);
    let a1 = Address::generate(&env);
    let a2 = Address::generate(&env);

    let config = config_for(&env, &[(&k1, &a1), (&k2, &a2)]);
    let mut proofs = Vec::new(&env);
    proofs.push_back(pop_proof(&env, &vault, &a1, &k1));

    let result = client.try_set_cold_signer_config(&admin, &config, &proofs);
    assert_eq!(result, Err(Ok(VaultError::ColdSignerProofMismatch)));
}

#[test]
fn test_address_count_mismatch_rejected() {
    let env = Env::default();
    let (client, admin, vault) = setup(&env);
    let key = signing_key(1);
    let addr = Address::generate(&env);

    let mut config = config_for(&env, &[(&key, &addr)]);
    config.cold_signer_addresses = Vec::new(&env);
    let mut proofs = Vec::new(&env);
    proofs.push_back(pop_proof(&env, &vault, &addr, &key));

    let result = client.try_set_cold_signer_config(&admin, &config, &proofs);
    assert_eq!(result, Err(Ok(VaultError::ColdSignerProofMismatch)));
}

/// Cross-language vector: the signature below was produced off-chain by the
/// JS `@stellar/stellar-sdk` (`Keypair.fromRawEd25519Seed([42; 32])`) over the
/// message built by the SDK's `buildColdSignerPopMessage`. If this test fails,
/// the contract and the SDK disagree on the PoP message format.
#[test]
fn test_sdk_generated_proof_verifies() {
    let env = Env::default();
    env.mock_all_auths();
    let vault = Address::from_string(&String::from_str(
        &env,
        "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526",
    ));
    env.register_at(&vault, VaultDAO, ());
    let client = VaultDAOClient::new(&env, &vault);
    let admin = Address::generate(&env);
    init_vault(&env, &client, &admin);

    let signer = Address::from_string(&String::from_str(
        &env,
        "GAMX62ZD4FWIKMWGVPEDR6WNL2TYTPQMO2ZJEAZUAON7VCZ5G2GWDF7W",
    ));
    let key = signing_key(42);
    assert_eq!(
        hex(&key.verifying_key().to_bytes()),
        "197f6b23e16c8532c6abc838facd5ea789be0c76b2920334039bfa8b3d368d61"
    );

    let sdk_sig: [u8; 64] = unhex(
        "b1cfc9947962e32ef8bfae9b78484709f8bdf9fdf6368723bb126f6427ce2d6a\
         20dead071116c5867c9728b4abe392557e8c40455ecc7b964dd83bf115911802",
    );

    let config = config_for(&env, &[(&key, &signer)]);
    let mut proofs = Vec::new(&env);
    proofs.push_back(BytesN::from_array(&env, &sdk_sig));
    client.set_cold_signer_config(&admin, &config, &proofs);
    assert_eq!(client.get_cold_signer_config().cold_signers.len(), 1);
}

fn hex(bytes: &[u8]) -> std::string::String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex<const N: usize>(s: &str) -> [u8; N] {
    let mut out = [0u8; N];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap();
    }
    out
}
