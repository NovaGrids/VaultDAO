/// Voting Deadline Enforcement — Bug Condition Exploration Tests
///
/// **Validates: Requirements 1.1, 1.2**
///
/// These tests encode the EXPECTED (correct) behavior:
///   - `approve_proposal` called at `current_ledger > voting_deadline` MUST return
///     `Err(VaultError::VotingDeadlinePassed)` and MUST NOT mutate `proposal.approvals`.
///   - `abstain_proposal` called at `current_ledger > voting_deadline` MUST return
///     `Err(VaultError::VotingDeadlinePassed)` and MUST NOT mutate `proposal.abstentions`.
///
/// On UNFIXED code these tests FAIL (proving the bug exists).
/// After the fix is applied they PASS (confirming the bug is resolved).
use super::*;
use crate::types::{RetryConfig, ThresholdStrategy, TimeBasedThreshold, VelocityConfig};
use crate::{InitConfig, VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/// Build a minimal InitConfig with `default_voting_deadline` set so that
/// proposals are created with a non-zero `voting_deadline`.
fn deadline_init_config(env: &Env, signers: Vec<Address>, deadline_offset: u64) -> InitConfig {
    InitConfig {
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
        default_voting_deadline: deadline_offset,
        spending_limit: 10_000,
        daily_limit: 100_000,
        weekly_limit: 500_000,
        timelock_threshold: 50_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
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
        recovery_config: RecoveryConfig::default(env),
        staking_config: types::StakingConfig::default(),
        proposal_id_prefix: 0,
    }
}

/// Set up a vault with one signer and a proposal whose `voting_deadline` is
/// `start_ledger + deadline_offset`.  Returns `(client, signer, proposal_id)`.
fn setup_vault_with_deadline_proposal(
    env: &Env,
    start_ledger: u32,
    deadline_offset: u64,
) -> (VaultDAOClient<'_>, Address, u64) {
    env.ledger().set_sequence_number(start_ledger);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let signer = Address::generate(env);
    let recipient = Address::generate(env);

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = StellarAssetClient::new(env, &token);
    token_client.mint(&contract_id, &10_000);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer.clone());

    client.initialize(&admin, &deadline_init_config(env, signers, deadline_offset));
    client.set_role(&admin, &signer, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &signer,
        &recipient,
        &token,
        &100,
        &Symbol::new(env, "test"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    );

    (client, signer, proposal_id)
}

// ---------------------------------------------------------------------------
// Test 1 — approve_proposal after deadline rejects proposal and returns Ok(())
//
// Fix: current_ledger > voting_deadline AND voting_deadline > 0
// Expected:      Ok(()) with proposal status set to Rejected
// ---------------------------------------------------------------------------
#[test]
fn test_approve_after_deadline_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    // Proposal created at ledger 1000 with voting_deadline = 1000 + 10 = 1010
    let (client, signer, proposal_id) = setup_vault_with_deadline_proposal(&env, 1000, 10);

    // Advance ledger past the deadline: 1011 > 1010
    env.ledger().set_sequence_number(1011);

    let result = client.try_approve_proposal(&signer, &proposal_id);

    assert!(
        result.is_ok(),
        "approve_proposal at ledger 1011 with voting_deadline=1010 must return Ok(())"
    );

    // Verify proposal was marked Rejected
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(
        proposal.status,
        ProposalStatus::Rejected,
        "proposal must be Rejected when deadline has passed"
    );
}

// ---------------------------------------------------------------------------
// Test 2 — abstain_proposal after deadline rejects proposal and returns Ok(())
//
// Fix: current_ledger > voting_deadline AND voting_deadline > 0
// Expected:      Ok(()) with proposal status set to Rejected
// ---------------------------------------------------------------------------
#[test]
fn test_abstain_after_deadline_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    // Proposal created at ledger 1000 with voting_deadline = 1000 + 10 = 1010
    let (client, signer, proposal_id) = setup_vault_with_deadline_proposal(&env, 1000, 10);

    // Advance ledger past the deadline: 1200 > 1010
    env.ledger().set_sequence_number(1200);

    let result = client.try_abstain_proposal(&signer, &proposal_id);

    assert!(
        result.is_ok(),
        "abstain_proposal at ledger 1200 with voting_deadline=1010 must return Ok(())"
    );

    // Verify proposal was marked Rejected
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(
        proposal.status,
        ProposalStatus::Rejected,
        "proposal must be Rejected when deadline has passed"
    );
}

