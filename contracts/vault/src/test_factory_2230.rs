//! Unit tests for Issue #2230: Vault factory + template registry with
//! upgradeable presets and license attestation.

#![cfg(test)]

use crate::errors::VaultError;
use crate::factory::{
    build_attestation_message, VaultFactory, VaultFactoryClient,
};
use crate::types::{FactoryProvenance, VaultTemplate, VoteWeight};
use crate::{VaultDAO, VaultDAOClient};
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    Address, BytesN, Env, String, Symbol, TryFromVal, Vec,
};

fn maintainer_keypair() -> (SigningKey, [u8; 32]) {
    let seed = [0x42u8; 32];
    let sk = SigningKey::from_bytes(&seed);
    let pk = sk.verifying_key().to_bytes();
    (sk, pk)
}

fn sign_template_attestation(
    env: &Env,
    sk: &SigningKey,
    template_id: &String,
    version: u32,
    wasm_hash: &BytesN<32>,
    params_schema: &String,
    license_uri: &String,
    license_hash: &BytesN<32>,
) -> BytesN<64> {
    let msg = build_attestation_message(
        env,
        template_id,
        version,
        wasm_hash,
        params_schema,
        license_uri,
        license_hash,
    );
    let mut raw = std::vec![0u8; msg.len() as usize];
    msg.copy_into_slice(&mut raw);
    let sig = sk.sign(&raw);
    BytesN::from_array(env, &sig.to_bytes())
}

fn sample_preset(env: &Env, threshold_ratio_percent: u32) -> VaultTemplate {
    VaultTemplate {
        version: VaultTemplate::CURRENT_VERSION,
        threshold_ratio_percent,
        quorum_percentage: 60,
        timelock_delay_ledgers: 100,
        timelock_threshold_pct: 50,
        veto_window_ledgers: 200,
        daily_limit_ratio_percent: 400,
        weekly_limit_ratio_percent: 900,
        fee_tiers: Vec::new(env),
        base_fee_bps: 25,
        enabled_features: VaultTemplate::FEATURE_WHITELIST_MODE | VaultTemplate::FEATURE_RETRY,
        grace_period_ledgers: 150,
        vote_weight: VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
    }
}

fn setup_factory(
    env: &Env,
    require_attestation: bool,
) -> (VaultFactoryClient<'_>, Address, SigningKey, BytesN<32>) {
    env.mock_all_auths();
    let factory_id = env.register(VaultFactory, ());
    let client = VaultFactoryClient::new(env, &factory_id);
    let admin = Address::generate(env);
    let (sk, pk_bytes) = maintainer_keypair();
    let pk = BytesN::from_array(env, &pk_bytes);

    client.init_factory(&admin, &pk, &require_attestation);
    (client, admin, sk, pk)
}

#[test]
fn test_factory_init_and_policy_update() {
    let env = Env::default();
    let (client, admin, _sk, pk) = setup_factory(&env, true);

    let policy = client.get_factory_policy();
    assert_eq!(policy.admin, admin);
    assert_eq!(policy.maintainer_pubkey, pk);
    assert!(policy.require_attestation);

    // Second initialization is rejected
    let dup = client.try_init_factory(&admin, &pk, &false);
    assert_eq!(dup.err(), Some(Ok(VaultError::AlreadyInitialized)));

    // Non-admin cannot update policy
    let outsider = Address::generate(&env);
    let unauth = client.try_set_factory_policy(&outsider, &pk, &false);
    assert_eq!(unauth.err(), Some(Ok(VaultError::Unauthorized)));

    // Admin can update policy
    let new_pk = BytesN::from_array(&env, &[0x99u8; 32]);
    client.set_factory_policy(&admin, &new_pk, &false);
    let updated = client.get_factory_policy();
    assert_eq!(updated.maintainer_pubkey, new_pk);
    assert!(!updated.require_attestation);
}

