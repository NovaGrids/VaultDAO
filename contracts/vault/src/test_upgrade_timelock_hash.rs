//! Unit tests for pinned upgrade timelocks and hash integrity (Issue #2063).
//!
//! Covers:
//!   - proposal pins the WASM hash and the earliest apply ledger;
//!   - early execution is rejected;
//!   - execution with a different hash is rejected;
//!   - cancellation clears the pin and blocks execution;
//!   - successful execution deploys the pinned hash and emits apply events.

#![cfg(test)]

use crate::errors::VaultError;
use crate::types::{InitConfig, PendingUpgrade, ProposalStatus, RetryConfig, VelocityConfig};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, BytesN, Env, String, Symbol, Vec,
};

const MIN_UPGRADE_TIMELOCK: u64 = 17_280;
const START_LEDGER: u64 = 100;

fn make_config(env: &Env, signers: Vec<Address>, upgrade_delay: u64) -> InitConfig {
    InitConfig {
        signers,
        threshold: 2,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 1_000,
        daily_limit: 5_000,
        weekly_limit: 10_000,
        timelock_threshold: 500,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
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
        high_impact_threshold: 70,
        admin_rotation_delay: 1_440,
        upgrade_timelock_delay: upgrade_delay,
    }
}

fn upload_test_wasm(env: &Env) -> BytesN<32> {
    // A minimal, valid empty WASM module. The host only needs the hash to be
    // registered in ledger state; the module does not need to export anything.
    let wasm = [0u8, 97, 115, 109, 1, 0, 0, 0];
    env.deployer().upload_contract_wasm(wasm.as_slice())
}

fn hex_hash(env: &Env, hash: &BytesN<32>) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let bytes = hash.to_array();
    let mut chars = [0u8; 64];
    for (index, byte) in bytes.iter().enumerate() {
        chars[index * 2] = HEX[(byte >> 4) as usize];
        chars[index * 2 + 1] = HEX[(byte & 0x0f) as usize];
    }
    String::from_str(env, core::str::from_utf8(&chars).unwrap_or(""))
}

fn has_event(env: &Env, name: &str, proposal_id: u64) -> bool {
    let topic = Symbol::new(env, name);
    env.events().all().iter().any(|(_, topics, _)| {
        let matches_name = topics
            .first()
            .and_then(|value| Symbol::try_from_val(env, &value).ok())
            .map(|symbol| symbol == topic)
            .unwrap_or(false);
        let matches_id = topics
            .get(1)
            .and_then(|value| u64::try_from_val(env, &value).ok())
            == Some(proposal_id);
        matches_name && matches_id
    })
}

fn setup(env: &Env, upgrade_delay: u64) -> (VaultDAOClient, Address, Address) {
    env.mock_all_auths();
    env.ledger()
        .with_mut(|ledger| ledger.sequence_number = START_LEDGER as u32);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let signer = Address::generate(env);
    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    client.initialize(&admin, &make_config(env, signers, upgrade_delay));
    (client, admin, signer)
}

#[test]
fn propose_upgrade_pins_hash_and_earliest_apply_ledger() {
    let env = Env::default();
    let (client, admin, _signer) = setup(&env, MIN_UPGRADE_TIMELOCK);
    let wasm_hash = upload_test_wasm(&env);
    env.events().all(); // flush initialize events

    let proposal_id = client.propose_upgrade(&admin, &wasm_hash);
    let pending = client
        .get_pending_upgrade()
        .expect("upgrade should be pinned");

    assert_eq!(
        pending,
        PendingUpgrade {
            proposal_id,
            wasm_hash: wasm_hash.clone(),
            earliest_apply_ledger: START_LEDGER + MIN_UPGRADE_TIMELOCK,
            proposer: admin.clone(),
        }
    );

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.unlock_ledger, pending.earliest_apply_ledger);
    assert_eq!(
        proposal.metadata.get(Symbol::new(&env, "wasm_hash")),
        Some(hex_hash(&env, &wasm_hash))
    );
    assert!(has_event(&env, "upgrade_proposed", proposal_id));
}

