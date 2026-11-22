//! Tests for Issue #2051: bridge receipt confirmer with reserved funds,
//! timeout unlock, conflicting-receipt rejection and fraud-proof disputes.

use crate::errors::VaultError;
use crate::types::{BridgeReceiptConfig, BridgeStatus, InitConfig, RetryConfig, ThresholdStrategy, VelocityConfig};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Bytes, BytesN, Env, Vec,
};

mod accepting_verifier {
    use soroban_sdk::{contract, contractimpl, Bytes, BytesN, Env};

    /// Fraud-proof verifier that accepts a proof iff its first byte is 1.
    #[contract]
    pub struct MockFraudVerifier;

    #[contractimpl]
    impl MockFraudVerifier {
        pub fn verify_bridge_fraud_proof(
            _env: Env,
            _bridge_id: BytesN<32>,
            _claimed_amount: i128,
            proof: Bytes,
        ) -> bool {
            proof.len() > 0 && proof.get(0) == Some(1)
        }
    }
}

mod trapping_verifier {
    use soroban_sdk::{contract, contractimpl, Bytes, BytesN, Env};

    /// Verifier that always traps.
    #[contract]
    pub struct TrappingFraudVerifier;

    #[contractimpl]
    impl TrappingFraudVerifier {
        pub fn verify_bridge_fraud_proof(
            _env: Env,
            _bridge_id: BytesN<32>,
            _claimed_amount: i128,
            _proof: Bytes,
        ) -> bool {
            panic!("verifier down")
        }
    }
}

use accepting_verifier::MockFraudVerifier;
use trapping_verifier::TrappingFraudVerifier;

struct Setup<'a> {
    env: Env,
    client: VaultDAOClient<'a>,
    vault: Address,
    admin: Address,
    target: Address,
    token: Address,
}

fn setup() -> Setup<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let vault = env.register(VaultDAO, ());
    let target = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &vault);
    let admin = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(Address::generate(&env));
    client.initialize(
        &admin,
        &InitConfig {
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
            spending_limit: 100_000,
            daily_limit: 500_000,
            weekly_limit: 1_000_000,
            timelock_threshold: 0,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 1_000_000,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            default_voting_deadline: 0,
            veto_addresses: Vec::new(&env),
            retry_config: RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: crate::types::RecoveryConfig::default(&env),
            staking_config: crate::types::StakingConfig::default(),
            proposal_id_prefix: 0,
            pre_execution_hooks: Vec::new(&env),
            post_execution_hooks: Vec::new(&env),
        },
    );

    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    StellarAssetClient::new(&env, &token).mint(&vault, &1_000);

    Setup {
        env,
        client,
        vault,
        admin,
        target,
        token,
    }
}

fn start_bridge(s: &Setup, amount: i128) -> (BytesN<32>, u64) {
    let deadline = s.env.ledger().sequence() as u64 + 100;
    let id = s
        .client
        .bridge_to_vault(&s.admin, &s.target, &s.token, &amount, &(amount - 5), &deadline);
    (id, deadline)
}

fn balance(s: &Setup, who: &Address) -> i128 {
    TokenClient::new(&s.env, &s.token).balance(who)
}

fn set_window(s: &Setup, window: u64, verifier: Option<Address>) {
    s.client.set_bridge_receipt_config(
        &s.admin,
        &BridgeReceiptConfig {
            fraud_proof_verifier: verifier,
            challenge_window_ledgers: window,
        },
    );
}

fn advance(s: &Setup, ledgers: u32) {
    s.env
        .ledger()
        .with_mut(|li| li.sequence_number += ledgers);
}

// ── Initiate ────────────────────────────────────────────────────────────────

