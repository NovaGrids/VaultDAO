//! Tests for the commit-reveal private voting scheme (Issue #1099).
use super::*;
use crate::types::{RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Bytes, BytesN, Env, Symbol, Vec,
};

// ── helpers ──────────────────────────────────────────────────────────────────

fn setup(env: &Env, threshold: u32, n_signers: usize) -> (VaultDAOClient<'_>, Vec<Address>, Address, Address) {
    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let mut signers = Vec::new(env);
    for _ in 0..n_signers {
        signers.push_back(Address::generate(env));
    }
    let recipient = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(signers.get(0).unwrap())
        .address();
    StellarAssetClient::new(env, &token).mint(&contract_id, &100_000);

    let cfg = InitConfig {
        signers: signers.clone(),
        threshold,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: 50_000,
        daily_limit: 200_000,
        weekly_limit: 500_000,
        timelock_threshold: 100_000,
        timelock_delay: 0,
        velocity_limit: VelocityConfig { limit: 1_000_000, window: 10_000, per_token_limit: 0 },
        threshold_strategy: ThresholdStrategy::Fixed,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        veto_window_ledgers: 0,
        retry_config: RetryConfig { enabled: false, max_retries: 0, initial_backoff_ledgers: 0 },
        recovery_config: RecoveryConfig::default(env),
        staking_config: types::StakingConfig::default(),
        proposal_id_prefix: 0,
    };
    client.initialize(&cfg);
    (client, signers, recipient, token)
}

/// Build a proposal with private voting enabled: commit_deadline = start + 10,
/// reveal_deadline = start + 20.  Returns the proposal_id.
fn create_private_proposal(
    env: &Env,
    client: &VaultDAOClient<'_>,
    proposer: &Address,
    recipient: &Address,
    token: &Address,
) -> u64 {
    // Create a normal proposal, then patch commit/reveal deadlines directly via storage.
    let proposal_id = client.propose_transfer(
        proposer,
        recipient,
        token,
        &1_000,
        &Symbol::new(env, "test"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::None,
        &0i128,
    ).unwrap();

    // Patch commit_deadline and reveal_deadline on the stored proposal.
    let current = env.ledger().sequence() as u64;
    let mut proposal = storage::get_proposal(env, proposal_id).unwrap();
    proposal.commit_deadline = current + 10;
    proposal.reveal_deadline = current + 20;
    storage::set_proposal(env, &proposal);
    proposal_id
}

/// Compute sha256(vote_byte || salt) off-chain inside the test environment.
fn make_commitment(env: &Env, approve: bool, salt: &[u8; 32]) -> BytesN<32> {
    let vote_byte: u8 = if approve { 1 } else { 0 };
    let mut preimage = Bytes::new(env);
    preimage.push_back(vote_byte);
    preimage.extend_from_array(salt);
    env.crypto().sha256(&preimage).into()
}

// ── tests ─────────────────────────────────────────────────────────────────────

/// 1. Commit + reveal (approve) → proposal becomes Approved after tally.
#[test]
fn test_commit_reveal_approve() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, signers, recipient, token) = setup(&env, 1, 1);
    let signer = signers.get(0).unwrap();
    let pid = create_private_proposal(&env, &client, &signer, &recipient, &token);

    let salt = [1u8; 32];
    let commitment = make_commitment(&env, true, &salt);
    client.commit_vote(&signer, &pid, &commitment).unwrap();

    // Advance past commit_deadline (100 + 10 = 110) into reveal window
    env.ledger().set_sequence_number(115);
    client.reveal_vote(&signer, &pid, &true, &BytesN::from_array(&env, &salt)).unwrap();

    // Advance past reveal_deadline (100 + 20 = 120)
    env.ledger().set_sequence_number(125);
    client.tally_private_vote(&pid).unwrap();

    let proposal = client.get_proposal(&pid).unwrap();
    assert_eq!(proposal.status, ProposalStatus::Approved);
}

/// 2. Commit + reveal (reject) → proposal becomes Rejected after tally.
#[test]
fn test_commit_reveal_reject() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, signers, recipient, token) = setup(&env, 2, 1);
    let signer = signers.get(0).unwrap();
    let pid = create_private_proposal(&env, &client, &signer, &recipient, &token);

    let salt = [2u8; 32];
    let commitment = make_commitment(&env, false, &salt);
    client.commit_vote(&signer, &pid, &commitment).unwrap();

    env.ledger().set_sequence_number(115);
    client.reveal_vote(&signer, &pid, &false, &BytesN::from_array(&env, &salt)).unwrap();

    env.ledger().set_sequence_number(125);
    client.tally_private_vote(&pid).unwrap();

    let proposal = client.get_proposal(&pid).unwrap();
    assert_eq!(proposal.status, ProposalStatus::Rejected);
}

/// 3. Signer commits but never reveals → counted as abstention, proposal Rejected.
#[test]
fn test_missing_reveal_counts_as_abstention() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    // threshold=2 so one approval is not enough
    let (client, signers, recipient, token) = setup(&env, 2, 2);
    let s0 = signers.get(0).unwrap();
    let s1 = signers.get(1).unwrap();
    let pid = create_private_proposal(&env, &client, &s0, &recipient, &token);

    let salt0 = [10u8; 32];
    client.commit_vote(&s0, &pid, &make_commitment(&env, true, &salt0)).unwrap();
    // s1 commits but never reveals
    let salt1 = [11u8; 32];
    client.commit_vote(&s1, &pid, &make_commitment(&env, true, &salt1)).unwrap();

    env.ledger().set_sequence_number(115);
    // Only s0 reveals
    client.reveal_vote(&s0, &pid, &true, &BytesN::from_array(&env, &salt0)).unwrap();

    env.ledger().set_sequence_number(125);
    client.tally_private_vote(&pid).unwrap();

    let proposal = client.get_proposal(&pid).unwrap();
    // s0 approved (1), s1 abstained (unrevealed) → 1 approval < threshold 2 → Rejected
    assert_eq!(proposal.status, ProposalStatus::Rejected);
    assert_eq!(proposal.abstentions.len(), 1);
}

