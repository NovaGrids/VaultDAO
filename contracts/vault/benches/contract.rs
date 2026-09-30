use std::time::Instant;

use soroban_sdk::{
    testutils::Address as _, token::StellarAssetClient, Address, Env, Symbol, Vec as SorobanVec,
};
use vault_dao::{
    types::{
        Condition, ConditionLogic, InitConfig, Priority, RecoveryConfig, RetryConfig,
        StakingConfig, ThresholdStrategy, TransferDetails, VelocityConfig, VoteWeight,
    },
    VaultDAO, VaultDAOClient,
};

const SAMPLES: usize = 15;
const AUDIT_SEED: u32 = 100;

struct Context {
    env: Env,
    contract_id: Address,
    admin: Address,
    token: Address,
    proposal_id: Option<u64>,
}

struct ResultRow {
    name: &'static str,
    storage_profile: &'static str,
    cpu_instructions: u64,
    memory_bytes: u64,
    wall_time_ns: u64,
}

fn context() -> Context {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let admin = Address::generate(&env);
    let second_signer = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let mut signers = SorobanVec::new(&env);
    signers.push_back(admin.clone());
    signers.push_back(second_signer);

    let client = VaultDAOClient::new(&env, &contract_id);
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
            spending_limit: 1_000_000_000,
            daily_limit: 5_000_000_000,
            weekly_limit: 10_000_000_000,
            timelock_threshold: 999_999_999,
            timelock_delay: 0,
            velocity_limit: VelocityConfig {
                limit: 1_000_000_000,
                window: 3600,
                per_token_limit: 0,
            },
            threshold_strategy: ThresholdStrategy::Fixed,
            pre_execution_hooks: SorobanVec::new(&env),
            post_execution_hooks: SorobanVec::new(&env),
            veto_addresses: SorobanVec::new(&env),
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

    StellarAssetClient::new(&env, &token).mint(&contract_id, &1_000_000_000);

    Context {
        env,
        contract_id,
        admin,
        token,
        proposal_id: None,
    }
}

fn seed_audit(context: &Context, entries: u32) {
    let client = VaultDAOClient::new(&context.env, &context.contract_id);
    for _ in 0..entries {
        client.update_threshold(&context.admin, &2);
    }
}

fn propose(context: &Context) -> u64 {
    let client = VaultDAOClient::new(&context.env, &context.contract_id);
    client.propose_transfer(
        &context.admin,
        &Address::generate(&context.env),
        &context.token,
        &100,
        &Symbol::new(&context.env, "bench"),
        &Priority::Normal,
        &SorobanVec::<Condition>::new(&context.env),
        &ConditionLogic::And,
        &0,
    )
}

fn scenario_single_event(context: &Context) {
    let _proposal_id = propose(context);
}

fn scenario_batch_events(context: &Context) {
    let client = VaultDAOClient::new(&context.env, &context.contract_id);
    let mut transfers = SorobanVec::new(&context.env);
    for _ in 0..10 {
        transfers.push_back(TransferDetails {
            recipient: Address::generate(&context.env),
            token: context.token.clone(),
            amount: 10,
        });
    }
    let _proposal_ids = client.batch_propose_transfers(
        &context.admin,
        &transfers,
        &Priority::Normal,
        &SorobanVec::<Condition>::new(&context.env),
        &ConditionLogic::And,
        &0,
    );
}

fn scenario_query(context: &Context) {
    let client = VaultDAOClient::new(&context.env, &context.contract_id);
    let _entries = client.get_audit_trail(&0, &50);
}

fn scenario_governance(context: &Context) {
    let client = VaultDAOClient::new(&context.env, &context.contract_id);
    let proposal_id = context.proposal_id.expect("governance fixture is missing");
    client.approve_proposal(&context.admin, &proposal_id);
}

fn scenario_archive(context: &Context) {
    let client = VaultDAOClient::new(&context.env, &context.contract_id);
    let _checkpoint_id = client.create_audit_checkpoint(&context.admin);
}

