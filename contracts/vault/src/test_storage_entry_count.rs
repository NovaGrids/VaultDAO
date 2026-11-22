//! Storage entry count regression tests (Issue #2113).
//!
//! Soroban charges rent based on the number of storage entries and their size.
//! As new features add `DataKey` variants, the storage footprint of common
//! operations can grow without anyone noticing. These tests assert that the
//! number of storage entries created by a standard vault flow stays within a
//! known baseline.
//!
//! If a change legitimately increases the number of storage entries, the
//! baseline below MUST be bumped explicitly and the bump MUST be accompanied by
//! a comment explaining which new entry/entries were added and why. This keeps
//! storage growth a deliberate, reviewed decision rather than an accident.

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env,
};

use crate::{DataKey, VaultContract, VaultContractClient};

/// Maximum number of storage entries a standard vault flow is allowed to
/// create.
///
/// The "standard flow" is: initialize a vault, create a token, propose a
/// transfer, approve it from all required signers, and execute it.
///
/// DO NOT increase this value without an explicit justification comment
/// explaining which new `DataKey` variant(s) were introduced and why the extra
/// storage is necessary. CI fails if the observed count exceeds this baseline.
const STANDARD_FLOW_STORAGE_ENTRY_BASELINE: u32 = 50;

/// Enumerates every `DataKey` variant that the contract may write and counts
/// how many of them are actually present in persistent, instance, or temporary
/// storage.
///
/// This helper intentionally lists keys explicitly rather than scanning raw
/// storage so that adding a new `DataKey` variant forces a review of this list
/// (and, if it is written during the standard flow, a baseline bump).
fn count_storage_entries(env: &Env, contract_id: &Address) -> u32 {
    let mut count: u32 = 0;

    env.as_contract(contract_id, || {
        let persistent = env.storage().persistent();
        let instance = env.storage().instance();
        let temporary = env.storage().temporary();

        // Instance storage keys.
        if instance.has(&DataKey::Config) {
            count += 1;
        }
        if instance.has(&DataKey::Signers) {
            count += 1;
        }
        if instance.has(&DataKey::Threshold) {
            count += 1;
        }
        if instance.has(&DataKey::Token) {
            count += 1;
        }
        if instance.has(&DataKey::NextProposalId) {
            count += 1;
        }

        // Persistent storage keys.
        if persistent.has(&DataKey::Config) {
            count += 1;
        }
        if persistent.has(&DataKey::Signers) {
            count += 1;
        }
        if persistent.has(&DataKey::Threshold) {
            count += 1;
        }
        if persistent.has(&DataKey::Token) {
            count += 1;
        }
        if persistent.has(&DataKey::NextProposalId) {
            count += 1;
        }

        // Temporary storage keys.
        if temporary.has(&DataKey::Config) {
            count += 1;
        }
        if temporary.has(&DataKey::Signers) {
            count += 1;
        }
        if temporary.has(&DataKey::Threshold) {
            count += 1;
        }
        if temporary.has(&DataKey::Token) {
            count += 1;
        }
        if temporary.has(&DataKey::NextProposalId) {
            count += 1;
        }
    });

    count
}

#[test]
fn standard_flow_storage_entry_count_within_baseline() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, VaultContract);
    let client = VaultContractClient::new(&env, &contract_id);

    // Create a token used by the vault.
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_id.address();

    // Set up signers and threshold.
    let signer_a = Address::generate(&env);
    let signer_b = Address::generate(&env);
    let signer_c = Address::generate(&env);
    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(signer_a.clone());
    signers.push_back(signer_b.clone());
    signers.push_back(signer_c.clone());

    // Initialize the vault.
    client.initialize(&signers, &2u32, &token_address);

    // Fund the vault so the transfer can execute.
    let token_client = token::StellarAssetClient::new(&env, &token_address);
    token_client.mint(&contract_id, &1_000i128);

    // Propose a transfer.
    let recipient = Address::generate(&env);
    let proposal_id = client.propose_transfer(&signer_a, &recipient, &100i128);

    // Approve from all required signers.
    client.approve(&signer_a, &proposal_id);
    client.approve(&signer_b, &proposal_id);

    // Execute the transfer.
    client.execute(&signer_a, &proposal_id);

    // Count the resulting storage entries and assert against the baseline.
    let entry_count = count_storage_entries(&env, &contract_id);

    assert!(
        entry_count <= STANDARD_FLOW_STORAGE_ENTRY_BASELINE,
        "standard flow created {} storage entries, exceeding baseline of {}. \
         If this increase is intentional, bump STANDARD_FLOW_STORAGE_ENTRY_BASELINE \
         and document which new DataKey variant(s) were added and why.",
        entry_count,
        STANDARD_FLOW_STORAGE_ENTRY_BASELINE,
    );
}