#[test]
fn test_initiate_reserves_funds_without_sending() {
    let s = setup();
    let (id, _) = start_bridge(&s, 100);

    assert_eq!(balance(&s, &s.vault), 1_000);
    assert_eq!(balance(&s, &s.target), 0);
    assert_eq!(s.client.get_reserved_bridge_balance(&s.token), 100);
    assert_eq!(
        s.client.get_bridge_record(&id).unwrap().status,
        BridgeStatus::Initiated
    );
}

#[test]
fn test_initiate_cannot_reserve_more_than_available() {
    let s = setup();
    // 950 reserved by one bridge; a second 100 would exceed the 1_000 balance.
    let deadline = s.env.ledger().sequence() as u64 + 100;
    s.client
        .bridge_to_vault(&s.admin, &s.target, &s.token, &950, &900, &deadline);
    let res = s
        .client
        .try_bridge_to_vault(&s.admin, &Address::generate(&s.env), &s.token, &100, &90, &deadline);
    assert_eq!(res, Err(Ok(VaultError::InsufficientBalance)));
}

#[test]
fn test_initiate_requires_treasurer_role() {
    let s = setup();
    let outsider = Address::generate(&s.env);
    let deadline = s.env.ledger().sequence() as u64 + 100;
    let res = s
        .client
        .try_bridge_to_vault(&outsider, &s.target, &s.token, &100, &95, &deadline);
    assert_eq!(res, Err(Ok(VaultError::InsufficientRole)));
}

// ── Happy path ──────────────────────────────────────────────────────────────

#[test]
fn test_confirm_releases_exactly_once() {
    let s = setup();
    let (id, _) = start_bridge(&s, 100);

    s.client.confirm_bridge_receipt(&s.target, &id, &98);
    assert_eq!(balance(&s, &s.target), 100);
    assert_eq!(balance(&s, &s.vault), 900);
    assert_eq!(s.client.get_reserved_bridge_balance(&s.token), 0);

    let record = s.client.get_bridge_record(&id).unwrap();
    assert_eq!(record.status, BridgeStatus::Confirmed);
    assert_eq!(record.actual_amount, 98);
    assert!(s.client.get_bridge_receipt(&id).unwrap().released);

    // Identical replay: stable status error, no second transfer.
    assert_eq!(
        s.client.try_confirm_bridge_receipt(&s.target, &id, &98),
        Err(Ok(VaultError::BridgeInvalidStatus))
    );
    assert_eq!(
        s.client.try_release_bridge_transfer(&id),
        Err(Ok(VaultError::BridgeInvalidStatus))
    );
    assert_eq!(balance(&s, &s.target), 100);
}

#[test]
fn test_confirm_with_challenge_window_releases_after_window() {
    let s = setup();
    set_window(&s, 50, None);
    let (id, _) = start_bridge(&s, 100);

    s.client.confirm_bridge_receipt(&s.admin, &id, &100);
    assert_eq!(balance(&s, &s.target), 0, "held during the challenge window");
    assert_eq!(s.client.get_reserved_bridge_balance(&s.token), 100);
    assert_eq!(
        s.client.try_release_bridge_transfer(&id),
        Err(Ok(VaultError::BridgeChallengeWindowActive))
    );

    advance(&s, 51);
    s.client.release_bridge_transfer(&id);
    assert_eq!(balance(&s, &s.target), 100);
    assert_eq!(s.client.get_reserved_bridge_balance(&s.token), 0);
    assert_eq!(
        s.client.try_release_bridge_transfer(&id),
        Err(Ok(VaultError::BridgeInvalidStatus))
    );
}

// ── Conflicting receipts ────────────────────────────────────────────────────

#[test]
fn test_conflicting_confirm_is_rejected_with_stable_error() {
    let s = setup();
    set_window(&s, 50, None);
    let (id, _) = start_bridge(&s, 100);

    s.client.confirm_bridge_receipt(&s.target, &id, &97);

    // Different amount.
    assert_eq!(
        s.client.try_confirm_bridge_receipt(&s.target, &id, &99),
        Err(Ok(VaultError::BridgeReceiptConflict))
    );
    // Different confirmer.
    assert_eq!(
        s.client.try_confirm_bridge_receipt(&s.admin, &id, &97),
        Err(Ok(VaultError::BridgeReceiptConflict))
    );
    // First receipt is untouched.
    let receipt = s.client.get_bridge_receipt(&id).unwrap();
    assert_eq!(receipt.actual_amount, 97);
    assert_eq!(receipt.confirmer, s.target);
}