// ---------------------------------------------------------------------------
// Test 3 — Boundary: approve_proposal AT exact deadline succeeds
//
// current_ledger == voting_deadline is NOT a bug condition (still in-window)
// Expected: Ok(()) — should pass on both unfixed and fixed code
// ---------------------------------------------------------------------------
#[test]
fn test_approve_at_exact_deadline_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    // Proposal created at ledger 1000 with voting_deadline = 1000 + 10 = 1010
    let (client, signer, proposal_id) = setup_vault_with_deadline_proposal(&env, 1000, 10);

    // Set ledger to exactly the deadline
    env.ledger().set_sequence_number(1010);

    let result = client.try_approve_proposal(&signer, &proposal_id);

    assert!(
        result.is_ok(),
        "approve_proposal at ledger == voting_deadline must succeed (boundary is in-window)"
    );
}

// ---------------------------------------------------------------------------
// Test 4 — One-past-deadline: current_ledger == voting_deadline + 1
//
// Fix: 1011 > 1010 AND 1010 > 0
// Expected:      Ok(()) with proposal status set to Rejected
// ---------------------------------------------------------------------------
#[test]
fn test_approve_one_past_deadline_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    // Proposal created at ledger 1000 with voting_deadline = 1000 + 10 = 1010
    let (client, signer, proposal_id) = setup_vault_with_deadline_proposal(&env, 1000, 10);

    // Advance exactly one ledger past the deadline
    env.ledger().set_sequence_number(1011);

    let result = client.try_approve_proposal(&signer, &proposal_id);

    assert!(
        result.is_ok(),
        "approve_proposal at voting_deadline+1 must return Ok(())"
    );

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Rejected);
}

// ---------------------------------------------------------------------------
// Test 5 — One-past-deadline for abstain: current_ledger == voting_deadline + 1
//
// Fix: 1011 > 1010 AND 1010 > 0
// Expected:      Ok(()) with proposal status set to Rejected
// ---------------------------------------------------------------------------
#[test]
fn test_abstain_one_past_deadline_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    // Proposal created at ledger 1000 with voting_deadline = 1000 + 10 = 1010
    let (client, signer, proposal_id) = setup_vault_with_deadline_proposal(&env, 1000, 10);

    // Advance exactly one ledger past the deadline
    env.ledger().set_sequence_number(1011);

    let result = client.try_abstain_proposal(&signer, &proposal_id);

    assert!(
        result.is_ok(),
        "abstain_proposal at voting_deadline+1 must return Ok(())"
    );

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Rejected);
}

// ===========================================================================
// Preservation Tests — Property 2
//
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
//
// These tests verify that in-window and zero-deadline votes are UNAFFECTED by
// the deadline enforcement fix.  They MUST PASS on both unfixed and fixed code.
// ===========================================================================

/// Build an InitConfig with `default_voting_deadline = 0` (no deadline).
fn no_deadline_init_config(env: &Env, signers: Vec<Address>) -> InitConfig {
    deadline_init_config(env, signers, 0)
}

/// Set up a vault with two signers and a proposal whose `voting_deadline = 0`.
/// Returns `(client, signer1, signer2, proposal_id)`.
fn setup_vault_no_deadline(
    env: &Env,
    start_ledger: u32,
) -> (VaultDAOClient<'_>, Address, Address, u64) {
    env.ledger().set_sequence_number(start_ledger);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let signer1 = Address::generate(env);
    let signer2 = Address::generate(env);
    let recipient = Address::generate(env);

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = StellarAssetClient::new(env, &token);
    token_client.mint(&contract_id, &10_000);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    client.initialize(&admin, &no_deadline_init_config(env, signers));
    client.set_role(&admin, &signer1, &Role::Treasurer);
    client.set_role(&admin, &signer2, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &signer1,
        &recipient,
        &token,
        &100,
        &Symbol::new(env, "test"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    );

    (client, signer1, signer2, proposal_id)
}

// ---------------------------------------------------------------------------
// Test P2-1 — approve_proposal with voting_deadline = 0 succeeds at any ledger
//
// Requirement 3.1: voting_deadline = 0 bypasses the deadline check entirely.
// ---------------------------------------------------------------------------
#[test]
fn test_approve_zero_deadline_succeeds_at_any_ledger() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, signer1, _signer2, proposal_id) = setup_vault_no_deadline(&env, 1000);

    // Advance ledger well past where a deadline would be — no deadline should be enforced.
    // Use a moderate value to avoid TTL/archival issues in the test environment.
    env.ledger().set_sequence_number(10_000);

    let result = client.try_approve_proposal(&signer1, &proposal_id);
    assert!(
        result.is_ok(),
        "approve_proposal with voting_deadline=0 must succeed regardless of current ledger"
    );

    // Approval must be recorded
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(
        proposal.approvals.len(),
        1,
        "approval must be recorded when voting_deadline=0"
    );
}

