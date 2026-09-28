//! Pause guard on fund-moving entry points, governed pool/fee withdrawals, and
//! vesting through the proposal flow.
//!
//! - Every entry point that pays vault-held funds out must refuse to run while
//!   the vault is paused (`VaultError::VaultPaused`).
//! - Insurance and stake pools can only be emptied by an approved
//!   super-majority proposal; the single-Admin `withdraw_*_pool` entry points
//!   are gone.
//! - `withdraw_fees` emits `fees_withdrawn`, writes an audit entry, and refuses
//!   amounts above the spending limit (those need a governed fee withdrawal).
//! - Vesting schedules are only created by an approved `CreateVesting`
//!   proposal, and count against daily/weekly spending limits.
#![cfg(test)]

use super::*;
use crate::types::{
    DisputeOutcome, DisputeResolution, InitConfig, SubscriptionTier, ThresholdStrategy,
    VelocityConfig, VoteWeight,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    token::StellarAssetClient,
    Address, BytesN, Env, IntoVal, Symbol, TryFromVal, Val, Vec,
};

const SPENDING_LIMIT: i128 = 10_000;
const DAILY_LIMIT: i128 = 50_000;

fn init_config(env: &Env, signers: Vec<Address>) -> InitConfig {
    InitConfig {
        veto_window_ledgers: 0,
        whitelist_mode: false,
        grace_period_ledgers: 100,
        vote_weight: VoteWeight::Flat,
        high_impact_threshold: 70,
        admin_rotation_delay: 1440,
        signers,
        threshold: 2,
        quorum: 0,
        quorum_percentage: 0,
        spending_limit: SPENDING_LIMIT,
        daily_limit: DAILY_LIMIT,
        weekly_limit: 200_000,
        timelock_threshold: 0,
        timelock_delay: 0,
        velocity_limit: VelocityConfig {
            limit: 100_000,
            window: 3600,
            per_token_limit: 0,
        },
        threshold_strategy: ThresholdStrategy::Fixed,
        default_voting_deadline: 0,
        veto_addresses: Vec::new(env),
        retry_config: crate::types::RetryConfig {
            max_retry_delay: 0,
            enabled: false,
            max_retries: 0,
            initial_backoff_ledgers: 0,
        },
        recovery_config: crate::types::RecoveryConfig::default(env),
        staking_config: crate::types::StakingConfig::default(),
        proposal_id_prefix: 0,
        pre_execution_hooks: Vec::new(env),
        post_execution_hooks: Vec::new(env),
    }
}

struct Setup<'a> {
    env: Env,
    client: VaultDAOClient<'a>,
    contract_id: Address,
    admin: Address,
    /// Treasurer and second approver.
    signer1: Address,
    /// Third signer, so a super-majority (threshold + 1 = 3) is reachable.
    signer2: Address,
    emergency: Address,
    token: Address,
}

/// Three signers, threshold 2, two emergency signers, and a vault holding
/// 1,000,000 tokens.
fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    client.initialize(&admin, &init_config(&env, signers));
    client.set_role(&admin, &signer1, &Role::Treasurer);

    let emergency = Address::generate(&env);
    let mut emergency_signers = Vec::new(&env);
    emergency_signers.push_back(emergency.clone());
    emergency_signers.push_back(Address::generate(&env));
    client.configure_emergency(&admin, &emergency_signers, &i128::MAX);

    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    StellarAssetClient::new(&env, &token).mint(&contract_id, &1_000_000);

    Setup {
        env,
        client,
        contract_id,
        admin,
        signer1,
        signer2,
        emergency,
        token,
    }
}

fn paused<'a>() -> Setup<'a> {
    let s = setup();
    s.client
        .pause_vault(&s.emergency, &Symbol::new(&s.env, "exploit"));
    assert!(s.client.get_pause_state().is_paused);
    s
}

