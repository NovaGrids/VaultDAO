# Wallet Recovery (VaultDAO Guide)

> Written for **security owners and operators** who configure guardian-based
> recovery and need to respond when it is used — legitimately or maliciously.
> Source of truth: the "Wallet Recovery" and "Recovery Proposals" sections of
> `contracts/vault/src/lib.rs` and `RecoveryConfig` / `RecoveryProposal` /
> `RecoveryConfigChangeProposal` in `contracts/vault/src/types.rs`.

Guardian-based recovery replaces a vault's signer set and threshold when the
current keys are lost or compromised. It is the last line of defence for a
vault whose signers can no longer act, so it is intentionally hard to use:

- The recovery **configuration** (who the guardians are, how many are needed,
  and how long the delay is) can only be changed through **multisig
  governance** — no single admin key can rewrite it.
- Performing a **recovery** requires guardian approval **and** a time delay
  before the signer set actually changes, so honest parties get a window to
  notice and cancel.

Ledgers close roughly every 5 seconds, so **1 day ≈ 17,280 ledgers**.

> **Deprecated:** `set_recovery_config` still exists in the ABI for backward
> compatibility but **always reverts with `InsufficientRole` (12)**. Recovery
> configuration must be changed with the governance flow in
> [section 3](#3-lifecycle-a-changing-the-recovery-config-governance).

---

## 1. Concepts and roles

```rust
pub struct RecoveryConfig {
    pub guardians: Vec<Address>, // trusted recovery signers
    pub threshold: u32,          // guardian approvals required to recover
    pub delay: u64,              // ledgers between approval and execution
}
```

| Concept | Meaning |
| --- | --- |
| **Guardian** | An address trusted to co-sign a recovery. Meant to be controlled by a different operator, entity, or offline key than the vault signers. |
| **Threshold** | How many guardian approvals are required before a recovery can execute. |
| **Delay** | Ledgers the contract waits after a recovery is approved before it can execute. During this window the recovery can be cancelled. |
| **Signer** | An address that can vote on normal proposals and approve governance. Recovery *rewrites* the signer set. |
| **Admin** | Role with operational control. Not automatically part of recovery. |

Two independent quorums are involved:

1. **Signers** approve changes to the `RecoveryConfig` itself (governance).
2. **Guardians** approve an actual recovery that replaces the signers.

Keep them separate. If guardians and signers are the same keys, a single
compromise defeats both.

---

## 2. Choosing guardians, threshold, and delay

### Guardians

- Use **3–7** guardians. A single guardian is a single point of failure; too
  many makes an emergency recovery slow.
- Prefer addresses **not** in the vault signer set, held by different people
  or organisations, on separate infrastructure.
- Store guardian keys offline (hardware wallet, HSM, or paper backup) — they
  should be cold and rarely used.
- Rotate a guardian through governance if a key is lost or leaves the
  organisation.

### Threshold

The threshold is a trade-off between resilience and risk:

| Threshold | Trade-off |
| --- | --- |
| `1` | Any single guardian can recover. Fast, but a single compromised guardian can replace the signer set. |
| **Majority** (`floor(n/2)+1`) | Common choice: tolerates some lost guardians while requiring collusion to abuse. |
| `n` (all guardians) | Strongest control, but one lost guardian permanently blocks recovery. |

Remember that the threshold also governs **cancelling an approved recovery**
(see [section 6](#6-cancellation-and-malicious-recovery)). In practice a
threshold below the number of guardians is what gives honest guardians the
ability to cancel a recovery they did not approve.

### Delay

The delay is the anti-malicious-recovery window. Pick it long enough for the
team to notice an alert and act:

| Delay | Approx. wall-clock | Use when |
| --- | --- | --- |
| `17_280` | ~1 day | Fast-moving operations |
| `51_840` | ~3 days | **Recommended default** for production |
| `120_960` | ~7 days | High-value, low-urgency vaults |

The delay applies **after** the threshold is reached, not from proposal
creation, so the total response window is `delay` ledgers.

---

## 3. Lifecycle A — changing the recovery config (governance)

Because a compromised admin should not be able to install hostile guardians,
config changes are a governance proposal requiring a signer supermajority.

```
propose_recovery_config_change ──▶ Pending ──approve (≥ threshold)──▶ Approved ──execute──▶ Executed
                                       │
                                  (expires after ~7 days)
```

### Step 1 — propose (any signer)

```rust
let proposal_id = vault.propose_recovery_config_change(
    &signer,
    RecoveryConfig {
        guardians: vec![&env, g1.clone(), g2.clone(), g3.clone()],
        threshold: 2,
        delay: 51_840, // ~3 days
    },
);
```

- Caller must be a **signer** (`NotASigner`, 11 otherwise).
- At most **3 active governance proposals** — a 4th fails with
  `ConfigChangeInProgress` (1010).
- The proposal expires `PROPOSAL_EXPIRY_LEDGERS` (120,960 ≈ 7 days) after
  creation; approve it within that window (`ProposalExpired`, 24).

Emits `recovery_config_proposal_created(proposal_id, proposer)`.

### Step 2 — approve (signers)

```rust
vault.approve_recovery_config_change(&signer_a, proposal_id);
vault.approve_recovery_config_change(&signer_b, proposal_id);
```

- Caller must be a signer (`NotASigner`); duplicate votes fail with
  `AlreadyApproved` (30); expired proposals fail with `ProposalExpired` (24).
- Required approvals = `ceil(signers.len() × governance_threshold / 100)`. The
  governance threshold defaults to **67%** and is set with
  `set_governance_threshold`.
- Once met, the proposal becomes `Approved`.

Emits `recovery_config_proposal_approved(proposal_id, voter, approval_count)`.

### Step 3 — execute (anyone)

```rust
vault.execute_recovery_config_change(&anyone, proposal_id);
```

- Requires `Approved` (`ProposalNotApproved`, 22).
- Writes the new `RecoveryConfig` into the vault config and marks the proposal
  `Executed`. There is no additional caller authorisation and no extra
  timelock, so execute promptly to free the active-proposal slot.

Emits `recovery_config` (with the proposer as data).

Reads: `get_recovery_config()`, `get_recovery_cfg_change_proposal(id)`.

---

## 4. Lifecycle B — performing a recovery

```
initiate_recovery ──▶ Pending ──approve (≥ guardian threshold)──▶ Approved
                          │                                          │
                     cancel_recovery                         wait `delay` ledgers
                     (any guardian)                                 │
                                                                    ▼
                                                          execute_recovery (anyone)
                                                                    │
                                                                    ▼
                                                                 Executed
```

### Step 1 — initiate (a guardian)

```rust
let recovery_id = vault.initiate_recovery(
    &guardian_1,
    vec![&env, new_signer_a.clone(), new_signer_b.clone(), new_signer_c.clone()],
    2, // new threshold
);
```

- Caller must be a **guardian** (`Unauthorized`, 10 otherwise).
- Only one recovery is open at a time; see [section 4a](#4a-the-recovery-ceremony)
  for how a second `initiate_recovery` is handled.
- `new_signers` must be non-empty (`NoSigners`, 3).
- `new_threshold` must be `1 ≤ threshold ≤ new_signers.len()`
  (`ThresholdTooHigh`, 5).
- The proposal starts `Pending` with `execution_after = 0`.

Emits `recovery_proposed(recovery_id, new_threshold)`.

### Step 2 — approve (guardians)

```rust
vault.approve_recovery(&guardian_2, recovery_id);
```

- Caller must be a guardian (`Unauthorized`); duplicate votes fail with
  `AlreadyApproved` (30); only `Pending` proposals can be approved
  (`ProposalNotPending`, 21).
- When approvals reach `RecoveryConfig.threshold`, the proposal becomes
  `Approved` and `execution_after = current_ledger + delay`.

Emits `recovery_approved(recovery_id, guardian)`.

### Step 3 — wait out the delay

Nothing can execute until `current_ledger ≥ execution_after`. During this
window, guardians can cancel (section 6). This is the whole point of the delay.

### Step 4 — execute (anyone)

```rust
vault.execute_recovery(&recovery_id); // no caller argument
```

- Requires status `Approved` (`ProposalNotApproved`, 22).
- Requires `current_ledger ≥ execution_after` (`TimelockNotExpired`, 60).
- **No caller authorisation** — once approved and unlocked, anyone (a keeper,
  a guardian, or a third party) can execute it. Do not treat "not yet executed"
  as "not going to happen".

Emits `recovery_executed(recovery_id)` and, if any proposals were invalidated,
`proposals_invalidated_by_recovery(recovery_id, ids)`.

Reads: `get_recovery_proposal(id)`.

---

## 4a. The recovery ceremony

### Ceremony diagram

```
                       recovery epoch E (get_recovery_epoch)
 ┌────────────────────────────────────────────────────────────────────────────┐
 │                                                                            │
 │  initiate_recovery(g, signers', t')  ──▶  Pending (epoch = E)              │
 │        │                                     │                             │
 │        │ second initiate while open:          │ approve_recovery(g)        │
 │        │   Reject    → RecoveryAlreadyActive  │ approve_recovery_with_     │
 │        │   Supersede → Pending one Cancelled, │   signature(g, sig)        │
 │        │               new one opens          │   (bound to id + epoch E,  │
 │        │               (Approved: refused)    │    single-use, age-checked)│
 │        │                                     ▼                             │
 │        │                        approvals ≥ threshold ──▶ Approved         │
 │        │                                     │                             │
 │        │            cancel_recovery          │ wait `delay` ledgers        │
 │        │   (Pending: any guardian,           │                             │
 │        │    Approved: guardian quorum)       ▼                             │
 │        │                             execute_recovery  ── one invocation ──┼──┐
 │        │                                                                   │  │
 │  past expires_at ─▶ expire_recovery ─▶ Expired (approvals + cancel votes   │  │
 │                                         cleared)                           │  │
 └────────────────────────────────────────────────────────────────────────────┘  │
                                                                                 │
   execute_recovery, atomically:                                                 │
     1. revoke role, tier, delegations, permissions, capabilities of every       │
        removed signer                                                           │
     2. grant Member to every new signer                                         │
     3. reset votes on Pending / Approved / Scheduled proposals                  │
     4. write the new signer set and threshold                                   │
     5. cancel every other open recovery                                         │
     6. advance to epoch E+1  ◀──────────────────────────────────────────────────┘
        (a governance change of the recovery config also cancels open
         recoveries and advances the epoch)
```

### Competing recoveries

Only one recovery epoch is active and only one recovery is open in it. What
happens when a guardian calls `initiate_recovery` while another recovery is
`Pending` or `Approved` depends on the policy set with
`set_recovery_competition_policy(admin, policy)` (Admin only; read with
`get_recovery_competition_policy()`):

| Policy | Open recovery is `Pending` | Open recovery is `Approved` |
| --- | --- | --- |
| `Reject` (default) | `RecoveryAlreadyActive` (1203) | `RecoveryAlreadyActive` |
| `Supersede` | The open one is `Cancelled` with its approvals and cancel votes cleared; the new one opens. Emits `recovery_superseded(old_id, new_id)` and `recovery_cancelled`. | `RecoveryAlreadyActive`. An approved recovery can only be stopped by a guardian cancel quorum, never by a newer proposal. |

An expired recovery no longer blocks a new one under either policy.

When a recovery executes, every other open recovery is cancelled in the same
invocation, so two ceremonies can never both apply.

### Epochs and replay protection

The vault keeps a **recovery epoch** (`get_recovery_epoch()`, starting at 0).
Every recovery records the epoch it was opened in. The epoch advances when:

- a recovery executes, or
- `execute_recovery_config_change` installs a new guardian set (open
  recoveries are cancelled at the same time).

`approve_recovery`, `approve_recovery_with_signature` and `execute_recovery`
refuse a recovery from an older epoch with `RecoveryEpochStale` (1213). An
approval gathered under an old guardian set or before a previous recovery can
therefore never be counted again.

### Cold-signed approvals

A guardian whose key is held offline can approve with
`approve_recovery_with_signature(guardian, proposal_id, public_key, signature, created_at_ledger)`.
The key must be registered for that guardian address through
`set_cold_signer_config` (with proof of possession). The guardian signs:

```
"VaultDAO:recovery-approve:v1"   (28 ASCII bytes)
|| XDR(ScVal::Address(vault))
|| proposal_id        (u64, big-endian)
|| recovery epoch     (u64, big-endian)
|| created_at_ledger  (u32, big-endian)
```

The same defences as cold proposal signatures apply:

| Check | Error |
| --- | --- |
| Key not registered for this guardian | `NotAColdSigner` (or `ColdSignerConfigNotSet`) |
| `created_at_ledger` in the future | `ColdSignatureFutureDated` |
| Older than `max_cold_sig_age_ledgers`, or older than the proposal | `ColdSignatureTooOld` |
| Proposal from an older epoch | `RecoveryEpochStale` |
| Signature already used | `RecoverySignatureReplayed` (1214) |
| Signature does not verify (wrong proposal, epoch, vault or key) | Call traps |

No `require_auth` is needed from the guardian: the signature is the
authorisation, and anyone may relay it.

### Expiry

Past `expires_at`, a recovery cannot be approved or executed and
`get_recovery_proposal` reports it as `Expired`. Anyone can call
`expire_recovery(proposal_id)` to persist that state: the status becomes
`Expired`, approvals and cancel votes are cleared and `execution_after` is
reset, emitting `recovery_expired(proposal_id; approvals_cleared, cancel_votes_cleared)`.
It fails with `TimelockNotExpired` before expiry and `ProposalNotPending` if the
recovery is already closed.

---

## 5. What `execute_recovery` changes

Applying a recovery is more than swapping addresses. The contract also repairs
the state that was derived from the old signer set:

**Signers and threshold**
- `config.signers` is replaced by `proposal.new_signers`.
- `config.threshold` is replaced by `proposal.new_threshold`.
- If `config.quorum > signers.len()` it is clamped down to `signers.len()`.

**Roles and privileges**
- Every **removed** signer has their role, delegations (in both directions),
  permissions, signer tier, and capability tokens cleared.
- Every **genuinely new** signer is granted the `Member` role. They are **not**
  Admin or Treasurer — those roles must be re-assigned after recovery.

**In-flight proposals**
- Every `Pending`, `Approved`, and `Scheduled` proposal has its approvals and
  abstentions cleared, and its signer snapshot refreshed to the **new** signer
  set.
- Any proposal that was `Approved` or `Scheduled` is demoted back to `Pending`
  so it must be re-voted by the new signer set before it can execute. Votes
  collected from the old (possibly compromised) signers cannot be reused.

After execution, coordinate an out-of-band handover: confirm the new signers
hold their keys, re-assign Admin/Treasurer roles, and review any proposals that
were reset to `Pending`.

---

## 6. Cancellation and malicious recovery

`cancel_recovery` is the emergency brake:

```rust
vault.cancel_recovery(&guardian, recovery_id);
```

The caller must be a guardian (`Unauthorized`, 10). Behaviour depends on the
recovery's state:

| State | Who can cancel | Effect |
| --- | --- | --- |
| `Pending` | **Any single guardian** | Immediately `Cancelled` |
| `Approved` | Guardians, by quorum | `Cancelled` once the guardian threshold is met |
| `Executed` / `Cancelled` | — | Reverts with `ProposalNotPending` (21) |

> **Important implementation detail.** Cancellation votes reuse the same
> `approvals` list as approval votes. Because an `Approved` recovery already
> holds at least `threshold` approvals, **a single guardian who did *not* vote
> to approve it is enough to cancel it** — their cancel vote pushes the count
> over the threshold. A guardian who already approved cannot vote to cancel
> (`AlreadyApproved`, 30).
>
> Consequently, if `threshold == guardians.len()`, every guardian will have
> approved by the time the recovery is `Approved`, and **no one can cancel
> it**. If you want an enforceable cancel window for approved recoveries, keep
> `threshold < guardians.len()`.

Emits `recovery_cancelled(recovery_id, canceller)`.

### If you must stop an execution you cannot cancel

1. **Pause the vault** immediately (`pause`, guarded by the pause cooldown) to
   stop outward movement while you investigate.
2. Notify all guardians and signers out-of-band.
3. If the recovery is `Pending`, have any guardian call `cancel_recovery`.
4. If it is `Approved` and a non-approving guardian exists, have that guardian
   cancel it.
5. If it cannot be cancelled (e.g. `threshold == guardians.len()`), treat the
   signer set as compromised: prepare a replacement recovery through the
   remaining honest guardians and consumers of the vault, and use
   [incident response](../reference/PRODUCTION_RUNBOOK.md#incident-response-playbook)
   procedures.

---

## 7. Failure modes

| Situation | What happens | What to do |
| --- | --- | --- |
| Guardian key lost | Recovery can still proceed if the remaining guardians meet the threshold; if `threshold` can no longer be met, the vault is unrecoverable. | Rotate guardians via governance **before** the threshold becomes unreachable. |
| Threshold set to `n` and one guardian lost | Recovery is permanently blocked. | Change the config through governance (if signers can still act). |
| Delay too short | Honest parties cannot react to a hostile recovery. | Increase `delay` via governance; prefer ≥ 3 days. |
| Delay too long | A legitimate recovery is slow. | Acceptable trade-off; the delay is the protection. |
| Guardians == signers | A single key compromise defeats both paths. | Separate the two key sets. |
| Compromised guardian initiates | Proposal sits `Pending` until it reaches threshold, then delays. | Cancel while `Pending` or during the delay window. |
| Compromised admin tries to rewrite guardians | `propose_recovery_config_change` needs a signer supermajority. | Governance still protects the config. |
| Config proposal stuck `Pending` | Counts toward the 3-active-proposal cap and blocks new ones until it expires (~7 days). | Approve or let it expire; keep only changes you expect to pass. |
| Recovery executed unexpectedly | Signers are swapped, roles on removed signers cleared, in-flight proposals reset. | Follow the post-recovery handover in section 5 and investigate how guardians were compromised. |

---

## 8. Incident-response checklist

**Detecting**

- [ ] Alert on `recovery_proposed` and `recovery_approved` events — these
      should be rare and always expected.
- [ ] Alert on `recovery_config_proposal_created` / `recovery_config` — an
      unexpected guardian change is a red flag.
- [ ] Alert on `recovery_executed` and `proposals_invalidated_by_recovery`.
- [ ] Reconcile `get_recovery_config()` and `get_recovery_proposal(id)` with
      your deployment manifest on a schedule.

**Triaging (within the delay window)**

1. [ ] Fetch the proposal: `vault.get_recovery_proposal(recovery_id)` and
       `vault.get_recovery_config()`.
2. [ ] Compare `new_signers` / `new_threshold` against the expected handover.
       Unknown addresses ⇒ assume hostile.
3. [ ] Contact every guardian out-of-band (Signal/phone) to confirm whether
       they approved. Do **not** trust in-band messages.
4. [ ] Check whether the delay has already elapsed
       (`execution_after` vs. current ledger).

**Responding**

5. [ ] **Hostile and `Pending`:** any guardian calls `cancel_recovery`.
6. [ ] **Hostile and `Approved`:** a guardian who did not approve calls
       `cancel_recovery`. If none is available, pause the vault and escalate.
7. [ ] **Legitimate:** verify the new signer addresses and threshold, then let
       the delay elapse and let anyone execute (or execute yourself).
8. [ ] After a hostile event: rotate all guardian and signer keys, re-run the
       config-change governance flow with a fresh guardian set and a longer
       delay, and review the audit trail.

**Afterwards**

9. [ ] Re-assign Admin/Treasurer roles to the new signer set.
10. [ ] Re-vote any proposals that `execute_recovery` reset to `Pending`.
11. [ ] Write a post-incident report and update the runbook if needed.

---

## 9. Reads and events

| Read | Returns |
| --- | --- |
| `get_recovery_config()` | `RecoveryConfig` |
| `get_recovery_proposal(id)` | `RecoveryProposal` |
| `get_recovery_cfg_change_proposal(id)` | `RecoveryConfigChangeProposal` |
| `get_recovery_epoch()` | Current recovery epoch |
| `get_recovery_competition_policy()` | `RecoveryCompetitionPolicy` |

| Event | Payload |
| --- | --- |
| `recovery_config_proposal_created` | `proposal_id, proposer` |
| `recovery_config_proposal_approved` | `proposal_id, voter, approval_count` |
| `recovery_config` | `proposer` |
| `recovery_proposed` | `proposal_id, new_threshold` |
| `recovery_approved` | `proposal_id, guardian` |
| `recovery_executed` | `proposal_id` |
| `proposals_invalidated_by_recovery` | `proposal_id, invalidated_ids` |
| `recovery_cancelled` | `proposal_id, canceller` |
| `recovery_superseded` | `old_id, new_id` |
| `recovery_expired` | `proposal_id, approvals_cleared, cancel_votes_cleared` |
| `recovery_epoch` | `new_epoch` |
| `recovery_policy` | `admin, policy` |

See [EVENTS.md](../reference/EVENTS.md) and
[PRODUCTION_RUNBOOK.md](../reference/PRODUCTION_RUNBOOK.md) for alert wiring.

---

## Related

- [Production runbook — incident response](../reference/PRODUCTION_RUNBOOK.md#incident-response-playbook)
- [Governance config changes](./GOVERNANCE_CONFIG_CHANGES.md) — how governance
  proposals and thresholds work
- [Security](../reference/SECURITY.md)