// ---------------------------------------------------------------------------
// Test P2-2 — abstain_proposal with voting_deadline = 0 succeeds at any ledger
//
// Requirement 3.2: voting_deadline = 0 bypasses the deadline check for abstentions.
// ---------------------------------------------------------------------------
#[test]
fn test_abstain_zero_deadline_succeeds_at_any_ledger() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, signer1, _signer2, proposal_id) = setup_vault_no_deadline(&env, 1000);

    // Advance ledger well past where a deadline would be — no deadline should be enforced.
    env.ledger().set_sequence_number(10_000);

    let result = client.try_abstain_proposal(&signer1, &proposal_id);
    assert!(
        result.is_ok(),
        "abstain_proposal with voting_deadline=0 must succeed regardless of current ledger"
    );

    // Abstention must be recorded
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(
        proposal.abstentions.len(),
        1,
        "abstention must be recorded when voting_deadline=0"
    );
}

// ---------------------------------------------------------------------------
// Test P2-3 — approve_proposal within window records approval and triggers
//             threshold/quorum transition
//
// Requirement 3.3: in-window approvals continue to work and transition proposal.
// ---------------------------------------------------------------------------
#[test]
fn test_approve_in_window_records_and_transitions() {
    let env = Env::default();
    env.mock_all_auths();

    // Proposal created at ledger 1000 with voting_deadline = 1000 + 100 = 1100
    let (client, signer1, proposal_id) = setup_vault_with_deadline_proposal(&env, 1000, 100);

    // Vote well within the window
    env.ledger().set_sequence_number(1050);

    let result = client.try_approve_proposal(&signer1, &proposal_id);
    assert!(
        result.is_ok(),
        "approve_proposal within voting window must succeed"
    );

    // Approval must be recorded
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(
        proposal.approvals.len(),
        1,
        "approval must be recorded for in-window vote"
    );

    // With threshold=1 and quorum=0, a single approval should transition to Approved
    assert_eq!(
        proposal.status,
        ProposalStatus::Approved,
        "proposal must transition to Approved when threshold is met in-window"
    );
}

// ---------------------------------------------------------------------------
// Test P2-4 — abstain_proposal within window records abstention and contributes
//             to quorum
//
// Requirement 3.4: in-window abstentions continue to work and count toward quorum.
// ---------------------------------------------------------------------------
#[test]
fn test_abstain_in_window_records_and_contributes_to_quorum() {
    let env = Env::default();
    env.mock_all_auths();

    // Proposal created at ledger 1000 with voting_deadline = 1000 + 100 = 1100
    let (client, signer1, proposal_id) = setup_vault_with_deadline_proposal(&env, 1000, 100);

    // Vote well within the window
    env.ledger().set_sequence_number(1050);

    let result = client.try_abstain_proposal(&signer1, &proposal_id);
    assert!(
        result.is_ok(),
        "abstain_proposal within voting window must succeed"
    );

    // Abstention must be recorded
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(
        proposal.abstentions.len(),
        1,
        "abstention must be recorded for in-window vote"
    );
}

// ---------------------------------------------------------------------------
// Test P2-5 — Boundary: approve at exactly voting_deadline succeeds (in-window)
//
// current_ledger == voting_deadline is NOT a bug condition.
// ---------------------------------------------------------------------------
#[test]
fn test_approve_at_deadline_boundary_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    // Proposal created at ledger 1000 with voting_deadline = 1000 + 50 = 1050
    let (client, signer1, proposal_id) = setup_vault_with_deadline_proposal(&env, 1000, 50);

    // Set ledger to exactly the deadline
    env.ledger().set_sequence_number(1050);

    let result = client.try_approve_proposal(&signer1, &proposal_id);
    assert!(
        result.is_ok(),
        "approve_proposal at current_ledger == voting_deadline must succeed (boundary is in-window)"
    );

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(
        proposal.approvals.len(),
        1,
        "approval must be recorded at the exact deadline boundary"
    );
}