fn approve_all(s: &Setup, proposal_id: u64) {
    s.client.approve_proposal(&s.admin, &proposal_id);
    s.client.approve_proposal(&s.signer1, &proposal_id);
    s.client.approve_proposal(&s.signer2, &proposal_id);
}

fn balance(s: &Setup, who: &Address) -> i128 {
    soroban_sdk::token::TokenClient::new(&s.env, &s.token).balance(who)
}

// ============================================================================
// Pause guard: one test per guarded entry point
// ============================================================================

/// `$call` is evaluated against a paused vault and must fail with VaultPaused
/// before any other validation (the arguments below are otherwise invalid).
macro_rules! paused_test {
    ($name:ident, |$s:ident| $call:expr) => {
        #[test]
        fn $name() {
            let $s = paused();
            let result = $call;
            assert_eq!(result.err(), Some(Ok(VaultError::VaultPaused)));
        }
    };
}

paused_test!(test_paused_blocks_auto_resolve_escrow, |s| s
    .client
    .try_auto_resolve_escrow(&1));
paused_test!(test_paused_blocks_batch_execute_proposals, |s| s
    .client
    .try_batch_execute_proposals(
        &s.admin,
        &Vec::from_array(&s.env, [1u64])
    ));
paused_test!(test_paused_blocks_bridge_to_vault, |s| s
    .client
    .try_bridge_to_vault(
        &s.admin,
        &Address::generate(&s.env),
        &s.token,
        &100,
        &1,
        &1_000
    ));
paused_test!(test_paused_blocks_claim_stream, |s| s
    .client
    .try_claim_stream(&s.admin, &1));
paused_test!(test_paused_blocks_claim_vested_tokens, |s| s
    .client
    .try_claim_vested_tokens(&s.admin, &1));
paused_test!(test_paused_blocks_close_insurance_claim_voting, |s| s
    .client
    .try_close_insurance_claim_voting(&s.admin, &1));
paused_test!(test_paused_blocks_confirm_bridge_receipt, |s| s
    .client
    .try_confirm_bridge_receipt(
        &s.admin,
        &BytesN::from_array(&s.env, &[1u8; 32]),
        &100
    ));
paused_test!(test_paused_blocks_create_subscription, |s| s
    .client
    .try_create_subscription(
        &s.admin,
        &Address::generate(&s.env),
        &SubscriptionTier::Basic,
        &s.token,
        &100,
        &1_000,
        &false,
        &0
    ));
paused_test!(test_paused_blocks_execute_batch, |s| s
    .client
    .try_execute_batch(&s.admin, &1));
paused_test!(test_paused_blocks_execute_cross_vault, |s| s
    .client
    .try_execute_cross_vault(&s.admin, &1));
paused_test!(test_paused_blocks_execute_insurance_withdrawal, |s| s
    .client
    .try_execute_insurance_withdrawal(&s.admin, &1));
paused_test!(test_paused_blocks_execute_stake_withdrawal, |s| s
    .client
    .try_execute_stake_withdrawal(&s.admin, &1));
paused_test!(test_paused_blocks_execute_fee_withdrawal, |s| s
    .client
    .try_execute_fee_withdrawal(&s.admin, &1));
paused_test!(test_paused_blocks_execute_recurring_payment, |s| s
    .client
    .try_execute_recurring_payment(&1));
paused_test!(test_paused_blocks_reactivate_subscription, |s| s
    .client
    .try_reactivate_subscription(&s.admin, &1));
paused_test!(test_paused_blocks_release_escrow, |s| s
    .client
    .try_release_escrow(&s.admin, &1));
paused_test!(test_paused_blocks_release_round_funds, |s| s
    .client
    .try_release_round_funds(&s.admin, &1, &0));
paused_test!(test_paused_blocks_renew_subscription, |s| s
    .client
    .try_renew_subscription(&s.admin, &1));
paused_test!(test_paused_blocks_resolve_dispute, |s| s
    .client
    .try_resolve_dispute(
        &s.admin,
        &1,
        &DisputeResolution::InFavorOfProposer
    ));
