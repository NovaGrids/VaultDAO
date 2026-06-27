# Streaming Payment Rate Limiter — Issue #1064

## Summary

Implements a per-period cumulative outflow cap on vault streaming payments with burst allowance.

## What Was Added

### `types.rs`
- `StreamRateWindow` struct — Temporary storage structure tracking `total_streamed_in_window: i128` and `window_start_ledger: u32`
- `Config.stream_max_window_amount: i128` — maximum cumulative stream outflow per rolling window (0 = disabled)
- `Config.burst_factor: u32` — burst allowance multiplier ×100 (default 150 = 1.5×)

### `storage.rs`
- `DataKey::StreamRateWindow(u64)` — Temporary storage key for per-stream window data
- `get_stream_rate_window()` / `set_stream_rate_window()` — helpers using Temporary storage (auto-evicts)

### `errors.rs`
- `StreamRateLimitExceeded = 230` — cumulative outflow cap exceeded
- `StreamDustRejected = 231` — payment below 10-stroop dust threshold

### `lib.rs`
- `trigger_stream_payment(caller, stream_id, amount)` — new public entry point
  - Rejects dust (< 10 stroops) before rate check
  - Loads `StreamRateWindow` from Temporary storage, resets if window expired
  - Applies `burst_factor` to effective cap
  - Updates window accumulator before transfer
- `update_stream_rate_config(admin, stream_max_window_amount, burst_factor)` — admin-only config update

### `test_streaming.rs` — 7 tests
1. Normal flow within limit succeeds
2. Dust payment rejected
3. Burst allowed (within burst cap)
4. Burst denied after exhaustion
5. Rate limit disabled when `stream_max_window_amount = 0`
6. Only recipient can trigger payment
7. Admin can update rate config
