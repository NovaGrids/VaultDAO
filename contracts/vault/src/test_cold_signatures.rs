use super::*;
use crate::types::{ColdSignerConfig, ConditionLogic, Priority, RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, BytesN as _},
    token::StellarAssetClient,
    Address, BytesN, Env, Symbol, Vec,
};

fn setup(env: &Env) -> (VaultDAOClient<'_>, Address, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let token_admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());

    client.initialize(
        &admin,
        &InitConfig {
            signers,
            threshold: 1,
            quorum: 0,
            quorum_percentage: 0,
            default_voting_deadline: 0,
            spending_limit: 1_000_000,
            daily_limit: 5_000_000,
            weekly_limit: 10_000_000,
            timelock_threshold: 999_999,
            timelock_delay: 0,
            velocity_limit: VelocityConfig { limit: 100, window: 3600, per_token_limit: 0 },
            threshold_strategy: ThresholdStrategy::Fixed,
            pre_execution_hooks: Vec::new(env),
            post_execution_hooks: Vec::new(env),
            veto_addresses: Vec::new(env),
            veto_window_ledgers: 0,
            retry_config: RetryConfig {
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(env),
            staking_config: crate::types::StakingConfig::default(),
            proposal_id_prefix: 0,
        },
    );

    (client, admin, token, contract_id)
}

fn create_proposal(
    env: &Env,
    client: &VaultDAOClient<'_>,
    proposer: &Address,
    token: &Address,
    vault_contract: &Address,
) -> u64 {
    StellarAssetClient::new(env, token).mint(vault_contract, &1_000_000);
    let recipient = Address::generate(env);
    client.propose_transfer(
        proposer,
        &recipient,
        token,
        &100i128,
        &Symbol::new(env, "test"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    )
}

/// Generate a random Ed25519 keypair and return (public_key, signing_key_bytes).
/// In tests we use random bytes; actual signing is done by soroban test utilities.
fn make_keypair(env: &Env) -> (BytesN<32>, soroban_sdk::testutils::ed25519::Keypair) {
    let kp = soroban_sdk::testutils::ed25519::Keypair::generate(env);
    (kp.public_key(), kp)
}

/// Sign `proposal_id` with an Ed25519 keypair (same logic as submit_cold_signature).
fn sign_proposal_id(env: &Env, kp: &soroban_sdk::testutils::ed25519::Keypair, proposal_id: u64) -> BytesN<64> {
    use soroban_sdk::Bytes;
    let mut id_bytes = Bytes::new(env);
    id_bytes.extend_from_array(&proposal_id.to_le_bytes());
    let proposal_hash = env.crypto().sha256(&id_bytes);
    kp.sign(env, &soroban_sdk::Bytes::from(proposal_hash.as_val()))
}

// ============================================================================
// set_cold_signer_config
// ============================================================================

#[test]
fn test_set_cold_signer_config_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _) = setup(&env);
    let (pk, _) = make_keypair(&env);
    let addr = Address::generate(&env);

    let mut pks = Vec::new(&env);
    pks.push_back(pk.clone());
    let mut addrs = Vec::new(&env);
    addrs.push_back(addr.clone());

    let config = ColdSignerConfig {
        cold_signers: pks,
        cold_signer_addresses: addrs,
        cold_sig_threshold: 1,
        cold_sig_expiry: 1000,
    };
    client.set_cold_signer_config(&admin, &config);

    let stored = client.get_cold_signer_config();
    assert_eq!(stored.cold_sig_threshold, 1);
    assert_eq!(stored.cold_signers.len(), 1);
}

#[test]
fn test_set_cold_signer_config_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, _, _) = setup(&env);
    let stranger = Address::generate(&env);
    let config = ColdSignerConfig::default(&env);
    let result = client.try_set_cold_signer_config(&stranger, &config);
    assert_eq!(result, Err(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_set_cold_signer_config_max_exceeded() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _, _) = setup(&env);
    let mut pks = Vec::new(&env);
    let mut addrs = Vec::new(&env);
    for _ in 0..6u32 {
        let (pk, _) = make_keypair(&env);
        pks.push_back(pk);
        addrs.push_back(Address::generate(&env));
    }

    let config = ColdSignerConfig {
        cold_signers: pks,
        cold_signer_addresses: addrs,
        cold_sig_threshold: 3,
        cold_sig_expiry: 1000,
    };
    let result = client.try_set_cold_signer_config(&admin, &config);
    assert_eq!(result, Err(Ok(VaultError::TooManyColdSigners)));
}

// ============================================================================
// submit_cold_signature
// ============================================================================