#[test]
fn test_unauthorized_confirmer_is_rejected() {
    let s = setup();
    let (id, _) = start_bridge(&s, 100);
    let stranger = Address::generate(&s.env);
    assert_eq!(
        s.client.try_confirm_bridge_receipt(&stranger, &id, &100),
        Err(Ok(VaultError::Unauthorized))
    );
}

#[test]
fn test_slippage_and_overstated_receipt_are_rejected_without_state_change() {
    let s = setup();
    let (id, _) = start_bridge(&s, 100);
    assert_eq!(
        s.client.try_confirm_bridge_receipt(&s.target, &id, &50),
        Err(Ok(VaultError::BridgeSlippageExceeded))
    );
    assert_eq!(
        s.client.try_confirm_bridge_receipt(&s.target, &id, &101),
        Err(Ok(VaultError::InvalidAmount))
    );
    assert_eq!(
        s.client.get_bridge_record(&id).unwrap().status,
        BridgeStatus::Initiated
    );
    assert!(s.client.get_bridge_receipt(&id).is_none());
}

// ── Timeout ─────────────────────────────────────────────────────────────────

#[test]
fn test_timeout_restores_balance_without_double_spend() {
    let s = setup();
    let (id, deadline) = start_bridge(&s, 100);

    s.env
        .ledger()
        .with_mut(|li| li.sequence_number = (deadline + 1) as u32);

    // Confirmation after the deadline fails and changes nothing.
    assert_eq!(
        s.client.try_confirm_bridge_receipt(&s.target, &id, &100),
        Err(Ok(VaultError::BridgeDeadlineExceeded))
    );
    assert_eq!(s.client.get_reserved_bridge_balance(&s.token), 100);

    s.client.expire_bridge_transfer(&id);
    assert_eq!(s.client.get_reserved_bridge_balance(&s.token), 0);
    assert_eq!(balance(&s, &s.vault), 1_000);
    assert_eq!(balance(&s, &s.target), 0);
    assert_eq!(
        s.client.get_bridge_record(&id).unwrap().status,
        BridgeStatus::Returned
    );

    // Second expiry and late confirm cannot move funds again.
    assert_eq!(
        s.client.try_expire_bridge_transfer(&id),
        Err(Ok(VaultError::BridgeInvalidStatus))
    );
    assert!(s.client.try_confirm_bridge_receipt(&s.target, &id, &100).is_err());
    assert_eq!(s.client.get_reserved_bridge_balance(&s.token), 0);
    assert_eq!(balance(&s, &s.vault), 1_000);
}

#[test]
fn test_unlocked_funds_can_back_a_new_bridge() {
    let s = setup();
    let deadline = s.env.ledger().sequence() as u64 + 10;
    let id = s
        .client
        .bridge_to_vault(&s.admin, &s.target, &s.token, &1_000, &990, &deadline);
    s.env
        .ledger()
        .with_mut(|li| li.sequence_number = (deadline + 1) as u32);
    s.client.expire_bridge_transfer(&id);

    // The whole balance is available again.
    let (id2, _) = start_bridge(&s, 1_000);
    s.client.confirm_bridge_receipt(&s.target, &id2, &1_000);
    assert_eq!(balance(&s, &s.target), 1_000);
    assert_eq!(balance(&s, &s.vault), 0);
}

// ── Disputes / fraud proofs ─────────────────────────────────────────────────

