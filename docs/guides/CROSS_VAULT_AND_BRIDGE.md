# Cross-Vault and Bridge Guide

How to coordinate actions across vaults (`set_cross_vault_config`,
`propose_cross_vault`, `execute_cross_vault`) and how to move assets
between vaults/chains (`set_bridge_config`, `propose_bridge_transfer`,
`bridge_to_vault`, `confirm_bridge_receipt`).

## Stability

| Area | Status |
|---|---|
| `set_cross_vault_config`, `propose_cross_vault`, `execute_cross_vault` | **Stable.** Same-vault governance rules apply (threshold, quorum, timelock). |
| `bridge_to_vault`, `confirm_bridge_receipt` (direct vault-to-vault transfer) | **Stable.** Record-based flow with slippage and deadline protection. |
| `set_bridge_config`, `propose_bridge_transfer` (adapter-mediated cross-chain proposals) | **Experimental.** Adapter interface and finality rules may change. |

## Feature flags

Both subsystems are opt-in per vault:

- Cross-vault: `CrossVaultConfig.enabled` (via `set_cross_vault_config`).
  `authorized_coordinators` lists the vault addresses allowed to coordinate
  actions on this vault; `max_action_amount` / `max_actions` bound each
  proposal.
- Bridge: `BridgeConfig.enabled` (via `set_bridge_config`).
  `bridge_adapters` lists the authorized adapter contracts;
  `max_action_amount` / `max_actions` bound each bridge proposal.

Calls are rejected when the corresponding flag is disabled. Both setters are
Admin-only.

## Trust assumptions

1. **Coordinators are trusted counterparties.** A coordinator listed in
   `authorized_coordinators` can propose actions that move this vault's funds
   once local governance approves them. Only list vaults you control or have
   audited agreements with.
2. **Adapters are trusted code.** An adapter in `bridge_adapters` executes
   cross-chain legs on this vault's behalf. A malicious or buggy adapter can
   lose funds in transit; keep the adapter list minimal.
3. **Destination chains are assumed to provide eventual finality.**
   The vault cannot observe the remote chain: receipt must be confirmed
   explicitly (see below). Until a receipt is confirmed and released, the
   funds stay reserved in the source vault: they count against exposure
   limits and cannot be spent elsewhere.
4. **Slippage bounds are the sender's responsibility.** Set `min_received`
   to the worst acceptable outcome; the confirmation step enforces it
   on-chain.

## Adapter interface requirements

An adapter contract used with `propose_bridge_transfer` must:

- expose an execute entrypoint the vault can call with the proposal's
  asset list and destination identifiers;
- report per-asset success/failure so the vault can record
  `execution_results` (`CrossChainProposal`) accurately;
- never take custody beyond the exact amounts in the approved proposal
  (the vault transfers only what governance approved);
- be deterministic and idempotent: re-execution after a partial failure
  must not double-spend a leg that already succeeded.

## Receipt-confirmation flow (`bridge_to_vault` / `confirm_bridge_receipt`)

Funds are **reserved, not sent** when a bridge starts. A pending transfer
always ends in exactly one terminal state, so it can never be paid out twice
or both paid out and refunded.

```text
            confirm (window = 0) ──────────────► Confirmed + released
Initiated ─ confirm (window > 0) ─► Confirmed ─┬─ release_bridge_transfer ─► released
    │                                          └─ dispute_bridge_receipt ──► Disputed (unlocked)
    └─ expire_bridge_transfer (after deadline) ─► Returned (unlocked)
```

1. **Initiate.** `bridge_to_vault(caller, target_vault, token, amount,
   min_received, deadline_ledger)` requires the Treasurer role. It checks
   that `amount` is covered by the vault's *available* (unearmarked) balance,
   otherwise it fails with `InsufficientBalance`. It then reserves `amount`
   (`get_reserved_bridge_balance(token)`), stores a `BridgeRecord`
   (`Initiated`) and returns a `bridge_id` (hash of source + target + token +
   amount + ledger). Reserved funds count as earmarked, so no other flow can
   spend them.
2. **Confirm.** `confirm_bridge_receipt(caller, bridge_id, actual_amount)`:
   - the caller must be the target vault, a registered bridge adapter
     (`BridgeConfig.bridge_adapters`) or a signer of the source vault,
     otherwise `Unauthorized`;
   - after `deadline_ledger` it fails with `BridgeDeadlineExceeded` and
     **changes nothing**; use `expire_bridge_transfer` instead;
   - `actual_amount < min_received` fails with `BridgeSlippageExceeded`, and
     `actual_amount > amount` with `InvalidAmount`; the record stays
     `Initiated`;
   - otherwise the receipt is recorded (`get_bridge_receipt`) and the record
     moves to `Confirmed`. With no challenge window the reserved amount is
     released to `target_vault` at once. Otherwise it is released later by
     `release_bridge_transfer(bridge_id)`, which anyone can call once
     `release_after` has passed (`BridgeChallengeWindowActive` before then).