paused_test!(test_paused_blocks_resolve_dispute_with_outcome, |s| s
    .client
    .try_resolve_dispute_with_outcome(
        &s.admin,
        &1,
        &DisputeOutcome::UpholdDispute
    ));
paused_test!(test_paused_blocks_resolve_escrow_dispute, |s| s
    .client
    .try_resolve_escrow_dispute(&s.admin, &1, &true));
paused_test!(test_paused_blocks_trigger_stream_payment, |s| s
    .client
    .try_trigger_stream_payment(&s.admin, &1, &100));
paused_test!(test_paused_blocks_unlock_early, |s| s
    .client
    .try_unlock_early(&s.admin));
paused_test!(test_paused_blocks_withdraw_fees, |s| s
    .client
    .try_withdraw_fees(&s.admin, &s.token, &s.admin));
paused_test!(test_paused_blocks_cancel_vesting, |s| s
    .client
    .try_cancel_vesting(&s.admin, &1));
paused_test!(test_paused_blocks_execute_multi_phase_proposal, |s| s
    .client
    .try_execute_multi_phase_proposal(&s.admin, &1));

#[test]
fn test_unpause_restores_guarded_entry_points() {
    let s = paused();
    s.client.unpause_vault(&s.emergency);
    // Past the pause guard: now fails on its own validation instead.
    let result = s.client.try_claim_stream(&s.admin, &1);
    assert_ne!(result.err(), Some(Ok(VaultError::VaultPaused)));
}

// ============================================================================
// Pool withdrawals: governed path only
// ============================================================================

/// The single-Admin entry points no longer exist on the contract.
#[test]
fn test_direct_admin_pool_withdrawal_entry_points_are_removed() {
    let s = setup();
    for name in ["withdraw_insurance_pool", "withdraw_stake_pool"] {
        let args: Vec<Val> =
            (s.admin.clone(), s.token.clone(), s.admin.clone(), 100i128).into_val(&s.env);
        let result = s.env.try_invoke_contract::<(), soroban_sdk::Error>(
            &s.contract_id,
            &Symbol::new(&s.env, name),
            args,
        );
        assert!(result.is_err(), "{name} must not be callable");
    }
}

fn seed_pools(s: &Setup, amount: i128) {
    s.env.as_contract(&s.contract_id, || {
        storage::add_to_insurance_pool(&s.env, &s.token, amount);
        storage::add_to_stake_pool(&s.env, &s.token, amount);
        storage::add_fees_collected(&s.env, &s.token, amount);
    });
}

#[test]
fn test_admin_alone_cannot_execute_stake_withdrawal() {
    let s = setup();
    seed_pools(&s, 5_000);
    let recipient = Address::generate(&s.env);

    let id = s
        .client
        .propose_stake_withdrawal(&s.admin, &s.token, &5_000, &recipient);
    s.client.approve_proposal(&s.admin, &id);

    let result = s.client.try_execute_stake_withdrawal(&s.admin, &id);
    assert_eq!(result, Err(Ok(VaultError::ProposalNotApproved)));
    assert_eq!(balance(&s, &recipient), 0);
    assert_eq!(s.client.get_stake_pool_balance(&s.token), 5_000);
}

#[test]
fn test_admin_alone_cannot_execute_insurance_withdrawal() {
    let s = setup();
    seed_pools(&s, 5_000);
    let recipient = Address::generate(&s.env);

    let id = s
        .client
        .propose_insurance_withdrawal(&s.admin, &s.token, &5_000, &recipient);
    s.client.approve_proposal(&s.admin, &id);

    let result = s.client.try_execute_insurance_withdrawal(&s.admin, &id);
    assert_eq!(result, Err(Ok(VaultError::ProposalNotApproved)));
    assert_eq!(balance(&s, &recipient), 0);
}