#[test]
fn test_register_template_with_valid_attestation() {
    let env = Env::default();
    let (client, admin, sk, _pk) = setup_factory(&env, true);

    let template_id = String::from_str(&env, "treasury-standard");
    let wasm_hash = BytesN::from_array(&env, &[0xABu8; 32]);
    let params_schema = String::from_str(&env, "https://schemas.vaultdao.org/treasury-v1.json");
    let license_uri = String::from_str(&env, "https://spdx.org/licenses/AGPL-3.0-only.html");
    let license_hash = BytesN::from_array(&env, &[0xCDu8; 32]);
    let preset = sample_preset(&env, 67);

    let sig = sign_template_attestation(
        &env,
        &sk,
        &template_id,
        1,
        &wasm_hash,
        &params_schema,
        &license_uri,
        &license_hash,
    );

    let rec = client.register_factory_template(
        &admin,
        &template_id,
        &1u32,
        &wasm_hash,
        &params_schema,
        &license_uri,
        &license_hash,
        &Some(preset),
        &Some(sig.clone()),
    );

    assert_eq!(rec.template_id, template_id);
    assert_eq!(rec.version, 1);
    assert_eq!(rec.wasm_hash, wasm_hash);
    assert_eq!(rec.params_schema, params_schema);
    assert_eq!(rec.license_uri, license_uri);
    assert_eq!(rec.license_hash, license_hash);
    assert!(rec.attested);
    assert_eq!(rec.attestation_sig, Some(sig));
    assert_eq!(rec.preset_revision, 1);
    assert!(!rec.deprecated);

    assert_eq!(client.get_latest_template_version(&template_id), 1);

    // Canonical attestation message helper matches local helper
    let onchain_msg = client.factory_attestation_message(
        &template_id,
        &1u32,
        &wasm_hash,
        &params_schema,
        &license_uri,
        &license_hash,
    );
    let local_msg = build_attestation_message(
        &env,
        &template_id,
        1,
        &wasm_hash,
        &params_schema,
        &license_uri,
        &license_hash,
    );
    assert_eq!(onchain_msg, local_msg);
}

#[test]
#[should_panic]
fn test_register_template_rejects_invalid_attestation_signature() {
    let env = Env::default();
    let (client, admin, _sk, _pk) = setup_factory(&env, true);

    let template_id = String::from_str(&env, "treasury-bad-sig");
    let wasm_hash = BytesN::from_array(&env, &[0x11u8; 32]);
    let params_schema = String::from_str(&env, "https://schemas.vaultdao.org/treasury-v1.json");
    let license_uri = String::from_str(&env, "https://spdx.org/licenses/MIT.html");
    let license_hash = BytesN::from_array(&env, &[0x22u8; 32]);

    // Sign with a DIFFERENT key than the factory maintainer key
    let wrong_sk = SigningKey::from_bytes(&[0xEEu8; 32]);
    let bad_sig = sign_template_attestation(
        &env,
        &wrong_sk,
        &template_id,
        1,
        &wasm_hash,
        &params_schema,
        &license_uri,
        &license_hash,
    );

    client.register_factory_template(
        &admin,
        &template_id,
        &1u32,
        &wasm_hash,
        &params_schema,
        &license_uri,
        &license_hash,
        &Some(sample_preset(&env, 60)),
        &Some(bad_sig),
    );
}

