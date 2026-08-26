//! Fuzz target for proposal creation (`propose_transfer_with_deps`), the
//! most complex and security-critical entry point for getting funds moving
//! out of the vault.
//!
//! Unlike the other fuzz targets in this crate, this one drives the *real*
//! contract (via `VaultDAOClient`) instead of a reimplemented copy of its
//! logic, so a discrepancy here is a discrepancy in the actual contract.
//!
//! The contract must never panic here, regardless of input: every invalid
//! combination of amount / recipient / token / memo / conditions /
//! dependencies has a typed `VaultError` to express it. A panic is a bug.
#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env, Symbol, Vec};
use vault_dao::types::{
    Condition, ConditionLogic, InitConfig, Priority, RecoveryConfig, RetryConfig, StakingConfig,
    ThresholdStrategy, VelocityConfig, VoteWeight,
};
use vault_dao::{VaultDAO, VaultDAOClient};

const MEMO_ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";

#[derive(Arbitrary, Debug)]
struct CreateProposalFuzzInput {
    amount: i64,
    insurance_amount: i64,
    recipient_index: u8,
    token_index: u8,
    memo_seed: u32,
    memo_len: u8,
    num_conditions: u8,
    condition_kind_seed: u8,
    condition_logic_is_or: bool,
    num_dependencies: u8,
    seed_proposal_count: u8,
}

/// Build a `Symbol`-safe memo from arbitrary bytes: `Symbol` only accepts
/// `[a-zA-Z0-9_]` up to 32 chars, so we map raw fuzzer input into that
/// alphabet rather than letting an invalid `Symbol::new` call panic the
/// harness itself (that would be a false-positive "crash").
fn arbitrary_memo(env: &Env, seed: u32, len: u8) -> Symbol {
    let len = (len % 10) as usize + 1;
    let mut buf = [0u8; 10];
    let mut state = seed | 1;
    for slot in buf.iter_mut().take(len) {
        let idx = (state as usize) % MEMO_ALPHABET.len();
        *slot = MEMO_ALPHABET[idx];
        state = state.wrapping_mul(1_103_515_245).wrapping_add(12_345);
    }
    let s = core::str::from_utf8(&buf[..len]).unwrap();
    Symbol::new(env, s)
}

fn make_condition(seed: u32) -> Condition {
    match seed % 5 {
        0 => Condition::BalanceAbove(((seed as i128) * 997) % 1_000_000),
        1 => Condition::DateAfter(seed as u64),
        2 => Condition::DateBefore(seed as u64 + 1),
        3 => Condition::BalanceAbove(-((seed as i128) % 1_000_000)),
        _ => Condition::DateAfter(0),
    }
}

fuzz_target!(|data: CreateProposalFuzzInput| {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_a = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let token_b = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    StellarAssetClient::new(&env, &token_a).mint(&contract_id, &1_000_000_000);
    StellarAssetClient::new(&env, &token_b).mint(&contract_id, &1_000_000_000);

    let recipients = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        admin.clone(),
    ];

    let mut signers = Vec::new(&env);
    signers.push_back(admin.clone());

    client.initialize(
        &admin,
        &InitConfig {
            whitelist_mode: false,
            grace_period_ledgers: 100,
            vote_weight: VoteWeight::Flat,
            high_impact_threshold: 70,
            admin_rotation_delay: 1440,
            signers,
            threshold: 1,
            quorum: 0,
            quorum_percentage: 0,
            default_voting_deadline: 0,
            spending_limit: 500_000_000,
            daily_limit: 1_000_000_000,
            weekly_limit: 2_000_000_000,
            timelock_threshold: 999_999_999,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 1_000_000_000,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            pre_execution_hooks: Vec::new(&env),
            post_execution_hooks: Vec::new(&env),
            veto_addresses: Vec::new(&env),
            veto_window_ledgers: 0,
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

    let token = if data.token_index % 2 == 0 {
        &token_a
    } else {
        &token_b
    };
    let recipient = &recipients[(data.recipient_index % recipients.len() as u8) as usize];
    let memo = arbitrary_memo(&env, data.memo_seed, data.memo_len);

    // Pre-seed a handful of baseline proposals so `depends_on` has real,
    // already-existing proposal IDs to reference (some valid, some not).
    let mut existing_ids: Vec<u64> = Vec::new(&env);
    let seed_count = (data.seed_proposal_count % 4) as u32;
    for i in 0..seed_count {
        if let Ok(Ok(id)) = client.try_propose_transfer(
            &admin,
            recipient,
            token,
            &(1_000 + i as i128),
            &Symbol::new(&env, "seed"),
            &Priority::Normal,
            &Vec::new(&env),
            &ConditionLogic::And,
            &0i128,
        ) {
            existing_ids.push_back(id);
        }
    }

    let mut conditions = Vec::new(&env);
    let n_cond = (data.num_conditions % 6) as u32;
    for i in 0..n_cond {
        conditions.push_back(make_condition(data.condition_kind_seed as u32 + i));
    }
    let condition_logic = if data.condition_logic_is_or {
        ConditionLogic::Or
    } else {
        ConditionLogic::And
    };

    let mut depends_on: Vec<u64> = Vec::new(&env);
    let n_dep = (data.num_dependencies % 5) as u32;
    for i in 0..n_dep {
        if existing_ids.is_empty() {
            // Reference a nonexistent proposal id on purpose: this must be
            // rejected with a typed error, never panic.
            depends_on.push_back(9_999_000 + i as u64);
        } else {
            let idx = i % existing_ids.len();
            depends_on.push_back(existing_ids.get(idx).unwrap());
        }
    }

    let amount = data.amount as i128;
    let insurance_amount = data.insurance_amount as i128;

    // The call under test: the contract must resolve to a typed
    // `VaultError` for any invalid input, never panic/abort.
    let _ = client.try_propose_transfer_with_deps(
        &admin,
        recipient,
        token,
        &amount,
        &memo,
        &Priority::Normal,
        &conditions,
        &condition_logic,
        &insurance_amount,
        &depends_on,
    );
});