#[test]
fn test_governed_stake_withdrawal_with_super_majority_emits_event_and_audit() {
    let s = setup();
    seed_pools(&s, 5_000);
    let recipient = Address::generate(&s.env);

    let id = s
        .client
        .propose_stake_withdrawal(&s.admin, &s.token, &4_000, &recipient);
    approve_all(&s, id);
    let audit_before = s.client.get_audit_entry_count();

    s.client.execute_stake_withdrawal(&s.signer1, &id);
    // events().all() only covers the latest invocation, so read it first.
    let event = find_event(&s, "pool_withdrawn").expect("pool_withdrawn event");

    assert_eq!(balance(&s, &recipient), 4_000);
    assert_eq!(s.client.get_stake_pool_balance(&s.token), 1_000);

    let (proposal_id, token, to, amount, executor): (u64, Address, Address, i128, Address) =
        TryFromVal::try_from_val(&s.env, &event).unwrap();
    assert_eq!(
        (proposal_id, token, to, amount, executor),
        (id, s.token.clone(), recipient, 4_000, s.signer1.clone())
    );

    assert_eq!(s.client.get_audit_entry_count(), audit_before + 1);
    let entry = s.client.get_audit_entry(&s.client.get_audit_entry_count());
    assert_eq!(entry.action, AuditAction::PoolWithdrawn);
}

#[test]
fn test_stake_withdrawal_proposal_cannot_be_executed_as_insurance_withdrawal() {
    let s = setup();
    seed_pools(&s, 5_000);
    let id = s
        .client
        .propose_stake_withdrawal(&s.admin, &s.token, &1_000, &s.admin);
    approve_all(&s, id);

    let result = s.client.try_execute_insurance_withdrawal(&s.admin, &id);
    assert_eq!(result, Err(Ok(VaultError::Unauthorized)));
}

// ============================================================================
// Fee withdrawals
// ============================================================================

/// Data of the most recent event whose first topic is `name`.
fn find_event(s: &Setup, name: &str) -> Option<Val> {
    let wanted = Symbol::new(&s.env, name);
    let mut found = None;
    for (_contract, topics, data) in s.env.events().all().iter() {
        if let Some(first) = topics.get(0) {
            if let Ok(sym) = Symbol::try_from_val(&s.env, &first) {
                if sym == wanted {
                    found = Some(data);
                }
            }
        }
    }
    found
}

#[test]
fn test_withdraw_fees_emits_fees_withdrawn_payload() {
    let s = setup();
    s.env.as_contract(&s.contract_id, || {
        storage::add_fees_collected(&s.env, &s.token, 2_500);
    });
    let recipient = Address::generate(&s.env);

    let withdrawn = s.client.withdraw_fees(&s.admin, &s.token, &recipient);
    let data = find_event(&s, "fees_withdrawn").expect("fees_withdrawn event");
    assert_eq!(withdrawn, 2_500);

    let payload: (Address, Address, i128, Address) =
        TryFromVal::try_from_val(&s.env, &data).unwrap();
    assert_eq!(
        payload,
        (s.token.clone(), recipient.clone(), 2_500, s.admin.clone())
    );
    assert_eq!(balance(&s, &recipient), 2_500);
}

#[test]
fn test_withdraw_fees_writes_audit_entry() {
    let s = setup();
    s.env.as_contract(&s.contract_id, || {
        storage::add_fees_collected(&s.env, &s.token, 1_000);
    });
    let before = s.client.get_audit_entry_count();

    s.client.withdraw_fees(&s.admin, &s.token, &s.admin);

    assert_eq!(s.client.get_audit_entry_count(), before + 1);
    let entry = s.client.get_audit_entry(&s.client.get_audit_entry_count());
    assert_eq!(entry.action, AuditAction::FeesWithdrawn);
    assert_eq!(entry.actor, s.admin);
}