#[test]
fn test_register_template_validation_and_duplicate_version_rejected() {
    let env = Env::default();
    let (client, admin, _sk, _pk) = setup_factory(&env, false);

    let template_id = String::from_str(&env, "grants-dao");
    let wasm_hash = BytesN::from_array(&env, &[0x33u8; 32]);
    let params_schema = String::from_str(&env, "{\"type\":\"object\"}");
    let license_uri = String::from_str(&env, "https://spdx.org/licenses/Apache-2.0.html");
    let license_hash = BytesN::from_array(&env, &[0x44u8; 32]);

    // Version 0 rejected
    let res = client.try_register_factory_template(
        &admin,
        &template_id,
        &0u32,
        &wasm_hash,
        &params_schema,
        &license_uri,
        &license_hash,
        &None,
        &None,
    );
    assert_eq!(res.err(), Some(Ok(VaultError::InvalidFactoryTemplate)));

    // Zero wasm hash rejected
    let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
    let res = client.try_register_factory_template(
        &admin,
        &template_id,
        &1u32,
        &zero_hash,
        &params_schema,
        &license_uri,
        &license_hash,
        &None,
        &None,
    );
    assert_eq!(res.err(), Some(Ok(VaultError::InvalidFactoryTemplate)));

    // Valid unattested registration succeeds
    client.register_factory_template(
        &admin,
        &template_id,
        &1u32,
        &wasm_hash,
        &params_schema,
        &license_uri,
        &license_hash,
        &Some(sample_preset(&env, 51)),
        &None,
    );

    // Duplicate (template_id, version) rejected
    let dup = client.try_register_factory_template(
        &admin,
        &template_id,
        &1u32,
        &wasm_hash,
        &params_schema,
        &license_uri,
        &license_hash,
        &Some(sample_preset(&env, 51)),
        &None,
    );
    assert_eq!(dup.err(), Some(Ok(VaultError::TemplateAlreadyExists)));
}

#[test]
fn test_deploy_vault_rejects_unknown_and_unattested_templates_when_policy_requires_attestation() {
    let env = Env::default();
    let (client, admin, _sk, _pk) = setup_factory(&env, true);

    let deployer = Address::generate(&env);
    let vault_admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(vault_admin.clone());
    signers.push_back(Address::generate(&env));
    let salt = BytesN::from_array(&env, &[0x01u8; 32]);

    // 1. Unknown template is rejected with TemplateNotFound
    let unknown_id = String::from_str(&env, "does-not-exist");
    let res = client.try_deploy_vault(
        &deployer,
        &unknown_id,
        &1u32,
        &salt,
        &vault_admin,
        &signers,
        &1_000_000i128,
        &None,
    );
    assert_eq!(res.err(), Some(Ok(VaultError::TemplateNotFound)));

    // 2. Register an unattested community template
    let community_id = String::from_str(&env, "community-vault");
    let wasm_hash = BytesN::from_array(&env, &[0x55u8; 32]);
    let params_schema = String::from_str(&env, "https://example.org/schema.json");
    let license_uri = String::from_str(&env, "https://spdx.org/licenses/MIT.html");
    let license_hash = BytesN::from_array(&env, &[0x66u8; 32]);

    let rec = client.register_factory_template(
        &admin,
        &community_id,
        &1u32,
        &wasm_hash,
        &params_schema,
        &license_uri,
        &license_hash,
        &Some(sample_preset(&env, 67)),
        &None,
    );
    assert!(!rec.attested);

    // 3. Attempting to deploy unattested template while require_attestation == true fails
    let res = client.try_deploy_vault(
        &deployer,
        &community_id,
        &1u32,
        &salt,
        &vault_admin,
        &signers,
        &1_000_000i128,
        &None,
    );
    assert_eq!(res.err(), Some(Ok(VaultError::TemplateNotAttested)));
}

