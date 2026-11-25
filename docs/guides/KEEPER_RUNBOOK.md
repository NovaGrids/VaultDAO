# Recurring Payment Keeper Runbook (VaultDAO)

This runbook covers safe operation of the recurring-payment keeper after
Issue #2225.

## Due detection and jitter

- The keeper polls `getDuePaymentsInWindow(current_ledger, jitter_window_max)`.
- A payment is triggered when `next_payment_ledger` is within
  `[current - jitter_window_max, current + 1]`.
- On-chain jitter is deterministic:
  `SHA256(u64_le(payment_id) || u64_le(creation_ledger))`; take the first four
  bytes as a little-endian `u32` and reduce modulo `jitter_window`. The window
  is capped at 10% of the interval. Do not treat `interval + jitter_offset`
  spacing as a missed payment — `recurring_pay_jittered` events attest to it.

## Catch-up policy

| Policy | Behavior |
| --- | --- |
| `PayUpToBudget` | Pay whole cycles up to the per-period catch-up budget, then bounded by daily/weekly/per-token spending limits. |
| `PayOne` | Pay one cycle for the whole outage; remaining cycles are discarded. |
| `Skip` | Pay only the current cycle; remaining cycles are discarded. |

Check `get_recurring_catch_up_controls(payment_id)` before investigating a
"short" payout. A `recurring_catch_up_budgeted(due_periods, paid_periods, budget)`
event is emitted whenever catch-up was capped. `max_missed_payments` still
applies first and returns `RecurringPaymentMissedCapExceeded`.

## Keeper fencing

`KeeperFence` issues a monotonically increasing token for each
`(vault, payment_id, next_payment_ledger)` lease. Every due-payment event
carries the token. Rules:

1. Acquire before publishing; if acquisition fails, another keeper owns the lease.
2. Re-validate the token immediately before publishing; a stale token is fenced.
3. Leases expire (default 60 s) and can then be acquired by another worker.
4. `release(key, token)` only succeeds for the current token, so a stale keeper
   cannot unlock another worker's lease.

In-memory fencing protects one process cluster; deployments with multiple
processes should back `KeeperFence` with a shared atomic store (the same
compare-and-set semantics apply).

## Failure and recovery

- `ExceedsDailyLimit` / `ExceedsWeeklyLimit`: wait for the next spending bucket
  or raise limits through governance; catch-up will never bypass them.
- `RecurringPaymentMissedCapExceeded`: recreate the schedule or raise
  `max_missed_payments` with an explicit budget.
- Two keepers running at once: expect one trigger and one "fenced out" debug
  log entry. If both publish, check that both jobs share the same fence store.

## Tests

```bash
cd contracts/vault && cargo test test_recurring_catchup_policy
cd backend && node --import tsx --test src/modules/jobs/recurring/keeper-fence.test.ts
```