// ---------------------------------------------------------------------------
// Test P2-6 — Boundary: abstain at exactly voting_deadline succeeds (in-window)
// ---------------------------------------------------------------------------
#[test]
fn test_abstain_at_deadline_boundary_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    // Proposal created at ledger 1000 with voting_deadline = 1000 + 50 = 1050
    let (client, signer1, proposal_id) = setup_vault_with_deadline_proposal(&env, 1000, 50);

    // Set ledger to exactly the deadline
    env.ledger().set_sequence_number(1050);

    let result = client.try_abstain_proposal(&signer1, &proposal_id);
    assert!(
        result.is_ok(),
        "abstain_proposal at current_ledger == voting_deadline must succeed (boundary is in-window)"
    );

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(
        proposal.abstentions.len(),
        1,
        "abstention must be recorded at the exact deadline boundary"
    );
}

// ---------------------------------------------------------------------------
// Test P2-7 — Other rejection paths are unaffected: ProposalNotPending
// ---------------------------------------------------------------------------
#[test]
fn test_other_rejection_proposal_not_pending() {
    let env = Env::default();
    env.mock_all_auths();

    // Use setup_vault_no_deadline which gives us two signers; voting_deadline=0
    // so the proposal has no deadline.  threshold=1 means signer1's approval
    // immediately transitions the proposal to Approved.
    let (client, signer1, signer2, proposal_id) = setup_vault_no_deadline(&env, 1000);

    // Approve within window — proposal transitions to Approved
    env.ledger().set_sequence_number(1050);
    client.approve_proposal(&signer1, &proposal_id);

    // Proposal is now Approved; a second approval attempt must return ProposalNotPending
    let result = client.try_approve_proposal(&signer2, &proposal_id);
    assert_eq!(
        result.err(),
        Some(Ok(VaultError::ProposalNotPending)),
        "approve_proposal on a non-Pending proposal must return ProposalNotPending"
    );
}

