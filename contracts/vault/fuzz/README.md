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

## Running All Fuzz Tests

Run all fuzz targets for 1 hour:
```bash
cargo fuzz run fuzz_spending_limit -- -max_total_time=3600 -timeout=30
cargo fuzz run fuzz_vote_threshold -- -max_total_time=3600 -timeout=30
cargo fuzz run fuzz_arithmetic -- -max_total_time=3600 -timeout=30
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
- None yet (baseline run completed successfully)
