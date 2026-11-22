# Governance Config Changes

This guide explains how vault configuration is changed on-chain, which parameters must go through the signer-governance workflow, and which ones a single Admin can change directly.

> **Read this before operating a production vault.** Several parameters that governance is meant to protect can also be changed by a single Admin through a direct setter (see [Governance bypasses](#known-governance-bypasses)). Until those setters are restricted in the contract, treat the Admin key as able to change any of them unilaterally.

All function and field names refer to `contracts/vault/src/lib.rs` and `contracts/vault/src/types.rs`.

---

## Authority levels

| Authority | Who | How it is checked |
|---|---|---|
| **Governance** | A supermajority of `Config.signers` | `propose_config_change` → `approve_config_change` (≥ governance threshold) → timelock / acknowledgment gate → `execute_config_change` |
| **Admin** | One address with `Role::Admin` | `admin.require_auth()` + role check; no other approvals |
| **Signer** | Any one address in `Config.signers` | `signer.require_auth()` + `config.signers.contains(..)` |
| **Init only** | Set in `InitConfig` at `initialize` | No setter exists; changing it requires a contract upgrade or migration |
| **Disabled** | Nobody | The direct setter always returns an error |

---

## The governance workflow

Governance proposals change **one** `ConfigParam` to **one** `i128` value.

### 1. `set_governance_threshold(admin, percentage)`

- **Authority:** Admin (single).
- Sets the percentage of signers that must approve a governance proposal.
- Valid range: `51`–`100`. Default when never set: **67**.
- Required approvals are `ceil(signers.len() × percentage / 100)`, calculated when each approval is recorded (so adding or removing signers changes the number required for proposals still pending).

### 2. `propose_config_change(proposer, param, new_value) -> u64`

- **Authority:** any signer.
- Creates a `GovernanceProposal` in `Pending` state and returns its ID.
- At most **3** governance proposals can be active at once (`ConfigChangeInProgress` otherwise).
- The proposal expires **120,960 ledgers (~7 days)** after creation.
- The proposer's own approval is **not** recorded automatically. Call `approve_config_change` separately.
- `new_value` is checked against the bounds and safety floors in the [parameter table](#governance-controlled-parameters) when proposed. Use [`simulate_config_change`](#simulate-before-apply) first to see the result.

### 3. `approve_config_change(voter, gov_proposal_id)`

- **Authority:** any signer, once per proposal.
- Rejects approvals after `expires_at` (`ProposalExpired`), duplicates (`AlreadyApproved`) and proposals that are no longer `Pending`.
- When approvals reach the required count the status becomes `Approved` and the change is queued behind its [execution gate](#timelock-and-dual-control). `config_change_queued(gov_id) → (unlock_ledger, risk_increasing, requires_ack)` is emitted.

### 4. `execute_config_change(caller, gov_proposal_id)`

- **Authority:** **any address**. The caller must sign the transaction but needs no role.
- Requires status `Approved` and an open [gate](#timelock-and-dual-control):
  - `ConfigChangeTimelocked` before `unlock_ledger`,
  - `ConfigChangeAckRequired` if a second acknowledgment is required and missing,
  - `VaultPaused` for a risk-increasing change while the vault is paused.
- Bounds and safety floors are **re-validated against the live config**. For example, a `Threshold` value that was valid when proposed but now exceeds the signer count fails with `ThresholdTooHigh`.
- Applies the new value through the same code `simulate_config_change` uses, marks the proposal `Executed` and emits [`config_diff`](#diff-events), `gov_proposal_executed` and `config_updated`.
- There is **no expiry check**: an approved proposal can be executed at any later time after its gate opens. Cancel stale ones with `cancel_config_change`.

### 5. `cancel_config_change(caller, gov_proposal_id)`

- **Authority:** the proposer, an Admin, or an emergency signer (`configure_emergency`).
- Cancels a `Pending` or `Approved` (queued) change, frees its active-proposal slot and removes its gate. Emits `config_change_cancelled`.

### Reading proposals

`get_governance_proposal(id) -> Option<GovernanceProposal>` returns the proposer, parameter, value, approvals, status, `created_at` and `expires_at`. `get_config_change_gate(id) -> Option<ConfigChangeGate>` returns the gate of an approved change.

---

## Simulate before apply

`simulate_config_change(param, new_value) -> ConfigChangePreview` is a read-only view (Issue #2060).

- Runs the same validation and safety floors as `propose_config_change`, so an invalid change fails here with the same error.
- Returns the old and new value, and the resulting `threshold`, `quorum`, `spending_limit`, `daily_limit`, `weekly_limit`, `timelock_delay`, `full_quorum_threshold`, `reputation_half_life` and `reputation_decay_floor`.
- Returns the controls that would apply: `risk_increasing`, `timelock_ledgers` and `requires_ack`.

`execute_config_change` applies the value with the same helper, so the preview matches the applied config exactly when nothing else changed in between. The test suite checks this for every parameter (`test_config_change_controls_2060.rs`).

## Timelock and dual control

A change is **risk-increasing** when it loosens a control:

| Parameter | Risk-increasing when |
|---|---|
| `Threshold`, `Quorum`, `TimelockDelay` | the new value is lower |
| `SpendingLimit`, `DailyLimit`, `WeeklyLimit` | the new value is higher |
| `FullQuorumThreshold` | it was enabled and is disabled (0) or raised |
| `ReputationHalfLife`, `ReputationDecayFloor` | never |

Tightening and neutral changes execute as soon as they are approved.

Risk-increasing changes wait **`max(Config.timelock_delay, 720)` ledgers** (at least ~1 hour) after approval. The delay is fixed when the change is approved and stored in its gate. A later `TimelockDelay` change does not shorten it.

**Dual control (optional).** `set_config_dual_control(admin, ack_role)` requires a second acknowledgment for every risk-increasing change approved while it is on:

- `acknowledge_config_change(acknowledger, gov_id)` must be called by an address whose role is exactly `ack_role` and who is **not** the change's proposer. It may be called during the timelock.
- `ack_role` cannot be `Observer` or `Member`.
- Turning dual control on only adds a control, so one Admin can do it. Turning it off needs `disable_config_dual_control(admin, acknowledger)`, signed by an Admin and a different holder of `ack_role`.
- Read the policy with `get_config_dual_control()`. Events: `config_dual_control`, `config_change_acked`.

### No timelock bypass

There is no call that executes a queued risk-increasing change before its `unlock_ledger`, or without its acknowledgment. The emergency path works the other way round, it can only stop a change:

1. An emergency signer calls `pause_vault`. While paused, `execute_config_change` refuses every risk-increasing change, even after its timelock.
2. An emergency signer (or an Admin) calls `cancel_config_change` to drop the queued change.
3. The vault is unpaused through the normal pause cooldown.

Tightening changes are not blocked by the pause, so signers can raise thresholds or lower limits during an incident.

## Safety floors

| Parameter | Floor |
|---|---|
| `Threshold` | Never below **2** (same minimum as `initialize` and `update_threshold`). `0` or `1` fails with `SafetyFloorViolation`. |
| `SpendingLimit`, `DailyLimit`, `WeeklyLimit` | Must stay positive and keep `spending ≤ daily ≤ weekly` (`InvalidAmount`). |

Floors are checked at proposal, simulation and execution time.

## Diff events

Every executed change emits one diff event:

- Topics: `("config_diff", gov_id, field)`, where `field` is `threshold`, `quorum`, `spending_limit`, `daily_limit`, `weekly_limit`, `timelock_delay`, `full_quorum_threshold`, `rep_half_life` or `rep_decay_floor`
- Data: `(old_value, new_value)`

### Example (Stellar CLI)

`ConfigParam` is a `#[repr(u32)]` enum, so pass the discriminant from the table below.

```bash
# Preview the result first (read-only)
stellar contract invoke --id "$VAULT" --network testnet -- \
  simulate_config_change --param 2 --new_value 500000000000

# Propose raising the daily limit (ConfigParam::DailyLimit = 2) to 50,000 XLM
GOV_ID=$(stellar contract invoke --id "$VAULT" --source signer1 --network testnet -- \
  propose_config_change --proposer "$SIGNER1" --param 2 --new_value 500000000000)

# Each signer approves until the governance threshold is met
stellar contract invoke --id "$VAULT" --source signer1 --network testnet -- \
  approve_config_change --voter "$SIGNER1" --gov_proposal_id "$GOV_ID"
stellar contract invoke --id "$VAULT" --source signer2 --network testnet -- \
  approve_config_change --voter "$SIGNER2" --gov_proposal_id "$GOV_ID"

# Raising a limit is risk-increasing: check when the gate opens
stellar contract invoke --id "$VAULT" --network testnet -- \
  get_config_change_gate --gov_proposal_id "$GOV_ID"

# Anyone can execute once Approved and past unlock_ledger
stellar contract invoke --id "$VAULT" --source signer1 --network testnet -- \
  execute_config_change --caller "$SIGNER1" --gov_proposal_id "$GOV_ID"
```

---

## Governance-controlled parameters

These are the only parameters `propose_config_change` accepts.

| `ConfigParam` | Value | `Config` field | Validation at proposal time | Direct setter that **bypasses** governance |
|---|---|---|---|---|
| `Threshold` | 0 | `threshold` | `2 ≤ v ≤ signers.len()` | `update_threshold` (Admin; reductions are routed through a timelocked proposal) |
| `SpendingLimit` | 1 | `spending_limit` | `v > 0`, `v ≤ daily_limit` | `update_limits` (Admin) |
| `DailyLimit` | 2 | `daily_limit` | `v > 0`, `spending_limit ≤ v ≤ weekly_limit` | `update_limits` (Admin) |
| `WeeklyLimit` | 3 | `weekly_limit` | `v > 0`, `v ≥ daily_limit` | `update_limits` (Admin) |
| `TimelockDelay` | 4 | `timelock_delay` | `v ≥ 0` | None. Governance only |
| `Quorum` | 5 | `quorum` | `0 ≤ v ≤ signers.len()` | `update_quorum` (Admin) |
| `FullQuorumThreshold` | 6 | `full_quorum_threshold` | `v ≥ 0` (0 disables) | None. `set_full_quorum_threshold` always fails |
| `ReputationHalfLife` | 7 | `reputation_config.decay_half_life_ledgers` | `v ≥ 0` (0 disables decay) | None. `set_reputation_config` always fails (Issue #2145) |
| `ReputationDecayFloor` | 8 | `reputation_config.decay_min_score` | `0 ≤ v ≤ 1000` | None. `set_reputation_config` always fails (Issue #2145) |

Governance checks the limit hierarchy (`spending ≤ daily ≤ weekly`) against the current values, like `update_limits`. To move all three limits in one direction, order the changes so each step stays consistent.

---

## Every `Config` field and its required authority

| `Config` field | Required authority | Entry point(s) |
|---|---|---|
| `signers` | **Admin** | `update_config_signers` (replaces the whole list), `remove_signer`. Also rewritten by `execute_recovery` |
| `threshold` | Governance **or Admin** | `ConfigParam::Threshold`, `update_threshold`. Also rewritten by `execute_recovery` |
| `quorum` | Governance **or Admin** | `ConfigParam::Quorum`, `update_quorum`. Also rewritten by `execute_recovery` |
| `spending_limit` | Governance **or Admin** | `ConfigParam::SpendingLimit`, `update_limits` |
| `daily_limit` | Governance **or Admin** | `ConfigParam::DailyLimit`, `update_limits` |
| `weekly_limit` | Governance **or Admin** | `ConfigParam::WeeklyLimit`, `update_limits` |
| `timelock_delay` | **Governance** | `ConfigParam::TimelockDelay` |
| `full_quorum_threshold` | **Governance** | `ConfigParam::FullQuorumThreshold` (`set_full_quorum_threshold` is disabled) |
| `threshold_strategy` | Admin | `set_threshold_strategy` |
| `veto_addresses` | Admin | `add_veto_address`, `remove_veto_address` |
| `pre_execution_hooks` / `post_execution_hooks` | Admin | `register_pre_hook`, `remove_pre_hook`, `register_post_hook`, `remove_post_hook` |
| `supported_tokens`, `token_daily_limits`, `token_weekly_limits` | Admin | `add_supported_token`, `remove_supported_token`, `set_token_limits` |
| `stream_max_window_amount`, `burst_factor` | Admin | `update_stream_rate_config`, `set_stream_burst_factor` |
| `approval_timeout_ledgers` | Admin | `update_approval_timeout` |
| `exec_window_ledgers` | Admin | `set_exec_window_ledgers` |
| `recovery_config` | **Governance** (signer supermajority) | `propose_recovery_config_change` → `approve_recovery_config_change` → `execute_recovery_config_change`. `set_recovery_config` is deprecated and always reverts with `InsufficientRole`. See [WALLET_RECOVERY.md](./WALLET_RECOVERY.md) |
| `whitelist_mode` | Admin | `set_whitelist_mode` |
| `min_participation_rate`, `low_participation_streak_n`, `participation_rate_window` | Admin | `update_participation_config` |
| `timelock_threshold` | Init only | `initialize` |
| `quorum_percentage` | Init only | `initialize` |
| `velocity_limit` | Init only | `initialize` |
| `default_voting_deadline` | Init only | `initialize` |
| `veto_window_ledgers` | Init only | `initialize` |
| `retry_config` | Init only | `initialize` |
| `staking_config` (in `Config`) | Init only | `initialize`. The live staking settings are in separate storage; see below |
| `signer_tiers` (in `Config`) | Init only | `initialize`. Per-signer tiers are in separate storage; see below |
| `proposal_id_prefix`, `grace_period_ledgers`, `vote_weight`, `high_impact_threshold`, `admin_rotation_delay`, `auto_topup_amount`, `tier_usage_tracking`, `arbitration_timeout_ledgers` | Init only | `initialize` |

## Settings stored outside `Config`

These module settings live in their own storage keys. **None of them go through governance.**

| Setting | Required authority | Entry point |
|---|---|---|
| Governance threshold (%) | Admin | `set_governance_threshold` |
| Roles | Admin (cannot grant a role ≥ its own) | `set_role` |
| Signer tier | Admin | `set_signer_tier` |
| Voting strategy | Admin | `update_voting_strategy` |
| Staking config | Admin | `update_staking_config` |
| Max proposal amendments | Admin | `set_max_amendments` |
| Funding-round config | **Any single signer** | `set_funding_round_config` |
| Keeper hooks | Any single signer | `register_keeper_hook` |
| Whitelist / blacklist entries, list mode | Admin | `add_to_whitelist`, `remove_from_whitelist`, `add_to_blacklist`, `remove_from_blacklist`, `set_list_mode` |
| Insurance, fee, gas, cost model, gas oracle | Admin | `set_insurance_config`, `set_insurance_voting_config`, `set_fee_structure`, `set_gas_config`, `update_cost_model`, `set_gas_price_oracle` |
| Price oracle, DEX, bridge, cross-vault | Admin | `update_oracle_config` / `set_oracle_config`, `set_dex_config`, `set_bridge_config`, `set_cross_vault_config` |
| Cold-signer, time-weighted voting | Admin | `set_cold_signer_config`, `set_time_weighted_config` |
| Reputation decay (governance only) | Governance | `ConfigParam::ReputationHalfLife`, `ConfigParam::ReputationDecayFloor` (`set_reputation_config` is disabled) |
| Streams auto-complete | Admin | `set_stream_auto_complete` |
| Templates | Admin | `update_template`, `update_var_template`, `set_template_status` |
| Holiday calendar, snapshot interval, pause cooldown, emergency | Admin | `set_holiday_calendar`, `set_snapshot_interval`, `set_pause_cooldown_config`, `configure_emergency` |

---

## Known governance bypasses

These are the overlaps operators most often miss. Each one lets a single key undo or pre-empt a signer supermajority.

1. **Limits, threshold and quorum have direct Admin setters.** `update_limits`, `update_threshold` and `update_quorum` write the same fields as `ConfigParam::{SpendingLimit, DailyLimit, WeeklyLimit, Threshold, Quorum}` without any signer approvals. A governance-approved value can be overwritten immediately afterwards.
2. **The Admin can replace the signer set.** `update_config_signers` replaces `Config.signers` wholesale. This changes who can vote on governance proposals and how many approvals are required.
3. **The Admin controls the governance threshold itself.** `set_governance_threshold` can lower the required supermajority to 51% with no approvals.
4. **Governance timelock applies only to governance.** Risk-increasing governance changes are timelocked (see [above](#timelock-and-dual-control)), but the direct Admin setters in item 1 are not.
5. **Funding-round config is single-signer.** `set_funding_round_config` needs only one signer, not governance or Admin.

`timelock_delay` and `full_quorum_threshold` are the only parameters that currently require governance with no bypass.

## Operational notes and limitations

- **Expired proposals keep their slot until cancelled.** The active-proposal counter decreases when a proposal is executed or cancelled. A proposal that expires while `Pending` keeps its slot until someone calls `cancel_config_change`, so three expired proposals block `propose_config_change` with `ConfigChangeInProgress` until they are cancelled.
- **Approved proposals never expire.** Execute them promptly or cancel them, or they can be applied long after the context has changed. Bounds are re-checked at execution, but intent is not.
- **Watch config events.** Alert on `config_change_queued` for risk-increasing changes: that is the window to cancel. `execute_config_change` and most direct `Config` setters (`update_threshold`, `update_limits`, `update_quorum`, `update_config_signers`, …) emit `config_updated`, which is the best single signal to alert on. Some paths emit only their own event or none: `set_exec_window_ledgers` emits `exec_window_ledgers_updated`, and `set_governance_threshold` emits nothing. For those, poll `get_config` or the relevant getter. See [`../reference/EVENTS.md`](../reference/EVENTS.md).
- **Protect the Admin key like a multisig.** Because of the bypasses above, hold the Admin role with a multisig account or hardware wallet and keep it separate from day-to-day signer keys.

## Related

- [`../reference/SECURITY.md`](../reference/SECURITY.md): vulnerability disclosure policy
- [`../reference/AUDIT_SCOPE.md`](../reference/AUDIT_SCOPE.md): known attack surfaces and findings
- [`WALLET_RECOVERY.md`](./WALLET_RECOVERY.md): guardian-based recovery, including its governance config flow
- [`TREASURY_RISK_MANAGEMENT.md`](./TREASURY_RISK_MANAGEMENT.md)
