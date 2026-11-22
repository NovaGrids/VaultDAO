//! Tests for Issue #2147: `get_active_config_change` entrypoint.
//!
//! Callers previously had to scan every proposal ID to find the config change
//! blocking a new one with `ConfigChangeInProgress`. These tests verify that the
//! in-flight config-change proposal ID is surfaced directly and tracks its
//! lifecycle:
//!
//! 1. `None` when no config change is pending.
//! 2. `Some(id)` after a config-change proposal is created.
//! 3. Cleared (`None`) after the proposal is cancelled.
//! 4. Cleared (`None`) after the proposal is executed.

#![cfg(test)]

use super::*;
use crate::types::{
    InitConfig, ProposalStatus, RetryConfig, ThresholdStrategy, VelocityConfig, VoteWeight,
};
use crate::{VaultDAO, VaultDAOClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Symbol, Vec,
};

const START_LEDGER: u32 = 1_000;
/// Timelock applied to threshold-reduction proposals (see `make_vault`).
const TIMELOCK_DELAY: u64 = 10;

/// Create a vault with `signer_count` signers (admin at index 0) and `threshold`.
/// Returns `(client, admin, all_signers)`.
fn make_vault(
    env: &Env,
    threshold: u32,
    signer_count: u32,
) -> (VaultDAOClient<'static>, Address, Vec<Address>) {
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.sequence_number = START_LEDGER);

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let mut signers: Vec<Address> = Vec::new(env);
    signers.push_back(admin.clone());
    for _ in 1..signer_count {
        signers.push_back(Address::generate(env));
    }

    client.initialize(
        &admin,
        &InitConfig {
            upgrade_timelock_delay: 17_280,
            signers: signers.clone(),
            threshold,
            quorum: 0,
            quorum_percentage: 0,
            spending_limit: 1_000_000,
            daily_limit: 5_000_000,
            weekly_limit: 10_000_000,
            timelock_threshold: 0,
            timelock_delay: TIMELOCK_DELAY,
            velocity_limit: VelocityConfig {
                limit: 1_000_000,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            default_voting_deadline: 0,
            veto_addresses: Vec::new(env),
            veto_window_ledgers: 0,
            retry_config: RetryConfig {
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
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
        },
    );

    (client, admin, signers)
}

/// No config change has been proposed yet, so nothing is in flight.
#[test]
fn test_active_config_change_is_none_on_fresh_vault() {
    let env = Env::default();
    let (client, _admin, _signers) = make_vault(&env, 2, 4);

    assert_eq!(client.get_active_config_change(), None);
}

/// A threshold reduction creates a config-change proposal; its ID is reported.
#[test]
fn test_active_config_change_reports_pending_proposal_id() {
    let env = Env::default();
    let (client, admin, _signers) = make_vault(&env, 3, 4);

    let proposal_id = client
        .update_threshold(&admin, &2u32)
        .expect("reduction must create a config-change proposal");

    assert_eq!(
        client.get_active_config_change(),
        Some(proposal_id),
        "in-flight config change must be reported by its proposal ID"
    );
}

/// Increases are applied immediately and never create an in-flight change.
#[test]
fn test_active_config_change_stays_none_for_immediate_increase() {
    let env = Env::default();
    let (client, admin, _signers) = make_vault(&env, 2, 4);

    client.update_threshold(&admin, &3u32);

    assert_eq!(client.get_active_config_change(), None);
}

/// Cancelling the pending config-change proposal clears the in-flight marker.
#[test]
fn test_active_config_change_cleared_on_cancellation() {
    let env = Env::default();
    let (client, admin, _signers) = make_vault(&env, 3, 4);

    let proposal_id = client
        .update_threshold(&admin, &2u32)
        .expect("reduction must create a config-change proposal");
    assert_eq!(client.get_active_config_change(), Some(proposal_id));

    client.cancel_proposal(&admin, &proposal_id, &Symbol::new(&env, "test"));

    assert_eq!(
        client.get_active_config_change(),
        None,
        "cancelling the config change must clear the in-flight marker"
    );
}

/// Executing the approved config-change proposal clears the in-flight marker.
#[test]
fn test_active_config_change_cleared_on_execution() {
    let env = Env::default();
    let (client, admin, signers) = make_vault(&env, 3, 4);
    let signer1 = signers.get(1).unwrap();
    let signer2 = signers.get(2).unwrap();

    let proposal_id = client
        .update_threshold(&admin, &2u32)
        .expect("reduction must create a config-change proposal");

    client.approve_proposal(&admin, &proposal_id);
    client.approve_proposal(&signer1, &proposal_id);
    client.approve_proposal(&signer2, &proposal_id);
    assert_eq!(
        client.get_proposal(&proposal_id).status,
        ProposalStatus::Approved
    );

    // Still in flight until executed.
    assert_eq!(client.get_active_config_change(), Some(proposal_id));

    env.ledger()
        .with_mut(|l| l.sequence_number = START_LEDGER + TIMELOCK_DELAY as u32 + 1);
    client.execute_proposal(&admin, &proposal_id);

    assert_eq!(
        client.get_active_config_change(),
        None,
        "executing the config change must clear the in-flight marker"
    );
}