#[test]
fn test_retroactive_attestation_and_deprecation() {
    let env = Env::default();
    let (client, admin, sk, _pk) = setup_factory(&env, true);

    let community_id = String::from_str(&env, "community-vault");
    let wasm_hash = BytesN::from_array(&env, &[0x77u8; 32]);
    let params_schema = String::from_str(&env, "https://example.org/schema.json");
    let license_uri = String::from_str(&env, "https://spdx.org/licenses/MIT.html");
    let license_hash = BytesN::from_array(&env, &[0x88u8; 32]);

    let contributor = Address::generate(&env);
    let rec = client.register_factory_template(
        &contributor,
        &community_id,
        &1u32,
        &wasm_hash,
        &params_schema,
        &license_uri,
        &license_hash,
        &Some(sample_preset(&env, 67)),
        &None,
    );
    assert!(!rec.attested);

    // Maintainer later signs and submits attestation
    let sig = sign_template_attestation(
        &env,
        &sk,
        &community_id,
        1,
        &wasm_hash,
        &params_schema,
        &license_uri,
        &license_hash,
    );
    let attested_rec = client.attest_factory_template(&admin, &community_id, &1u32, &sig);
    assert!(attested_rec.attested);
    assert_eq!(attested_rec.attestation_sig, Some(sig));

    // Deprecating the template blocks new deployments with TemplateInactive
    client.deprecate_factory_template(&admin, &community_id, &1u32);
    let fetched = client.get_factory_template(&community_id, &1u32);
    assert!(fetched.deprecated);

    let deployer = Address::generate(&env);
    let vault_admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(vault_admin.clone());
    signers.push_back(Address::generate(&env));

    let res = client.try_deploy_vault(
        &deployer,
        &community_id,
        &1u32,
        &BytesN::from_array(&env, &[0x02u8; 32]),
        &vault_admin,
        &signers,
        &1_000_000i128,
        &None,
    );
    assert_eq!(res.err(), Some(Ok(VaultError::TemplateInactive)));
}

#[test]
fn test_upgradeable_preset_preserves_pinned_wasm_and_license() {
    let env = Env::default();
    let (client, admin, sk, _pk) = setup_factory(&env, true);

    let template_id = String::from_str(&env, "treasury-upgradeable");
    let wasm_hash = BytesN::from_array(&env, &[0xA1u8; 32]);
    let params_schema = String::from_str(&env, "https://schemas.vaultdao.org/treasury-v1.json");
    let license_uri = String::from_str(&env, "https://spdx.org/licenses/AGPL-3.0-only.html");
    let license_hash = BytesN::from_array(&env, &[0xB2u8; 32]);
    let sig = sign_template_attestation(
        &env,
        &sk,
        &template_id,
        1,
        &wasm_hash,
        &params_schema,
        &license_uri,
        &license_hash,
    );

    let initial = client.register_factory_template(
        &admin,
        &template_id,
        &1u32,
        &wasm_hash,
        &params_schema,
        &license_uri,
        &license_hash,
        &Some(sample_preset(&env, 60)),
        &Some(sig),
    );
    assert_eq!(initial.preset_revision, 1);

    // Non-admin cannot upgrade preset
    let outsider = Address::generate(&env);
    let unauth = client.try_upgrade_template_preset(
        &outsider,
        &template_id,
        &1u32,
        &sample_preset(&env, 75),
    );
    assert_eq!(unauth.err(), Some(Ok(VaultError::Unauthorized)));

    // Invalid preset ratio rejected
    let bad = client.try_upgrade_template_preset(
        &admin,
        &template_id,
        &1u32,
        &sample_preset(&env, 0),
    );
    assert_eq!(bad.err(), Some(Ok(VaultError::InvalidTemplate)));

    // Admin upgrades preset; pinned wasm_hash, license, and attestation remain intact
    let upgraded = client.upgrade_template_preset(
        &admin,
        &template_id,
        &1u32,
        &sample_preset(&env, 75),
    );
    assert_eq!(upgraded.preset_revision, 2);
    assert_eq!(
        upgraded.preset.into_option().unwrap().threshold_ratio_percent,
        75
    );
    assert_eq!(upgraded.wasm_hash, wasm_hash);
    assert_eq!(upgraded.license_uri, license_uri);
    assert_eq!(upgraded.license_hash, license_hash);
    assert!(upgraded.attested);
}

