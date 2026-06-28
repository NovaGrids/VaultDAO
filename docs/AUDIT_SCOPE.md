# Audit Scope

This document defines the attack surface of the VaultDAO smart contract (`contracts/vault/src/lib.rs`) for a third-party security audit. It is a companion to [`SECURITY.md`](./SECURITY.md), which covers vulnerability disclosure; this document covers what an auditor should examine, what the contract claims to guarantee, and where the team's own analysis already found gaps.

**How this document was produced:** every finding below was traced against the actual current source on `main` (Soroban SDK `22.0.8`), not inferred from documentation or comments. Where a finding references a specific function or line, that reference was verified at the time of writing. Risk ratings follow a conservative bias as instructed: when exploitability is uncertain, the rating reflects the more severe interpretation rather than the more charitable one.

**A note on current code health before the audit begins:** while researching this document, several pre-existing defects were found that auditors should know about up front, because they affect how much weight to put on "this is tested" claims elsewhere in this document:

- `contracts/vault/src/types.rs` had (until a recent fix) a duplicate `staking_config` field in `InitConfig` — a compile error.
- `contracts/vault/src/errors.rs` currently has `PermissionNotFound` declared twice (lines 139 and 187) — also a compile error (E0428).
- `contracts/vault/src/test.rs` has at least 10 duplicate test function names (e.g. `test_deposit_exceeds_spending_limit`, `test_escrow_basic_flow`, `test_cancel_subscription` each appear twice) and ~23 call sites that construct `InitConfig` with duplicate field assignments.
- Three structural defects (two missing closing braces, one corrupted function body) were previously found in `lib.rs` itself — see the "Prior Issues" section below for details and status.

**Practical implication for the audit:** as of this writing, `contracts/vault` does not compile cleanly, and `cargo test` cannot run to completion against `test.rs` until the duplicate-declaration issues are resolved. This document was produced by static reading and targeted manual tracing of the affected logic, not by running the test suite end-to-end. Auditors should independently confirm the current compile status before relying on any "this is covered by tests" claim in §5.

---

## Table of Contents

