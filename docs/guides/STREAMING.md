# Streaming Payments

**Audience:** Treasurers who create and manage streams, operators who set the pause policy and burst caps, and keepers who run the permissionless maintenance calls.
**Goal:** Explain how a stream accrues, what pausing, clawback and the rate window do to it, and the invariants the contract keeps across all of them.

Source of truth: the streaming sections of `contracts/vault/src/lib.rs` and `StreamingPayment`, `StreamPausePolicy`, `StreamRateWindow` in `contracts/vault/src/types.rs`.

---

## 1. Lifecycle

```
create_stream ──▶ Active ──pause_stream──▶ Paused ──resume_stream──▶ Active
                    │                        │
                    │                        └─ pause outlives policy ─▶ AutoResume (Active) / AutoCancel (Cancelled)
                    ├─ claim_stream / trigger_stream_payment (pays accrued)
                    ├─ execute_clawback (recalls unvested; stream keeps running)
                    └─ cancel_stream ─▶ Cancelled (accrued to recipient, rest to sender)
```

| Call | Who | Effect |
|------|-----|--------|
| `create_stream` | Treasurer / Admin (or `InitiateStream` capability) | Escrows `total_amount` into the vault |
| `claim_stream` | Recipient | Pays everything accrued and unclaimed |
| `trigger_stream_payment` | Recipient | Pays a chosen `amount` up to what has accrued |
| `pause_stream` / `resume_stream` | Sender / Admin | Freeze / restart accrual |
| `cancel_stream` | Sender / Admin | Settle: accrued to recipient, rest refunded to sender |
| `request_stream_clawback` → `vote_clawback` → `execute_clawback` | Admin / Treasurer quorum | Recall unvested funds |
| `enforce_stream_pause_policy` | Anyone (keeper) | Apply the pause policy to an over-long pause |

## 2. Accrual

Accrual is integer fixed-point:

```
active_seconds = accumulated_seconds + (min(now, end_timestamp) - last_update_timestamp)   // Active only
accrued        = min(rate * active_seconds, total_amount)                                    // saturating multiply
claimable      = accrued - claimed_amount
```

- Only an **Active** stream accrues new seconds. A Paused stream accrues nothing, however long the ledger gap.
- Accrual stops at `end_timestamp` and never exceeds `total_amount`.
- Every path that pays out (`claim_stream`, `trigger_stream_payment`, `cancel_stream`, `execute_clawback`) uses the same calculation.
- `adjust_stream_rate` rescales banked seconds by flooring, so a rate change can under-pay by less than one second of accrual, never over-pay.

## 3. Pausing

On `resume_stream` the schedule is extended by the paused time: `end_timestamp += now - pause_start`, and `pause_duration` / `pause_cycles` are updated.

- A pause that begins **after** `end_timestamp` earns no extension: the stream had already finished accruing.
- Claiming or clawing back during a pause does not reset the pause start, so it neither shortens the extension nor restarts the pause TTL.

### 3.1 Pause TTL policy

`set_stream_pause_policy(admin, StreamPausePolicy { max_pause_secs, action })` (Admin only) bounds how long any stream may stay paused. `max_pause_secs = 0` disables the policy (the default). `get_stream_pause_policy()` reads it.

Once `now > pause_start + max_pause_secs`:

| `action` | Behaviour |
|----------|-----------|
| `AutoResume` | The stream is treated as resumed at the deadline: the extension is capped at `max_pause_secs` and accrual restarts from `pause_start + max_pause_secs`. This is applied lazily by `claim_stream`, `trigger_stream_payment`, `resume_stream`, `cancel_stream` and `execute_clawback`, or eagerly by `enforce_stream_pause_policy`. |
| `AutoCancel` | `resume_stream` fails with `StreamPauseExpired` (1208). Anyone can call `enforce_stream_pause_policy(stream_id)`, which cancels the stream: the recipient receives everything accrued before the pause and the sender is refunded the rest. The recipient can still claim pre-pause accrual until then. |

`enforce_stream_pause_policy` returns the new status (`Active` or `Cancelled`), fails with `ProposalNotPending` if the stream is not paused, and with `TimelockNotExpired` if the pause is still within the policy. Both outcomes emit `stream_pause_expired(stream_id; action, paused_at, applied_at)`.

## 4. Clawback

A clawback recalls `min(requested, total_amount - accrued)`. Funds the recipient can already withdraw are never taken. The recalled amount is refunded to the sender, `total_amount` is reduced by it, and the stream keeps running.

`get_stream_clawed_amount(stream_id)` returns the cumulative amount recalled. The current `total_amount` always equals `original_total - clawed`.

## 5. Burst caps (rate window)

`update_stream_rate_config(admin, stream_max_window_amount, burst_factor)` sets a per-stream outflow cap over a rolling window of 17,280 ledgers (~1 day). `stream_max_window_amount = 0` disables it. `set_stream_burst_factor` changes the factor alone (100–300).

```
effective_cap = stream_max_window_amount * burst_factor / 100
```

- The cap applies to **every** stream payout: `claim_stream` and `trigger_stream_payment`. `cancel_stream` and clawback are not capped, so a stream can always be settled.
- Creating a stream escrows funds and does **not** consume the window.
- A payout that would take the window above `effective_cap` is rejected with the stable error `StreamRateLimitExceeded` (230). Soroban reverts the call, so nothing is recorded.
- A payout that takes the window above the base cap but within the burst allowance succeeds and emits `stream_burst_used(stream_id; window_total, base_cap, effective_cap, window_start_ledger)`.
- `get_stream_rate_window(stream_id)` returns the current window.

## 6. Invariants

These hold after every call and are checked by the property test in `contracts/vault/src/test_stream_invariants_2055.rs`:

1. `claimed_amount <= total_amount = original_total - clawed`.
2. Recipient balance received from the stream equals `claimed_amount`.
3. Tokens are conserved between recipient, sender and vault.
4. A pause, at any length and across any ledger gap, adds no accrual.

## 7. Events

| Event | Topics | Data |
|-------|--------|------|
| `stream_status` | `stream_id` | `(status, updated_by)` |
| `stream_pause_policy` | — | `(admin, max_pause_secs, action)` |
| `stream_pause_expired` | `stream_id` | `(action, paused_at, applied_at)` |
| `stream_burst_used` | `stream_id` | `(window_total, base_cap, effective_cap, window_start_ledger)` |
| `stream_clawback_executed` | `stream_id` | `(amount, executed_by)` |

## Related guides

- [Recurring payments](RECURRING_PAYMENTS.md)
- [Token vesting](VESTING.md)
- [Treasury risk management](TREASURY_RISK_MANAGEMENT.md)