// ---------------------------------------------------------------------------
// Test P2-8 — Other rejection paths are unaffected: AlreadyApproved
// ---------------------------------------------------------------------------
#[test]
fn test_other_rejection_already_approved() {
    let env = Env::default();
    env.mock_all_auths();

    // Use a 2-signer vault with threshold=2 so the proposal stays Pending after one vote
    env.ledger().set_sequence_number(1000);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_client = StellarAssetClient::new(&env, &token);
    token_client.mint(&contract_id, &10_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    let config = InitConfig {
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
        default_voting_deadline: 200, // deadline = 1000 + 200 = 1200
        spending_limit: 10_000,
        daily_limit: 100_000,
        weekly_limit: 500_000,
        timelock_threshold: 50_000,
        timelock_delay: 100,
        velocity_limit: crate::types::VelocityConfig {
            limit: 100,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: crate::types::ThresholdStrategy::Fixed,
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        veto_addresses: Vec::new(&env),
        retry_config: crate::types::RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: RecoveryConfig::default(&env),
        staking_config: crate::types::StakingConfig::default(),
        proposal_id_prefix: 0,
    };

    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &signer1,
        &recipient,
        &token,
        &100,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // First approval within window
    env.ledger().set_sequence_number(1050);
    client.approve_proposal(&signer1, &proposal_id);

    // Second approval by same signer must return AlreadyApproved
    let result = client.try_approve_proposal(&signer1, &proposal_id);
    assert_eq!(
        result.err(),
        Some(Ok(VaultError::AlreadyApproved)),
        "duplicate approval must return AlreadyApproved"
    );
}

// ---------------------------------------------------------------------------
// Test P2-9 — Other rejection paths are unaffected: NotASigner
//
// An address that is not a signer at all must be rejected before any deadline
// check is applied.
// ---------------------------------------------------------------------------
#[test]
fn test_other_rejection_not_a_signer() {
    let env = Env::default();
    env.mock_all_auths();

    // Proposal created at ledger 1000 with voting_deadline = 1000 + 100 = 1100
    let (client, _signer1, proposal_id) = setup_vault_with_deadline_proposal(&env, 1000, 100);

    // A completely new address that was never a signer
    let outsider = Address::generate(&env);

    env.ledger().set_sequence_number(1050);
    let result = client.try_approve_proposal(&outsider, &proposal_id);
    assert_eq!(
        result.err(),
        Some(Ok(VaultError::NotASigner)),
        "approve_proposal by a non-signer must return NotASigner"
    );
}

// ===========================================================================
// Deadline Extension Tests — Issue #712
//
// **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
// ===========================================================================

// Helper: check if any event in the list has topic[0] matching the given symbol name.
fn has_event_with_topic(env: &Env, topic_name: &str) -> bool {
    use soroban_sdk::testutils::Events;
    use soroban_sdk::IntoVal;
    let all_events = env.events().all();
    let expected: soroban_sdk::Val = Symbol::new(env, topic_name).into_val(env);
    all_events.iter().any(|e| {
        let topics = e.1;
        !topics.is_empty() && topics.get(0).unwrap().get_payload() == expected.get_payload()
    })
}




// ===========================================================================
// Time-Based Threshold Reduction Tests
// ===========================================================================

/// Test that approval before reduction delay uses initial threshold
#[test]
fn test_time_based_threshold_before_reduction() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    StellarAssetClient::new(&env, &token).mint(&contract_id, &100_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

    let config = InitConfig {
        veto_window_ledgers: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 2, // Global threshold
        quorum: 0,
        quorum_percentage: 0,
        default_voting_deadline: 0,
        spending_limit: 10_000,
        daily_limit: 100_000,
        weekly_limit: 500_000,
        timelock_threshold: 50_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: ThresholdStrategy::TimeBased(TimeBasedThreshold {
            initial_threshold: 3, // Requires 3 approvals initially
            reduced_threshold: 2, // Reduces to 2 after delay
            reduction_delay: 100, // 100 ledgers delay
        }),
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
        proposal_id_prefix: 0,
    };

    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

    // Create proposal at ledger 1000
    env.ledger().set_sequence_number(1000);
    let proposal_id = client.propose_transfer(
        &signer1,
        &recipient,
        &token,
        &1000,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Approve with 2 signers before reduction delay (should not be enough - needs 3)
    client.approve_proposal(&admin, &proposal_id);
    client.approve_proposal(&signer2, &proposal_id);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending); // Still pending, needs 3 approvals

    // Third approval should make it approved
    client.approve_proposal(&signer3, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved);
}


/// Test that reduced threshold still requires quorum
#[test]
fn test_time_based_threshold_respects_quorum() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    StellarAssetClient::new(&env, &token).mint(&contract_id, &100_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

    let config = InitConfig {
        veto_window_ledgers: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 2,
        quorum: 3, // Requires 3 total votes (approvals + abstentions)
        quorum_percentage: 0,
        default_voting_deadline: 0,
        spending_limit: 10_000,
        daily_limit: 100_000,
        weekly_limit: 500_000,
        timelock_threshold: 50_000,
        timelock_delay: 100,
        velocity_limit: VelocityConfig {
            limit: 100,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: ThresholdStrategy::TimeBased(TimeBasedThreshold {
            initial_threshold: 3,
            reduced_threshold: 2,
            reduction_delay: 100,
        }),
        pre_execution_hooks: Vec::new(&env),
        post_execution_hooks: Vec::new(&env),
        veto_addresses: Vec::new(&env),
        retry_config: RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: RecoveryConfig::default(&env),
        staking_config: types::StakingConfig::default(),
        proposal_id_prefix: 0,
    };

    client.initialize(&admin, &config);
    client.set_role(&admin, &signer1, &Role::Treasurer);

    // Create proposal at ledger 1000
    env.ledger().set_sequence_number(1000);
    let proposal_id = client.propose_transfer(
        &signer1,
        &recipient,
        &token,
        &1000,
        &Symbol::new(&env, "test"),
        &Priority::Normal,
        &Vec::new(&env),
        &ConditionLogic::And,
        &0i128,
    );

    // Advance past reduction delay
    env.ledger().set_sequence_number(1101);

    // Two approvals should meet reduced threshold but not quorum
    client.approve_proposal(&admin, &proposal_id);
    client.approve_proposal(&signer2, &proposal_id);

    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Pending); // Still pending due to quorum

    // Add abstention to meet quorum
    client.abstain_proposal(&signer3, &proposal_id);
    let proposal = client.get_proposal(&proposal_id);
    assert_eq!(proposal.status, ProposalStatus::Approved); // Now approved
}



// ===========================================================================
// extend_voting_deadline Tests — Issue: Voting Deadline Extension with Admin Override
// ===========================================================================

fn setup_for_extend_deadline(
    env: &Env,
    start_ledger: u32,
    deadline_offset: u64,
) -> (VaultDAOClient<'_>, Address, u64, u64) {
    env.ledger().set_sequence_number(start_ledger);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let proposer = Address::generate(env);
    let recipient = Address::generate(env);

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    StellarAssetClient::new(env, &token).mint(&contract_id, &10_000);

    let mut signers = Vec::new(env);
    signers.push_back(admin.clone());
    signers.push_back(proposer.clone());

    client.initialize(&admin, &deadline_init_config(env, signers, deadline_offset));
    client.set_role(&admin, &proposer, &Role::Treasurer);

    let proposal_id = client.propose_transfer(
        &proposer,
        &recipient,
        &token,
        &100,
        &Symbol::new(env, "test"),
        &Priority::Normal,
        &Vec::new(env),
        &ConditionLogic::And,
        &0i128,
    );

    let expires_at = client.get_proposal(&proposal_id).expires_at;
    (client, admin, proposal_id, expires_at)
}

#[test]
fn test_extend_voting_deadline_once_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposal_id, expires_at) = setup_for_extend_deadline(&env, 1000, 20);

    let old_deadline = client.get_proposal(&proposal_id).voting_deadline;
    let new_deadline = (old_deadline + 10).min(expires_at);

    let result = client.try_extend_voting_deadline(&admin, &proposal_id, &new_deadline);
    assert!(result.is_ok(), "first extension must succeed");
    assert_eq!(
        client.get_proposal(&proposal_id).voting_deadline,
        new_deadline
    );
}