#[test]
fn test_submit_valid_cold_signature() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let (pk, kp) = make_keypair(&env);
    let addr = Address::generate(&env);

    let mut pks = Vec::new(&env);
    pks.push_back(pk.clone());
    let mut addrs = Vec::new(&env);
    addrs.push_back(addr.clone());

    client.set_cold_signer_config(
        &admin,
        &ColdSignerConfig {
            cold_signers: pks,
            cold_signer_addresses: addrs,
            cold_sig_threshold: 1,
            cold_sig_expiry: 10_000,
        },
    );

    let sig = sign_proposal_id(&env, &kp, proposal_id);
    client.submit_cold_signature(&proposal_id, &sig, &pk);

    assert_eq!(client.get_cold_signature_count(&proposal_id), 1);
}

#[test]
fn test_submit_cold_signature_not_a_cold_signer_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let (pk, _kp) = make_keypair(&env);
    let addr = Address::generate(&env);

    let mut pks = Vec::new(&env);
    pks.push_back(pk.clone());
    let mut addrs = Vec::new(&env);
    addrs.push_back(addr.clone());

    client.set_cold_signer_config(
        &admin,
        &ColdSignerConfig {
            cold_signers: pks,
            cold_signer_addresses: addrs,
            cold_sig_threshold: 1,
            cold_sig_expiry: 10_000,
        },
    );

    // Use an unregistered public key
    let (unknown_pk, unknown_kp) = make_keypair(&env);
    let sig = sign_proposal_id(&env, &unknown_kp, proposal_id);
    let result = client.try_submit_cold_signature(&proposal_id, &sig, &unknown_pk);
    assert_eq!(result, Err(Ok(VaultError::NotAColdSigner)));
}

#[test]
fn test_verify_cold_signatures_insufficient_returns_false() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let (pk1, _kp1) = make_keypair(&env);
    let (pk2, _kp2) = make_keypair(&env);
    let addr1 = Address::generate(&env);
    let addr2 = Address::generate(&env);

    let mut pks = Vec::new(&env);
    pks.push_back(pk1.clone());
    pks.push_back(pk2.clone());
    let mut addrs = Vec::new(&env);
    addrs.push_back(addr1);
    addrs.push_back(addr2);

    client.set_cold_signer_config(
        &admin,
        &ColdSignerConfig {
            cold_signers: pks,
            cold_signer_addresses: addrs,
            cold_sig_threshold: 2,
            cold_sig_expiry: 10_000,
        },
    );

    // No signatures submitted yet
    assert!(!client.verify_cold_signatures(&proposal_id));
}

#[test]
fn test_verify_cold_signatures_sufficient_returns_true() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let (pk1, kp1) = make_keypair(&env);
    let (pk2, kp2) = make_keypair(&env);
    let addr1 = Address::generate(&env);
    let addr2 = Address::generate(&env);

    let mut pks = Vec::new(&env);
    pks.push_back(pk1.clone());
    pks.push_back(pk2.clone());
    let mut addrs = Vec::new(&env);
    addrs.push_back(addr1);
    addrs.push_back(addr2);

    client.set_cold_signer_config(
        &admin,
        &ColdSignerConfig {
            cold_signers: pks,
            cold_signer_addresses: addrs,
            cold_sig_threshold: 2,
            cold_sig_expiry: 10_000,
        },
    );

    let sig1 = sign_proposal_id(&env, &kp1, proposal_id);
    let sig2 = sign_proposal_id(&env, &kp2, proposal_id);
    client.submit_cold_signature(&proposal_id, &sig1, &pk1);
    client.submit_cold_signature(&proposal_id, &sig2, &pk2);

    assert!(client.verify_cold_signatures(&proposal_id));
}

#[test]
fn test_replay_prevention_same_signature_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    let (pk, kp) = make_keypair(&env);
    let addr = Address::generate(&env);

    let mut pks = Vec::new(&env);
    pks.push_back(pk.clone());
    let mut addrs = Vec::new(&env);
    addrs.push_back(addr);

    client.set_cold_signer_config(
        &admin,
        &ColdSignerConfig {
            cold_signers: pks,
            cold_signer_addresses: addrs,
            cold_sig_threshold: 1,
            cold_sig_expiry: 10_000,
        },
    );

    let sig = sign_proposal_id(&env, &kp, proposal_id);
    client.submit_cold_signature(&proposal_id, &sig, &pk);

    // Submitting the exact same signature again should be rejected
    let result = client.try_submit_cold_signature(&proposal_id, &sig, &pk);
    assert_eq!(result, Err(Ok(VaultError::ColdSignatureAlreadySubmitted)));
}

#[test]
fn test_verify_cold_signatures_no_config_returns_false() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, vault) = setup(&env);
    let proposal_id = create_proposal(&env, &client, &admin, &token, &vault);

    // No cold signer config set (threshold = 0 by default)
    assert!(!client.verify_cold_signatures(&proposal_id));
}