#[test]
fn test_accepted_fraud_proof_unlocks_reservation() {
    let s = setup();
    let verifier = s.env.register(MockFraudVerifier, ());
    set_window(&s, 50, Some(verifier));
    let (id, _) = start_bridge(&s, 100);
    s.client.confirm_bridge_receipt(&s.target, &id, &100);

    let disputer = Address::generate(&s.env);
    let bad_proof = Bytes::from_array(&s.env, &[0u8]);
    assert_eq!(
        s.client.try_dispute_bridge_receipt(&disputer, &id, &bad_proof),
        Err(Ok(VaultError::BridgeFraudProofRejected))
    );

    let proof = Bytes::from_array(&s.env, &[1u8, 2, 3]);
    s.client.dispute_bridge_receipt(&disputer, &id, &proof);
    assert_eq!(
        s.client.get_bridge_record(&id).unwrap().status,
        BridgeStatus::Disputed
    );
    assert_eq!(s.client.get_reserved_bridge_balance(&s.token), 0);
    assert_eq!(balance(&s, &s.vault), 1_000);
    assert_eq!(balance(&s, &s.target), 0);

    // A disputed transfer can never be released or re-confirmed.
    advance(&s, 100);
    assert_eq!(
        s.client.try_release_bridge_transfer(&id),
        Err(Ok(VaultError::BridgeInvalidStatus))
    );
    assert!(s.client.try_confirm_bridge_receipt(&s.target, &id, &100).is_err());
}

#[test]
fn test_dispute_without_verifier_or_with_trapping_verifier_is_rejected() {
    let s = setup();
    set_window(&s, 50, None);
    let (id, _) = start_bridge(&s, 100);
    s.client.confirm_bridge_receipt(&s.target, &id, &100);
    let proof = Bytes::from_array(&s.env, &[1u8]);
    let disputer = Address::generate(&s.env);
    assert_eq!(
        s.client.try_dispute_bridge_receipt(&disputer, &id, &proof),
        Err(Ok(VaultError::BridgeFraudProofRejected))
    );

    let trapping = s.env.register(TrappingFraudVerifier, ());
    set_window(&s, 50, Some(trapping));
    assert_eq!(
        s.client.try_dispute_bridge_receipt(&disputer, &id, &proof),
        Err(Ok(VaultError::BridgeFraudProofRejected))
    );
    assert_eq!(s.client.get_reserved_bridge_balance(&s.token), 100);
}

#[test]
fn test_dispute_after_window_is_rejected() {
    let s = setup();
    let verifier = s.env.register(MockFraudVerifier, ());
    set_window(&s, 10, Some(verifier));
    let (id, _) = start_bridge(&s, 100);
    s.client.confirm_bridge_receipt(&s.target, &id, &100);
    advance(&s, 11);
    let proof = Bytes::from_array(&s.env, &[1u8]);
    assert_eq!(
        s.client
            .try_dispute_bridge_receipt(&Address::generate(&s.env), &id, &proof),
        Err(Ok(VaultError::BridgeInvalidStatus))
    );
    s.client.release_bridge_transfer(&id);
    assert_eq!(balance(&s, &s.target), 100);
}

// ── Config / storage rent ───────────────────────────────────────────────────

#[test]
fn test_receipt_config_is_admin_only() {
    let s = setup();
    let res = s.client.try_set_bridge_receipt_config(
        &Address::generate(&s.env),
        &BridgeReceiptConfig {
            fraud_proof_verifier: None,
            challenge_window_ledgers: 5,
        },
    );
    assert_eq!(res, Err(Ok(VaultError::Unauthorized)));
}

#[test]
fn test_extend_bridge_intent_ttl() {
    let s = setup();
    let (id, _) = start_bridge(&s, 100);
    s.client.extend_bridge_intent_ttl(&id);
    assert_eq!(
        s.client.try_extend_bridge_intent_ttl(&BytesN::from_array(&s.env, &[9u8; 32])),
        Err(Ok(VaultError::BridgeInvalidId))
    );
}
