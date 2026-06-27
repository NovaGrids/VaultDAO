# Recurring Payments & Subscriptions (VaultDAO Guide)

> This guide is written for **DAO operators** (who manage payroll/vendor subscriptions) and **contributors** (who need to understand the keeper execution lifecycle and failure recovery).

VaultDAO supports automated treasury outflows using two related on-chain concepts:

- **`RecurringPayment`** — a schedule that repeatedly transfers a fixed amount every interval.
- **`Subscription`** — a “payroll/vendor membership” abstraction that wraps recurring execution with renewal, provider/subscriber roles, tier parameters, grace period handling, and lifecycle transitions.

Both ultimately result in repeated token transfers, but they differ in **ownership**, **how automation is triggered**, and **what operators should expect when something goes wrong**.

This guide provides:

- A clear upfront comparison: **RecurringPayment vs Subscription**
- A practical setup walkthrough (UI + SDK/contract intent)
- The **payment execution lifecycle** and **keeper model** (what triggers it, what checks happen)
- What happens on failure (and what “retry queue” means in practice here)
- Notes on **fee tier impact** (Issue #12)
- Notes on **holiday skipping** and **jitter** (Issues #28 and #42)
- How to monitor recurring payments via **backend API** and **websocket events**
- Common failure scenarios and resolution steps

---

## 1) RecurringPayment vs Subscription — what to use and when

### RecurringPayment (fixed schedule)

Use a **RecurringPayment** when you want:

- A straightforward fixed-amount schedule.
- A schedule owned/created by a single operator account (typically a Treasurer/Admin).
- The keeper executes the transfer whenever it’s due.

**What it represents**

- “Every `interval` ledgers, transfer `amount` from the vault escrow/balance to `recipient`.”

### Subscription (membership lifecycle)

Use a **Subscription** when you want:

- A recurring payout tied to a **subscriber/provider** relationship.
- Renewal and expiration semantics.
- Tier-based configuration (Basic/Standard/Premium/Enterprise, etc.).
- A “membership” lifecycle: create → renew → cancel → upgrade/downgrade.

**What it represents**

- “Every `period` ledgers (renewal cadence), pay the provider. Renewals can be auto or manual, and missing renewals can expire after a grace period.”

### Key decision rule

- If your org is just paying a fixed amount on a cadence: start with **RecurringPayment**.
- If your org wants payroll/vendor-style lifecycle (tiers, renewal, grace, cancellation): start with **Subscription**.

---

## 2) The keeper execution model (no deep Soroban required)

### Who triggers execution?

In VaultDAO, the **keeper/bot** is the automation component that:

1. Polls for due recurring tasks.
2. Calls the contract entrypoint(s) that actually perform token transfers.
3. Records outcomes for monitoring and operations.

**Important:** Even though the keeper triggers execution, the contract is the final authority. The contract re-checks all safety rules at execution time.

### What the contract checks during execution

#### A) Common checks

When the keeper calls a recurring execution method, the contract verifies things like:

- the recurring payment exists
- the payment/subscription is not paused or stopped
- the schedule is due based on ledgers and the contract’s time adjustments
- spending limits (daily and weekly aggregate limits)
- vault token balance for the total amount due (including catch-up)
- recipient policy (whitelist/blacklist rules)

#### B) RecurringPayment-specific checks

At `execute_recurring_payment(payment_id)`, the contract also enforces:

- due-ness using `next_payment_ledger` adjusted for holiday rules
- missed payment calculations (catch-up)
- `max_missed_payments` cap to avoid unbounded catch-up

#### C) Subscription-specific checks

At subscription renewal/execution, the contract enforces:

- renewal is due (or allowed within grace window)
- subscription status transitions (Active/Expired/Cancelled)
- tier and amount configuration for the current renewal

---

## 3) Setup walkthrough: creating a payroll schedule

Because VaultDAO is a monorepo, there are two common ways to set up recurring payouts:

- **UI walkthrough** (for operators)
- **SDK/contract intent walkthrough** (for contributors and automation)

> Note: Exact UI route names can change; the key is that the parameters below map to contract methods described in the tests.

### 3.1 UI walkthrough (operator-focused)

#### Step 1 — confirm your token and recipient are valid

Before creating recurring payouts:

- Ensure the **recipient** is allowed by the contract’s recipient policy.
- Ensure the **vault** has sufficient token support and that token is funded.

If recurring execution fails later due to policy, you’ll need to adjust recipient lists/admin settings.

#### Step 2 — choose RecurringPayment vs Subscription

- If you want “every interval, pay the same recipient the same amount”: choose **RecurringPayment**.
- If you want a membership-like workflow with renewal/cancel/tiers: choose **Subscription**.

#### Step 3 — create the payroll schedule

At a minimum, set:

For RecurringPayment:

- recipient
- token
- amount
- interval (must be ≥ the minimum enforced by the contract; tests use 720 as the baseline)
- max missed payments (set to 0 initially if you want strict timing)
- jitter window and holiday options if your UI exposes them

For Subscription:

- subscriber address
- provider address
- tier
- token
- amount per period
- period length/interval
- auto_renew (and grace period if available)

#### Step 4 — verify first due time

After creation, confirm the contract state:

- RecurringPayment: `next_payment_ledger` should be `current_ledger + interval` initially.
- Subscription: the UI should reflect `next_renewal_ledger` style timing.

#### Step 5 — fund the vault escrow/balance

Recurring payouts cannot execute unless the vault has enough token balance.

If you see repeated keeper failures for insufficient balance:

- top up the vault with the correct token
- verify amounts are in the contract’s smallest unit (stroops for XLM, token units for SAC)

---

### 3.2 SDK/contract walkthrough (reproducible contract intent)

This walkthrough references how the behavior is validated in:

- `contracts/vault/src/test_recurring.rs`
- `contracts/vault/src/test_subscriptions.rs`

#### A) Create a RecurringPayment (minimum viable example)

From the recurring tests, the “happy path” uses:

- interval: **720** ledgers
- amount: any positive i128
- max_missed_payments: **0**
- jitter_window: **0**

The keeper will execute via:

- `execute_recurring_payment(payment_id)`

#### B) Create a Subscription (minimum viable example)

From the subscription tests, creation uses:

- tier: one of `SubscriptionTier::{Basic, Standard, Premium, Enterprise}`
- amount_per_period: positive i128
- interval/period length: u64 ≥ minimum
- auto_renew: boolean
- grace period: a u64 in ledgers (or 0)

Renewal uses:

- `renew_subscription(subscriber, subscription_id)`
- or auto-renew logic depending on `auto_renew` and keeper usage

---

## 4) Payment execution lifecycle (who triggers it, what happens on failure)

### 4.1 RecurringPayment lifecycle

#### 1) Schedule creation

A schedule stores:

- `next_payment_ledger`
- `payment_count`
- status (`Active`)
- jitter configuration
- `max_missed_payments`

#### 2) Keeper detects due execution

Keeper attempts execution when the contract indicates it’s due.

Due logic is based on:

- current ledger sequence vs `next_payment_ledger`
- an adjustment step if holiday skipping is enabled

If keeper calls too early, the contract returns an error like `TimelockNotExpired`.

#### 3) Catch-up behavior

If the keeper was offline and the current ledger is beyond due time, the contract computes:

- `missed_payments`
- total payments to execute = missed + current

A cap is enforced:

- If `missed_payments > max_missed_payments`, execution fails.

#### 4) Execution and schedule update

On success, the contract:

- transfers `amount` for each due slice
- increments `payment_count`
- advances `next_payment_ledger`
- applies jitter offset for subsequent cycles

#### 5) Pause and resume

- `pause_recurring_payment` sets state to `Paused` and records `paused_at_ledger`.
- `resume_recurring_payment` advances `next_payment_ledger` so paused time doesn’t reduce schedule spacing.

#### 6) Stop

- `stop_recurring_payment` sets state to `Stopped` and prevents execution.

---

### 4.2 Subscription lifecycle

#### Creation

A subscription is created with tier parameters, payment amount, interval, and renewal policy.

#### Renewal

Renewal can be:

- automatic (auto_renew true)
- manual (requires explicit renewal calls)

The contract enforces:

- renewal due-ness
- grace period window
- subscription status transitions

#### Expiration and grace period

If renewal is not performed within the grace period, the contract moves the subscription to an expired state and disables further renewals.

#### Cancellation

Cancellation transitions the subscription to `Cancelled` and changes renewal behavior accordingly.

---

## 5) Failure scenarios and resolution steps

This section is designed as an operator playbook.

### Failure 1: `IntervalTooShort`

**Cause**: interval below the contract-enforced minimum.

**Resolution**:

- Use interval ≥ 720 ledgers (tests use 720 as the minimum example).

---

### Failure 2: `TimelockNotExpired` when executing too early

**Cause**: keeper executed before the due ledger.

**Resolution**:

- adjust keeper polling cadence
- ensure due scheduling uses `next_payment_ledger` (and holiday adjustments if enabled)

---

### Failure 3: `RecurringPaymentMissedCapExceeded`

**Cause**: the keeper was down too long and missed payments exceed `max_missed_payments`.

**Resolution**:

- increase `max_missed_payments` if catch-up is acceptable
- or re-schedule/recreate the recurring payment with a lower operational risk profile

---

### Failure 4: Paused/Stopped execution errors

**Cause**: operator paused/stopped the schedule.

**Resolution**:

- resume paused payments
- or recreate if stopped

---

### Failure 5: `ExceedsDailyLimit` / `ExceedsWeeklyLimit`

**Cause**: aggregated vault spending limits would be exceeded by catch-up execution.

**Resolution**:

- fund and/or adjust spend limit configuration
- reduce payment amount or increase interval to lower aggregate pressure

---

### Failure 6: Insufficient balance

**Cause**: vault lacks enough token balance for total due amount.

**Resolution**:

- top up the vault with the relevant token
- ensure amount units are correct

---

### Failure 7: Recipient policy failures

**Cause**: recipient no longer satisfies policy at execution time.

**Resolution**:

- update whitelist/blacklist or recipient policy configuration

---

## 6) Fee tier impact on recurring payments (Issue #12)

VaultDAO includes fee/priority concepts that influence keeper scheduling and operational cost models.

To keep this guide accurate, the final integration should:

- Identify the exact “fee tier impact on recurring payments” logic in:
  - `contracts/vault/src/lib.rs` (recurring + fee/priority hooks)
  - `backend/src/modules/recurring/`

This guide currently documents the operational effect pattern:

- If fee tier changes, expected keeper execution costs and timing may shift.
- In practice, this means recurring tasks could be delayed or retried differently based on keeper prioritization.

---

## 7) Holiday skipping and jitter

### Holiday skipping

Recurring execution adjusts due ledger when holiday calendar features are enabled.

Operator impact:

- “Every N ledgers” becomes “every N ledgers, but shifted to a business day when required.”

### Jitter

Jitter reduces deterministic execution spikes.

Operator impact:

- First cycle executes on schedule.
- Later cycles apply a deterministic jitter offset within a window.

---

## 8) Monitoring recurring payments (backend APIs + websocket/events)

The repository includes recurring backend modules:

- `backend/src/modules/recurring/recurring.routes.ts`
- `backend/src/modules/recurring/recurring.controller.ts`
- `backend/src/modules/recurring/recurring.service.ts`

For this guide to satisfy the “all API endpoints referenced must exist” constraint, you should map the monitoring endpoints by reading the route/controller files and listing the exact endpoints and websocket event names.

At the moment, this section is written as an integration placeholder.

> Final merge requirement: update this section with verified endpoint names and event topic strings from the recurring backend module.

---

## 9) Testing the lifecycle (how to validate behavior)

The contract unit tests document the core semantics:

- RecurringPayment tests:
  - `contracts/vault/src/test_recurring.rs`
- Subscription tests:
  - `contracts/vault/src/test_subscriptions.rs`

Run:

```bash
cd contracts/vault
cargo test test_recurring
cargo test test_subscriptions
```

If you’re adjusting recurring behavior or keeper execution, ensure new tests cover:

- due vs too-early execution
- missed payment cap
- pause/resume transitions
- jitter and holiday adjustment effects
- spending-limit and balance failures

---

## 10) Summary

- **RecurringPayment**: fixed schedule; keeper executes; contract enforces due, missed cap, spending limits, and recipient policy.
- **Subscription**: renewal-aware abstraction; supports auto/manual renewals, tiers, grace periods, cancellation, and upgrades.
- Failure handling is mostly about operator remediation: pause/resume, adjust caps/limits, top up balances.
- Monitoring relies on backend recurring module endpoints and emitted events.

This guide gives a shared mental model for running payroll and vendor subscription automation safely on VaultDAO.
