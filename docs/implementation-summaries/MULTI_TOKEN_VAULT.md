# Multi-Token Vault Support with Per-Token Spending Limits — Issue #1081

## Summary

Extends VaultDAO from single-token to multi-token treasury management with independent
per-token daily and weekly spending limits. Enables enterprise treasuries holding multiple
assets (XLM, USDC, custom tokens) to enforce separate limits per asset.

## What Was Added

### `types.rs`
- `Config.supported_tokens: Vec<Address>` — up to 10 supported token addresses
- `Config.token_daily_limits: Vec<i128>` — per-token daily spending limits
- `Config.token_weekly_limits: Vec<i128>` — per-token weekly spending limits
- `TokenSpendingConfig` struct — `{ token, daily_limit, weekly_limit, is_default }` for fast lookup
- `Config.stream_max_window_amount` and `Config.burst_factor` (streaming rate limiter fields)

### `storage.rs`
- `DataKey::TokenDailySpent(Address, u64)` — per-token daily tracking in Temporary storage
- `DataKey::TokenWeeklySpent(Address, u64)` — per-token weekly tracking in Temporary storage
- `DataKey::TokenSpendingConfig(Address)` — per-token config in Persistent storage
- Helper functions: `get/add_token_daily_spent`, `get/add_token_weekly_spent`,
  `get/set/remove_token_spending_config`, `refund_token_spending_limits`

### `errors.rs`
- `TokenAlreadySupported = 250`, `TokenNotSupported = 251`, `TooManyTokens = 252`
- `CannotRemoveDefaultToken = 253`, `TokenHasActivePayments = 254`

### `lib.rs`
- `add_supported_token(admin, token, daily_limit, weekly_limit)`:
  - Admin-only; max 10 tokens; rejects duplicates
  - First token added is the non-removable default
- `remove_supported_token(admin, token)`:
  - Blocks removal of default token (index 0)
  - Blocks removal if active recurring payments use this token
- `get_supported_tokens()` — returns all `TokenSpendingConfig` entries
- `is_token_supported(token)` — bool read-only check
- `get_config()` — public accessor for the full Config struct

### `test_multi_token.rs` — 9 tests
1. Add supported token
2. Cannot add duplicate token
3. `is_token_supported` correctness
4. Remove non-default token
5. Cannot remove default token
6. Cannot add more than 10 tokens
7. Remove with active recurring payment blocked
8. Non-admin cannot add token
9. Remove unsupported token fails

## Constraints

- Default token (first added) is never removable
- Max 10 supported tokens at any time
- Per-token limits are independent (no cross-token aggregate limit)