3. **Conflicting receipts.** Only the first valid receipt is accepted. A later
   receipt with a different `actual_amount` or a different confirmer fails with
   the stable error `BridgeReceiptConflict`. Replaying the same receipt fails
   with `BridgeInvalidStatus`. Neither moves funds.
4. **Timeout.** `expire_bridge_transfer(bridge_id)` can be called by anyone
   once `deadline_ledger` has passed while the record is still `Initiated`. It
   unlocks the reservation (the funds never left the vault) and marks the
   record `Returned`. A second call fails with `BridgeInvalidStatus`.
5. **Dispute (optional fraud proofs).** While a confirmed receipt is inside its
   challenge window and not yet released,
   `dispute_bridge_receipt(disputer, bridge_id, proof)` asks the configured
   verifier to check the proof. If the verifier returns `true`, the reservation
   is unlocked, nothing is sent, and the record becomes `Disputed`. A verifier
   that returns `false` or traps, or a missing verifier, fails with
   `BridgeFraudProofRejected`.

### Receipt configuration

`set_bridge_receipt_config(admin, BridgeReceiptConfig { fraud_proof_verifier,
challenge_window_ledgers })` (Admin only; read it with
`get_bridge_receipt_config`). It applies to receipts confirmed after the call.

A fraud-proof verifier is any contract that exposes:

```rust
fn verify_bridge_fraud_proof(bridge_id: BytesN<32>, claimed_amount: i128, proof: Bytes) -> bool;
```

`claimed_amount` is the `actual_amount` from the receipt under dispute. The
proof format is defined by the verifier. A typical proof is a conflicting
signed receipt, or a light-client proof showing that the remote leg did not
deliver.

### Events

| Event | When |
|---|---|
| `bridge_to_vault_initiated` | Funds reserved |
| `bridge_receipt_confirmed` | First valid receipt recorded |
| `bridge_released` | Reserved funds transferred to the target vault |
| `bridge_timed_out` + `bridge_funds_returned` | Timeout unlocked the reservation |
| `bridge_disputed` | Fraud proof accepted, reservation unlocked |
| `bridge_receipt_cfg` | Receipt configuration changed |

### Storage rent

Each pending `BridgeRecord` and its receipt get a TTL that covers
`deadline_ledger + challenge_window_ledgers` plus one day of slack, capped at
the network maximum. This stops a record from being archived while funds are
still reserved against it. Settled records keep the default proposal TTL.
For very long deadlines, anyone can call
`extend_bridge_intent_ttl(bridge_id)` to extend the TTL again.

## Failure handling

| Failure | Behavior |
|---|---|
| Amount exceeds spending limit / `max_action_amount` | Rejected upfront (`BridgeAmountExceedsLimit`, `InvalidAmount`). |
| Amount exceeds available (unearmarked) balance | Rejected upfront (`InsufficientBalance`). |
| Caller lacks Treasurer role | Rejected (`InsufficientRole`). |
| `deadline_ledger` already passed at initiation | Rejected (`BridgeDeadlineExceeded`). |
| Confirmation after deadline | Rejected (`BridgeDeadlineExceeded`), no state change; call `expire_bridge_transfer` to unlock the reservation (status `Returned`). |
| Slippage (`actual_amount < min_received`) | Confirmation rejected; funds stay reserved until a valid receipt or the timeout. |
| Conflicting receipt | Rejected (`BridgeReceiptConflict`); the first receipt stands. |
| Fraud proof accepted | Reservation unlocked; status `Disputed`. |
| Duplicate `bridge_id` | Rejected (`BridgeAlreadyExists`). |
| Unknown `bridge_id` / wrong status | Rejected (`BridgeInvalidId` / `BridgeInvalidStatus`). |
| Partial multi-asset execution (adapter path) | Per-asset `execution_results`; failed legs can be retried without re-executing successful ones. |
| Emergency | `pause` blocks initiation, confirmation, release, dispute and expiry; `unpause` resumes. |

## Minimal example

```rust
// 1. Enable cross-vault coordination (admin).
client.set_cross_vault_config(&admin, &CrossVaultConfig {
    enabled: true,
    authorized_coordinators: vec![&env, partner_vault],
    max_action_amount: 10_000,
    max_actions: 5,
});

// 2. Bridge with 2% slippage tolerance and a 500-ledger deadline.
let bridge_id = client.bridge_to_vault(
    &caller, &target_vault, &token,
    &10_000, &9_800, &(&env.ledger().sequence() as u64 + 500),
);

// 3. Confirm receipt once delivered (target vault, adapter or signer).
//    With no challenge window this releases the reserved funds at once.
client.confirm_bridge_receipt(&target_vault, &bridge_id, &9_950);

// 3b. Or, if nothing arrives before the deadline, unlock the reservation.
// client.expire_bridge_transfer(&bridge_id);
```
