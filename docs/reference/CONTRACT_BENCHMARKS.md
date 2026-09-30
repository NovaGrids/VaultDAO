# Contract Benchmarks

The Soroban contract benchmark suite lives in `contracts/vault/benches/contract.rs` and runs with:

```sh
cd contracts/vault
cargo bench --bench contract -- --output benchmark-results.json
```

To include the release WebAssembly module size, build it first and pass its path:

```sh
cargo build --target wasm32-unknown-unknown --release
cargo bench --bench contract -- \
  --output benchmark-results.json \
  --wasm-size target/wasm32-unknown-unknown/release/vault_dao.wasm
```

## Scenarios And Metrics

Each scenario runs 15 times in a fresh Soroban `Env`; setup and fixture seeding happen before resetting the budget counters. The result records the median CPU instruction cost, memory cost in bytes, and native wall-clock time. Storage profiles label read-only, write-only, and mixed contract calls so storage access paths can be compared independently:

| Scenario | Workload | Storage profile |
| --- | --- | --- |
| `single_event` | Create one transfer proposal and its audit/event data | Read/write |
| `batch_events_10` | Create ten transfer proposals in one batch | Read/write |
| `query_audit_page_50` | Read a 50-entry audit page | Read-only |
| `governance_approval` | Create and approve a transfer proposal | Read/write |
| `audit_archive_100` | Checkpoint and prune 100 audit entries | Read/write |
| `storage_read` | Read the audit entry count | Read-only |
| `storage_write` | Update the governance threshold | Write |

The SDK test environment exposes deterministic host CPU and memory budget counters, not exact ledger entry/byte read-write totals or production gas fees. These are Rust-native contract measurements and can underestimate costs of running the compiled WASM. For exact transaction resource estimates, simulate the same calls against a Stellar RPC environment. `wasm_bytes` is the release build's file size before any external optimizer step; wall-clock time is informational and is not part of the regression gate.

## CI, Regression, And History

The `Contract Benchmarks` workflow runs for pull requests, pushes to `main`, weekly on Monday, and manual dispatch. Pull requests and subsequent main runs compare their results with the latest successful main-branch benchmark artifact. A result fails CI when median CPU cost, median memory cost, or release WASM size grows by more than 5%; changes to the benchmark scenario set also fail for review. Wall-clock changes are shown but do not fail CI because shared runners are noisy.

Each run publishes `benchmark-results.json` as a GitHub Actions artifact retained for 90 days. The workflow summary renders a per-scenario comparison table, while the JSON artifact contains the commit and Unix timestamp for historical analysis or plotting. The first successful run has no baseline and seeds the history; later runs enforce regression checks.