//! Fuzz target for `execute_proposal`, the most dangerous function in the
//! contract: it moves real tokens and is the final gate for spending-limit
//! checks, timelock verification, and pre/post execution hooks.
//!
//! This target pre-seeds a vault with several proposals, drives each one
//! through a random mix of approve/veto/cancel calls to land in varied
//! states (Pending, Approved, Vetoed, Cancelled), then fuzzes
//! `execute_proposal` against a randomly chosen target with randomized
//! ledger sequence / timestamp offsets so timelock and expiry boundaries
//! get exercised. As with `fuzz_create_proposal`, this drives the real
//! contract via `VaultDAOClient` — every path must resolve to a typed
//! `VaultError`, never panic.
#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Symbol, Vec,
};
use vault_dao::types::{
    ConditionLogic, InitConfig, Priority, RecoveryConfig, RetryConfig, StakingConfig,
    ThresholdStrategy, VelocityConfig, VoteWeight,
};
use vault_dao::{VaultDAO, VaultDAOClient};

#[derive(Arbitrary, Debug)]
struct ExecuteProposalFuzzInput {
    amounts: [u32; 4],
    approve_admin: bool,
    approve_signer2: bool,
    veto: bool,
    cancel: bool,
    ledger_offset: u32,
    timestamp_offset: u32,
    proposal_pick: u8,
    executor_is_signer: bool,
    execute_twice: bool,
}

fuzz_target!(|data: ExecuteProposalFuzzInput| {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let outsider = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    StellarAssetClient::new(&env, &token).mint(&contract_id, &1_000_000_000);

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(signer2.clone());

    let mut veto_addresses = Vec::new(&env);
    veto_addresses.push_back(admin.clone());

    client.initialize(
        &admin,
        &InitConfig {
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers,
            threshold: 2,
            quorum: 0,
            quorum_percentage: 0,
            default_voting_deadline: 0,
            spending_limit: 400_000,
            daily_limit: 5_000_000,
            weekly_limit: 10_000_000,
            // Small enough that some fuzzed amounts trip the timelock and
            // some don't, exercising both branches of execute_proposal.
            timelock_threshold: 50_000,
            timelock_delay: 50,
            velocity_limit: VelocityConfig {
                limit: 1_000_000_000,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            pre_execution_hooks: Vec::new(&env),
            post_execution_hooks: Vec::new(&env),
            veto_addresses,
            // Non-zero so `veto_proposal` is reachable from the fuzzer.
            veto_window_ledgers: 1_000,
            retry_config: RetryConfig {
                max_retry_delay: 0,
                enabled: false,
                max_retries: 0,
                initial_backoff_ledgers: 0,
            },
            recovery_config: RecoveryConfig::default(&env),
            staking_config: StakingConfig::default(),
            proposal_id_prefix: 0,
        },
    );

    // Pre-seed a handful of proposals so the target picks from a vault with
    // "various proposal states" rather than a single freshly-created one.
    let mut proposal_ids: Vec<u64> = Vec::new(&env);
    for raw_amount in data.amounts {
        let amount = 1 + (raw_amount as i128 % 300_000);
        if let Ok(Ok(id)) = client.try_propose_transfer(
            &admin,
            &recipient,
            &token,
            &amount,
            &Symbol::new(&env, "fz"),
            &Priority::Normal,
            &Vec::new(&env),
            &ConditionLogic::And,
            &0i128,
        ) {
            proposal_ids.push_back(id);
        }
    }
    if proposal_ids.is_empty() {
        return;
    }

    let idx = (data.proposal_pick as u32) % proposal_ids.len();
    let target_id = proposal_ids.get(idx).unwrap();

    // Randomly move the target proposal toward Approved / Vetoed / Cancelled
    // before execution, so `execute_proposal` sees every reachable status.
    if data.approve_admin {
        let _ = client.try_approve_proposal(&admin, &target_id);
    }
    if data.approve_signer2 {
        let _ = client.try_approve_proposal(&signer2, &target_id);
    }
    if data.veto {
        let _ = client.try_veto_proposal(&admin, &target_id);
    }
    if data.cancel {
        let _ = client.try_cancel_proposal(&admin, &target_id, &Symbol::new(&env, "c"));
    }

    // Randomize ledger sequence / timestamp before execution to probe
    // timelock-unlock and expiration boundaries.
    let seq = env.ledger().sequence();
    env.ledger()
        .set_sequence_number(seq.saturating_add(data.ledger_offset % 200_000));
    let ts = env.ledger().timestamp();
    env.ledger()
        .set_timestamp(ts + (data.timestamp_offset % 5_000_000) as u64);

    let executor = if data.executor_is_signer {
        &admin
    } else {
        &outsider
    };

    // The call under test: must resolve to a typed `VaultError` for every
    // unreachable/invalid state transition, never panic.
    let _ = client.try_execute_proposal(executor, &target_id);

    if data.execute_twice {
        // Re-entrant / double-execute attempts must also be rejected
        // cleanly (ProposalAlreadyExecuted or similar), not panic.
        let _ = client.try_execute_proposal(executor, &target_id);
    }
});