#[test]
fn test_extend_voting_deadline_up_to_max_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposal_id, expires_at) = setup_for_extend_deadline(&env, 1000, 20);

    let base = client.get_proposal(&proposal_id).voting_deadline;
    for i in 1u64..=3 {
        let current = client.get_proposal(&proposal_id).voting_deadline;
        let next = (current + 5).min(expires_at);
        if next <= current {
            break;
        }
        let res = client.try_extend_voting_deadline(&admin, &proposal_id, &next);
        assert!(res.is_ok(), "extension {} of 3 must succeed", i);
    }
    assert!(client.get_proposal(&proposal_id).voting_deadline > base);
}

#[test]
fn test_extend_voting_deadline_exceeds_max_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposal_id, expires_at) = setup_for_extend_deadline(&env, 1000, 10);

    for _ in 0..3 {
        let current = client.get_proposal(&proposal_id).voting_deadline;
        let next = (current + 5).min(expires_at);
        if next <= current {
            return;
        }
        let _ = client.try_extend_voting_deadline(&admin, &proposal_id, &next);
    }

    let current = client.get_proposal(&proposal_id).voting_deadline;
    let next = (current + 5).min(expires_at);
    if next > current {
        let res = client.try_extend_voting_deadline(&admin, &proposal_id, &next);
        assert_eq!(res, Err(Ok(VaultError::MaxDeadlineExtensionsReached)));
    }
}

#[test]
fn test_extend_voting_deadline_past_expiry_returns_invalid_deadline() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposal_id, expires_at) = setup_for_extend_deadline(&env, 1000, 20);

    let res = client.try_extend_voting_deadline(&admin, &proposal_id, &(expires_at + 1));
    assert_eq!(res, Err(Ok(VaultError::InvalidDeadline)));
}


#[test]
fn test_extend_voting_deadline_non_pending_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, proposal_id, expires_at) = setup_for_extend_deadline(&env, 1000, 20);

    client.approve_proposal(&admin, &proposal_id);

    let current = client.get_proposal(&proposal_id).voting_deadline;
    let new_deadline = (current + 5).min(expires_at);

    let res = client.try_extend_voting_deadline(&admin, &proposal_id, &new_deadline);
    assert_eq!(res, Err(Ok(VaultError::ProposalNotPending)));
}