/// 4. Wrong salt in reveal → CommitmentMismatch error.
#[test]
fn test_invalid_reveal_wrong_salt() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, signers, recipient, token) = setup(&env, 1, 1);
    let signer = signers.get(0).unwrap();
    let pid = create_private_proposal(&env, &client, &signer, &recipient, &token);

    let correct_salt = [5u8; 32];
    let wrong_salt = [9u8; 32];
    client.commit_vote(&signer, &pid, &make_commitment(&env, true, &correct_salt)).unwrap();

    env.ledger().set_sequence_number(115);
    let result = client.try_reveal_vote(&signer, &pid, &true, &BytesN::from_array(&env, &wrong_salt));
    assert!(result.is_err());
}

/// 5. Duplicate commit → AlreadyCommitted error.
#[test]
fn test_duplicate_commit_blocked() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, signers, recipient, token) = setup(&env, 1, 1);
    let signer = signers.get(0).unwrap();
    let pid = create_private_proposal(&env, &client, &signer, &recipient, &token);

    let salt = [3u8; 32];
    client.commit_vote(&signer, &pid, &make_commitment(&env, true, &salt)).unwrap();
    let result = client.try_commit_vote(&signer, &pid, &make_commitment(&env, true, &salt));
    assert!(result.is_err());
}

/// 6. Commit after commit_deadline → CommitPhaseClosed error.
#[test]
fn test_commit_after_deadline_fails() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, signers, recipient, token) = setup(&env, 1, 1);
    let signer = signers.get(0).unwrap();
    let pid = create_private_proposal(&env, &client, &signer, &recipient, &token);

    // Advance past commit_deadline
    env.ledger().set_sequence_number(115);
    let result = client.try_commit_vote(&signer, &pid, &make_commitment(&env, true, &[4u8; 32]));
    assert!(result.is_err());
}

/// 7. Reveal before commit_deadline → RevealPhaseNotStarted error.
#[test]
fn test_reveal_before_commit_deadline_fails() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, signers, recipient, token) = setup(&env, 1, 1);
    let signer = signers.get(0).unwrap();
    let pid = create_private_proposal(&env, &client, &signer, &recipient, &token);

    let salt = [6u8; 32];
    client.commit_vote(&signer, &pid, &make_commitment(&env, true, &salt)).unwrap();

    // Still in commit phase
    let result = client.try_reveal_vote(&signer, &pid, &true, &BytesN::from_array(&env, &salt));
    assert!(result.is_err());
}

/// 8. Reveal after reveal_deadline → RevealPhaseClosed error.
#[test]
fn test_reveal_after_reveal_deadline_fails() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, signers, recipient, token) = setup(&env, 1, 1);
    let signer = signers.get(0).unwrap();
    let pid = create_private_proposal(&env, &client, &signer, &recipient, &token);

    let salt = [7u8; 32];
    client.commit_vote(&signer, &pid, &make_commitment(&env, true, &salt)).unwrap();

    // Advance past reveal_deadline
    env.ledger().set_sequence_number(130);
    let result = client.try_reveal_vote(&signer, &pid, &true, &BytesN::from_array(&env, &salt));
    assert!(result.is_err());
}

/// 9. Tally before reveal deadline → RevealDeadlineNotPassed error.
#[test]
fn test_tally_before_reveal_deadline_fails() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, signers, recipient, token) = setup(&env, 1, 1);
    let signer = signers.get(0).unwrap();
    let pid = create_private_proposal(&env, &client, &signer, &recipient, &token);

    // Advance past commit_deadline but before reveal_deadline
    env.ledger().set_sequence_number(115);
    let result = client.try_tally_private_vote(&pid);
    assert!(result.is_err());
}

/// 10. commit_vote on a non-private proposal → PrivateVotingNotEnabled error.
#[test]
fn test_commit_on_non_private_proposal_fails() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, signers, recipient, token) = setup(&env, 1, 1);
    let signer = signers.get(0).unwrap();

    // Normal proposal (commit_deadline = 0)
    let pid = client.propose_transfer(
        &signer,
        &recipient,
        &token,
        &1_000,
        &Symbol::new(&env, "normal"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::None,
        &0i128,
    ).unwrap();

    let result = client.try_commit_vote(&signer, &pid, &make_commitment(&env, true, &[8u8; 32]));
    assert!(result.is_err());
}

/// 11. Non-signer cannot commit → NotASigner error.
#[test]
fn test_non_signer_cannot_commit() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(100);

    let (client, signers, recipient, token) = setup(&env, 1, 1);
    let signer = signers.get(0).unwrap();
    let pid = create_private_proposal(&env, &client, &signer, &recipient, &token);

    let outsider = Address::generate(&env);
    let result = client.try_commit_vote(&outsider, &pid, &make_commitment(&env, true, &[9u8; 32]));
    assert!(result.is_err());
}
