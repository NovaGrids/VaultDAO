//! End-to-end tests for governance config changes affecting active proposals (Issue #2114).
//!
//! These tests exercise the full governance flow: a config change is proposed,
//! approved, and executed, and the resulting configuration is then verified to
//! gate subsequent proposals according to the new rules.

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Vec,
};

use crate::{
    config::{Config, ConfigChange, ConfigChangeType},
    errors::Error,
    storage::DataKey,
    types::{Proposal, ProposalStatus, ProposalType, VaultState},
    VaultContract, VaultContractClient,
};

/// Helper: set up a vault with `signers` signers, the given threshold and quorum.
fn setup_vault(
    env: &Env,
    signers: &Vec<Address>,
    threshold: u32,
    quorum: u32,
) -> (Address, VaultContractClient<'_>) {
    let contract_id = env.register_contract(None, VaultContract);
    let client = VaultContractClient::new(env, &contract_id);

    let admin = signers.get(0).unwrap();
    client.initialize(&admin, signers, &threshold, &quorum);

    (contract_id, client)
}

/// Helper: build a simple transfer proposal.
fn make_transfer_proposal(env: &Env, recipient: &Address, amount: i128) -> Proposal {
    Proposal {
        id: 0,
        proposal_type: ProposalType::Transfer {
            recipient: recipient.clone(),
            amount,
        },
        proposer: recipient.clone(),
        status: ProposalStatus::Pending,
        approvals: Vec::new(env),
        created_at: env.ledger().timestamp(),
    }
}

/// Helper: propose, approve (with all signers), and execute a config change.
fn execute_config_change(
    env: &Env,
    client: &VaultContractClient<'_>,
    signers: &Vec<Address>,
    change: ConfigChange,
) {
    let proposer = signers.get(0).unwrap();
    let proposal_id = client.propose_config_change(&proposer, &change);

    // Approve with every signer so the config-change proposal itself passes
    // regardless of the current threshold/quorum.
    for signer in signers.iter() {
        client.approve_config_change(&signer, &proposal_id);
    }

    client.execute_config_change(&proposer, &proposal_id);

    // Sanity check: the config change executed successfully.
    let cfg = client.get_config();
    match change.change_type {
        ConfigChangeType::Threshold => {
            assert_eq!(cfg.threshold, change.new_value as u32);
        }
        ConfigChangeType::Quorum => {
            assert_eq!(cfg.quorum, change.new_value as u32);
        }
    }
}

#[test]
fn test_threshold_change_gates_subsequent_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let signers = Vec::from_array(
        &env,
        [
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
        ],
    );

    // Start with a high threshold (3 of 3).
    let (_contract_id, client) = setup_vault(&env, &signers, 3, 0);

    let recipient = Address::generate(&env);
    let amount: i128 = 100;

    // --- Phase 1: proposal is rejected under the OLD (high) threshold. ---
    let proposal = make_transfer_proposal(&env, &recipient, amount);
    let proposal_id = client.propose_transfer(&signers.get(0).unwrap(), &recipient, &amount);

    // Only two of three signers approve; under threshold=3 this is insufficient.
    client.approve_transfer(&signers.get(0).unwrap(), &proposal_id);
    client.approve_transfer(&signers.get(1).unwrap(), &proposal_id);

    // Attempting to execute should fail because the threshold is not met.
    let result = client.try_execute_transfer(&signers.get(0).unwrap(), &proposal_id);
    assert_eq!(result, Err(Ok(Error::ThresholdNotMet)));

    // Proposal remains pending.
    let stored = client.get_proposal(&proposal_id);
    assert_eq!(stored.status, ProposalStatus::Pending);

    // --- Phase 2: lower the threshold via governance. ---
    let change = ConfigChange {
        change_type: ConfigChangeType::Threshold,
        new_value: 2,
    };
    execute_config_change(&env, &client, &signers, change);

    // --- Phase 3: resubmit the same proposal; it now passes under threshold=2. ---
    let proposal_id2 = client.propose_transfer(&signers.get(0).unwrap(), &recipient, &amount);
    client.approve_transfer(&signers.get(0).unwrap(), &proposal_id2);
    client.approve_transfer(&signers.get(1).unwrap(), &proposal_id2);

    // Execution should now succeed.
    client.execute_transfer(&signers.get(0).unwrap(), &proposal_id2);

    let stored2 = client.get_proposal(&proposal_id2);
    assert_eq!(stored2.status, ProposalStatus::Executed);

    // Silence unused-variable warning for the helper-built proposal.
    let _ = proposal;
}

#[test]
fn test_quorum_change_gates_subsequent_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let signers = Vec::from_array(
        &env,
        [
            Address::generate(&env),
            Address::generate(&env),
            Address::generate(&env),
        ],
    );

    // Start with a low quorum (0) and a low threshold (1) so that a single
    // approval is enough under the old config.
    let (_contract_id, client) = setup_vault(&env, &signers, 1, 0);

    let recipient = Address::generate(&env);
    let amount: i128 = 50;

    // --- Phase 1: a proposal passes under the OLD (low) quorum. ---
    let proposal_id = client.propose_transfer(&signers.get(0).unwrap(), &recipient, &amount);
    client.approve_transfer(&signers.get(0).unwrap(), &proposal_id);
    client.execute_transfer(&signers.get(0).unwrap(), &proposal_id);

    let stored = client.get_proposal(&proposal_id);
    assert_eq!(stored.status, ProposalStatus::Executed);

    // --- Phase 2: raise the quorum via governance. ---
    let change = ConfigChange {
        change_type: ConfigChangeType::Quorum,
        new_value: 3,
    };
    execute_config_change(&env, &client, &signers, change);

    // --- Phase 3: a new proposal is now gated by the NEW (high) quorum. ---
    let proposal_id2 = client.propose_transfer(&signers.get(0).unwrap(), &recipient, &amount);

    // Only one approval: threshold (1) is met, but quorum (3) is not.
    client.approve_transfer(&signers.get(0).unwrap(), &proposal_id2);

    let result = client.try_execute_transfer(&signers.get(0).unwrap(), &proposal_id2);
    assert_eq!(result, Err(Ok(Error::QuorumNotMet)));

    let stored2 = client.get_proposal(&proposal_id2);
    assert_eq!(stored2.status, ProposalStatus::Pending);

    // Add remaining approvals to satisfy the new quorum.
    client.approve_transfer(&signers.get(1).unwrap(), &proposal_id2);
    client.approve_transfer(&signers.get(2).unwrap(), &proposal_id2);

    // Now execution succeeds.
    client.execute_transfer(&signers.get(0).unwrap(), &proposal_id2);

    let stored3 = client.get_proposal(&proposal_id2);
    assert_eq!(stored3.status, ProposalStatus::Executed);
}