fn scenario_storage_read(context: &Context) {
    let client = VaultDAOClient::new(&context.env, &context.contract_id);
    let _entry_count = client.get_audit_entry_count();
}

fn scenario_storage_write(context: &Context) {
    let client = VaultDAOClient::new(&context.env, &context.contract_id);
    client.update_threshold(&context.admin, &2);
}

fn median(values: &mut [u64]) -> u64 {
    values.sort_unstable();
    values[values.len() / 2]
}

fn benchmark(
    name: &'static str,
    storage_profile: &'static str,
    seed_entries: u32,
    operation: fn(&Context),
) -> ResultRow {
    let mut cpu_samples = std::vec::Vec::with_capacity(SAMPLES);
    let mut memory_samples = std::vec::Vec::with_capacity(SAMPLES);
    let mut wall_samples = std::vec::Vec::with_capacity(SAMPLES);

    for _ in 0..SAMPLES {
        let mut context = context();
        context.env.cost_estimate().budget().reset_unlimited();
        if seed_entries > 0 {
            seed_audit(&context, seed_entries);
        }
        if name == "governance_approval" {
            context.proposal_id = Some(propose(&context));
        }

        context.env.cost_estimate().budget().reset_default();
        let started = Instant::now();
        operation(&context);
        wall_samples.push(started.elapsed().as_nanos() as u64);

        let budget = context.env.cost_estimate().budget();
        cpu_samples.push(budget.cpu_instruction_cost());
        memory_samples.push(budget.memory_bytes_cost());
    }

    ResultRow {
        name,
        storage_profile,
        cpu_instructions: median(&mut cpu_samples),
        memory_bytes: median(&mut memory_samples),
        wall_time_ns: median(&mut wall_samples),
    }
}

fn main() {
    let mut output = String::from("benchmark-results.json");
    let mut wasm_size = 0u64;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--output" => output = args.next().expect("--output requires a file path"),
            "--wasm-size" => {
                let path = args.next().expect("--wasm-size requires a file path");
                wasm_size = std::fs::metadata(path)
                    .expect("cannot read WASM file metadata")
                    .len();
            }
            other => panic!("unknown argument: {other}"),
        }
    }

    let results = [
        benchmark("single_event", "read_write", 0, scenario_single_event),
        benchmark("batch_events_10", "read_write", 0, scenario_batch_events),
        benchmark("query_audit_page_50", "read_only", AUDIT_SEED, scenario_query),
        benchmark("governance_approval", "read_write", 0, scenario_governance),
        benchmark("audit_archive_100", "read_write", AUDIT_SEED, scenario_archive),
        benchmark("storage_read", "read_only", AUDIT_SEED, scenario_storage_read),
        benchmark("storage_write", "write", 0, scenario_storage_write),
    ];

    let commit = std::env::var("GITHUB_SHA").unwrap_or_else(|_| "local".to_string());
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock is before Unix epoch")
        .as_secs();
    let mut json = format!(
        "{{\n  \"schema_version\": 1,\n  \"commit\": \"{commit}\",\n  \"timestamp_unix\": {timestamp},\n  \"wasm_bytes\": {wasm_size},\n  \"benchmarks\": [\n"
    );
    for (index, row) in results.iter().enumerate() {
        let comma = if index + 1 == results.len() { "" } else { "," };
        json.push_str(&format!(
            "    {{\"name\":\"{}\",\"storage_profile\":\"{}\",\"cpu_instructions\":{},\"memory_bytes\":{},\"wall_time_ns\":{}}}{}\n",
            row.name,
            row.storage_profile,
            row.cpu_instructions,
            row.memory_bytes,
            row.wall_time_ns,
            comma,
        ));
    }
    json.push_str("  ]\n}\n");
    std::fs::write(&output, &json).expect("cannot write benchmark results");
    print!("{json}");
}