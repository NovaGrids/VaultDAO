# Proposal Staking and Slashing Implementation Status

## Completed Features

### 1. Type Definitions (types.rs)
- ✅ Added `StakingConfig` struct with configurable parameters:
  - `enabled`: Toggle staking requirement
  - `min_amount`: Minimum proposal amount requiring stake
  - `base_stake_bps`: Base stake as percentage of proposal amount (basis points)
  - `max_stake_amount`: Maximum stake cap
  - `slash_percentage`: Percentage slashed for malicious proposals
  - `reputation_discount_threshold`: Reputation score for reduced stakes
  - `reputation_discount_percentage`: Discount for high-reputation users

- ✅ Added `StakeRecord` struct to track individual stakes:
  - Proposal ID, staker address, token, amount
  - Lock/release timestamps
  - Refund and slash status tracking

- ✅ Added missing batch transaction types:
  - `BatchStatus` enum
  - `BatchTransaction` struct
  - `BatchExecutionResult` struct
  - `BatchOperation` struct

### 2. Storage Layer (storage.rs)
- ✅ Added `StakingConfig` to DataKey enum
- ✅ Added `StakePool` for tracking slashed funds per token
- ✅ Added `StakeRecord` for per-proposal stake tracking
- ✅ Implemented storage functions:
  - `get/set_staking_config()`
  - `get/add/subtract_stake_pool()`
  - `get/set_stake_record()`

### 3. Core Logic (lib.rs)
- ✅ Updated `Config` and `InitConfig` to include `staking_config`
- ✅ Updated `Proposal` struct to include `stake_amount` field
- ✅ Implemented stake calculation in `propose_transfer_internal()`:
  - Calculates required stake based on proposal amount
  - Applies reputation discounts for high-reputation users
  - Enforces maximum stake cap
  - Locks stake tokens in vault
  - Creates stake record

- ✅ Implemented stake refund in `execute_proposal()`:
  - Returns full stake to proposer on successful execution
  - Updates stake record with refund status
  - Emits stake_refunded event

- ✅ Implemented slashing in `reject_proposal()`:
  - Calculates slash amount based on config
  - Returns partial stake to proposer
  - Adds slashed amount to stake pool
  - Updates stake record with slash details
  - Emits stake_slashed event

- ✅ Added admin functions:
  - `update_staking_config()`: Update staking parameters
  - `withdraw_stake_pool()`: Withdraw slashed funds
  - `get_stake_pool()`: View pool balance
  - `get_stake_record()`: View stake details
  - `get_staking_config()`: View current config

### 4. Events (events.rs)
- ✅ Added `emit_stake_locked()`: When stake is locked on proposal creation
- ✅ Added `emit_stake_slashed()`: When stake is slashed for malicious proposal
- ✅ Added `emit_stake_refunded()`: When stake is refunded on success

### 5. Tests (test.rs)
- ✅ `test_staking_requirement_and_locking()`: Verifies stake calculation and locking
- ✅ `test_stake_refund_on_successful_execution()`: Tests refund mechanism
- ✅ `test_stake_slashing_on_rejection()`: Tests slashing for malicious proposals
- ✅ `test_stake_calculation_with_reputation_discount()`: Tests reputation discounts
- ✅ `test_stake_pool_management()`: Tests pool withdrawal
- ✅ `test_update_staking_config()`: Tests config updates
- ✅ `test_stake_max_cap()`: Tests maximum stake enforcement

## Known Issue: DataKey Enum Size Limit

### Problem
The Soroban `#[contracttype]` macro has a maximum size limit for enums. The `DataKey` enum in `storage.rs` has grown too large (45+ variants) and now exceeds this limit, causing a compilation error:

```
error: custom attribute panicked
= help: message: called `Result::unwrap()` on an `Err` value: LengthExceedsMax
```

### Root Cause
Each feature added to the contract adds new storage keys to the `DataKey` enum. The cumulative size has exceeded Soroban's limits.

### Solution Options

#### Option 1: Split DataKey into Multiple Enums (Recommended)
Create separate enums for different feature domains:

```rust
#[contracttype]
pub enum CoreDataKey {
    Initialized,
    Config,
    Role(Address),
    Proposal(u64),
    // ... core keys only
}

#[contracttype]
pub enum FeatureDataKey {
    Staking(StakingKey),
    Insurance(InsuranceKey),
    Subscription(SubscriptionKey),
    // ... feature-specific keys
}

#[contracttype]
pub enum StakingKey {
    Config,
    Pool(Address),
    Record(u64),
}
```

#### Option 2: Use String-Based Keys
Replace the enum with string-based keys (less type-safe but more flexible):

```rust
fn stake_pool_key(token: &Address) -> String {
    format!("stake_pool_{}", token)
}
```

#### Option 3: Refactor Storage Architecture
Implement a hierarchical storage system with namespaces to reduce the number of top-level keys.

## Integration Steps

Once the DataKey issue is resolved:

1. **Build and Test**:
   ```bash
   cargo build --release --target wasm32-unknown-unknown
   cargo test
   ```

2. **Run Clippy**:
   ```bash
   cargo clippy --all-targets -- -D warnings
   ```

3. **Deploy and Test**:
   - Deploy to testnet
   - Test stake locking on proposal creation
   - Test stake refund on successful execution
   - Test slashing on rejection
   - Verify pool management functions

## Acceptance Criteria Status

- ✅ Stake requirements configured in `StakingConfig`
- ✅ Stake calculation logic based on proposal amount with reputation discounts
- ✅ Stake locking in `propose_transfer()`
- ✅ Slashing logic for malicious proposals in `reject_proposal()`
- ✅ Stake refund for successful proposals in `execute_proposal()`
- ✅ Stake pool management with admin withdrawal
- ✅ Comprehensive tests covering all scenarios
- ⚠️ Tests pass (blocked by DataKey enum size issue)

## Next Steps

1. **Immediate**: Resolve DataKey enum size issue using Option 1 (split into multiple enums)
2. **Testing**: Run full test suite once compilation succeeds
3. **Integration**: Merge with dynamic fee PR
4. **Documentation**: Update API documentation with staking functions
5. **Deployment**: Deploy to testnet for integration testing

## Files Modified

- `contracts/vault/src/types.rs`: Added staking types
- `contracts/vault/src/storage.rs`: Added staking storage functions
- `contracts/vault/src/lib.rs`: Implemented staking logic
- `contracts/vault/src/events.rs`: Added staking events
- `contracts/vault/src/test.rs`: Added comprehensive tests

## Estimated Effort to Complete

- DataKey refactoring: 2-3 hours
- Testing and validation: 1-2 hours
- Integration with other PRs: 1 hour
- **Total**: 4-6 hours
