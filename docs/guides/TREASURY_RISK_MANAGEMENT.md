# Treasury Risk Management Guide

**Audience:** Treasurers, Admins, and finance committees operating a VaultDAO treasury on Stellar.  
**Goal:** Set spending limits, understand circuit breakers and compliance signals, and run a monthly risk review in under an hour.

This guide explains *how* VaultDAO constrains outflow and *how* operators should think about those constraints. Where we suggest percentages of treasury, they are explicitly labeled as **guidelines, not mandates**—your board charter, legal counsel, and insurance requirements always win.

---

## Table of contents

1. [Risk posture in one page](#1-risk-posture-in-one-page)
2. [Spending limit setup](#2-spending-limit-setup)
3. [Spending limit calculator](#3-spending-limit-calculator)
4. [What happens when a limit is hit](#4-what-happens-when-a-limit-is-hit)
5. [Temporary limit raises (governance + timelock + reset)](#5-temporary-limit-raises-governance--timelock--reset)
6. [Circuit breaker](#6-circuit-breaker)
7. [Compliance score interpretation](#7-compliance-score-interpretation)
8. [Monthly risk review checklist](#8-monthly-risk-review-checklist)
9. [Incident playbooks](#9-incident-playbooks)
10. [Appendix: Config fields quick map](#10-appendix-config-fields-quick-map)

---

## 1. Risk posture in one page

VaultDAO is designed so that no single rushed click empties the treasury. Risk controls stack:

| Layer | What it caps | Where it lives |
| ----- | ------------ | -------------- |
| Per-proposal **spending_limit** | Size of one transfer proposal | `Config.spending_limit` |
| **daily_limit** / **weekly_limit** | Aggregate outflow over time | `Config.daily_limit`, `Config.weekly_limit` |
| Per-token daily/weekly limits | Same idea per asset | `Config.token_daily_limits`, `Config.token_weekly_limits` |
| **Timelock** + high-impact extension | Speed of execution after approvals | `timelock_*`, `high_impact_threshold` |
| **Circuit breaker threshold** | Burst outflow in a short window (~1 hour) | `circuit_breaker_threshold` (storage / feature config) |
| Roles + threshold / quorum | Who can propose and how many must agree | Roles, `threshold`, `quorum` |
| Compliance score (dashboard) | Operational hygiene signal | Governance Health widget (`N% Compliant`) |

**Operator mindset:** Limits are tripwires, not suggestions the contract will politely ignore. When a tripwire fires, the correct response is to investigate—not to disable every control permanently.

---

## 2. Spending limit setup

### 2.1 The three native limits

On initialization and via Admin configuration updates (`update_limits` / Admin panel spending controls), VaultDAO expects positive values for:

1. **`spending_limit`** — maximum amount for a single proposal (in stroops for native XLM; analogous base units for other tokens as configured).
2. **`daily_limit`** — maximum sum of proposals/spends counted toward “today.”
3. **`weekly_limit`** — maximum sum counted toward the rolling week window the contract uses.

Multi-token vaults additionally configure **`token_daily_limits`** and **`token_weekly_limits`** aligned with `supported_tokens`.

Reputation-aware boosts may raise effective limits for high-reputation proposers in some deployments (for example 1.5× daily/weekly above a score threshold, or higher per-proposal caps). Treat boosts as *flexibility for trusted operators*, not a reason to set base limits dangerously high.

### 2.2 Percentage-of-treasury guidelines (guidelines, not mandates)

Use the table below as a **starting conversation** with your board. These percentages are **guidelines, not mandates**. Organizations with insurance covenants, grant restrictions, or regulated fiduciary duties should tighten further. Organizations running only Testnet sandboxes may loosen for ergonomics.

| Vault maturity | Suggested per-proposal cap (`spending_limit`) | Suggested daily cap | Suggested weekly cap | Notes |
| -------------- | --------------------------------------------- | ------------------- | -------------------- | ----- |
| New / high uncertainty | **0.5%–1%** of liquid treasury | **1%–2%** | **3%–5%** | Prefer smaller caps until processes prove reliable. |
| Steady operations | **1%–2%** | **2%–4%** | **5%–10%** | Common “working capital” band for DAOs with recurring payroll. |
| Mature + audited processes | **2%–3%** | **4%–6%** | **10%–15%** | Still keep circuit breaker well below “drain in an hour.” |
| Crisis / heightened alert | Cut prior caps by **half** temporarily | Same | Same | Pair with higher approval threshold if governance allows. |

**Again: guidelines, not mandates.** Document your chosen percentages in the board minutes and map them to absolute stroop/token amounts in the calculator section below.

### 2.3 How to set limits in practice

1. Inventory liquid balances per supported token (exclude illiquid or reserved buckets if your policy requires).
2. Pick a maturity row from the guidelines table (or a stricter custom policy).
3. Convert percentages to absolute units (see calculator).
4. Admin opens configuration / Admin Panel and updates spending limits.
5. Confirm on-chain via `get_config` / dashboard config view.
6. Announce the new caps to all Treasurers so proposal authors do not repeatedly hit errors.
7. Record the change in your monthly risk log (date, old values, new values, rationale).

### 2.4 Align limits with timelock and threshold

Spending caps alone are incomplete:

- Raise **approval threshold** when caps increase.
- Ensure **timelock_threshold** and **timelock_delay** catch mid-size payments even when under `spending_limit`.
- Set **`high_impact_threshold`** (impact score 0–100) so large/complex proposals automatically receive extended delay.

Example policy narrative (illustrative only): “Per-proposal cap 2% of treasury; anything above 0.5% enters timelock; impact score ≥ 70 adds extended timelock; circuit breaker pauses the vault if hourly outflow exceeds 3%.”

---

## 3. Spending limit calculator

### 3.1 Worked calculator table

Replace the “Example treasury” column with your numbers. Amounts below assume **native XLM** displayed in whole XLM for readability; configure the contract in stroops (1 XLM = 10,000,000 stroops).

**Example treasury liquid balance: 1,000,000 XLM**

| Limit field | Guideline % (not a mandate) | Absolute amount (XLM) | Stroops (for config) | When to use |
| ----------- | ----------------------------- | --------------------- | -------------------- | ----------- |
| `spending_limit` | 1% | 10,000 | 100,000,000,000 | Default per-proposal ceiling |
| `spending_limit` (conservative) | 0.5% | 5,000 | 50,000,000,000 | New vaults / post-incident |
| `spending_limit` (flexible) | 2% | 20,000 | 200,000,000,000 | Mature ops with strong quorum |
| `daily_limit` | 2% | 20,000 | 200,000,000,000 | Normal operations |
| `daily_limit` (tight) | 1% | 10,000 | 100,000,000,000 | Heightened alert |
| `weekly_limit` | 8% | 80,000 | 800,000,000,000 | Normal operations |
| `weekly_limit` (tight) | 4% | 40,000 | 400,000,000,000 | Heightened alert |
| Per-token daily (stablecoin example) | 2% of *that* token’s balance | (compute) | (compute) | Multi-token vaults |
| Circuit breaker hourly threshold | 3% of treasury (guideline) | 30,000 | 300,000,000,000 | Burst protection; see §6 |

**Blank worksheet for your vault**

| Limit field | Your guideline % | Your absolute amount | Configured on-chain? | Owner |
| ----------- | ---------------- | -------------------- | -------------------- | ----- |
| `spending_limit` | ____% | ________ | ☐ Yes / ☐ No | Admin |
| `daily_limit` | ____% | ________ | ☐ Yes / ☐ No | Admin |
| `weekly_limit` | ____% | ________ | ☐ Yes / ☐ No | Admin |
| Token A daily / weekly | ____% | ________ | ☐ Yes / ☐ No | Admin |
| Token B daily / weekly | ____% | ________ | ☐ Yes / ☐ No | Admin |
| `circuit_breaker_threshold` | ____% (hourly) | ________ | ☐ Yes / ☐ No | Admin / Security |

### 3.2 Sanity checks before saving config

- `spending_limit` ≤ `daily_limit` ≤ `weekly_limit` in almost all healthy policies (exceptions are rare and should be written down).
- Sum of expected recurring payments for a week should fit under `weekly_limit` with headroom for emergencies.
- Circuit breaker hourly threshold should be **lower** than “we could lose the treasury before humans notice,” typically a low single-digit percent of liquid funds (**guideline, not mandate**).
- Zero or negative limits are rejected at initialization; do not “disable” safety by setting absurdly large numbers without board approval.

### 3.3 Multi-token tip

When `supported_tokens` includes several assets, size each token’s daily/weekly caps against **that token’s** liquid balance, not against the XLM balance alone. A vault can be “fine” in XLM while a USDC bucket is over-exposed.

---

## 4. What happens when a limit is hit

Limits are enforced when proposing (and again in spirit at execution/recurring paths). Hitting a limit is a **controlled failure**, not a bug.

### 4.1 User experience (dashboard)

Typical UX sequence:

1. Treasurer fills a new transfer proposal (recipient, amount, token, memo, attachments).
2. On submit, Freighter may still prompt—or the simulation / contract call fails first depending on client path.
3. The UI surfaces a user-friendly error via toasts / error mapping (for example titles about spending or daily limits, with recovery suggestions such as reducing amount or waiting for the window to reset).
4. The proposal is **not** created (or not executable) when the contract rejects with a limit error—funds do not move.
5. Recurring payment keepers that attempt an over-limit execution likewise fail closed; operators see failed runs in monitoring rather than silent overspends.

Authors should treat the error as feedback: shrink the amount, split across days, or start a governance request to raise limits (Section 5).

### 4.2 Contract errors (what engineers and power users see)

Relevant `VaultError` outcomes include (names reflect contract semantics):

| Situation | Typical error / behavior |
| --------- | ------------------------ |
| Amount above per-proposal cap | Spending / proposal limit exceeded (SDK docs also describe `SpendingLimitExceeded`) |
| Today’s aggregate would exceed cap | `ExceedsDailyLimit` |
| Week’s aggregate would exceed cap | `ExceedsWeeklyLimit` |
| Per-token daily / weekly | `ExceedsTokenDailyLimit` / `ExceedsTokenWeeklyLimit` |
| Circuit breaker trips on execute | Vault auto-pauses; `VaultPaused` with cause `circuit_breaker` |

Exact numeric codes live in `contracts/vault/src/errors.rs`. Frontend `errorMapping` translates many of these into plain-language titles and recovery tips for non-technical Treasurers.

### 4.3 Recovery paths

**A. Benign oversize request**

1. Reduce the proposal amount under `spending_limit`.
2. Or wait until daily/weekly counters reset (temporary storage windows elapse).
3. Resubmit and continue normal approvals.

**B. Legitimate need larger than caps**

1. Do **not** ask Admin to set limits to “max int” in Slack.
2. Follow [Section 5](#5-temporary-limit-raises-governance--timelock--reset): governance proposal → timelock → temporary raise → execute needed payments → reset.
3. Log the exception in the monthly risk review.

**C. Suspected abuse or compromised proposer**

1. Stop creating new proposals from the suspect address.
2. Consider pausing / emergency controls if available to Admins.
3. Review recent approvals and outgoing transfers.
4. Rotate roles / remove signer if confirmed.
5. Keep limits **tight** during investigation.

**D. Recurring payments stuck on limits**

1. Confirm keeper errors show limit exhaustion vs insufficient balance.
2. Pause or adjust the recurring schedule.
3. Top up only if policy allows; otherwise re-size the recurring amount.

Refund semantics: when proposals are cancelled under certain paths, spending-limit buckets may be refunded (`refund_spending_limits` / token variants) so cancelled intents do not permanently consume daily/weekly capacity. Operators should still verify counters after large cancel waves.

---

## 5. Temporary limit raises (governance + timelock + reset)

Permanent limit inflation is how treasuries get drained slowly. Prefer **time-boxed raises**.

### 5.1 Recommended sequence

1. **Draft a governance proposal** (off-chain memo + on-chain config update proposal as your process requires) stating:
   - Current limits
   - Proposed temporary limits
   - Business reason (payroll spike, acquisition, disaster relief)
   - Exact reset values and reset deadline
2. **Collect approvals** at the normal or elevated threshold.
3. **Honor timelock** — especially if impact score is high or the config change itself is privileged. Do not social-engineer signers into “just signing because we are late.”
4. **Admin executes** the limit update after timelock.
5. **Execute the exceptional payments** that required the raise.
6. **Reset** limits to the prior (or safer) values via a second scheduled change—ideally already approved as a paired proposal or calendar reminder with owners.
7. **Verify** on-chain config matches the reset targets.
8. **Announce** completion to Treasurers.

### 5.2 Guardrails for temporary raises

- Cap the raise duration (for example 48–72 hours of operational need, **guideline, not mandate**).
- Prefer raising `daily_limit` / `weekly_limit` slightly rather than multiplying `spending_limit` by 10×.
- Pair raises with extra human review on each proposal (comments + attachment verification).
- Never combine “limits raised,” “threshold lowered,” and “timelock disabled” in the same window.

### 5.3 Reset discipline

Treat “forgot to reset” as an incident:

- Calendar invite with Admin + Treasurer + Security Officer.
- Dashboard reminder / ticket.
- Monthly checklist item explicitly confirms limits match policy targets (see §8).

---

## 6. Circuit breaker

### 6.1 What it is

The **circuit breaker** is a burst-outflow brake evaluated at **proposal execution**. It is separate from daily/weekly spending limits.

On-chain behavior (see `contracts/vault/src/lib.rs` and `storage.rs`):

1. Read **`circuit_breaker_threshold`** via `storage::get_circuit_breaker_threshold` (instance storage feature key; default `0` means disabled).
2. If threshold `> 0`, compute the current **hour window** (`ledger_sequence / 720`, roughly one hour of ledgers).
3. Read outflow already recorded for that window (`get_circuit_breaker_outflow`).
4. If `outflow + proposal.amount > threshold`:
   - Auto-set pause state with cause symbol **`circuit_breaker`**
   - Emit vault-paused event
   - Return **`VaultError::VaultPaused`**
5. Otherwise add the amount to the window’s outflow counter (temporary storage with short TTL).

This is the field operators mean when they say **Config / vault `circuit_breaker_threshold`**: configure it deliberately; leaving it at `0` disables the brake.

### 6.2 Choosing a threshold (guidelines, not mandates)

| Posture | Hourly `circuit_breaker_threshold` vs liquid treasury | Intent |
| ------- | ----------------------------------------------------- | ------ |
| Conservative | ~1%–2% | Very early pause; more false positives possible |
| Balanced | ~2%–4% | Catches automated drain attempts; allows busy hours |
| Permissive | ~5%+ | Only extreme bursts; ensure other limits are tight |

These percentages are **guidelines, not mandates**. Size the absolute threshold in the same units as proposal amounts.

### 6.3 Operator response when it trips

1. Confirm dashboard / events show pause cause `circuit_breaker`.
2. Halt keeper aggressive retries that might add noise.
3. Inventory executions in the last hour—expected payroll vs unknown recipients.
4. If legitimate burst (rare): unpause per Admin emergency procedure **after** human review, optionally raise threshold temporarily with governance, then reset.
5. If malicious: keep paused, rotate keys, cancel lingering proposals, engage Security Officer.

### 6.4 Relationship to backend “circuit breakers”

Note: the Node backend also has HTTP/webhook **circuit breakers** for failing RPC or notification endpoints. Those protect infrastructure availability. They are **not** the on-chain `circuit_breaker_threshold`. Treasurers care primarily about the on-chain pause; DevOps cares about both.

---

## 7. Compliance score interpretation

The dashboard **Governance Health** widget shows a badge like **`82% Compliant`** driven by `complianceScore` (0–100) from `GET /api/v1/snapshots/governance`, alongside participation rate and active proposal count.

### 7.1 Color bands (UI)

From `GovernanceHealthWidget`:

| Score | Badge color | Interpretation |
| ----- | ----------- | -------------- |
| **≥ 80** | Green | Healthy operational compliance posture |
| **50–79** | Yellow | Attention needed—process drift or missed controls |
| **< 50** | Red | Elevated risk—treat as a governance incident trigger |

(Report exports may use similar green / amber / red thresholds around 80 / 60.)

### 7.2 How to read the score as a Treasurer

The compliance score is a **hygiene and process signal**, not a guarantee that every payment is lawful in your jurisdiction. A green badge does not replace legal review. A red badge does not by itself mean funds were stolen—but it means you should investigate promptly.

Use it as:

- A leading indicator before monthly close.
- A talking point in board risk packets (“compliance 64% — yellow; actions …”).
- A prompt to check: overdue proposal reviews, missing attachment verification, limit exceptions not reset, low participation, failed webhook delivery to auditors, etc.

### 7.3 Actions by band

**Green (≥ 80)**  
Maintain course. Still run the monthly checklist. Spot-check one high-impact proposal end-to-end.

**Yellow (50–79)**  
Within 5 business days: list top gaps (participation, unsettled temporary limits, unsigned policies, keeper failures). Assign owners. Re-check score after fixes.

**Red (< 50)**  
Within 24–48 hours: Admin + Treasurer + Security huddle. Consider tighter limits, pause non-essential proposals, verify circuit breaker and signers. Document findings.

### 7.4 What not to do

- Do not “farm” the score with empty proposals.
- Do not disable monitoring to hide a red badge.
- Do not confuse participation % with compliance %—both appear on the same widget but answer different questions.

---

## 8. Monthly risk review checklist

**Time box:** complete in **under 1 hour**. Assign a facilitator (usually Treasurer) and a scribe.

### Pre-read (5 minutes)

- [ ] Pull current on-chain config: `spending_limit`, `daily_limit`, `weekly_limit`, token limits, `high_impact_threshold`, **`circuit_breaker_threshold`**
- [ ] Note Governance Health: participation %, active proposals, **compliance score** / `% Compliant` badge
- [ ] Skim last month’s outgoing transfers and any pause events

### Limits & capacity (10 minutes)

- [ ] Confirm absolute limits still match board policy percentages (**guidelines applied as your mandate**)
- [ ] Confirm any **temporary raises** from last month were **reset**
- [ ] Confirm `spending_limit` ≤ `daily_limit` ≤ `weekly_limit` (or documented exception)
- [ ] For each supported token, confirm daily/weekly caps still fit balances
- [ ] Estimate next month’s recurring + known one-offs; ensure weekly headroom ≥ 20% (**guideline, not mandate**)

### Circuit breaker & pause readiness (5 minutes)

- [ ] Verify `circuit_breaker_threshold` is **> 0** in production (or document intentional disable with Security sign-off)
- [ ] Confirm who can unpause and where the emergency runbook lives
- [ ] Review any `circuit_breaker` pause events since last review

### Governance & access (10 minutes)

- [ ] Signer list matches HR / board roster; remove departed members
- [ ] Review active **delegations**; revoke stale ones
- [ ] Spot-check Admin / Treasurer role assignments
- [ ] Confirm approval threshold and quorum still appropriate for treasury size

### Proposal quality sample (15 minutes)

- [ ] Open 2–3 recent high-amount proposals in **Proposal Detail**
- [ ] Confirm attachments verified (**✓ Verified**) or exception logged
- [ ] Confirm impact scores and timelocks behaved as expected
- [ ] Confirm no proposal bypassed intended recipient policy / whitelist mode

### Automation & notifications (10 minutes)

- [ ] Keeper / recurring execution success rate acceptable; no silent backlog
- [ ] Notification webhooks delivering (Slack/email/PagerDuty as configured)
- [ ] Backend RPC circuit breakers not stuck open against primary endpoints

### Close-out (5 minutes)

- [ ] Update risk log with compliance score trend (up / flat / down)
- [ ] File action items with owners and due dates
- [ ] Schedule next month’s review
- [ ] If compliance **< 50**, escalate per Section 7 before adjournment

---

## 9. Incident playbooks

### 9.1 Rapid outflow suspected

1. Pause vault if not already paused.
2. Snapshot config and recent events.
3. Freeze new approvals socially (announce in signer channel).
4. Rotate compromised keys; revoke delegations.
5. Engage Security Officer and external counsel as required.

### 9.2 Limits blocking payroll

1. Confirm it is a limit issue vs insufficient balance.
2. Use temporary raise procedure (§5)—not permanent inflation.
3. Prefer splitting payroll across days if policy allows.
4. After pay run, reset limits same day if possible.

### 9.3 Compliance score collapse

1. Do not ignore yellow/red badges for multiple weeks.
2. Run an out-of-cycle abbreviated checklist (§8).
3. Publish findings to the board packet.

---

## 10. Appendix: Config fields quick map

| Field | Role in risk management |
| ----- | ----------------------- |
| `Config.spending_limit` | Per-proposal ceiling |
| `Config.daily_limit` | Daily aggregate ceiling |
| `Config.weekly_limit` | Weekly aggregate ceiling |
| `Config.token_daily_limits` / `token_weekly_limits` | Per-asset ceilings |
| `Config.timelock_threshold` / `timelock_delay` | Slow mid/large executions |
| `Config.high_impact_threshold` | Extra delay for high impact scores |
| **`circuit_breaker_threshold`** | Hourly burst pause trigger |
| `Config.threshold` / `quorum` | Human consensus strength |
| `Config.supported_tokens` | Multi-token surface area |

---

*Related reading: `docs/reference/SECURITY.md`, `docs/reference/ARCHITECTURE.md`, `docs/guides/RECURRING_PAYMENTS.md`, `docs/guides/SIGNING_GUIDE.md`.*
