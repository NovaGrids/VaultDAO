# Governance Parameter Sensitivity Analysis

**Audience:** Vault operators, Admins, Treasurers, and security committees configuring VaultDAO on Stellar.  
**Goal:** Understand the security trade-offs of each governance parameter so operators can choose values that match their organization's risk appetite, rather than copying defaults blindly.  
**Status:** Production guidance. All percentages are **guidelines, not mandates**—your board charter, legal counsel, and insurance requirements always win.

---

## Table of contents

1. [Why parameter sensitivity matters](#1-why-parameter-sensitivity-matters)
2. [Parameter reference](#2-parameter-reference)
   - 2.1 [threshold (M-of-N)](#21-threshold-m-of-n)
   - 2.2 [quorum](#22-quorum)
   - 2.3 [spending_limit](#23-spending_limit)
   - 2.4 [daily_limit / weekly_limit](#24-daily_limit--weekly_limit)
   - 2.5 [timelock_threshold](#25-timelock_threshold)
   - 2.6 [timelock_delay](#26-timelock_delay)
   - 2.7 [high_impact_threshold](#27-high_impact_threshold)
   - 2.8 [circuit_breaker_threshold](#28-circuit_breaker_threshold)
   - 2.9 [velocity_limit](#29-velocity_limit)
   - 2.10 [default_voting_deadline](#210-default_voting_deadline)
   - 2.11 [threshold_strategy](#211-threshold_strategy)
3. [Cross-parameter interactions](#3-cross-parameter-interactions)
4. [Worked examples by vault archetype](#4-worked-examples-by-vault-archetype)
   - 4.1 [DAO (decentralized autonomous organization)](#41-dao-decentralized-autonomous-organization)
   - 4.2 [Investment club](#42-investment-club)
   - 4.3 [Enterprise treasury](#43-enterprise-treasury)
5. [Parameter selection checklist](#5-parameter-selection-checklist)
6. [Appendix: Quick decision matrix](#6-appendix-quick-decision-matrix)

---

## 1. Why parameter sensitivity matters

VaultDAO enforces security through configurable parameters, not through hardcoded assumptions. The same parameter value that protects a $1M treasury may be dangerously tight or dangerously loose for a $100M treasury. Misconfigured parameters are the leading cause of preventable treasury incidents:

- **Threshold too low** — a single compromised key can drain funds.
- **Timelock too short** — signers have insufficient time to detect and cancel malicious proposals.
- **Spending limit too high** — a rogue proposal can bypass aggregate safeguards.
- **Circuit breaker disabled** — burst attacks proceed without an automatic pause.

This guide explains the security implication of each parameter and provides worked examples so operators can calibrate values against their actual threat model.

---

## 2. Parameter reference

### 2.1 threshold (M-of-N)

**What it controls:**  
How many distinct signers must approve a proposal before it can execute. Expressed as `threshold` of `N` total signers (for example `3-of-5`).

**Low value (for example 1-of-5)**  
- **Pro:** Fast execution, low coordination overhead.  
- **Con:** A single compromised key can authorize transfers. If one signer is tricked or coerced, the treasury is at risk.  
- **When dangerous:** Any vault holding material funds, or any vault where signers are geographically dispersed and cannot coordinate in real time.

**High value (for example 4-of-5 or 5-of-5)**  
- **Pro:** Strong consensus requirement; limits blast radius of a single compromised signer.  
- **Con:** Slow governance. High thresholds can create deadlock if signers travel, change roles, or lose keys.  
- **When dangerous:** Very small signer sets (for example `2-of-2`) where losing one key permanently locks the vault.

**Guideline:**  
- Aim for `threshold = ceil(N * 0.6)` or higher.  
- For `N=3`, use `2-of-3` (minimum).  
- For `N=5`, use `3-of-5` (balanced) or `4-of-5` (paranoid).  
- Never set `threshold = N` unless you have a robust key-recovery plan.

---

### 2.2 quorum

**What it controls:**  
Minimum number of signers that must participate (approve, reject, or abstain) before a proposal is considered valid. Set to `0` to disable quorum checks. Unlike `threshold`, quorum measures *participation*, not just positive approvals.

**Low value (for example 1 or 2)**  
- **Pro:** Proposals pass even when many signers are inactive.  
- **Con:** A small active minority can pass proposals without broader oversight.  
- **When dangerous:** Large DAOs where most signers are dormant; a cartel of 2 active signers can control the treasury.

**High value (for example 80–100% of signers)**  
- **Pro:** Requires broad participation; harder for a small group to capture governance.  
- **Con:** Proposals stall when signers are unavailable (travel, illness, key loss).  
- **When dangerous:** Any organization with part-time board members or a large signer set.

**Guideline:**  
- For `N ≤ 5`, consider `quorum = threshold` (same number must participate as must agree).  
- For `N > 5`, consider `quorum = ceil(N * 0.5)`.  
- Set `quorum = 0` only for test vaults or when you have a strong off-chain commitment process.  
- If your vault uses delegation, remember that delegated votes count toward quorum.

---

### 2.3 spending_limit

**What it controls:**  
Maximum amount that a single proposal can request, in the token's smallest unit (stroops for XLM).

**Low value (for example 0.5% of liquid treasury)**  
- **Pro:** Caps the damage from any single rogue proposal.  
- **Con:** Large but legitimate transfers (payroll, acquisition) require multiple proposals or temporary limit raises.  
- **When dangerous:** When the limit is so low that operators routinely override it, training the team to treat limits as optional.

**High value (for example >5% of liquid treasury)**  
- **Pro:** Reduces operational friction for large transfers.  
- **Con:** A single compromised or coerced approval can move substantial funds in one step.  
- **When dangerous:** Mature vaults with strong quorum and long timelocks can tolerate higher per-proposal caps; immature vaults cannot.

**Guideline:**  
- **New / high uncertainty:** `0.5%–1%` of liquid treasury.  
- **Steady operations:** `1%–2%`.  
- **Mature + audited:** `2%–3%`.  
- Always ensure `spending_limit ≤ daily_limit ≤ weekly_limit`.

---

### 2.4 daily_limit / weekly_limit

**What it controls:**  
Aggregate maximum outflow across all proposals executed within a rolling daily or weekly window. These are enforced at execution time, not proposal time.

**Low value (for example 1% daily / 3% weekly)**  
- **Pro:** Limits the total damage possible in a short window even if multiple proposals are approved.  
- **Con:** Legitimate burst spending (payroll week, seasonal payouts) can hit the wall.  
- **When dangerous:** When operators lower daily limits to "be safe" without checking known recurring obligations.

**High value (for example 10% daily / 30% weekly)**  
- **Pro:** Accommodates normal operational cadence.  
- **Con:** An attacker who compromises multiple signers (or exploits a quorum weakness) can drain the treasury faster than humans can respond.  
- **When dangerous:** When daily and weekly limits are both raised to "max int" to "stop errors," effectively disabling the safety net.

**Guideline:**  
- Daily should be `2–4×` the weekly limit divided by 7.  
- Ensure known recurring payments for the next 7 days fit comfortably under `weekly_limit` with at least 20% headroom.  
- Pair with timelocks so that even if the weekly limit is exhausted, each individual proposal still faces scrutiny.

---

### 2.5 timelock_threshold

**What it controls:**  
The minimum proposal amount that triggers a mandatory timelock delay before execution. Proposals below this threshold execute immediately after threshold approvals are met; proposals at or above it must wait.

**Low value (for example 0.1% of treasury)**  
- **Pro:** Almost every transfer gets a cooling-off period; humans have time to detect mistakes.  
- **Con:** Operational friction for routine small transfers; signers may learn to ignore timelock warnings.  
- **When dangerous:** When the threshold is so low that timelocks become background noise, defeating their purpose.

**High value (for example >3% of treasury)**  
- **Pro:** Fast execution for routine payments; timelock reserved for truly large moves.  
- **Con:** A mid-size malicious transfer (for example 2% of treasury) executes without a delay, giving defenders little reaction time.  
- **When dangerous:** When `timelock_threshold` is set above `spending_limit`, making the timelock effectively unreachable.

**Guideline:**  
- Set `timelock_threshold` between `10%` and `50%` of `spending_limit`.  
- Common defaults: `0.5%` (paranoid), `1%` (balanced), `2%` (permissive).  
- Always verify `timelock_threshold < spending_limit`.

---

### 2.6 timelock_delay

**What it controls:**  
The number of ledgers (approximately 5 seconds each on Stellar) that must elapse after approvals are met before a timelocked proposal can execute.

**Low value (for example 720 ledgers ≈ 1 hour)**  
- **Pro:** Fast governance for time-sensitive opportunities.  
- **Con:** Insufficient time for signers to notice a compromised approval, pause the vault, or coordinate a rejection.  
- **When dangerous:** Any production treasury. A 1-hour delay is rarely enough for a multi-signer organization to convene and respond.

**High value (for example 17280+ ledgers ≈ 24 hours or more)**  
- **Pro:** Maximum reaction time; aligns with traditional "cooling-off" periods.  
- **Con:** Slows legitimate urgent payments; signers may develop workarounds (emergency procedures that bypass timelocks).  
- **When dangerous:** Extremely high delays (weeks) can be weaponized by a single disgruntled signer who refuses to approve and then claims the process is "broken."

**Guideline:**  
- **Minimum:** `17280` ledgers (~24 hours).  
- **Balanced:** `28800–43200` ledgers (8–12 hours).  
- **High-impact extension:** Add `14400–28800` ledgers (4–8 hours) when impact score ≥ threshold.  
- Document emergency override procedures if you use shorter delays.

---

### 2.7 high_impact_threshold

**What it controls:**  
An impact score (0–100) computed from treasury balance percentage, recipient risk, and proposal complexity. When a proposal's score meets or exceeds this threshold, the contract applies an extended timelock delay on top of the base `timelock_delay`.

**Low value (for example 40)**  
- **Pro:** Most non-trivial proposals get extra scrutiny and delay.  
- **Con:** Routine but slightly complex proposals (for example multi-condition payroll) trigger extended timelocks unnecessarily.  
- **When dangerous:** Operators learn to "game" the score by splitting transfers, reducing attachment complexity, or using known recipients to stay below the threshold.

**High value (for example 90)**  
- **Pro:** Extended timelock reserved for truly exceptional moves.  
- **Con:** Complex but legitimate proposals (mergers, structured deals) execute with only the base delay, which may be insufficient.  
- **When dangerous:** When the threshold is set so high that the extended timelock is effectively never triggered.

**Guideline:**  
- Default: `70–80`.  
- Conservative: `60`.  
- Permissive: `85`.  
- Pair with clear criteria in your governance policy so proposers understand what drives a high score.

---

### 2.8 circuit_breaker_threshold

**What it controls:**  
The maximum aggregate outflow allowed within a short hourly window. If execution would push the hourly total above this threshold, the contract auto-pauses the vault with cause `circuit_breaker`. Set to `0` to disable.

**Low value (for example 1% of treasury)**  
- **Pro:** Very early pause; may catch burst attacks before significant damage.  
- **Con:** False positives during legitimate high-activity periods (payroll runs, batch settlements).  
- **When dangerous:** When the threshold is so low that normal operations routinely trip it, causing operators to disable the circuit breaker entirely.

**High value (for example >10% of treasury)**  
- **Pro:** Accommodates busy execution windows without false trips.  
- **Con:** An attacker with compromised approvals can drain a large percentage of the treasury before the breaker fires.  
- **When dangerous:** When set to `0` (disabled) or so high that it never trips in practice.

**Guideline:**  
- **Conservative:** `1–2%` of liquid treasury per hour.  
- **Balanced:** `2–4%`.  
- **Permissive:** `5%+` only if daily/weekly limits and timelocks are extremely tight.  
- Always set `> 0` in production unless Security signs off on disablement.

---

### 2.9 velocity_limit

**What it controls:**  
The maximum number of proposals that can be created within a short time window (per ledger or per minute). This limits spam and slows an attacker who tries to flood the vault with small transfers.

**Low value (for example 1–5 per ledger)**  
- **Pro:** Severe throttle; makes brute-force or spam attacks expensive in time.  
- **Con:** Legitimate batch operations (for example 50 vendor payouts) require splitting across multiple ledgers or special batch approvals.  
- **When dangerous:** When the limit is so low that normal treasury operations cannot complete during a busy period.

**High value (for example 50+ per ledger)**  
- **Pro:** Batch-friendly; supports operational efficiency.  
- **Con:** An attacker with proposal rights can flood the vault with micro-transfers to obscure a large theft or exhaust signer attention.  
- **When dangerous:** When set to the maximum possible value to "avoid errors," removing the protection entirely.

**Guideline:**  
- **Conservative:** `5–10` per ledger.  
- **Balanced:** `10–20`.  
- **Permissive:** `20–50` for vaults with mature batch workflows.  
- Review after major batch operations to ensure the limit was not inadvertently blocking legitimate activity.

---

### 2.10 default_voting_deadline

**What it controls:**  
How long a proposal stays open for voting before it expires if the approval threshold is not met. Measured in ledgers.

**Low value (for example 1–2 days)**  
- **Pro:** Fast iteration; stale proposals don't linger.  
- **Con:** Signers who travel or have limited availability miss their voting window.  
- **When dangerous:** Short deadlines combined with high quorum requirements create a "perfect storm" where valid proposals consistently expire for lack of participation.

**High value (for example 14+ days)**  
- **Pro:** Maximum participation; signers have ample time to review.  
- **Con:** Proposals sit open for weeks, creating governance drift and uncertainty for proposers.  
- **When dangerous:** Open proposals can be superseded by newer proposals, leading to voter confusion and approval of outdated terms.

**Guideline:**  
- **Standard:** `100800` ledgers (~7 days).  
- **Fast-moving:** `51840` ledgers (~3 days).  
- **Slow / high-consensus:** `120960` ledgers (~10 days) or `172800` ledgers (~12 days).  
- Consider extending deadlines for high-impact proposals rather than changing the global default.

---

### 2.11 threshold_strategy

**What it controls:**  
How approval counts are calculated. Common strategies:

- **Absolute** — A fixed number of approvals is required (for example 3-of-5).  
- **Weighted** — Votes are weighted by signer reputation score or token balance.  
- **Tiered** — Different signer roles require different thresholds (for example Admins need 2-of-2, Treasurers need 3-of-5).

**Absolute (low complexity, predictable)**  
- **Pro:** Simple to understand and audit. Every signer has equal weight.  
- **Con:** Does not differentiate between trusted and untrusted signers.  
- **When dangerous:** When all signers are treated equally regardless of tenure or role, a new or compromised signer has the same power as a founding member.

**Weighted (meritocratic but complex)**  
- **Pro:** Experienced, high-reputation signers carry more influence.  
- **Con:** Weight calculation must be transparent; plutocracy risk if weights are based on token holdings.  
- **When dangerous:** When weights are opaque or can be gamed (for example by Sybil attacks on reputation).

**Tiered (role-aware)**  
- **Pro:** Aligns voting power with responsibility. Critical config changes might require unanimous Admin approval while routine transfers use a lower Treasurer threshold.  
- **Con:** More complex to configure and explain; role changes require careful coordination with threshold updates.  
- **When dangerous:** When tier thresholds are set such that a single Admin can unilaterally control privileged operations.

**Guideline:**  
- Start with **Absolute** unless you have a specific reason to weight votes.  
- If using **Tiered**, ensure the Admin tier threshold is at least `2` (never `1-of-1` for privileged operations).  
- Document the strategy and rationale in your governance constitution.

---

## 3. Cross-parameter interactions

Parameters do not operate in isolation. Changing one often requires adjusting others.

| Interaction | Risk if ignored |
| :--- | :--- |
| **threshold ↑ + quorum ↓** | Fewer signers must agree, but more must participate. Net effect: governance may stall. |
| **spending_limit ↑ without timelock_threshold ↑** | Large per-proposal caps with a high timelock trigger mean big transfers skip the delay. |
| **daily_limit ↑ + weekly_limit ↑ without timelock_delay ↑** | More money moves faster, giving defenders less reaction time. |
| **quorum ↑ + default_voting_deadline ↓** | Proposals expire before enough signers can participate. |
| **circuit_breaker_threshold ↑ + daily_limit ↑** | Both aggregate controls are weakened simultaneously, creating a large unprotected corridor. |
| **threshold_strategy = Tiered + threshold = 1 in any tier** | A single signer in a high-privilege tier can act unilaterally. |
| **velocity_limit ↑ + spending_limit ↑** | An attacker can spam many large proposals before defenders notice. |

**Rule of thumb:** When raising a permissive parameter (limit, threshold, delay), check whether any restrictive parameter needs to move in the opposite direction to maintain your intended security posture.

---

## 4. Worked examples by vault archetype

The following examples assume a liquid treasury of **1,000,000 XLM** and use the common Stellar ledger timing of approximately 5 seconds per ledger.

### 4.1 DAO (decentralized autonomous organization)

**Profile:** 9 signers, geographically dispersed, part-time participation, moderate to high treasury value, community-governed.  
**Risk appetite:** Moderate. Speed of execution matters, but consensus strength is valued.  
**Threat model:** Compromised individual keys, social engineering, low participation during off-hours.

| Parameter | Value | Rationale |
| :--- | :--- | :--- |
| `threshold` | `5-of-9` | Requires majority consensus; losing 4 signers still allows operation. |
| `quorum` | `5` | Same as threshold; a proposal needs the same number of participants as approvals. |
| `spending_limit` | `10,000 XLM` (1%) | Limits single-proposal damage while keeping payroll manageable. |
| `daily_limit` | `30,000 XLM` (3%) | Accommodates normal operational cadence. |
| `weekly_limit` | `100,000 XLM` (10%) | Weekly headroom for recurring obligations. |
| `timelock_threshold` | `5,000 XLM` (0.5%) | Most real transfers get a cooling-off period. |
| `timelock_delay` | `28800` ledgers (~40 hours) | Nearly two days of reaction time for signers in different time zones. |
| `high_impact_threshold` | `70` | Complex or large proposals get an extra 8 hours. |
| `circuit_breaker_threshold` | `20,000 XLM` (2%/hour) | Catches burst attacks while tolerating busy hours. |
| `velocity_limit` | `10` per ledger | Prevents spam without blocking batch operations. |
| `default_voting_deadline` | `100800` ledgers (~7 days) | Standard week-long window for community participation. |
| `threshold_strategy` | `Absolute` | Simple, transparent, and easy to audit. |

**Operational notes:**  
- DAOs should publish these parameters in a public governance document.  
- Consider a `quorum_percentage` if your DAO constitution requires a minimum turnout percentage rather than an absolute number.  
- When signer count changes (onboarding/offboarding), recalculate `quorum` and `threshold` together.

---

### 4.2 Investment club

**Profile:** 5 signers, small to medium treasury, face-to-face or real-time chat coordination, active participation expected.  
**Risk appetite:** Moderate-high. Speed matters for time-sensitive trades; trust between members is higher.  
**Threat model:** Single compromised key, accidental double-spend, market-timing pressure.

| Parameter | Value | Rationale |
| :--- | :--- | :--- |
| `threshold` | `3-of-5` | Majority approval; one or two absences do not block deals. |
| `quorum` | `3` | Matches threshold; ensures proposals have real participation, not just 3 people always approving. |
| `spending_limit` | `20,000 XLM` (2%) | Larger per-proposal cap suits opportunistic trades. |
| `daily_limit` | `50,000 XLM` (5%) | Accommodates clustered deal days. |
| `weekly_limit` | `150,000 XLM` (15%) | Reasonable for active rebalancing. |
| `timelock_threshold` | `10,000 XLM` (1%) | Most trades above 1% get a short delay. |
| `timelock_delay` | `17280` ledgers (~24 hours) | One full day; enough to review but not so long that opportunities expire. |
| `high_impact_threshold` | `80` | Only the largest or most complex positions get extended delay. |
| `circuit_breaker_threshold` | `30,000 XLM` (3%/hour) | Tolerates burst trading activity. |
| `velocity_limit` | `20` per ledger | Supports multiple concurrent trade proposals. |
| `default_voting_deadline` | `51840` ledgers (~3 days) | Fast-moving market environment. |
| `threshold_strategy` | `Absolute` | Straightforward for a small, known group. |

**Operational notes:**  
- Investment clubs should document an "emergency trade" procedure that allows unilateral execution for amounts below a documented tier limit, with post-hoc notification.  
- If the club uses a `signer_tier` system (see API), ensure `full_quorum_threshold` does not bypass `timelock_threshold` for amounts above the trade desk's comfort level.

---

### 4.3 Enterprise treasury

**Profile:** 7 signers, large treasury, regulated environment, strict governance requirements, multi-tier roles (C-suite, finance, security).  
**Risk appetite:** Low. Compliance, auditability, and defense-in-depth are prioritized over speed.  
**Threat model:** Compromised credentials, insider threat, regulatory audit, phishing of executives.

| Parameter | Value | Rationale |
| :--- | :--- | :--- |
| `threshold` | `5-of-7` | Requires near-unanimous approval; maximum consensus strength. |
| `quorum` | `5` | Matches threshold; proposals cannot pass with a small subset. |
| `spending_limit` | `50,000 XLM` (5%) | Generous per-proposal cap for M&A or large vendor payments, but still bounded. |
| `daily_limit` | `100,000 XLM` (10%) | Accommodates large payroll or settlement windows. |
| `weekly_limit` | `250,000 XLM` (25%) | Covers multi-day payment runs with headroom. |
| `timelock_threshold` | `25,000 XLM` (2.5%) | Most meaningful transfers enter timelock. |
| `timelock_delay` | `43200` ledgers (~60 hours) | Three full business days for legal, compliance, and security review. |
| `high_impact_threshold` | `60` | Lower threshold ensures complex proposals (conditions, dependencies, insurance) get extra delay. |
| `circuit_breaker_threshold` | `20,000 XLM` (2%/hour) | Conservative burst protection; aligns with SOC 2 / SOX control mindset. |
| `velocity_limit` | `5` per ledger | Limits proposal spam; supports deliberate, reviewed workflows. |
| `default_voting_deadline` | `120960` ledgers (~10 days) | Accommodates board schedules and compliance review cycles. |
| `threshold_strategy` | `Tiered` | Role-aware: Admins (config changes) may need `2-of-2`, Treasurers (transfers) need `3-of-5`. |

**Operational notes:**  
- Enterprises should pair these parameters with a formal governance policy (RFC process, multi-sig + HSM keys, quarterly access review).  
- `quorum` and `threshold` should be reviewed quarterly and after any key ceremony.  
- Consider whitelisting approved recipients for high-value transfers to reduce `high_impact_threshold` score inflation from recipient risk.  
- Document emergency override procedures with legal counsel approval; never disable `circuit_breaker_threshold` without a signed risk acceptance.

---

## 5. Parameter selection checklist

Use this checklist during vault setup and quarterly reviews.

- [ ] **Signer inventory** — Confirm current signer count, roles, and key custody model (hot, warm, cold).  
- [ ] **Threshold selection** — Set `threshold = ceil(N * 0.6)` or higher; never `1-of-N` for production.  
- [ ] **Quorum alignment** — Set `quorum` such that participation matches organizational availability; avoid deadlock.  
- [ ] **Spending caps** — Compute `spending_limit`, `daily_limit`, `weekly_limit` from board-approved percentages of liquid treasury.  
- [ ] **Timelock calibration** — Ensure `timelock_threshold < spending_limit` and `timelock_delay ≥ 17280` ledgers.  
- [ ] **High-impact policy** — Set `high_impact_threshold` and document what score triggers extended delay.  
- [ ] **Circuit breaker** — Set `circuit_breaker_threshold > 0`; test it in staging.  
- [ ] **Velocity check** — Set `velocity_limit` to accommodate known batch workflows without enabling spam.  
- [ ] **Voting deadline** — Set `default_voting_deadline` to match signer availability and market speed.  
- [ ] **Strategy choice** — Choose `threshold_strategy` and document the rationale.  
- [ ] **Cross-parameter review** — Verify no parameter pair creates an unintended weakening (see Section 3).  
- [ ] **Board approval** — Record final values in board minutes or governance charter.  
- [ ] **Staging test** — Execute a full proposal lifecycle on testnet with the chosen values before mainnet deployment.

---

## 6. Appendix: Quick decision matrix

Use this matrix for fast calibration during initial setup or emergency reconfiguration.

| If your priority is ... | Adjust ... | Direction | Example |
| :--- | :--- | :--- | :--- |
| **Prevent single-key compromise** | `threshold` | ↑ | `3-of-3` → `3-of-5` |
| **Avoid governance deadlock** | `threshold` | ↓ | `4-of-5` → `3-of-5` |
| **Increase participation** | `quorum` | ↑ | `2` → `3` |
| **Speed up small transfers** | `timelock_threshold` | ↑ | `1%` → `3%` |
| **Slow down large transfers** | `timelock_threshold` | ↓ | `3%` → `1%` |
| **Longer reaction window** | `timelock_delay` | ↑ | `24h` → `48h` |
| **Reduce false-positive pauses** | `circuit_breaker_threshold` | ↑ | `1%` → `3%` |
| **Tighter burst protection** | `circuit_breaker_threshold` | ↓ | `5%` → `2%` |
| **Support batch operations** | `velocity_limit` | ↑ | `5` → `20` |
| **Reduce spam risk** | `velocity_limit` | ↓ | `50` → `10` |
| **Faster governance cycles** | `default_voting_deadline` | ↓ | `10 days` → `3 days` |
| **Broader consensus time** | `default_voting_deadline` | ↑ | `3 days` → `10 days` |

**Reminder:** Every increase in a restrictive parameter (threshold, quorum, limits, timelock) improves security but reduces operational speed. Every decrease does the opposite. The art of governance parameter selection is finding the balance that matches your organization's actual risk appetite, not a theoretical maximum.

---

*Related reading: `docs/reference/SECURITY.md`, `docs/reference/ARCHITECTURE.md`, `docs/guides/TREASURY_RISK_MANAGEMENT.md`, `docs/reference/API.md`.*