#[test]
fn test_deployed_vault_emits_factory_and_template_version_event() {
    let env = Env::default();
    env.mock_all_auths();

    let vault_id = env.register(VaultDAO, ());
    let vault = VaultDAOClient::new(&env, &vault_id);

    let factory_addr = Address::generate(&env);
    let admin = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer2);
    signers.push_back(signer3);

    let template_id = String::from_str(&env, "treasury-standard");
    let template_version = 3u32;
    let wasm_hash = BytesN::from_array(&env, &[0xDEu8; 32]);
    let license_uri = String::from_str(&env, "https://spdx.org/licenses/AGPL-3.0-only.html");
    let license_hash = BytesN::from_array(&env, &[0xADu8; 32]);
    let preset = sample_preset(&env, 67);

    let input_provenance = FactoryProvenance {
        factory: factory_addr.clone(),
        template_id: template_id.clone(),
        template_version,
        wasm_hash: wasm_hash.clone(),
        license_uri: license_uri.clone(),
        license_hash: license_hash.clone(),
        attested: true,
        deployed_at_ledger: 0,
    };

    vault.initialize_from_factory(
        &input_provenance,
        &admin,
        &signers,
        &preset,
        &2_000i128,
    );

    // 1. Provenance is stored on the deployed vault
    let provenance = vault
        .get_factory_provenance()
        .expect("factory provenance must be recorded");
    assert_eq!(provenance.factory, factory_addr);
    assert_eq!(provenance.template_id, template_id);
    assert_eq!(provenance.template_version, template_version);
    assert_eq!(provenance.wasm_hash, wasm_hash);
    assert_eq!(provenance.license_uri, license_uri);
    assert_eq!(provenance.license_hash, license_hash);
    assert!(provenance.attested);

    // 2. Deployed vault emitted the factory+template version event
    let all_events = env.events().all();
    let expected_topic = Symbol::new(&env, "factory_template_version");
    let mut found_event = false;
    for (contract, topics, data) in all_events.iter() {
        if contract != vault_id {
            continue;
        }
        if topics.len() == 2 {
            let t0 = Symbol::try_from_val(&env, &topics.get(0).unwrap()).ok();
            let t1 = Address::try_from_val(&env, &topics.get(1).unwrap()).ok();
            if t0 == Some(expected_topic.clone()) && t1 == Some(factory_addr.clone()) {
                let payload = <(String, u32, BytesN<32>, BytesN<32>, bool)>::try_from_val(
                    &env,
                    &data,
                )
                .expect("event payload tuple");
                assert_eq!(payload.0, template_id);
                assert_eq!(payload.1, template_version);
                assert_eq!(payload.2, wasm_hash);
                assert_eq!(payload.3, license_hash);
                assert!(payload.4);
                found_event = true;
            }
        }
    }
    assert!(
        found_event,
        "deployed vault must emit factory_template_version event with factory + template version"
    );
}

#[test]
fn test_list_factory_templates_tracks_multiple_versions() {
    let env = Env::default();
    let (client, admin, _sk, _pk) = setup_factory(&env, false);

    let t1 = String::from_str(&env, "treasury-standard");
    let t2 = String::from_str(&env, "grants-dao");
    let schema = String::from_str(&env, "https://schemas.vaultdao.org/v1.json");
    let license = String::from_str(&env, "https://spdx.org/licenses/AGPL-3.0-only.html");

    client.register_factory_template(
        &admin,
        &t1,
        &1u32,
        &BytesN::from_array(&env, &[1u8; 32]),
        &schema,
        &license,
        &BytesN::from_array(&env, &[2u8; 32]),
        &Some(sample_preset(&env, 60)),
        &None,
    );
    client.register_factory_template(
        &admin,
        &t1,
        &2u32,
        &BytesN::from_array(&env, &[3u8; 32]),
        &schema,
        &license,
        &BytesN::from_array(&env, &[4u8; 32]),
        &Some(sample_preset(&env, 67)),
        &None,
    );
    client.register_factory_template(
        &admin,
        &t2,
        &1u32,
        &BytesN::from_array(&env, &[5u8; 32]),
        &schema,
        &license,
        &BytesN::from_array(&env, &[6u8; 32]),
        &Some(sample_preset(&env, 51)),
        &None,
    );

    assert_eq!(client.get_latest_template_version(&t1), 2);
    assert_eq!(client.get_latest_template_version(&t2), 1);

    let all = client.list_factory_templates();
    assert_eq!(all.len(), 3);
}
