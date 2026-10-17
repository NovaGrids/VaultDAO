# DEX Swaps and Price Oracle Guide

**Audience:** Operators who configure the price oracle and DEX allow-list, and treasurers who propose swaps and liquidity actions.
**Goal:** Explain how the oracle interface, staleness checks, DEX whitelist, `SwapProposal` variants, and slippage and price-impact checks work, and where the current implementation is still simulated.

> **Status:** The swap execution path is partly simulated. Swap amounts are computed locally, not by calling a DEX contract. The validation rules in this guide are enforced; the external DEX call is not yet wired. See [section 7](#7-current-limitations).

---

## Table of contents

1. [Overview](#1-overview)
2. [Price oracle](#2-price-oracle)
3. [Portfolio valuation](#3-portfolio-valuation)
4. [DEX configuration](#4-dex-configuration)
5. [Swap proposals](#5-swap-proposals)
6. [Execution and validation](#6-execution-and-validation)
7. [Current limitations](#7-current-limitations)
8. [Worked examples](#8-worked-examples)

---

## 1. Overview

Swaps and liquidity actions go through the normal proposal flow:

1. An admin configures the oracle (`set_oracle_config`) and the DEX allow-list (`set_dex_config`).
2. A treasurer proposes a swap with `propose_swap`, providing a `SwapProposal` variant.
3. Signers approve the proposal through the usual voting path.
4. Anyone authorized calls `execute_swap_proposal`, which re-checks the allow-list, the oracle prices, and the slippage bounds before recording the result.

---

## 2. Price oracle

### 2.1 Configuration

`set_oracle_config(admin, VaultOracleConfig)` takes:

| Field | Meaning |
|-------|---------|
| `address` | Contract address of the oracle |
| `base_symbol` | Base currency symbol, for example `USD` |
| `max_staleness` | Maximum age of a price, in seconds. Must be greater than `0` |

- The caller must authorize and hold the **Admin** role.
- A `max_staleness` of `0` is rejected with `InvalidAmount`.
- Successful updates emit an oracle-config-updated event.
- `set_oracle_config` is an alias for `update_oracle_config`.

### 2.2 Oracle interface

The vault calls one function on the oracle contract:

```
lastprice(asset: Address) -> Option<VaultPriceData>
```

The result must include a `price` (`i128`) and a `timestamp` (Unix seconds). The vault does not call any other oracle function.

### 2.3 Price lookup and failure behaviour

`get_asset_price(asset)` applies these checks in order:

| Condition | Result |
|-----------|--------|
| No oracle configured | `OracleNotConfigured` |
| Oracle returns `None` (no price for the asset) | `InvalidAmount` |
| `now - timestamp > max_staleness` | `OraclePriceStale`, and an oracle-price-stale event is emitted |
| `price <= 0` | `OracleError` |
| Otherwise | The price is returned |

**Staleness** is measured against the ledger timestamp at the time of the call, not against the time the oracle last updated. A price exactly `max_staleness` seconds old is still accepted; anything older is refused.

### 2.4 Decimals assumption

The vault assumes prices are **USD scaled by 10^7**, the Stellar convention, and that amounts are in **stroops** (7 decimals). Conversion:

```
usd_value = (amount * price) / 10_000_000
```

If your oracle reports a different scale, values will be off by that factor. Normalize the oracle output before configuring it.

---

## 3. Portfolio valuation

`get_portfolio_valuation(assets)` sums `convert_to_usd` over the given token addresses:

- An empty list returns `0`.
- Assets with a zero balance are skipped and do not trigger an oracle query.
- If **any** non-zero asset has no price, or a stale price, the whole call fails. There is no partial total.
- Sums use saturating addition.

Pass the full list of tokens you hold. Assets you omit are not counted.

---

## 4. DEX configuration

`set_dex_config(admin, DexConfig)` is restricted to the **Admin** role.

| Field | Meaning |
|-------|---------|
| `enabled_dexs` | Allow-list of DEX or farm contract addresses |
| `max_slippage_bps` | Slippage tolerance in basis points (for example `100` = 1%). Stored; see [section 7](#7-current-limitations) |
| `max_price_impact_bps` | Maximum price impact allowed for a swap, in basis points (for example `500` = 5%) |
| `min_liquidity` | Minimum liquidity for swaps. Stored; see [section 7](#7-current-limitations) |

The allow-list is the main control. Any DEX or farm address not in `enabled_dexs` is refused at both proposal and execution time with `DexError`.

If no DEX configuration exists, `propose_swap` and `execute_swap_proposal` fail with `DexError`.

---

## 5. Swap proposals

`propose_swap(proposer, swap_op, priority, conditions, condition_logic, insurance_amount)` requires the **Treasurer** role or higher. It checks that the DEX or farm address in the variant is on the allow-list, then creates a proposal flagged as a swap.

Each `SwapProposal` variant carries its own fields:

| Variant | Fields | What it does | Limits checked on execution |
|---------|--------|--------------|-----------------------------|
| `Swap(dex, token_in, token_out, amount_in, min_amount_out)` | DEX address, input and output tokens, input amount, minimum output | Swaps `amount_in` of `token_in` for `token_out` | DEX on allow-list; price impact at most `max_price_impact_bps`; output at least `min_amount_out` |
| `AddLiquidity(dex, token_a, token_b, amount_a, amount_b, min_lp_tokens)` | DEX, both tokens and amounts, minimum LP tokens | Adds liquidity to a pair | DEX on allow-list; LP tokens at least `min_lp_tokens` |
| `RemoveLiquidity(dex, lp_token, amount, min_token_a, min_token_b)` | DEX, LP token, LP amount, minimum of each token | Removes liquidity | DEX on allow-list; each received amount at least its minimum |
| `StakeLp(farm, lp_token, amount)` | Farm, LP token, amount | Stakes LP tokens in a farm | Farm on allow-list |
| `UnstakeLp(farm, lp_token, amount)` | Farm, LP token, amount | Unstakes LP tokens | Farm on allow-list |
| `ClaimRewards(farm)` | Farm | Claims farming rewards | Farm on allow-list |

Use `min_amount_out`, `min_lp_tokens`, and the `min_token_*` fields as your slippage protection. A value of `0` accepts any result.

Swap proposals use the normal expiry, priority, timelock, and condition settings, and are marked `is_swap` so that `execute_swap_proposal` accepts them.

---

## 6. Execution and validation

`execute_swap_proposal(executor, proposal_id)` requires only that the executor authorizes. Any authorized address can execute an approved swap. Before running the swap, it checks:

1. The proposal is a swap.
2. The status is `Approved`.
3. The proposal has not expired. An expired proposal is marked `Expired` and refused.
4. The timelock has passed, if one is set.

It then runs the variant-specific checks from [section 5](#5-swap-proposals).

### 6.1 Price impact

For a `Swap`, the vault fetches the oracle price of both tokens **before** execution and computes:

```
expected_out = amount_in * price_in / price_out
impact_bps   = (expected_out - actual_out) * 10_000 / expected_out
```

If `impact_bps > max_price_impact_bps`, the swap fails with `DexError`. If either price is zero or negative, the check fails with `OracleError`. A result that is better than expected gives an impact of `0`.

### 6.2 Output check

After the swap, the actual output must be at least `min_amount_out`. Otherwise the whole execution fails with `DexError` and the proposal stays approved.

### 6.3 Results

On success:

- The `SwapResult` is stored under the proposal ID and can be read back.
- The proposal status becomes `Executed`.
- The matching events are emitted for each variant.

---

## 7. Current limitations

Read this section before relying on swaps in production.

- **No external DEX call yet.** `Swap` computes the output locally at a fixed simulated rate (99% of `amount_in`, a 1% simulated slippage). The code marks the external call as a TODO. Output is therefore not what a live pool would return.
- **Liquidity actions are simulated.** `AddLiquidity` estimates LP tokens as `(amount_a + amount_b) / 2`. `RemoveLiquidity` and the farm variants also use simulated amounts.
- **`max_slippage_bps` and `min_liquidity` are stored but not enforced** on the swap paths in the current code. Use `min_amount_out` and the other `min_*` fields for slippage protection until this changes.
- **Oracle prices are read at execution time**, not at proposal time. A price move between approval and execution affects the price-impact check.

---

## 8. Worked examples

### 8.1 Configure the oracle and allow-list

```text
set_oracle_config(admin, {
  address: <oracle contract>,
  base_symbol: "USD",
  max_staleness: 300          // reject prices older than 5 minutes
})

set_dex_config(admin, {
  enabled_dexs: [<dex router>],
  max_slippage_bps: 100,      // 1%
  max_price_impact_bps: 500,  // 5%
  min_liquidity: 10_000
})
```

### 8.2 Propose a swap with protection

A treasurer proposes to sell 1,000 units of token A for token B. The minimum acceptable output is 980 units, which is a 2% tolerance against the oracle-implied amount.

```text
propose_swap(treasurer, Swap(<dex router>, <token A>, <token B>, 1_000, 980), ...)
```

If the oracle implies 1,000 units of B and the simulated output is 990, the price-impact check passes and the output check passes (990 ≥ 980).

### 8.3 Stale oracle

If the oracle's last update is 400 seconds old and `max_staleness` is 300, any step that prices an asset returns `OraclePriceStale`. That includes `execute_swap_proposal` for a `Swap`, and `get_portfolio_valuation` for any non-zero holding of that asset.

### 8.4 Unknown DEX

A proposal for a router that is not in `enabled_dexs` is refused at `propose_swap` with `DexError`. If the allow-list is later changed to remove a DEX that has an approved proposal, execution is refused for that proposal as well.

---

## Related guides

- [Treasury risk management](TREASURY_RISK_MANAGEMENT.md)
- [Governance parameter sensitivity](GOVERNANCE_PARAMETERS.md)
- [Insurance and staking](INSURANCE_AND_STAKING.md)
