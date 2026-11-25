# Contract Upgrade Guide

This document describes the safe process for upgrading the VaultDAO Soroban contract. It covers building a deterministic WASM, computing the upgrade hash, creating and approving the upgrade proposal, executing it, validating the new version, and — if the upgrade is found defective — the rollback procedure.

All steps are grounded in the actual contract functions in `contracts/vault/src/lib.rs`.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites and Access Control](#2-prerequisites-and-access-control)
3. [Step 1 — Build the Deterministic WASM](#3-step-1--build-the-deterministic-wasm)
4. [Step 2 — Compute and Verify the WASM Hash](#4-step-2--compute-and-verify-the-wasm-hash)
5. [Step 3 — Propose the Upgrade](#5-step-3--propose-the-upgrade)
6. [Step 4 — M-of-N Approval (Unanimous Consent)](#6-step-4--m-of-n-approval-unanimous-consent)
7. [Step 5 — Execute the Upgrade](#7-step-5--execute-the-upgrade)
8. [Step 6 — Post-Upgrade Validation](#8-step-6--post-upgrade-validation)
9. [Rollback Procedure](#9-rollback-procedure)
10. [Upgrade Checklist](#10-upgrade-checklist)

---

## 1. Overview

VaultDAO uses the Soroban `env.deployer().update_current_contract_wasm(hash)` host function to perform in-place contract upgrades. The upgrade flow is:

```
Build WASM  →  Compute hash  →  propose_upgrade()  →  all signers approve  →  execute_upgrade()
```

Key properties of the current implementation:

| Property | Value |
|---|---|
| Who can propose | `Role::Admin` only |
| Approval requirement | **Every registered signer** must approve (`approvals.len() == signers.len()`) |
| Timelock | Mandatory; `earliest_apply_ledger = created_at + config.upgrade_timelock_delay`, with `config.upgrade_timelock_delay >= 17_280` ledgers |
| Hash pinning | `PendingUpgrade` stores the exact `wasm_hash`, proposal ID, proposer and earliest apply ledger; execution deploys only that hash |
| Expiry | `created_at + (config.upgrade_timelock_delay * 10)` (10× the upgrade timelock) |
| Concurrent upgrades | One pinned upgrade at a time (blocked by `UpgradeUnauthorized` if another upgrade is pending) |
| Cancellation | An Admin may call `cancel_upgrade` before execution; this clears the pin and emits `upgrade_cancelled` |
| Priority | `Critical` |
| Voting deadline | None enforced (0) |

---

## 2. Prerequisites and Access Control

### Who can act

| Action | Required role / condition |
|---|---|
| `propose_upgrade` | `Role::Admin` |
| `approve_proposal` | Any registered signer in `config.signers` who was in the snapshot |
| `execute_upgrade` | Any address with auth; contract validates proposal state internally |
| Emergency `cancel_proposal` | Original proposer (Admin) or any Admin |

### Checks the contract enforces before proposal creation

1. Caller holds `Role::Admin` — error `UpgradeUnauthorized` (920) otherwise.
2. No other upgrade proposal is currently `Pending` or `Approved` — error `UpgradeUnauthorized` otherwise.
3. Vault must be initialized and not paused — error `NotInitialized` (2) or `VaultPaused` (1020).

---

## 3. Step 1 — Build the Deterministic WASM

Soroban upgrade hashes must match exactly. Any non-determinism in the build invalidates the hash comparison on-chain. Use the locked toolchain and flags below.

### 3.1 Pin the Rust toolchain

The contract locks `soroban-sdk = "22.0.8"`. Use stable Rust with the `wasm32-unknown-unknown` target.

```bash
# Confirm your toolchain
rustup show active-toolchain

# Install the WASM target if missing
rustup target add wasm32-unknown-unknown
```

### 3.2 Build in release mode

**Always** use `--release` and `--target wasm32-unknown-unknown`. Debug builds produce a different binary and a different hash.

```bash
cd contracts/vault
cargo build --target wasm32-unknown-unknown --release
```

The compiled artifact lands at:
```
contracts/vault/target/wasm32-unknown-unknown/release/vault_dao.wasm
```

### 3.3 Reproducibility

For an upgrade that will be reviewed by all signers, every reviewer must be able to independently build the same WASM from the same tagged commit and arrive at the same SHA-256 hash. To guarantee this:

- **Tag the exact commit** being deployed before sharing the hash with other signers.
- **Record the Rust toolchain version** in the PR description (`rustup show active-toolchain`).
- **Do not strip, compress, or post-process** the output WASM — Soroban uses the raw artifact.

---

## 4. Step 2 — Compute and Verify the WASM Hash

The `execute_upgrade` function calls `env.deployer().update_current_contract_wasm(wasm_hash)` with a `BytesN<32>` hash. You must compute this hash off-chain, supply it to `propose_upgrade`, and supply the same value again to `execute_upgrade`. The contract pins the hash at proposal time and rejects any execution that presents a different value.

### 4.1 Compute the SHA-256 hash

```bash
# Linux / macOS
sha256sum contracts/vault/target/wasm32-unknown-unknown/release/vault_dao.wasm

# macOS (shasum)
shasum -a 256 contracts/vault/target/wasm32-unknown-unknown/release/vault_dao.wasm
```

Example output:
```
a3f2c1d4e5b6789012345678901234567890abcdef1234567890abcdef123456  vault_dao.wasm
```

### 4.2 Upload the WASM to Stellar

Before calling `propose_upgrade` the new WASM must be uploaded to the Stellar network so its hash is registered in ledger state:

```bash
stellar contract upload \
  --wasm contracts/vault/target/wasm32-unknown-unknown/release/vault_dao.wasm \
  --source <ADMIN_KEY> \
  --network testnet   # or mainnet
```

The CLI prints the `wasm_hash` (32-byte hex) you will pass to `propose_upgrade`.

### 4.3 Cross-verify the hash

Every signer should independently:

1. Checkout the tagged commit.
2. Build the WASM using the pinned toolchain.
3. Compute the SHA-256.
4. Compare against the `wasm_hash` included in the proposal description.

If the hashes do not match, do not approve the proposal.

---

## 5. Step 3 — Propose the Upgrade

```rust
// Function signature
pub fn propose_upgrade(
    env: Env,
    admin: Address,
    new_wasm_hash: BytesN<32>,
) -> Result<u64, VaultError>
```

### Via the Stellar CLI

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEY> \
  --network testnet \
  -- propose_upgrade \
  --admin <ADMIN_ADDRESS> \
  --new_wasm_hash <WASM_HASH_HEX>
```

### What the contract does

1. Requires `admin.require_auth()`.
2. Verifies the caller holds `Role::Admin`.
3. Verifies no upgrade is already pinned (`get_pending_upgrade()` returns `None`).
4. Requires `config.upgrade_timelock_delay >= 17_280` ledgers and computes `earliest_apply_ledger = current_ledger + config.upgrade_timelock_delay`.
5. Creates a `Proposal` with:
   - `memo = Symbol("upgrade")`
   - `priority = Priority::Critical`
   - `unlock_ledger = earliest_apply_ledger`
   - `expires_at = current_ledger + (config.upgrade_timelock_delay * 10)`
   - `metadata["wasm_hash"]` = lowercase hex of the supplied hash
   - `snapshot_signers` = all current signers at the moment of creation
6. Stores a `PendingUpgrade` record containing the proposal ID, exact `wasm_hash`, proposer, and `earliest_apply_ledger`. If an upgrade is cancelled or executed this record is cleared; until then a second proposal is rejected with `UpgradeUnauthorized`.
7. Emits `proposal_created` and `upgrade_proposed` events.
8. Returns the new `proposal_id`.

### Record the proposal ID

Save the returned `proposal_id`. All signers need it to approve, and you will need it for `execute_upgrade` or `cancel_upgrade`. You can inspect the pin at any time:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_pending_upgrade
```

---

## 6. Step 4 — M-of-N Approval (Unanimous Consent)

Unlike regular transfer proposals, upgrade proposals require **every signer** to approve. The `execute_upgrade` function enforces:

```rust
if proposal.approvals.len() != config.signers.len() {
    return Err(VaultError::UpgradeUnauthorized);
}
```

### Each signer approves

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <SIGNER_KEY> \
  --network testnet \
  -- approve_proposal \
  --signer <SIGNER_ADDRESS> \
  --proposal_id <PROPOSAL_ID>
```

Normal `approve_proposal` rules apply:
- Signer must be in `snapshot_signers` (the set captured at proposal creation).
- Signer must also still be in `config.signers` (Issue #1351: removed signers cannot vote).
- A signer who has already approved is silently skipped.
- Voting delegation applies — if a signer has delegated their vote, the delegate's approval counts for the delegator as well.

### Verify approval progress

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_proposal \
  --proposal_id <PROPOSAL_ID>
```

Check `approvals.len()` against the total signer count from `get_config().signers.len()`. Both must be equal before proceeding.

---

## 7. Step 5 — Execute the Upgrade

After all signers have approved and the timelock has expired, any authorized address can trigger execution.

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <EXECUTOR_KEY> \
  --network testnet \
  -- execute_upgrade \
  --executor <EXECUTOR_ADDRESS> \
  --proposal_id <PROPOSAL_ID> \
  --expected_wasm_hash <WASM_HASH_HEX>
```

`expected_wasm_hash` must match the value passed to `propose_upgrade`. The contract deploys the pinned hash, not the caller-supplied value; the argument exists so a mismatched transaction fails before the host call.

### What the contract checks before executing

| Check | Error if failed |
|---|---|
| The vault is not paused | `VaultPaused` (1020) |
| A `PendingUpgrade` exists for this proposal ID | `UpgradeNotFound` (923) |
| `proposal.memo == Symbol("upgrade")` | `ProposalNotFound` (20) |
| `proposal.status == ProposalStatus::Approved` | `ProposalNotApproved` (22) |
| `current_ledger >= pending.earliest_apply_ledger` and `>= proposal.unlock_ledger` | `UpgradeTimelockActive` (921) |
| `proposal.approvals.len() == config.signers.len()` | `UpgradeUnauthorized` (920) |
| `expected_wasm_hash == pending.wasm_hash` | `UpgradeHashMismatch` (924) |

### What happens on success

1. `env.deployer().update_current_contract_wasm(pending.wasm_hash)` is called — this is the Soroban host call that atomically replaces the contract bytecode with the exact hash signers approved.
2. `proposal.status` is set to `ProposalStatus::Executed` and the `PendingUpgrade` record is cleared.
3. An audit entry `AuditAction::ExecuteProposal` is written.
4. `upgrade_applied` and `initialized` events are emitted with the proposal ID, pinned hash, apply ledger, and current threshold, signalling the new contract version to indexers.

> **Important:** After `update_current_contract_wasm` returns, all subsequent invocations of the contract will run the new WASM. The storage layout, instance data, and persistent records are preserved exactly as-is — only the code changes.

### Cancelling a pending upgrade

If the release must be halted before the timelock expires, any Admin can cancel the pin. Cancellation marks the proposal `Cancelled`, removes the `PendingUpgrade` record (so a replacement proposal can be created), and emits `upgrade_cancelled`.

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEY> \
  --network testnet \
  -- cancel_upgrade \
  --admin <ADMIN_ADDRESS> \
  --proposal_id <PROPOSAL_ID>
```

After cancellation, `execute_upgrade` for that proposal returns `UpgradeNotFound`. Signers must approve a fresh proposal with the replacement hash.

---

## 8. Step 6 — Post-Upgrade Validation

Perform these checks immediately after the upgrade transaction confirms.

### 8.1 Verify the proposal is executed

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_proposal \
  --proposal_id <PROPOSAL_ID>
```

Expected: `status = Executed`.

### 8.2 Verify config integrity

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_config
```

Confirm:
- `signers` list is unchanged.
- `threshold` is unchanged.
- `spending_limit`, `daily_limit`, `weekly_limit` are unchanged.
- No new fields carry unexpected zero or default values that indicate storage migration issues.

### 8.3 Verify audit trail continuity

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_audit_entries \
  --offset 0 \
  --limit 5
```

The last entry should be `AuditAction::ExecuteProposal` for the upgrade proposal ID.

### 8.4 Smoke test critical paths

Run at minimum:

```bash
# 1. Verify a new proposal can be created
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <TREASURER_KEY> \
  --network testnet \
  -- propose_transfer \
  ...

# 2. Verify a signer can approve it
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <SIGNER_KEY> \
  --network testnet \
  -- approve_proposal \
  --signer <SIGNER_ADDRESS> \
  --proposal_id <NEW_PROPOSAL_ID>
```

### 8.5 Check backend indexer

The backend emits `upgrade_proposed` at proposal time, `upgrade_applied` when the pin is applied, plus `proposal_executed` and `initialized` for the new version. Confirm the backend's event stream shows these without gaps and that the pinned hash in `upgrade_proposed` matches `upgrade_applied`.

---

## 9. Rollback Procedure

Soroban's `update_current_contract_wasm` is **not directly reversible** — once the upgrade transaction is included in a closed ledger, the new WASM is live and cannot be undone by reverting that ledger.

### 9.1 Forward rollback — deploy the previous WASM

The correct rollback is to perform a second upgrade that re-deploys the previous WASM:

1. **Retrieve the previous WASM hash.** Before any upgrade, record the currently deployed contract's code hash:
   ```bash
   stellar contract info \
     --id <CONTRACT_ID> \
     --network testnet
   ```
   Store the `wasm_hash` field in a pre-upgrade checklist item.

2. **Upload the previous WASM** to the network if it is not already uploaded (it should still be in the ledger's WASM store):
   ```bash
   stellar contract upload \
     --wasm path/to/previous/vault_dao.wasm \
     --source <ADMIN_KEY> \
     --network testnet
   ```

3. **Propose, approve, and execute** a new upgrade proposal with the previous WASM hash, following Steps 3–7 above.

> Note: The `upgrade_timelock_delay` (minimum 17,280 ledgers) applies to the rollback upgrade as well, so it cannot be reduced below 24 hours. If the defect is critical, the Admin can activate the emergency pause first to halt fund movements while the rollback is assembled and approved.

### 9.2 Emergency pause while rollback is in flight

If the defective upgrade creates an active security risk, pause the vault immediately while assembling the rollback proposal:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEY> \
  --network testnet \
  -- pause_vault \
  --admin <ADMIN_ADDRESS> \
  --cause emergency_upgrade_rollback
```

This sets `PauseState.is_paused = true`, which blocks all `propose_transfer`, `execute_proposal`, `execute_recurring_payment`, and stream operations. Proposals can still be approved so signers can vote on the rollback proposal while the vault is paused.

### 9.3 Cancel the defective upgrade proposal before execution

If the upgrade proposal has been created and approved but not yet executed, and the defect is discovered in the approval window, **cancel it before it can be executed**:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEY> \
  --network testnet \
  -- cancel_proposal \
  --canceller <ADMIN_ADDRESS> \
  --proposal_id <UPGRADE_PROPOSAL_ID> \
  --reason bad_wasm_hash
```

An Admin cancelling another account's proposal uses rejection semantics internally (see `cancel_proposal` implementation). This sets the proposal to `Rejected` and removes it from the priority queue.

### 9.4 What cannot be rolled back

| Item | Recoverable? |
|---|---|
| Code changes (`update_current_contract_wasm`) | Only by forward upgrade to previous WASM |
| Storage data changes made by the new code | Only if new code provides migration/revert functions |
| Executed proposals under the new code | No — on-chain transfers are final |
| Emitted events | No — events are immutable ledger records |

---

## 10. Upgrade Checklist

Use this checklist before every production upgrade.

### Pre-upgrade (at least 48 hours before)

- [ ] Source code for the new version is tagged (`git tag vX.Y.Z`) on the release commit.
- [ ] The tagged commit passes all CI checks (`cargo test`, `cargo clippy`, `cargo fmt --check`).
- [ ] `cargo audit --config .cargo/audit.toml` passes with no unfixed advisories.
- [ ] The new WASM has been built from the tagged commit using the pinned stable toolchain.
- [ ] SHA-256 of the WASM has been computed and distributed to all signers.
- [ ] Each signer has independently built and verified the WASM hash.
- [ ] The current contract's WASM hash has been recorded as the rollback target.
- [ ] The new WASM has been uploaded to the network and the upload transaction is confirmed.

### Proposal creation

- [ ] `propose_upgrade` has been called by an Admin.
- [ ] The returned `proposal_id` has been shared with all signers.
- [ ] `get_pending_upgrade()` shows the expected hash, proposer, and `earliest_apply_ledger`.
- [ ] The proposal's `unlock_ledger` and `metadata["wasm_hash"]` match the pin (timelock expiry and hash).

### Approval window

- [ ] All N signers have approved the upgrade proposal.
- [ ] `get_proposal(proposal_id).approvals.len() == config.signers.len()`.
- [ ] The timelock has expired (`current_ledger >= get_pending_upgrade().earliest_apply_ledger`).

### Execution

- [ ] `execute_upgrade` has been called with the same hash that was proposed and confirmed.
- [ ] `get_proposal(proposal_id).status == Executed`.
- [ ] `get_pending_upgrade()` returns no value.

### Schema migration (issue #1748)

The contract stores `DataKey::SchemaVersion` (`storage::CURRENT_SCHEMA_VERSION`). Deployments that predate versioning report version 0. After `execute_upgrade`, any call that reads the config fails with `SchemaVersionMismatch` until an admin runs `migrate(admin, from_version)` with `from_version` equal to `get_schema_version()`.

- [ ] Note `get_schema_version()` before the upgrade.
- [ ] After upgrade, call `migrate(admin, <old_version>)`.
- [ ] Confirm `get_schema_version()` equals the new build's version.
- [ ] When changing `Config`, `Proposal`, or `Escrow` types, bump `CURRENT_SCHEMA_VERSION` and add a migration step in `migrate`.

Schema version 2 adds the default per-signer pending proposal cap and rebuilds
the pending-proposal and active-stream recipient indexes for existing vaults.

### Post-upgrade validation

- [ ] `get_config()` returns expected, unchanged settings.
- [ ] Audit trail shows `AuditAction::ExecuteProposal` for the upgrade proposal.
- [ ] A smoke-test proposal has been created and approved successfully.
- [ ] Backend event indexer shows `upgrade_proposed`, `upgrade_applied`, `proposal_executed`, and `initialized` events without gaps, with matching hashes.

---

*For the contract's general security model, see [SECURITY.md](SECURITY.md). For the full audit scope, see [AUDIT_SCOPE.md](AUDIT_SCOPE.md). For deployment instructions, see [DEPLOYMENT.md](DEPLOYMENT.md).*