1. [Attack Surface Catalogue](#1-attack-surface-catalogue)
   - [1.1 Cross-Contract Call Risk](#11-cross-contract-call-risk-soroban-specific-reentrancy)
   - [1.2 RBAC Bypass Scenarios](#12-rbac-bypass-scenarios)
   - [1.3 Timelock Bypass Scenarios](#13-timelock-bypass-scenarios)
   - [1.4 Spending Limit Bypass](#14-spending-limit-bypass)
   - [1.5 Integer Overflow Points](#15-integer-overflow-points)
   - [1.6 Contract Upgrade Mechanism](#16-contract-upgrade-mechanism--governance-is-disconnected-from-execution)
2. [Known Assumptions and Invariants](#2-known-assumptions-and-invariants)
3. [Out of Scope](#3-out-of-scope)
4. [Prior Issues and Resolutions](#4-prior-issues-and-resolutions)
5. [Test Coverage Cross-Reference](#5-test-coverage-cross-reference)

---

## Summary of Findings

| # | Finding | Section | Residual Risk |
|---|---|---|---|
| 1 | Contract upgrade execution discards the proposed WASM hash and substitutes a hardcoded all-zero hash | §1.6 | **High** |
| 2 | Unilateral signer-tier execution bypasses `timelock_threshold` entirely, with no validation linking tier limits to timelock configuration | §1.3 | **High** |
| 3 | No explicit reentrancy guard; proposal status remains `Approved` (not `Executed`) during the external token-transfer call | §1.1 | Medium |
| 4 | 39 call sites use direct role equality while 69 use the hierarchical `role_satisfies`, producing inconsistent `DisputeArbitrator` privileges depending on call site | §1.2 | Medium |
| 5 | Spending-limit refunds credit the current day/week bucket rather than the original one, causing accounting drift across bucket boundaries | §1.4 | Medium |
| 6 | Several `i128` multiplications on user-influenced values use raw arithmetic with no `overflow-checks` in the release profile | §1.5 | Medium |

This table is a navigation aid, not a substitute for reading each finding's full reasoning, mitigations, and recommendation in §1 — risk ratings here are necessarily compressed and the detailed sections contain the actual evidence and caveats behind each one.

---

## 1. Attack Surface Catalogue

Each entry lists: affected functions, existing mitigations, and a residual risk rating (Low / Medium / High). Ratings are conservative — see the note above.

### 1.1 Cross-Contract Call Risk (Soroban-specific "reentrancy")

Soroban does not have classic EVM-style reentrancy (a single host invocation either fully commits or fully rolls back), but it **does** allow a called contract to call back into the caller within the same top-level transaction. If the vault calls an attacker-supplied token contract, that token contract's code runs with the vault's authorization context already established, and it can attempt to call back into the vault's own public functions before the vault has finished its own state updates.

**Affected functions:** `propose_transfer` → `propose_transfer_internal` (line ~618, single-signer-meets-threshold path at line ~958-968), `execute_proposal` (line 1689) → `try_execute_transfer` (line 9586), `batch_execute_proposals`.

**The specific gap:** in `try_execute_transfer`, the vault's balance is checked (line 9622) and then `token::try_transfer` is called (line 9630) to an address supplied by the proposer (`proposal.token`) — an arbitrary contract address, not necessarily the canonical Stellar Asset Contract. The proposal's `status` field is **not** updated to `Executed` until control returns all the way back to `execute_proposal` (line 1850), well after the transfer call. During that window, `proposal.status` is still `Approved` in persistent storage.

**Existing mitigations:**
- Soroban's all-or-nothing transaction model means a panic anywhere in the call chain rolls back the entire transaction, including any in-flight reentrant call.
- `executor.require_auth()` is checked once at the top of `execute_proposal` — a reentrant call to `execute_proposal` for the same `proposal_id` would still need a valid `require_auth` for some address, which is non-trivial for an attacker-controlled token contract to forge for the original executor (Soroban auth is signature-based and scoped, not an ambient `msg.sender`-style check that the token can simply act as).

**What is not mitigated:**
- There is **no explicit reentrancy guard** anywhere in the codebase (no "in progress" flag set and checked at the start of `execute_proposal` / `try_execute_transfer`). The only reason a same-`proposal_id` reentrant call doesn't trivially re-execute is that auth and balance checks happen to be in the way — this is defense by accident, not by design.
- A non-standard token contract (anything other than the audited Stellar Asset Contract) is fully trusted by this code. The contract has no allowlist of token addresses and no check that `token_addr` behaves like a standard SAC.
- If a future code change moves the `proposal.status = Executed` write earlier, or if a different entry point calls `try_execute_transfer` with weaker auth requirements, the lack of an explicit guard becomes immediately exploitable rather than incidentally safe.

**Residual risk: Medium.** No confirmed working exploit was constructed as part of this review (that requires a deployed malicious token contract and live testing, which is squarely audit-scope work, not static analysis). Rated Medium rather than Low because the absence of an explicit guard means safety currently depends on auth/balance checks that were not designed as reentrancy protection, and rated Medium rather than High because Soroban's auth model and all-or-nothing rollback semantics meaningfully narrow the exploitable window compared to EVM-style reentrancy.

**Recommendation for auditors:** specifically test what happens when `proposal.token` points to a malicious contract whose `transfer` function calls back into `execute_proposal`, `approve_proposal`, or `cancel_proposal` for the same `proposal_id` before returning.

### 1.2 RBAC Bypass Scenarios

**Affected functions:** all functions gating access via `Role`, including `set_role`, `resolve_dispute`, `update_cost_model`, and 39+ other sites.

**The specific gap — inconsistent role-check mechanism.** `Role::role_satisfies(required, actual)` (in `types.rs`, line 290) implements a hierarchical check: normally `actual as u32 >= required as u32`, **plus a special case** where `Role::DisputeArbitrator` (discriminant `4`) explicitly satisfies a `Role::Admin` (discriminant `3`) requirement. This means by design, a `DisputeArbitrator` can act anywhere an `Admin` is required, *when the call site uses `role_satisfies`*.

However, 39 call sites in `lib.rs` check role via **direct equality** instead (`if role != Role::Admin { return Err(Unauthorized) }`, e.g. lines 2556, 2589, 3308, 4573, 4631, 4709, and more). At these sites, a `DisputeArbitrator` is rejected outright, contradicting the special case `role_satisfies` establishes elsewhere. The two mechanisms disagree about what a `DisputeArbitrator` is allowed to do, and which mechanism applies to any given function depends entirely on which pattern that function's author happened to use.

**Existing mitigations:**
- The `Role` enum's ordinal design (`Observer=0 < Member=1 < Treasurer=2 < Admin=3`) is intentional and mostly consistent for the four "normal" roles.
- 69 call sites do use `role_satisfies` correctly.

**What is not mitigated:**
- There is no single source of truth for "what can a `DisputeArbitrator` do" — the answer differs by call site, and nothing enforces consistency between the two patterns.
- `DisputeArbitrator = 4` being numerically *above* `Admin = 3` means any future code that's written using plain ordinal comparison (`actual as u32 >= 3`) without the special case will silently grant Admin-equivalent access to a DisputeArbitrator, even at sites that didn't intend to.

**Residual risk: Medium.** This is not an externally-triggerable privilege escalation by an unprivileged user — `DisputeArbitrator` is itself a privileged role only Admin can assign. The risk is internal inconsistency: an Admin reasonably assumes "DisputeArbitrator can resolve disputes and that's it," per `Role`'s doc comment (`/// Can resolve disputes.`), but the `role_satisfies` special case grants broader access at any `role_satisfies`-gated Admin-only function. Rated Medium rather than Low because the gap between documented intent and actual enforced behavior is a real, demonstrable inconsistency, not a hypothetical; rated Medium rather than High because exploiting it requires already holding a privileged role.

**Recommendation for auditors:** enumerate every call site using direct role equality versus `role_satisfies`, and confirm with the team whether `DisputeArbitrator`'s intended scope is "dispute resolution only" or "Admin-equivalent." The two are currently both true, depending which function you call.
### 1.3 Timelock Bypass Scenarios

**Affected functions:** `propose_transfer_internal` (line ~618), specifically the unilateral-execution branch at lines 957-975; `can_execute_unilaterally` (line 14345); `set_signer_tier` (line 14359).

**The specific gap — unilateral execution ignores `timelock_threshold` entirely.** `Config` supports per-signer "tiers" (`SignerTier::Junior(limit)`, `SignerTier::Senior(limit)`, `SignerTier::Principal`) that grant unilateral spending authority: a signer whose tier limit covers the proposal amount can propose **and immediately execute** a transfer in a single call, with no second approval and — critically — without ever checking or setting `unlock_ledger` (the field that normally enforces the timelock). The relevant code:

```rust
if Self::can_execute_unilaterally(&storage::get_signer_tier(&env, &proposer), amount, full_quorum_threshold) {
    proposal.approvals.push_back(proposer.clone());
    proposal.status = ProposalStatus::Approved;
    Self::try_execute_transfer(&env, &proposer, &mut proposal, current_ledger)?;
    proposal.status = ProposalStatus::Executed;
    // ...
}
```

`can_execute_unilaterally` only checks `amount <= tier.limit` and `amount <= full_quorum_threshold` (when set). It has no awareness of `config.timelock_threshold` at all.

`set_signer_tier` (the function an Admin uses to grant a tier) only validates `limit >= 0` — it does **not** reject a tier limit that exceeds `timelock_threshold`.

**Net effect:** if an Admin grants any signer a tier limit at or above `timelock_threshold` (whether deliberately, by misunderstanding the interaction between the two systems, or by typo), that signer can instantly execute transfers that would otherwise require the timelock delay — with no way for other signers to cancel or review the transfer first, since it executes in the same transaction it's proposed in.

**Existing mitigations:**
- Granting a tier requires `Role::Admin`, gated by `require_auth` and a role check (line 14365-14368).
- `full_quorum_threshold`, if set by an Admin, provides an independent cap regardless of tier limit.

**What is not mitigated:**
- Nothing connects tier-limit configuration to timelock configuration. The two are independently configurable, and the contract does not warn or reject a configuration where they conflict.
- This is silent: there's no event emitted specifically warning "this tier limit exceeds the timelock threshold," so the misconfiguration would only surface when someone notices a large transfer happened instantly.

**Residual risk: High.** Rated High, not Medium, because: (a) the bypass is total — not a partial weakening but a complete skip of the timelock mechanism for in-scope amounts, (b) the trigger condition (an Admin setting a tier limit) is a normal, expected administrative action that an Admin could take without realizing the timelock consequence, since nothing in `set_signer_tier`'s validation or documentation warns about the interaction, and (c) per the conservative-rating instruction, an unbounded high-value instant-execution path with no contract-level safeguard against misconfiguration warrants the higher rating even though it requires Admin-level trust to trigger.

**Recommendation for auditors:** confirm with the team whether unilateral tiers are intended to be timelock-exempt by design (a documented product decision) or whether `can_execute_unilaterally` / `set_signer_tier` should additionally check against `timelock_threshold`. Either way, this should be explicit, not implicit.

### 1.4 Spending Limit Bypass

**Affected functions:** `propose_transfer_internal`, `cancel_proposal`, `execute_proposal` (expiry branch, line 1737-1759), `storage::refund_spending_limits` (in `storage.rs`, line 1332).

**The specific gap — refunds credit the wrong time bucket.** Daily and weekly spending limits are tracked per "day number" / "week number" bucket (`storage::get_day_number`, `get_week_number`), incremented when a proposal is created (`add_daily_spent`, `add_weekly_spent`) using the **creation-time** bucket. When a proposal is later cancelled or expires, `refund_spending_limits` is called — but it computes `get_day_number(env)` / `get_week_number(env)` using **the current ledger time at the moment of refund**, not the original creation time.

If a proposal is created on day N and cancelled or expires on day N+1 (or later — proposals can sit `Pending` for a while before timing out), the refund credits day N+1's bucket, while day N's bucket remains permanently over-counted (it was debited and never correctly credited back).

**Existing mitigations:**
- `try_deduct_daily_spent` / `try_deduct_weekly_spent` (referenced in the comment at storage.rs:1333-1335) are atomic read-validate-write operations specifically designed to prevent a *double*-refund landing in the same ledger — this guards against one failure mode but not the bucket-mismatch one described above.
- The practical exposure window is bounded — at most a few buckets' worth of drift per affected proposal, not unbounded.

**What is not mitigated:**
- There is no mechanism to refund into the *original* bucket. The bug is structural, not a missing edge-case check.
- Repeated propose → wait past the limit period → cancel cycles could, in principle, be used to permanently inflate the *next* period's available spending room relative to what the configured limit intends, since each such cycle credits "today" without ever correctly clearing the original day's debit.

**Residual risk: Medium.** Not rated High because the actual amount of "extra" room created per cycle is bounded by the original proposal's amount, and constructing a meaningful exploit requires deliberately timing proposal creation/cancellation across bucket boundaries repeatedly. Not rated Low because the underlying accounting error is real, easily demonstrated (create a proposal, advance the ledger past a day boundary, cancel it, inspect both day buckets), and silently degrades the spending-limit guarantee over time without any error or warning.

**Recommendation for auditors:** write a test that creates a proposal, advances `env.ledger().set_sequence_number(...)` / the ledger timestamp past a day boundary, cancels the proposal, and asserts which day bucket received the refund. Confirm whether `Proposal` stores its original creation day/week (it stores `created_at` as a ledger sequence number) and whether `refund_spending_limits` could be changed to recompute the bucket from that stored value instead of "now."

### 1.5 Integer Overflow Points

**Affected functions (non-exhaustive — found via direct grep for raw, non-checked `i128` arithmetic involving user/proposer-influenced values):**

| Location | Expression | Inputs |
|---|---|---|
| `lib.rs:716` | `amount * insurance_config.min_insurance_bps as i128 / 10_000` | proposal amount, admin-configured bps |
| `lib.rs:745` | `amount * staking_config.base_stake_bps as i128 / 10_000` | proposal amount, admin-configured bps |
| `lib.rs:4823` | `payment.amount * total_payments as i128` | recurring payment amount × count |
| `lib.rs:5173` | `stream.rate * total_active_seconds as i128` | stream rate × elapsed seconds |
| `lib.rs:5338` | `stream.rate * stream.accumulated_seconds as i128` | stream rate × accumulated seconds |
| `lib.rs:8901` | `(amount * fee_bps as i128) / 10_000` | proposal amount, fee bps |
| `lib.rs:11129` | `(lock.amount * config.early_unlock_penalty_bps as i128) / 10_000` | lock amount, admin-configured bps |
| `lib.rs:13694` | `(lock.amount * lock.power_multiplier_bps as i128) / 10_000` | lock amount, multiplier |

**The specific gap.** `contracts/vault/Cargo.toml` has **no `[profile.release]` section**, meaning the crate builds with Rust's default release profile, which sets `overflow-checks = false`. In debug builds, an `i128` multiplication that overflows panics; in the release/WASM build that actually ships (`cargo build --target wasm32-unknown-unknown --release`, as run in CI), the same overflow **silently wraps** to an incorrect value instead of panicking or erroring.

`i128`'s range (~±1.7 × 10^38) is enormous relative to realistic token amounts, which is the main reason none of these are flagged as immediately, trivially exploitable. But "the input would have to be unrealistically large" is exactly the kind of informal reasoning a conservative audit should not rely on as a substitute for an explicit bound check, especially for `stream.rate` and `payment.amount`, which (depending on what validation exists at stream/recurring-payment creation time) may not be bounded at all before reaching this arithmetic.

**Existing mitigations:**
- 119 other arithmetic sites in `lib.rs` do use `saturating_add` / `saturating_sub` / `checked_*`, showing the team is generally aware of overflow risk and mitigates it in many places.
- `i128`'s width provides a large margin before wraparound versus, say, `u64` or `u32`.

**What is not mitigated:**
- The specific multiplication sites listed above use raw `*` rather than `saturating_mul` or `checked_mul`.
- No `[profile.release] overflow-checks = true` exists to catch this class of bug even as a fail-safe (this would convert a silent wrap into a panic/transaction-revert in production — strictly safer for a financial contract, at modest gas cost).
- No explicit upper bound was found on `stream.rate` or `payment.amount` at their respective creation entry points as part of this review (auditors should verify this directly against `propose_streaming_payment` / equivalent, which was not fully traced for this document).

**Residual risk: Medium.** Not rated Low, because raw multiplication on user-influenced `i128` values with no compile-time overflow protection is a real gap regardless of how unlikely realistic inputs are to trigger it, and the absence of `overflow-checks = true` means there is no safety net even if a bound check elsewhere is later found to be insufficient. Not rated High absent a demonstrated, concrete input that triggers a wrap with realistic token amounts — `i128`'s width makes this materially harder to trigger than the equivalent bug would be on a narrower integer type.

**Recommendation for auditors:** add `overflow-checks = true` to a `[profile.release]` section in `Cargo.toml` as a baseline fail-safe, then specifically verify the upper bounds (if any) on `stream.rate`, `payment.amount`, and `lock.amount` at their respective creation/configuration entry points, and confirm whether any combination of admin-configured `_bps` values and proposer-supplied amounts can realistically approach `i128::MAX / bps_value`.
### 1.6 Contract Upgrade Mechanism — Governance Is Disconnected From Execution

This was not in the issue's original list of attack surfaces, but it was discovered during this review and is severe enough that omitting it would make this document materially incomplete.

**Affected functions:** `propose_upgrade` (line 13712), `execute_upgrade` (line 13801).

**The specific gap.** `propose_upgrade` accepts a `new_wasm_hash: BytesN<32>` parameter — the actual hash signers are meant to be voting on — but **never stores it**. Instead, it stores a literal placeholder string in proposal metadata:

```rust
meta.set(Symbol::new(&env, "wasm_hash"), String::from_str(&env, "placeholder"));
```

and records only the *byte length* of the hash (always `32`) as `proposal.amount`. The real hash value is discarded immediately after the function returns.

`execute_upgrade`, after confirming unanimous approval and timelock expiry, reads back the placeholder metadata value (line 13836-13838, assigned to `_wasm_hash_str` — the leading underscore signals the value is intentionally unused), and then does this:

```rust
// For now, create a dummy WASM hash - in production this would be properly stored
let wasm_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
env.deployer().update_current_contract_wasm(wasm_hash);
```

The all-zero hash, not the hash any signer actually voted on, is what gets passed to `update_current_contract_wasm`.

**Practical effect:** the entire upgrade proposal/approval/timelock flow has no causal connection to what code the contract actually upgrades to. Either:
1. `update_current_contract_wasm([0u8; 32])` fails at the host level because no contract is deployed under that hash (most likely on a real network, where hash `0x00..00` corresponds to nothing) — in which case the upgrade mechanism is simply non-functional, and `execute_upgrade` would error out every time it's called; or
2. In some environment, `[0u8; 32]` resolves to *something* — in which case every "successful" upgrade silently deploys that fixed WASM regardless of what was proposed and approved, which is a governance-bypass of the worst kind: a unanimous, timelocked vote that has zero effect on what code actually runs.

This was not exploited or executed against a live network as part of this review — confirming which of the two outcomes above actually occurs requires testing against an actual Soroban host (this is exactly the kind of question a third-party audit's test environment should answer directly).

**Existing mitigations:**
- Requires unanimous (`proposal.approvals.len() == config.signers.len()`) approval and a mandatory timelock to reach `execute_upgrade` at all — so even though the *mechanism* is broken, an attacker without unanimous signer collusion cannot reach this code path to attempt anything.
- The comment in the code (`"For now... in production this would be properly stored"`) strongly suggests this is known, incomplete, placeholder code rather than a disguised backdoor — but a third-party audit should not take that at face value without independent confirmation, and regardless of intent, the current behavior is the current behavior.

**What is not mitigated:**
- There is no test (see §5) that asserts `execute_upgrade` actually deploys the hash that was proposed — which would have caught this immediately, since any such test's assertion would fail or have to itself hardcode the same dummy value to pass.
- Nothing in the public interface signals to a signer voting on an upgrade proposal that their vote does not bind the actual deployed code.

**Residual risk: High.** This is rated High independent of the conservative-bias instruction — a contract upgrade path that is either completely non-functional or silently deploys unintended code is a severe finding by any standard. If the team's intent is "this feature is incomplete and not yet meant to be used," that itself needs to be stated explicitly somewhere reachable by an auditor or by anyone inspecting the public interface (e.g., the function should be feature-flagged off, or `execute_upgrade` should return a not-implemented error), rather than appearing as a fully wired, multi-sig-gated, timelocked governance feature that silently does the wrong thing.

**Recommendation for auditors:** treat this as the highest-priority item in the entire document. Confirm directly (in a test environment, not by static reading) what `update_current_contract_wasm([0u8; 32])` actually does, and verify with the team whether `propose_upgrade`/`execute_upgrade` are meant to be reachable in the current release at all.
## 2. Known Assumptions and Invariants

These are stated as formal properties — conditions that should hold for every reachable contract state — rather than prose descriptions. Each includes the function(s) responsible for upholding it, and the test(s) intended to verify it. Where a property is **violated by a known bug**, that is stated explicitly rather than omitted.

### INV-1: Initialization is single-shot
```
∀ calls to initialize(): initialize() succeeds at most once per contract instance.
After the first successful call, every subsequent call to initialize() returns Err(AlreadyInitialized).
```
**Enforced by:** a stored "initialized" flag checked at the top of `initialize` (line ~360).
**Verified by:** `test_double_initialization` pattern — confirm exact test name in `test.rs` (multiple `*_initialized*`-style tests exist; auditors should grep `fn test_.*init` directly, as this review did not enumerate every one by name).
**Status:** Holds, per static reading. Not independently re-verified by execution as part of this review (see compile-status note above).

### INV-2: A proposal cannot execute below its required approval threshold
```
∀ proposals p: p.status transitions to Executed
  ⟹ (p.approvals.len() ≥ config.threshold) ∨ can_execute_unilaterally(signer_tier(p.proposer), p.amount, full_quorum_threshold)
```
**Enforced by:** `ensure_vote_requirements_satisfied` (called from `execute_proposal`, line 1783) for the multi-sig path; `can_execute_unilaterally` (line 14345) for the unilateral path.
**Verified by:** `test_multisig_approval` (line 132), `test_unauthorized_proposal` (line 219).
**Status:** Holds for the multi-sig path. The unilateral path is a documented exception to the *threshold* requirement by design (§1.3) — auditors should treat INV-2 as two separate properties (multi-sig threshold vs. unilateral tier limit) rather than one, since they're enforced by entirely different code paths with different risk profiles.

### INV-3: A proposal whose amount meets or exceeds `timelock_threshold` cannot execute before `unlock_ledger`
```
∀ proposals p: p.status transitions to Executed via the standard (non-unilateral) path
  ⟹ p.unlock_ledger == 0 ∨ current_ledger ≥ p.unlock_ledger
```
**Enforced by:** the check at `execute_proposal` line 1762 (`if proposal.unlock_ledger > 0 && current_ledger < proposal.unlock_ledger { return Err(TimelockNotExpired) }`), and equivalently at lines 2100, 4280, 6508.
**Verified by:** `test_execute_before_timelock_panics` (`test_admin_rotation.rs:179`), `test_execute_before_timelock_expires_fails` (`test_regressions.rs:951`), `test_timelock_violation` (`test.rs:285`).
**Status: VIOLATED for the unilateral-execution path.** As documented in §1.3, `can_execute_unilaterally` never checks `unlock_ledger` or `timelock_threshold` at all. INV-3 should be read as holding only for proposals that go through `propose_transfer` → `approve_proposal` → `execute_proposal`; it does **not** hold for proposals that qualify for unilateral execution under a signer's tier. This is the single most important gap in this document — auditors should treat "the timelock holds" as a claim that is conditionally true, not universally true.

### INV-4: Cumulative spending within a day/week cannot exceed the configured daily/weekly limit
```
∀ days d: Σ(amount of proposals created on day d, net of refunds correctly attributed to day d) ≤ config.daily_limit
```
**Enforced by:** `add_daily_spent` / `add_weekly_spent` at proposal creation, checked against `config.daily_limit` / `config.weekly_limit` before allowing creation.
**Verified by:** `test_propose_transfer_daily_limit_accumulates_across_multiple_proposals` (line 1882), `test_propose_transfer_weekly_limit_accumulates_across_multiple_proposals` (line 1934), `test_propose_transfer_exact_spending_limit_passes_and_limit_plus_one_fails` (line 1824), `test_daily_limit_recovers_after_proposal_expiry` (`test_regressions.rs:141`).
**Status: PARTIALLY VIOLATED**, per §1.4 — the parenthetical "net of refunds correctly attributed to day d" in the formal statement above is doing real work. `refund_spending_limits` attributes refunds to the *current* day/week at time of cancellation/expiry, not the original day/week of the debit. The invariant as commonly understood ("you can't spend more than the limit per day") still holds in the sense that no single day's *new proposals* can exceed the limit when summed against that day's tracked spend — but the tracked spend itself can drift from the true intended accounting over time across cancellations that span a day/week boundary.

### INV-5: A signer can only approve a proposal once
```
∀ proposals p, signers s: |{approvals in p.approvals where approval.signer == s}| ≤ 1
```
**Enforced by:** the `if proposal.approvals.contains(&voter) { continue; }` check in `approve_proposal` (line 1318).
**Verified by:** test coverage exists via the `AlreadyApproved` error path; auditors should confirm the exact test name (multiple `*_already_approved*`-pattern tests likely exist — not individually enumerated for this review).
**Status:** Holds, per static reading.

### INV-6: `role_satisfies` is the authoritative privilege-ordering function, but is not universally used
```
∀ functions f gated by role: the actual access granted to a DisputeArbitrator at f
  depends on whether f uses role_satisfies(required, actual) or direct equality (actual == required)
```
This is stated as an invariant about the *codebase*, not about safe contract behavior — it is the formal version of the finding in §1.2. There is currently no single invariant of the form "DisputeArbitrator can do X and only X" that holds uniformly across the contract.
**Status: This is the core finding of §1.2 and should be resolved (by standardizing on one mechanism) before being treated as settled.**

### INV-7: A proposal cannot be executed twice
```
∀ proposals p: p.status == Executed is a terminal state — no function transitions p.status away from Executed.
```
**Enforced by:** the explicit check at the top of `execute_proposal` (`if proposal.status == ProposalStatus::Executed { return Err(ProposalAlreadyExecuted) }`, line 1724) and the state-machine transition table at line ~8185-8192, which lists valid transitions and does not include any transition *out of* `Executed`.
**Verified by:** the `ProposalAlreadyExecuted` error path — auditors should confirm exact test name(s).
**Status:** Holds for the single top-level call path. **This is the invariant most directly relevant to the cross-contract call risk in §1.1** — INV-7 is upheld by ledger sequencing within a single transaction (the status write happens once, after the transfer call returns), not by an explicit re-entrancy guard. Auditors evaluating §1.1 should treat INV-7 as the property to specifically try to break via a reentrant call from a malicious token contract.

### INV-8: Vault balance is sufficient before any transfer is attempted
```
∀ transfers t executed by the vault: token::balance(vault) ≥ t.amount + t.insurance_amount + t.fee at the time the balance check runs
```
**Enforced by:** the explicit check in `try_execute_transfer` (line 9622-9626).
**Verified by:** the `InsufficientBalance` error path.
**Status:** Holds as a check-then-act pattern within a single call. Note this is a check against balance at a single point in time — see §1.1 for why a reentrant call between the check and the transfer is the relevant residual concern, not a TOCTOU race from outside the transaction (Soroban transactions are not interleaved with other transactions mid-execution).

### INV-9 (codebase-level, not contract-logic-level): the deployed test suite's assertions are a lower bound, not a complete characterization, of contract behavior
Stated explicitly because several findings in this document (§1.3 in particular) were discovered by reading code paths that have **no corresponding test** asserting the property one way or the other. The presence of 749 `#[test]` functions (per `docs/reference/TESTING.md`) should not be read as "every invariant above has been independently verified by execution" — §5 below maps which invariants have direct test coverage and which do not.
## 3. Out of Scope

The following are explicitly **not** part of this audit's scope, with reasoning for each exclusion:

- **`frontend/` and `backend/`.** This audit concerns on-chain contract logic. The frontend's wallet/transaction-building code and the backend's event-indexing/normalization code are separate attack surfaces (e.g., XSS, API auth, event-spoofing) that belong to a web-application security review, not a smart-contract audit. If the frontend constructs and signs transactions on a user's behalf, that construction logic is in scope for a *web* security review, but the contract-side validation of whatever transaction eventually arrives is what this document covers.
- **The underlying Stellar/Soroban host and protocol.** Soroban's own auth model, ledger consensus, and resource metering are Stellar Development Foundation-maintained infrastructure, not VaultDAO code. This document assumes the host behaves as documented; it does not re-audit Soroban itself.
- **The Stellar Asset Contract (SAC) or any third-party token contract.** VaultDAO calls into token contracts via `token::Client` (see §1.1) but does not implement token logic itself. The *fact* that VaultDAO trusts whatever `token_addr` it's given is in scope (§1.1); the internal correctness of a specific token implementation is not.
- **Off-chain components: the replay CLI (`backend/src/modules/events/replay/replay-cli.ts`), job scheduling, notification dispatch.** These consume contract events but do not have write access to contract state. A bug here could produce incorrect off-chain records or missed notifications, which is a real concern, but not a contract-security concern in the sense this document is scoped to.
- **Denial-of-service via gas/resource exhaustion at the *transaction* level** (e.g., an attacker submitting many spam transactions to congest the network) — this is a Stellar network-level concern, not specific to VaultDAO's contract logic. **Within-contract resource exhaustion** (a single call that itself does unbounded work, e.g. iterating an attacker-growable list) *is* in scope and auditors should look for it, particularly around `list_proposal_ids`-style enumeration calls (note: `propose_upgrade`, §1.6, calls `Self::list_proposal_ids(env.clone(), 0, 1000)` and iterates all of them on every single upgrade proposal — this scales linearly with total proposal count and should be checked for cost growth over the contract's lifetime).
- **Social-engineering or key-compromise scenarios** (a legitimate signer's private key being stolen, a signer being coerced). The contract's RBAC and multi-sig design exists partly *to* mitigate single-key compromise, and evaluating how well it does so against a compromised-key threat model is reasonable audit scope; but "could someone phish a signer" is not a contract code question.
- **Economic/game-theoretic attacks on the staking, insurance, and reputation systems** (e.g., whether the `base_stake_bps` incentive structure is economically sound) are explicitly **out of scope for a security/correctness audit** and would be better suited to a separate economic-design review — this document covers whether the code correctly implements its stated rules, not whether those rules produce good incentives.

## 4. Prior Issues and Resolutions

This section lists known, previously-identified bugs in this codebase, their status, and (where relevant) which of the attack surfaces above they touch. Several of these were found during preparation of *other* documentation issues for this repository and are included here because a security audit document should not omit known live defects in the code it describes.

| Issue | File / Location | Status as of this writing | Relation to this document |
|---|---|---|---|
| Missing closing brace in `propose_transfer_internal` nests the pause check and the entire access-control/limit-check logic inside `if config.signers.is_empty()` | `lib.rs`, ~line 641-646 | **Open** — fix prepared on a separate branch, not yet merged to `main` | Directly relevant to §1.2/§1.3/§1.4 — while unfixed, the role check, recipient validation, and velocity-limit check for `propose_transfer_internal` only execute when the signer list is empty, which is not the normal operating condition. This is arguably the single most severe *currently-merged* defect, independent of anything else in this document, since it means access control for the primary transfer-proposal path is effectively dead code under normal operation. |
| Missing closing brace in `get_capability` | `lib.rs`, ~line 14340 | **Open** — fix prepared, not yet merged | Not directly security-relevant (read-only getter), but contributes to the file's current non-compiling state, which affects confidence in every other claim in this document until resolved. |
| Corrupted/interleaved body in `execute_insurance_withdrawal` (references out-of-scope `attachment`/`index` identifiers, orphaned trailing block) | `lib.rs`, ~lines 3759-3837 | **Open** — root cause identified via `git log -p`, traced to a bad merge; fix prepared, not yet merged | Not part of the attack surfaces above, but blocks compilation, and the insurance-withdrawal-execution path itself (once restored) should be re-reviewed for the same class of issues catalogued in §1 (it executes a token transfer and updates proposal status, structurally similar to §1.1). |
| Duplicate `staking_config` field in `InitConfig` | `types.rs`, was line 90 & 95 | **Fixed** on the `docs/1187-testing-guide-all-layers` branch | Not a security defect on its own (compile-time only), but is one of several signals (see intro) that this codebase has had un-caught structural defects merge to `main`, which is relevant context for how much independent verification an audit should plan to do versus relying on existing review processes having caught issues. |
| Duplicate `PermissionNotFound` enum variant | `errors.rs`, lines 139 & 187 | **Open** — found during preparation of this document, not yet fixed on any branch | Same category as above. Also worth note: this means any code path that's supposed to return `VaultError::PermissionNotFound` currently fails to compile, so that specific error condition is entirely untestable until resolved. |
| ~23 call sites in `test.rs` constructing `InitConfig` with duplicate field assignments; at least 10 duplicate test function names in `test.rs` | `test.rs`, scattered | **Open** | This is the most directly relevant prior issue for §5 below — it means `cargo test` cannot currently run to completion, so every "verified by test X" claim in this document and in `TESTING.md` reflects what the test is *designed* to check, based on reading its assertions, not a confirmed passing run. |
| Contract upgrade mechanism discards the proposed WASM hash and substitutes a hardcoded all-zero hash | `lib.rs`, `propose_upgrade`/`execute_upgrade`, lines 13712-13855 | **Open** — newly identified as part of this document; see §1.6 | This is the most severe item in this entire document. Listed here as well as in §1.6 so it is not missed by a reader who only skims this table. |

## 5. Test Coverage Cross-Reference

This maps each attack surface in §1 to the test file(s) that are designed to exercise it. "Designed to exercise" reflects what the test's assertions check, based on reading the test code — given the current compile-blocking issues in `test.rs` (§4), this could not be confirmed by an actual passing `cargo test` run as of this writing, and auditors should re-run this mapping against a green test suite once the prior issues above are resolved.

| Attack surface | Test file(s) | Coverage assessment |
|---|---|---|
| §1.1 Cross-contract call / reentrancy | *(none identified)* | **No direct test coverage found.** No test in any `test_*.rs` file constructs a malicious/non-standard token contract to probe reentrant calls into `execute_proposal`/`approve_proposal` mid-transfer. `test.rs` and `test_staking.rs` test token transfers, but only against the standard Stellar Asset Contract test double, which is not adversarial. |
| §1.2 RBAC bypass (role_satisfies vs. direct equality inconsistency) | `test.rs`, `test_disputes.rs` | Tests exist for individual `Unauthorized`/`InsufficientRole` paths (e.g. `test_unauthorized_proposal`, `test_change_priority_unauthorized`), but **no test specifically checks what a `DisputeArbitrator` can or cannot do** across the 39 direct-equality call sites versus the 69 `role_satisfies` call sites. The inconsistency itself is untested by construction — testing one call site doesn't reveal the disagreement with another. |
| §1.3 Timelock bypass via unilateral execution | `test_enterprise_features.rs` | This file contains the only tests referencing `SignerTier`/unilateral execution found during this review. **No test was found that specifically checks whether a unilateral-tier execution can exceed `timelock_threshold`** — existing tests appear to cover the tier-limit mechanism in isolation, not its interaction with the timelock system. This gap matches the code-level gap in §1.3 exactly. |
| §1.4 Spending limit bypass (refund bucket mismatch) | `test.rs` (`test_cancel_proposal_refunds_daily_and_weekly_spending_limits`, line 2083), `test_regressions.rs` (`test_daily_limit_recovers_after_proposal_expiry`, line 141) | Tests confirm a refund happens and that *some* bucket is credited, but based on reading their setup, they do not appear to specifically advance the ledger across a day/week boundary between proposal creation and cancellation — which is exactly the condition needed to surface the bucket-mismatch bug. Auditors should check whether either test's `env.ledger()` manipulation spans a bucket boundary; if not, this is a coverage gap that exactly mirrors the code gap. |
| §1.5 Integer overflow | `test_streaming.rs`, `test_staking.rs`, `test_fees.rs` | These files test the *functions* that contain the flagged multiplications, but under realistic, small example values — none were found to specifically probe near-`i128::MAX` boundary values for `stream.rate`, `lock.amount`, or `payment.amount`. Standard practice for this class of bug is a dedicated boundary/fuzz test, which was not found. |
| §1.6 Upgrade mechanism hash mismatch | *(none identified)* | **No test asserts that `execute_upgrade` deploys the WASM hash that was actually proposed.** This is the most consequential coverage gap in the document — a single test asserting `wasm_hash_used_by_deployer == wasm_hash_originally_proposed` would have caught this immediately, and its absence is itself informative. |

**Overall assessment:** the existing 749-test contract suite (per `TESTING.md`) provides solid coverage of the *happy paths* and many *direct* error conditions (wrong role, insufficient balance, expired proposal, etc.) for each individual function. It provides materially weaker coverage of **cross-cutting properties** — invariants that depend on the interaction between two or more subsystems (timelock × unilateral tiers, role hierarchy × direct-equality checks, spending limits × time-bucket boundaries, proposed-vs-executed upgrade hash). Every attack surface in §1 of this document falls into that second, less-covered category. This is a reasonable and common pattern for a test suite written function-by-function as features were added — it is exactly the kind of gap a third-party audit, which looks at the system as a whole rather than one PR at a time, is best positioned to close.

---

*This document should be revisited whenever a new attack-surface category emerges (e.g., a new cross-contract integration) or when any of the "Open" items in §4 are resolved — at minimum, the residual risk ratings in §1 should be re-evaluated after the three `lib.rs` structural fixes and the upgrade-mechanism issue are addressed.*