#[test]
fn execute_upgrade_rejects_early_application() {
    let env = Env::default();
    let (client, admin, signer) = setup(&env, MIN_UPGRADE_TIMELOCK);
    let wasm_hash = upload_test_wasm(&env);
    let proposal_id = client.propose_upgrade(&admin, &wasm_hash);

    client.approve_proposal(&admin, &proposal_id);
    client.approve_proposal(&signer, &proposal_id);
    assert_eq!(
        client.get_proposal(&proposal_id).status,
        ProposalStatus::Approved
    );

    let result = client.try_execute_upgrade(&admin, &proposal_id, &wasm_hash);
    assert_eq!(result.err(), Some(Ok(VaultError::UpgradeTimelockActive)));
}

#[test]
fn execute_upgrade_rejects_hash_mismatch() {
    let env = Env::default();
    let (client, admin, signer) = setup(&env, MIN_UPGRADE_TIMELOCK);
    let wasm_hash = upload_test_wasm(&env);
    let proposal_id = client.propose_upgrade(&admin, &wasm_hash);

    client.approve_proposal(&admin, &proposal_id);
    client.approve_proposal(&signer, &proposal_id);
    env.ledger().with_mut(|ledger| {
        ledger.sequence_number = (START_LEDGER + MIN_UPGRADE_TIMELOCK) as u32;
    });

    let wrong_hash = BytesN::from_array(&env, &[1u8; 32]);
    let result = client.try_execute_upgrade(&admin, &proposal_id, &wrong_hash);
    assert_eq!(result.err(), Some(Ok(VaultError::UpgradeHashMismatch)));
}

#[test]
fn cancel_upgrade_clears_pending_and_blocks_execution() {
    let env = Env::default();
    let (client, admin, _signer) = setup(&env, MIN_UPGRADE_TIMELOCK);
    let wasm_hash = upload_test_wasm(&env);
    let proposal_id = client.propose_upgrade(&admin, &wasm_hash);
    env.events().all(); // flush propose events

    client.cancel_upgrade(&admin, &proposal_id);

    assert!(client.get_pending_upgrade().is_none());
    assert_eq!(
        client.get_proposal(&proposal_id).status,
        ProposalStatus::Cancelled
    );
    assert!(has_event(&env, "upgrade_cancelled", proposal_id));

    env.ledger().with_mut(|ledger| {
        ledger.sequence_number = (START_LEDGER + MIN_UPGRADE_TIMELOCK) as u32;
    });
    let result = client.try_execute_upgrade(&admin, &proposal_id, &wasm_hash);
    assert_eq!(result.err(), Some(Ok(VaultError::UpgradeNotFound)));
}

#[test]
fn propose_upgrade_rejects_short_configured_timelock() {
    let env = Env::default();
    // Initialize with a short delay by bypassing initialize validation and
    // writing the config directly through the SDK's storage view.
    env.mock_all_auths();
    env.ledger()
        .with_mut(|ledger| ledger.sequence_number = START_LEDGER as u32);
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signer = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());
    client.initialize(&admin, &make_config(&env, signers, MIN_UPGRADE_TIMELOCK));

    // Guards are defence in depth: initialize already rejects short delays.
    // A legacy vault can still be migrated into a state with a shorter delay,
    // so propose_upgrade must refuse to pin an unsafe ledger.
    env.as_contract(&contract_id, || {
        let mut config = crate::storage::get_config_unchecked(&env).unwrap();
        config.upgrade_timelock_delay = MIN_UPGRADE_TIMELOCK - 1;
        crate::storage::set_config(&env, &config);
    });

    let wasm_hash = upload_test_wasm(&env);
    let result = client.try_propose_upgrade(&admin, &wasm_hash);
    assert_eq!(result.err(), Some(Ok(VaultError::UpgradeTimelockTooShort)));
}

#[test]
fn execute_upgrade_applies_pinned_hash_and_emits_event() {
    let env = Env::default();
    let (client, admin, signer) = setup(&env, MIN_UPGRADE_TIMELOCK);
    let wasm_hash = upload_test_wasm(&env);
    let proposal_id = client.propose_upgrade(&admin, &wasm_hash);

    client.approve_proposal(&admin, &proposal_id);
    client.approve_proposal(&signer, &proposal_id);
    env.ledger().with_mut(|ledger| {
        ledger.sequence_number = (START_LEDGER + MIN_UPGRADE_TIMELOCK) as u32;
    });
    env.events().all(); // flush approval events

    let result = client.try_execute_upgrade(&admin, &proposal_id, &wasm_hash);
    assert!(result.is_ok(), "expected the pinned upgrade to apply");
    assert!(has_event(&env, "upgrade_applied", proposal_id));
}
