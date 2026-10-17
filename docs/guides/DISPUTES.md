# Disputes and Arbitration Guide

**Audience:** Signers, escrow funders and recipients, and anyone holding the Admin or DisputeArbitrator role.
**Goal:** Explain the two dispute mechanisms in VaultDAO, which is which, who may file and arbitrate, what bonds apply, what each outcome does, and which events are emitted.

---

## Table of contents

1. [Two mechanisms](#1-two-mechanisms)
2. [Roles](#2-roles)
3. [Proposal disputes](#3-proposal-disputes)
4. [Escrow disputes](#4-escrow-disputes)
5. [Bonds and outcomes](#5-bonds-and-outcomes)
6. [Events](#6-events)
7. [Worked examples](#7-worked-examples)
8. [Pitfalls](#8-pitfalls)

---

## 1. Two mechanisms

VaultDAO has two separate dispute paths. They share the word "dispute" but track different objects and settle differently.

| | Proposal dispute | Escrow dispute |
|---|---|---|
| **Object** | A treasury proposal (`Proposal` with a `dispute` record) | An escrow agreement (`Escrow`) |
| **File with** | `raise_dispute` | `dispute_escrow` |
| **Who may file** | Any signer (proposal-only), or the escrow funder or recipient when linked to an escrow | The escrow funder, or an Admin |
| **Bond** | Required. Posted by the disputer in the bond token | None |
| **Resolve with** | `resolve_dispute_with_outcome` (preferred), or the older `resolve_dispute` | `resolve_escrow_dispute` or `auto_resolve_escrow` |
| **Settles** | Bond according to the outcome, and any linked escrow | Remaining escrow funds to recipient or funder |
| **Who may decide** | Admin or DisputeArbitrator | Admin or DisputeArbitrator (`resolve_escrow_dispute`); anyone after timeout (`auto_resolve_escrow`) |

Use a **proposal dispute** when the question is whether a treasury action should go ahead, and money is at stake as a deposit. Use an **escrow dispute** when the question is whether an agreed payment should be released or refunded.

---

## 2. Roles

| Role | Can file | Can arbitrate |
|------|----------|---------------|
| Signer | Proposal disputes (no escrow link) | Only if also Admin or DisputeArbitrator |
| Escrow funder or recipient | Proposal disputes linked to their escrow | No |
| Admin | Escrow disputes | Yes |
| DisputeArbitrator | No | Yes |

DisputeArbitrator is a narrow role. It can resolve disputes but does **not** have general Admin privileges.

Arbitrators cannot resolve a dispute they filed. `resolve_dispute_with_outcome` returns `ArbitratorCannotResolveOwnDispute` in that case.

---

## 3. Proposal disputes

### 3.1 Filing

`raise_dispute(disputer, proposal_id, escrow_id, reason, evidence, bond_token, bond_amount)`:

- The proposal must exist.
- **With `escrow_id`:** the disputer must be the escrow's funder or recipient. The escrow status is set to `Disputed` and the reason is recorded on the escrow.
- **Without `escrow_id`:** the disputer must be a signer (`NotASigner` otherwise).
- The proposal must not be `Executed` or `Cancelled`.
- If an earlier dispute on the same proposal has been **dismissed**, a new one is refused with `DisputeAlreadyDismissed`.
- `bond_amount` must be positive (`DisputeBondTooSmall` otherwise). The bond is transferred into the vault.
- `evidence` is a list of strings, typically links or hashes to off-chain material.

The dispute is stored with status `Filed` and linked to the proposal. `get_proposal_disputes(proposal_id)` returns its dispute IDs, and `get_dispute(dispute_id)` returns the record.

### 3.2 Resolving

There are two resolution entrypoints.

**`resolve_dispute_with_outcome(arbitrator, dispute_id, outcome)`** is the one to use. It requires DisputeArbitrator or higher, and settles the bond according to the outcome in [section 5](#5-bonds-and-outcomes). It returns `DisputeAlreadyResolved` if the dispute is already resolved or dismissed.

**`resolve_dispute(admin, dispute_id, resolution)`** is the older path. It requires an Admin or a signer. It records a resolution and, if the disputer has an escrow in `Disputed` status, releases or refunds that escrow's remaining funds. **It does not settle the dispute bond.** Use `resolve_dispute_with_outcome` for any dispute that has a bond.

Both entrypoints are blocked while the vault is paused.

---

## 4. Escrow disputes

### 4.1 Filing

`dispute_escrow(disputer, escrow_id, reason)`:

- The disputer must be the escrow's funder **or** hold the Admin role.
- The escrow must be `Active` or `MilestonesComplete`.
- The status becomes `Disputed` and the reason is stored.
- No bond is taken and no proposal is involved.

### 4.2 Resolving

**`resolve_escrow_dispute(arbitrator, escrow_id, release_to_recipient)`** requires DisputeArbitrator or higher, and the escrow must be `Disputed`.

- All unreleased funds go to the recipient if `release_to_recipient` is `true`, otherwise to the funder.
- The escrow status becomes `Released` or `Refunded`.
- Blocked while paused.

**`auto_resolve_escrow(escrow_id)`** can be called by anyone. If the escrow has been `Disputed` for at least `arbitration_timeout_ledgers` since it was created, all remaining funds are refunded to the funder. It is blocked while paused.

> The timeout is measured from escrow creation, not from the time the dispute was filed. A dispute filed late in an escrow's life can be auto-resolved immediately.

---

## 5. Bonds and outcomes

Only proposal disputes carry a bond. `resolve_dispute_with_outcome` applies one of three outcomes:

| Outcome | Dispute status | Resolution recorded | Bond |
|---------|----------------|---------------------|------|
| `UpholdDispute` | `Resolved` | `InFavorOfDisputer` | Full bond returned to the disputer |
| `DismissDispute` | `Dismissed` | `Dismissed` | Half returned to the disputer; half (rounded down) kept by the vault |
| `DrawDispute` | `Resolved` | `Compromise` | Full bond returned to the disputer |

A dismissed dispute also blocks any future dispute on the same proposal (`DisputeAlreadyDismissed`).

**Choosing an outcome.** `UpholdDispute` records that the dispute was justified and returns the bond. `DismissDispute` records that it was not and keeps half the bond. `DrawDispute` returns the bond without a finding for either side. The contract does not define how an arbitrator should pick between them; that is a governance decision for your process.

### 5.1 Resolution codes

`DisputeStatus`: `Filed`, `UnderReview`, `Resolved`, `Dismissed`.

`DisputeResolution`: `InFavorOfProposer`, `InFavorOfDisputer`, `Compromise`, `Dismissed`.

`DisputeOutcome`: `UpholdDispute`, `DismissDispute`, `DrawDispute`.

`UnderReview` exists in the enum, but no entrypoint sets it. A dispute goes from `Filed` straight to a final status.

---

## 6. Events

| Event (helper name) | When |
|---------------------|------|
| `emit_dispute_raised` | A proposal dispute is filed |
| `emit_dispute_bond_posted` | A proposal dispute bond is transferred in |
| `emit_dispute_resolved` | A dispute is resolved through `resolve_dispute` |
| `emit_dispute_outcome` | A dispute is resolved through `resolve_dispute_with_outcome` |
| `emit_dispute_bond_slashed` | The kept share of a dismissed bond is recorded |
| `emit_dispute_bond_returned` | A bond is returned to the disputer |

Escrow dispute filing and resolution change the escrow status; follow the escrow ID and status to track them. The helper names are from `events.rs`; check the emitted topic names in your indexer before relying on them.

---

## 7. Worked examples

### 7.1 Signer disputes a proposal and wins

1. Signer `S1` calls `raise_dispute(S1, 42, None, "bad_recipient", ["ipfs://..."], USDC, 500)`. The vault holds 500 USDC. Dispute `7` is `Filed`.
2. An arbitrator `A` (DisputeArbitrator) reviews and calls `resolve_dispute_with_outcome(A, 7, UpholdDispute)`.
3. `S1` receives the 500 back. Dispute `7` is `Resolved` with `InFavorOfDisputer`.

### 7.2 Dismissed dispute

Same filing as above, but the outcome is `DismissDispute`.

- `S1` receives 250.
- The vault keeps 250. The dispute-bond-slashed event reports the slashed and kept amounts.
- Dispute `7` is `Dismissed`, and no further disputes can be filed on proposal `42`.

### 7.3 Escrow dispute

1. Escrow `15` is `Active`. The funder calls `dispute_escrow(funder, 15, "milestone_not_met")`. No bond is taken.
2. An arbitrator calls `resolve_escrow_dispute(arbitrator, 15, false)`. The remaining funds return to the funder. The escrow is `Refunded`.

If the arbitrator never acts, anyone can call `auto_resolve_escrow(15)` once the timeout has passed.

---

## 8. Pitfalls

- **Do not use `resolve_dispute` for bonded disputes.** It leaves the bond where it is.
- **Escrow-linked proposal disputes share state with escrow disputes.** Filing `raise_dispute` with an `escrow_id` moves the escrow to `Disputed`. Resolving that escrow with `resolve_escrow_dispute` does not update the proposal dispute record, so resolve both explicitly.
- **Arbitrator independence.** An arbitrator who is also a party cannot resolve their own proposal dispute. Nothing in the contract stops an arbitrator from resolving an escrow dispute they are otherwise involved in, so apply that check in your process.

---

## Related guides

- [Insurance and staking](INSURANCE_AND_STAKING.md)
- [Treasury risk management](TREASURY_RISK_MANAGEMENT.md)
- [Proposal supersession](PROPOSAL_SUPERSESSION.md)
