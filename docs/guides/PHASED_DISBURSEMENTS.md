# Phased Treasury Disbursements (VaultDAO Guide)

> Written for **DAO operators** planning multi-step payouts (grants, vendor
> onboarding, milestone payments) and **integrators** wiring these flows into
> tooling. Full function signatures live in the
> [API reference](../reference/API.md#multi-phase-proposals).

A phased disbursement groups up to **five** treasury operations under a
single multisig approval and executes them in a fixed order. If a later phase
fails, the whole execution is abandoned — no partial payout is left behind.

Typical uses:

- Whitelist a new vendor **and** pay their first invoice in one approved action
- Pay several grant recipients in a defined order
- Rotate a signer out and pay a final settlement together

---

## 1. Concepts

| Concept | Description |
| --- | --- |
| **Base proposal** | A regular `Proposal` created by `create_multi_phase_proposal`. It carries no funds (`amount = 0`, memo `multi_phase`) and exists only so signers can vote on the bundle. |
| **Phase** | One `ProposalOperation` (`Transfer`, `RemoveSigner`, or `UpdateWhitelist`) plus an optional `rollback_operation`. |
| **Rollback operation** | A compensating action for a phase, run in reverse order if a later phase fails. |
| **Balance snapshot** | A ledger checkpoint (`take_manual_snapshot`) you can record before and after a disbursement for audit trails. |

Roles required:

| Action | Minimum role |
| --- | --- |
| `create_multi_phase_proposal` | Treasurer |
| `approve_proposal` | Signer |
| `execute_multi_phase_proposal` | Treasurer |
| `set_snapshot_interval` / `take_manual_snapshot` | Admin |

---

## 2. Plan the phases

Order matters: phases run top to bottom and stop at the first failure.

1. **Put preconditions first.** Whitelist additions should precede transfers
   to the new recipient, otherwise the transfer phase fails on whitelist-mode
   vaults.
2. **Give reversible phases a rollback.** For `UpdateWhitelist(addr, Add)`
   the natural rollback is `UpdateWhitelist(addr, Remove)`.
3. **Keep transfers late.** Token transfers cannot be "un-sent" by a
   rollback operation, so place the riskiest non-transfer steps earlier.
4. **Stay within five phases.** Split larger programmes into several
   multi-phase proposals.
5. **Check the balance up front.** The sum of all `Transfer` amounts per
   token must be available in the vault at execution time.

Example — onboard a contractor and pay two milestones:

| # | Operation | Rollback |
| --- | --- | --- |
| 0 | `UpdateWhitelist(contractor, Add)` | `UpdateWhitelist(contractor, Remove)` |
| 1 | `Transfer(contractor, USDC, 5_000, "m1")` | none |
| 2 | `Transfer(contractor, USDC, 7_500, "m2")` | none |

---

## 3. Walkthrough

### Step 1 — (optional) checkpoint the treasury

```rust
vault.set_snapshot_interval(&admin, &17_280);   // advisory: ~1 day between snapshots
let before = vault.take_manual_snapshot(&admin); // requires ≥100 ledgers since the last one
```

### Step 2 — create the proposal

```rust
let phases = vec![
    &env,
    ProposalPhase {
        operation: ProposalOperation::UpdateWhitelist(contractor.clone(), ListAction::Add),
        rollback_operation: OptionalProposalOperation::Some(
            ProposalOperation::UpdateWhitelist(contractor.clone(), ListAction::Remove),
        ),
        status: ProposalPhaseStatus::Pending,
    },
    ProposalPhase {
        operation: ProposalOperation::Transfer(
            contractor.clone(), usdc.clone(), 5_000_0000000, Symbol::new(&env, "m1"),
        ),
        rollback_operation: OptionalProposalOperation::None,
        status: ProposalPhaseStatus::Pending,
    },
    ProposalPhase {
        operation: ProposalOperation::Transfer(
            contractor.clone(), usdc.clone(), 7_500_0000000, Symbol::new(&env, "m2"),
        ),
        rollback_operation: OptionalProposalOperation::None,
        status: ProposalPhaseStatus::Pending,
    },
];
let proposal_id = vault.create_multi_phase_proposal(&treasurer, &phases);
```

The base proposal expires roughly **7 days** (120,960 ledgers) after creation.

### Step 3 — collect approvals

Signers vote on `proposal_id` exactly like any other proposal:

```rust
vault.approve_proposal(&signer_a, &proposal_id);
vault.approve_proposal(&signer_b, &proposal_id);
```

Once threshold and quorum are met the base proposal becomes `Approved`.

### Step 4 — execute

```rust
vault.execute_multi_phase_proposal(&treasurer, &proposal_id);
```

On success every phase is `Executed` and the base proposal is `Executed`.

### Step 5 — (optional) checkpoint again

```rust
let after = vault.take_manual_snapshot(&admin);
let history = vault.get_snapshot_at(&(before.ledger as u32)); // nearest snapshot at/before a ledger
let latest = vault.get_latest_snapshot();
```

---

## 4. Failure handling

If any phase fails, `execute_multi_phase_proposal` returns
`PhaseExecutionFailed` (621). The contract attempts rollbacks for the phases
that already ran, but because the invocation ends in an error the Soroban
host reverts **all** of its effects. The practical outcome is:

- No tokens moved, no whitelist or signer changes persisted
- The base proposal is still `Approved`

Recovery checklist:

1. Identify the failing phase by simulating the call (the simulation's
   diagnostic events show which operation errored).
2. Fix the cause — top up the vault, remove a duplicate whitelist entry,
   make sure a signer removal does not drop below the threshold.
3. Call `execute_multi_phase_proposal` again before the proposal expires, or
   cancel it and create a corrected one.

Other errors:

| Error | Meaning |
| --- | --- |
| `TooManyPhases` (620) | Zero or more than five phases supplied at creation |
| `ProposalNotApproved` (22) | Execution attempted before approval |
| `MultiPhaseProposalNotFound` (622) | ID belongs to a regular proposal |
| `InsufficientRole` (12) | Caller below Treasurer (or Admin for snapshots) |
| `InvalidAmount` (40) | Snapshot interval < 100, or snapshot taken < 100 ledgers after the previous one |

---

## 5. Snapshot notes

- Up to **90** snapshots are retained; the oldest is dropped first.
- `get_snapshot_at(ledger)` returns the newest snapshot at or before `ledger`,
  or `None` if it has been evicted or none exist.
- `set_snapshot_interval` only stores the desired cadence — schedule a keeper
  to call `take_manual_snapshot` at that interval.
- Snapshots currently capture the ledger and timestamp only; `balances`,
  `total_staked` and `pending_releases` are left empty/zero. Pair them with
  off-chain balance queries until on-chain balance capture lands.
- Each snapshot emits a `snapshot_taken` event `(ledger, token_count)` that
  indexers can subscribe to.