#[test]
fn test_withdraw_fees_above_spending_limit_requires_proposal() {
    let s = setup();
    s.env.as_contract(&s.contract_id, || {
        storage::add_fees_collected(&s.env, &s.token, SPENDING_LIMIT + 1);
    });
    let recipient = Address::generate(&s.env);

    let result = s.client.try_withdraw_fees(&s.admin, &s.token, &recipient);
    assert_eq!(result, Err(Ok(VaultError::ExceedsProposalLimit)));

    // The governed path moves it once a super-majority approves.
    let id = s
        .client
        .propose_fee_withdrawal(&s.admin, &s.token, &(SPENDING_LIMIT + 1), &recipient);
    approve_all(&s, id);
    s.client.execute_fee_withdrawal(&s.admin, &id);
    let payload: (Address, Address, i128, Address) = TryFromVal::try_from_val(
        &s.env,
        &find_event(&s, "fees_withdrawn").expect("fees_withdrawn event"),
    )
    .unwrap();
    assert_eq!(payload.2, SPENDING_LIMIT + 1);
    assert_eq!(balance(&s, &recipient), SPENDING_LIMIT + 1);
}

// ============================================================================
// Vesting through the proposal flow
// ============================================================================

fn propose_vesting(s: &Setup, beneficiary: &Address, total: i128) -> u64 {
    s.client
        .create_vesting_schedule(&s.admin, beneficiary, &s.token, &total, &100, &0, &1_000)
}

#[test]
fn test_single_admin_cannot_create_vesting_directly() {
    let s = setup();
    let beneficiary = Address::generate(&s.env);

    let proposal_id = propose_vesting(&s, &beneficiary, 5_000);

    // Only a proposal exists; no schedule and no funds committed yet.
    assert!(s.client.get_vesting_schedule(&1).is_none());
    assert_eq!(
        s.client.get_proposal(&proposal_id).status,
        ProposalStatus::Pending
    );

    // The same Admin approving alone is not enough to execute it.
    s.client.approve_proposal(&s.admin, &proposal_id);
    let result = s
        .client
        .try_execute_multi_phase_proposal(&s.signer1, &proposal_id);
    assert_eq!(result, Err(Ok(VaultError::ProposalNotApproved)));
    assert!(s.client.get_vesting_schedule(&1).is_none());
}

#[test]
fn test_member_cannot_propose_vesting() {
    let s = setup();
    let member = Address::generate(&s.env);
    let result = s
        .client
        .try_create_vesting_schedule(&member, &member, &s.token, &1_000, &100, &0, &1_000);
    assert_eq!(result, Err(Ok(VaultError::InsufficientRole)));
}

#[test]
fn test_approved_vesting_proposal_creates_schedule_and_counts_spending() {
    let s = setup();
    let beneficiary = Address::generate(&s.env);

    let proposal_id = propose_vesting(&s, &beneficiary, 5_000);
    s.client.approve_proposal(&s.admin, &proposal_id);
    s.client.approve_proposal(&s.signer1, &proposal_id);
    s.client
        .execute_multi_phase_proposal(&s.signer1, &proposal_id);

    let schedule = s.client.get_vesting_schedule(&1).expect("schedule created");
    assert_eq!(schedule.beneficiary, beneficiary);
    assert_eq!(schedule.total, 5_000);
    assert_eq!(
        s.client.get_proposal(&proposal_id).status,
        ProposalStatus::Executed
    );
}

#[test]
fn test_vesting_total_above_daily_limit_is_rejected() {
    let s = setup();
    let beneficiary = Address::generate(&s.env);

    let proposal_id = propose_vesting(&s, &beneficiary, DAILY_LIMIT + 1);
    s.client.approve_proposal(&s.admin, &proposal_id);
    s.client.approve_proposal(&s.signer1, &proposal_id);

    let result = s
        .client
        .try_execute_multi_phase_proposal(&s.signer1, &proposal_id);
    assert_eq!(result, Err(Ok(VaultError::PhaseExecutionFailed)));
    assert!(s.client.get_vesting_schedule(&1).is_none());
}
