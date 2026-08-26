# VaultDAO Contract Fuzz Testing

This directory contains cargo-fuzz targets for VaultDAO contract's critical functions.

## Setup

1. Install cargo-fuzz (if not already installed):
```bash
cargo install cargo-fuzz
```

2. Navigate to the fuzz directory:
```bash
cd contracts/vault/fuzz
```

## Available Fuzz Targets

### 1. Spending Limit Fuzz Target
Tests spending limit validation logic with random inputs.
```bash
cargo fuzz run fuzz_spending_limit -- -max_len=4096 -timeout=10
```

### 2. Vote Threshold Fuzz Target
Tests voting threshold and quorum calculations.
```bash
cargo fuzz run fuzz_vote_threshold -- -max_len=4096 -timeout=10
```

### 3. Arithmetic Fuzz Target
Tests arithmetic operations (insurance, stake, fees) for overflow/underflow.
```bash
cargo fuzz run fuzz_arithmetic -- -max_len=4096 -timeout=10
```

### 4. Execute Proposal Fuzz Target
Unlike the targets above, this one drives the **real contract** through
`VaultDAOClient` (not a reimplemented copy of its logic). It pre-seeds
several proposals, randomly walks each toward Pending/Approved/Vetoed/
Cancelled via `approve_proposal` / `veto_proposal` / `cancel_proposal`, then
calls `execute_proposal` against a randomly chosen target with randomized
ledger sequence/timestamp offsets (to probe timelock-unlock and expiration
boundaries) and an executor that may or may not be a signer. Also fuzzes a
same-input double-execute to probe the reentrancy guard. `execute_proposal`
handles token transfers, spending-limit bookkeeping, timelock verification,
and hook calls, so this is the highest-value target in this directory.
```bash
cargo fuzz run fuzz_execute_proposal -- -max_len=4096 -timeout=10
```

## Running All Fuzz Tests

Run all fuzz targets for 1 hour:
```bash
cargo fuzz run fuzz_spending_limit -- -max_total_time=3600 -timeout=30
cargo fuzz run fuzz_vote_threshold -- -max_total_time=3600 -timeout=30
cargo fuzz run fuzz_arithmetic -- -max_total_time=3600 -timeout=30
cargo fuzz run fuzz_execute_proposal -- -max_total_time=3600 -timeout=30
```

For issue-tracking purposes, a single 30-minute run of a new target is the
minimum bar before merging changes to the function it covers:
```bash
cargo fuzz run fuzz_execute_proposal -- -max_total_time=1800 -timeout=30
```

## Flags Reference

- `-max_len=N`: Maximum length of generated input
- `-timeout=N`: Timeout in seconds per run
- `-max_total_time=N`: Maximum total time to run in seconds
- `-jobs=N`: Number of parallel jobs
- `-workers=N`: Number of worker threads

## Findings

Findings will be stored in `artifacts/` directory with detailed crash data.

### Previous Findings
- `fuzz_spending_limit`, `fuzz_vote_threshold`, `fuzz_arithmetic`: None yet (baseline run completed successfully)
- `fuzz_execute_proposal`: **Not yet run.** This target was added and reviewed for correctness, but no
  Rust/cargo-fuzz toolchain was available in the environment that authored it, so the required 30-minute run
  has not been executed. Before relying on this coverage, run:
  ```bash
  cargo fuzz run fuzz_execute_proposal -- -max_total_time=1800 -timeout=30
  ```
  and record the outcome (clean run, or crash details + fix) in this section.
