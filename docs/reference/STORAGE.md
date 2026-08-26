# VaultDAO Storage Architecture Deep-Dive (Instance vs Persistent vs Temporary) + Cost Model

> Audience: contributors extending VaultDAO contract features.

This document explains:

1. **When to use Soroban storage types** in VaultDAO (**Instance**, **Persistent**, **Temporary**) with concrete rules.
2. **How TTL works** (including what happens on expiry and how TTL extension affects rent).
3. A **cost model** for estimating ledger rent impact (with example calculations).
4. **Storage key design patterns** (namespacing, collision avoidance, key size considerations).
5. A **current VaultDAO storage inventory**: every storage key variant in `contracts/vault/src/storage.rs`.
6. **Migration considerations**: safely changing storage type for existing data.

## 0) Storage types in Soroban (VaultDAO usage model)

Soroban provides three storage classes:

- **Instance storage** (`env.storage().instance()`): data kept permanently by default and loaded into the contract’s state for every invocation.
- **Persistent storage** (`env.storage().persistent()`): long-lived data (survives across invocations) that can optionally have TTL to reclaim rent.
- **Temporary storage** (`env.storage().temporary()`): time-bounded data that is cheap and auto-evicts when TTL expires.

VaultDAO uses a **hybrid storage model** optimized for ledger rent:

- frequently accessed configuration and indexes → **Instance**
- canonical state that must outlive invocations → **Persistent** (often with TTL)
- short-lived counters / windows / snapshots → **Temporary**

The contract also uses **TTL extension** heavily via `extend_ttl` to reclaim rent while tolerating late readers and retry windows.

## 1) Storage type decision tree (Mermaid)

Use this decision tree when adding new state.

```mermaid
flowchart TD
  A[Does the data need to be present for *every* invocation?] -->|Yes| B[Use Instance storage]
  A -->|No| C[Does the data need to survive across invocations for a long lifecycle?]
  C -->|Yes| D[Use Persistent storage]
  C -->|No| E[Is the data only needed for a bounded time window?]
  E -->|Yes| F[Use Temporary storage]
  E -->|No| G[Re-check; consider Persistent with TTL or redesign]

  B --> H[Also consider: small hot indexes only]
  D --> I[Prefer Persistent + TTL if you can define an expiry]
  F --> J[Always define TTL based on correctness window]
```

## 2) Concrete rules: when to use each storage type

### 2.1 Use **Instance** storage when…

- The value is a **configuration constant** or **hot index** that is required during normal execution paths.
- The value is small and frequently used (avoids repeated persistent reads).
- The value has a **nearly indefinite lifecycle** and TTL would be either unnecessary or counterproductive.

In `contracts/vault/src/storage.rs`, common Instance storage usage includes:

- Initialization flag: `DataKey::Initialized`
- Core config: `DataKey::Config`
- Indexes/counters used for enumeration and next-ID allocation (e.g., `NextProposalId`, `NextRecurringId`)
- Hot “current window” metrics stored as instance when it’s aggregated and used for derived views.

### 2.2 Use **Persistent** storage when…

- The value represents **canonical state**: proposals, escrow objects, retry state, subscriptions, etc.
- The data must outlive invocations.
- You can define a **TTL strategy** to avoid unbounded rent when data becomes irrelevant.

In `storage.rs`, many persistent keys are extended with TTL, for example:

- Proposals: `PROPOSAL_TTL` based extension
- Roles and whitelists: `INSTANCE_TTL_THRESHOLD` + `INSTANCE_TTL`
- Many “feature keys” (`FeatureKey::*`) use `extend_ttl` with `PERSISTENT_TTL` / `PROPOSAL_TTL`.

### 2.3 Use **Temporary** storage when…

- The value is a **counter or window** that is only required for a short time.
- The value can be evicted without breaking correctness (once TTL expires, the system must behave as if the data is reset/absent).

Examples from `storage.rs`:

- Daily spent counters: `DataKey::DailySpent(day)`
- Weekly spent counters: `DataKey::WeeklySpent(week)`
- Velocity histories: `temporary()` usage with TTL extension
- Execution snapshots: `ExecutionSnapshot` in temporary storage
- Streaming rate limiter window: `DataKey::StreamRateWindow(stream_id)`

## 3) TTL mechanics in VaultDAO

### 3.1 TTL constants used in the contract

From `contracts/vault/src/storage.rs`:

- `DAY_IN_LEDGERS = 17_280` (~24 hours at 5 s/ledger)
- `PROPOSAL_TTL = DAY_IN_LEDGERS * 7` (7 days)
- `INSTANCE_TTL = DAY_IN_LEDGERS * 30` (30 days)
- `PERSISTENT_TTL = DAY_IN_LEDGERS * 30` (30 days)
- `INSTANCE_TTL_THRESHOLD = DAY_IN_LEDGERS * 7`
- `PERSISTENT_TTL_THRESHOLD = DAY_IN_LEDGERS * 7`

These are used with:

- `extend_ttl(&key, threshold, ttl)`

### 3.2 What TTL extension means

`extend_ttl(key, threshold, ttl)` effectively says:

- if remaining TTL is below `threshold`, extend to `ttl`.
- this avoids paying rent for already-fresh entries repeatedly.

VaultDAO uses the pattern to keep recently accessed data alive but allow stale data to expire.

### 3.3 What happens on expiry

When TTL expires:

- data is evicted (no longer retrievable via `.get(&key)`)
- contract logic must handle missing data as “default state”

VaultDAO relies on this by using `.unwrap_or(0)` / `.unwrap_or_else(Vec::new(env))` defaults in getters.

### 3.4 How TTL affects correctness

You must set TTL based on **your correctness window**:

- For daily counters, TTL covers at least “the time until that day is no longer needed” plus safe margin.
- For proposal-related entries, TTL should cover typical cancel/execute delays.

Example in code:

- DailySpent TTL is extended for `DAY_IN_LEDGERS * 2` (covers ~48 hours).
- WeeklySpent TTL is extended for `DAY_IN_LEDGERS * 14`.
- Execution snapshots are stored for `DAY_IN_LEDGERS`.

### 3.5 TTL extension under adversarial timing

Important: because TTL eviction is time-based, you must ensure:

- If a function expects the data to exist (e.g. replay prevention or rate windows), TTL must cover the worst-case time between setting and reading.
- If retries or delayed execution exist, the TTL must cover those spans.

## 4) Cost model: estimating storage rent impact

### 4.1 How Soroban actually computes rent (CAP-0066)

Soroban's rent fee formula is defined in [CAP-0066 (State Archival)](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0066.md):

```
rent_fee_for_size_and_ledgers(is_persistent, S, L) = round_up(
    S * L * rent_fee_per_1kb(BucketListSize) /
    if (is_persistent, persistentRentRateDenominator, tempRentRateDenominator)
)
```

Where:

- `S` = entry size in bytes (key + value, XDR-encoded)
- `L` = number of ledgers the TTL is extended by
- `rent_fee_per_1kb(BucketListSize)` = a rate that **grows with total Soroban state size on the network** — it is not a fixed constant. Below the network's target state size it grows linearly; above it, it grows faster via a configured growth factor. This is a deliberate economic lever to discourage unbounded state growth.
- `persistentRentRateDenominator` / `tempRentRateDenominator` — persistent storage divides by the smaller denominator (i.e. costs more per byte-ledger) than temporary storage, which is why §2.3 recommends temporary storage for anything that doesn't need to survive long-term.

**Important:** because `rent_fee_per_1kb` is dynamic, there is no fixed "stroops per KB" constant that stays valid over time — it depends on current network-wide Soroban state size. Always pull the live rate from [Stellar Lab → Network Limits](https://lab.stellar.org/network-limits) (or `simulateTransaction`'s resource fee breakdown against your own RPC) before budgeting a real deployment. The cost estimator script below takes this rate as an input parameter for exactly that reason.

### 4.2 Estimated entry sizes per `DataKey` / `FeatureKey` variant

Exact XDR-encoded sizes depend on field contents (e.g. how many tags or approvals a proposal has), so the table below gives **approximate, order-of-magnitude sizes** grouped by the underlying Rust type, derived from the struct definitions in `contracts/vault/src/types.rs` and `storage.rs`. Treat these as planning estimates — measure real sizes with `stellar contract read` / RPC ledger-entry footprints before finalizing a budget.

| Group | Representative `DataKey` / `FeatureKey` variants | Storage type | Approx. size | Why |
| --- | --- | --- | --- | --- |
| Scalar counters/flags | `Initialized`, `NextProposalId`, `NextRecurringId`, `NextCommentId`, `NextAuditId`, `NextStreamId`, `NextInsuranceClaimId`, `NextDelegationId`, `NextHTagId`, `HTagCount`, `NextVarTemplateId`, `VarTemplateCount` | Instance | ~20–40 bytes | Single `u32`/`u64` value plus key discriminant overhead |
| Hash/bytes values | `LastAuditHash`, `ColdSigUsed(BytesN<32>)` | Instance/Persistent | ~50–70 bytes | Fixed 32-byte hash plus XDR type/length overhead |
| Small address-keyed records | `Role(Address)`, `Whitelist(Address)`, `Blacklist(Address)`, `TokenSpendingConfig(Address)`, `Reputation(Address)` | Instance/Persistent | ~60–120 bytes | One `Address` key (~36–40 bytes encoded) plus a small struct/enum value |
| Time-windowed counters | `DailySpent(u64)`, `WeeklySpent(u64)`, `TokenDailySpent(Address, u64)`, `TokenWeeklySpent(Address, u64)`, `StreamRateWindow(u64)` | Temporary | ~40–90 bytes | `u64`/`Address` composite key plus one `i128` amount |
| Large canonical records | `Proposal(u64)`, `Recurring(u64)` (`RecurringPayment`), `Stream(u64)` (`StreamingPayment`), `Escrow(u64)`, `AmendmentHistory(u64)`, `MultiPhaseProposal(u64)`, `CrossVaultProposal(u64)`, `BatchTransaction` | Persistent | **~0.5–2+ KB**, scaling with signer count | These structs hold `Vec<Address>` (approvals, snapshot_signers), `Map<Address, i128>` (`signer_snapshot`), `Map<Symbol, String>` (`metadata`), and `Vec<String>`/`Vec<Symbol>` (attachments, tags) — each additional signer or tag adds ~40–60 bytes. This is the dominant rent driver in most vaults. |
| Indexes / collections | `RoleIndex`, `WhitelistIndex`, `BlacklistIndex`, `DelegatorsFor(Address)`, `ProposalComments(u64)`, `HTagChildren(u64)`, `CancellationHistory` | Instance/Persistent | `~20 bytes base + (N × ~36–40 bytes)` | A `Vec<Address>` or `Vec<u64>` — size scales linearly with the number of signers/comments/children indexed |
| Small audit/comment entries | `Comment(u64)`, `AuditEntry(u64)`, `CancellationRecord(u64)` | Persistent | ~150–400 bytes | Fixed struct fields plus a variable-length `String` body |

### 4.3 Parametric storage cost formula (VaultDAO-level abstraction)

Combining the CAP-0066 formula with the size table above, for a group of `N` similar entries:

```
Cost(N, S, L, R, D) ≈ N * S_KB * L * R / D
```

- `N` = number of entries (e.g. 100 proposals)
- `S_KB` = average entry size in KB (from §4.2)
- `L` = TTL in ledgers (from §3.1's constants — `PROPOSAL_TTL`, `INSTANCE_TTL`, etc.)
- `R` = live `rent_fee_per_1kb(BucketListSize)` from Stellar Lab (§4.1)
- `D` = `persistentRentRateDenominator` or `tempRentRateDenominator` (live network parameter, §4.1)

Because `extend_ttl(key, threshold, ttl)` re-extends TTL once remaining life drops below `threshold`, an **actively-used** entry pays this rent fee roughly `30 / (ttl_days / 2)` times per 30-day month (using VaultDAO's `threshold = ttl / 2` pattern, e.g. `PROPOSAL_TTL / 2`).

### 4.4 Example calculation: 100 proposals vs 100 spending-limit counters

#### Assumptions (explicit)

- 100 proposals stored in Persistent storage.
- Each proposal entry has “some size”; we approximate relative cost only.
- Daily spending counters stored in Temporary storage.
- Each counter is one ledger-window bucket.

#### Proposal TTL

From `storage.rs`:

- proposal TTL used for `.extend_ttl(&key, PROPOSAL_TTL / 2, PROPOSAL_TTL)`
- `PROPOSAL_TTL = 7 days`.

So for “time stored” model, `T_proposal ≈ 7 days`.

#### Daily spending TTL

From `storage.rs`:

- daily counters TTL extended to `DAY_IN_LEDGERS * 2` (2 days).
- `T_daily_spent ≈ 2 days`.

#### Relative cost ratio (storage-type aware)

Let the per-byte rent coefficient be:

- `c_P` for persistent
- `c_T` for temporary

Then:

- Proposal cost: `100 * S_prop * (7d) * c_P`
- Counter cost: `100 * S_ctr * (2d) * c_T`

So ratio:

- `ratio = (100 * S_prop * 7 * c_P) / (100 * S_ctr * 2 * c_T)`
- `ratio = (S_prop / S_ctr) * (7/2) * (c_P / c_T)`

**Interpretation:** Even with lower TTL, proposals can still dominate due to larger value sizes, while counters are smaller and temporary.

### 4.5 Cost analysis table (parametric)

| Scenario            | N entries | Storage type | TTL model | Relative cost            |
| ------------------- | --------: | ------------ | --------: | ------------------------ |
| 100 proposals       |       100 | Persistent   |        7d | `100 * S_prop * 7 * c_P` |
| 100 daily counters  |       100 | Temporary    |        2d | `100 * S_ctr * 2 * c_T`  |
| 100 weekly counters |       100 | Temporary    |       14d | `100 * S_ctr * 14 * c_T` |

> Replace coefficients using current Stellar rent parameters for exact numeric results.

### 4.6 Worked example: a vault with 100 proposals and 10 signers

> ⚠️ **The rate used below is an illustrative placeholder, not a current network value.** `rent_fee_per_1kb(BucketListSize)` is dynamic (§4.1) — look up the live figure at [Stellar Lab → Network Limits](https://lab.stellar.org/network-limits) and re-run `contracts/vault/scripts/estimate_rent.sh` with it before using this number for real budgeting.

**Assumptions:**

- 100 active `Proposal(u64)` entries, persistent storage, `PROPOSAL_TTL` = 7 days (§3.1).
- 10 signers, meaning each proposal's `approvals`, `snapshot_signers`, and `signer_snapshot` fields carry up to 10 addresses — average encoded size ≈ **1 KB per proposal** (§4.2).
- Proposals are actively read/written, so `extend_ttl(key, PROPOSAL_TTL/2, PROPOSAL_TTL)` refreshes each one roughly every 3.5 days → **~8.6 renewals per 30-day month** (§4.3).
- 10 `Role(Address)` entries at ~0.05 KB each, `INSTANCE_TTL` = 30 days, refreshed roughly every 23 days (`INSTANCE_TTL_THRESHOLD` = 7 days) → **~1.3 renewals per month**.
- Illustrative placeholder rent rate: `R / D = 1 stroop per KB per ledger` for persistent storage.

**Calculation:**

```
proposal_rent_per_renewal = S_KB * L * (R/D)
                           = 1 KB * 120,960 ledgers * 1 stroop/KB/ledger
                           = 120,960 stroops ≈ 0.0121 XLM

proposal_monthly_cost = 0.0121 XLM * 8.6 renewals * 100 proposals
                       ≈ 10.4 XLM/month

role_rent_per_renewal  = 0.05 KB * 518,400 ledgers * 1 stroop/KB/ledger
                       = 25,920 stroops ≈ 0.0026 XLM

role_monthly_cost      = 0.0026 XLM * 1.3 renewals * 10 signers
                       ≈ 0.034 XLM/month

total ≈ 10.4 XLM/month
```

**A vault with 100 proposals and 10 signers costs approximately 10.4 XLM/month in rent**, using the illustrative placeholder rate above — proposal storage dominates the cost because it's the largest and most frequently-renewed persistent entry type. Re-run the estimator script with the current live rate from Stellar Lab to get a real figure for your deployment; the true number could be an order of magnitude lower under normal (non-congested) network state, since Soroban rent is deliberately cheap until the network's total state size approaches its target.

### 4.7 Cost estimator script

`contracts/vault/scripts/estimate_rent.sh` implements the §4.3–4.6 calculation as a reusable CLI tool, so you can plug in the current live rent rate (and your vault's actual proposal/signer counts) instead of relying on the placeholder above:

```bash
# Uses the same defaults as the worked example above (illustrative rate)
./contracts/vault/scripts/estimate_rent.sh

# Override with your vault's real counts and the live rate from Stellar Lab
./contracts/vault/scripts/estimate_rent.sh \
  --proposals 250 \
  --signers 5 \
  --rate-stroops-per-kb-per-ledger 0.4
```

See the script's `--help` output for the full list of overridable assumptions (entry sizes, TTLs, rent rate).

## 5) Storage key design patterns

VaultDAO’s storage keys are intentionally split into:

- **Small, typed discriminants** (`DataKey`, `CounterKey`, `VestingKey`, `CalendarKey`)
- **Feature-scoped keys** (`FeatureKey`) to avoid enum size limits

### 5.1 Namespacing

Rules:

- Use separate enums for different key families (`DataKey` vs `FeatureKey`).
- For dynamic keys (addresses, ids), use typed key constructors that encode the entity.

### 5.2 Collision avoidance

Soroban storage keys must uniquely map to a value. In VaultDAO:

- `DataKey::Proposal(u64)` and `FeatureKey::Proposal(...)` are distinct enums, so even if numeric values overlap, they don’t collide.
- For Symbol-based indexing (e.g., tags), VaultDAO converts symbols to deterministic u64 via SHA-256 and uses that as a discriminant (see `symbol_to_u64_key`).

### 5.3 Key size and rent

General guidance:

- Prefer compact discriminants (u32/u64) over long strings for key components.
- Avoid embedding large vectors directly into keys—store them as values.

VaultDAO follows this by using:

- `BytesN<32>` for hashes
- `Symbol` where needed but mapping Symbols to u64 discriminants for key space efficiency.

## 6) VaultDAO storage inventory (all keys in `storage.rs`)

This inventory lists every variant in `DataKey` and every variant in `FeatureKey` as defined in `contracts/vault/src/storage.rs`.

### 6.1 `DataKey` variants

From `#[contracttype] pub enum DataKey { ... }`:

- `Initialized`
- `Config`
- `Role(Address)`
- `RoleIndex`
- `Proposal(u64)`
- `NextProposalId`
- `PriorityQueue(u32)`
- `DailySpent(u64)`
- `WeeklySpent(u64)`
- `Recurring(u64)`
- `NextRecurringId`
- `VelocityHistory(Address)`
- `ListMode`
- `Whitelist(Address)`
- `Blacklist(Address)`
- `Comment(u64)`
- `ProposalComments(u64)`
- `NextCommentId`
- `AuditEntry(u64)`
- `NextAuditId`
- `LastAuditHash`
- `Attachments(u64)`
- `Reputation(Address)`
- `VotingStrategy`
- `ApprovalLedger(u64, Address)`
- `Stream(u64)`
- `NextStreamId`
- `CancellationRecord(u64)`
- `CancellationHistory`
- `AmendmentHistory(u64)`
- `ExecutionSnapshot(u64)`
- `ExecutionFeeEstimate(u64)`
- `StreamRateWindow(u64)`
- `InsuranceClaim(u64)`
- `NextInsuranceClaimId`
- `InsuranceClaimVote(u64, Address)`
- `TokenDailySpent(Address, u64)`
- `TokenWeeklySpent(Address, u64)`
- `TokenSpendingConfig(Address)`
- `Delegation(Address)`
- `DelegationHistory(Address)`
- `NextDelegationId`
- `DelegatorsFor(Address)`
- `VelocityHistoryByToken(Address, Address)`
- `StatusIndex(u32)`
- `WhitelistIndex`
- `BlacklistIndex`
- `NotificationPrefsIndex`
- `HTag(u64)`
- `HTagChildren(u64)`
- `HTagProposals(u64)`
- `ProposalHTagIds(u64)`
- `NextHTagId`
- `HTagCount`
- `HTagNameScope(u64)`
- `ColdSig(u64, BytesN<32>)`
- `ColdSigIndex(u64)`
- `ColdSigUsed(BytesN<32>)`
- `VarTemplate(u64)`
- `NextVarTemplateId`
- `VarTemplateCount`
- `VarTemplateName(Symbol)`
- `ProposalVarRef(u64)`
- `VarTemplateProposals(u64)`

### 6.2 `CounterKey` variants

- `Template = 1`
- `Escrow = 2`
- `Dispute = 3`
- `Subscription = 4`
- `Recovery = 5`
- `FundingRound = 6`
- `Batch = 7`
- `ScopedDelegation = 8`

### 6.3 `VestingKey` variants

- `Schedule(u64)`
- `NextId`
- `ActiveCount`
- `Reserved(Address)`

### 6.4 `CalendarKey` variants

- `Holidays`

### 6.5 `FeatureKey` variants

From `pub enum FeatureKey { ... }`:

- `Counter(CounterKey)`
- `InsuranceConfig`
- `NotificationPrefs(Address)`
- `DexConfig`
- `SwapProposal(u64)`
- `SwapResult(u64)`
- `GasConfig`
- `ExecutionFeeEstimate(u64)`
- `Metrics`
- `Template(u64)`
- `TemplateName(Symbol)`
- `RetryState(u64)`
- `Escrow(u64)`
- `FunderEscrows(Address)`
- `RecipientEscrows(Address)`
- `InsurancePool(Address)`
- `TokenLock(Address)`
- `TimeWeightedConfig`
- `TotalLocked(Address)`
- `FeeStructure`
- `FeesCollected(Address)`
- `UserVolume(Address, Address)`
- `StakingConfig`
- `StakePool(Address)`
- `StakeRecord(u64)`
- `CrossVaultProposal(u64)`
- `CrossVaultConfig`
- `BridgeRecord(BytesN<32>)`
- `Dispute(u64)`
- `ProposalDisputes(u64)`
- `Batch(u64)`
- `BatchResult(u64)`
- `BatchRollback(u64)`
- `ThresholdReduced(u64)`
- `RecoveryProposal(u64)`
- `FundingRound(u64)`
- `ProposalFundingRounds(u64)`
- `FundingRoundConfig`
- `VaultOracleConfig`
- `VotingStrategy`
- `ApprovalLedger(u64, Address)`
- `Permissions(Address)`
- `DelegatedPermission(Address, Address, u32)`
- `Subscription(u64)`
- `SubscriberIndex(Address)`
- `ReputationConfig`
- `BridgeConfig`
- `CrossChainProposal(u64)`
- `BridgeLock(u64)`
- `MetricsBucket(u64)`
- `MetricsBucketIndex`
- `PendingConfig`
- `WhitelistEntry(Address)`
- `MultiPhaseProposal(u64)`
- `CapabilityToken(BytesN<32>)`
- `Moderator(Address)`
- `CommentRateCount(u64, Address, u64)`
- `CostModel`
- `ColdSignerConfig`
- `DeadLetter(u64)`
- `DeadLetterCount`

## 7) Migration considerations (changing storage type)

If you decide that an existing key should move from Persistent ↔ Instance ↔ Temporary:

### 7.1 Never lose invariants

- If a value is required to enforce security checks (replay prevention, permission expiry), TTL must cover the time-to-use.
- When migrating, ensure the old storage location and new storage location are consistent for at least one full correctness window.

### 7.2 Safe migration pattern

1. **Dual-write** during a transition period:
   - write both old and new storage types
2. **Prefer new reads** after the first migration block
3. **Garbage collect old data** once:
   - you are sure no invocations depend on the old storage
   - TTL on old data has elapsed

### 7.3 TTL changes and backward compatibility

If you reduce TTL:

- ensure that any delayed execution, replay protection, or UI/indexer lag still functions when data is evicted.

If you increase TTL:

- expect higher rent until TTL expires.

## 8) Suggested workflow for contributors

When implementing a feature:

1. Identify the data’s **correctness window** (how long it must exist).
2. Choose storage type using the decision tree.
3. If Persistent/Temporary, define TTL values using the same ledger constants or add new constants.
4. Add getters that default safely when TTL eviction occurs.
5. Update `docs/reference/STORAGE.md` if new key types are introduced.

## Appendix A: Soroban documentation citations

This repo should cite external Soroban docs for exact rent mechanics and TTL semantics.

In this document, rent is modeled parametrically because current Stellar fee coefficients are not included in the repository snapshot.

When you publish this doc, include:

- Stellar network fee parameter version (cite)
- Soroban storage rent formula source (cite)

---

End of document.
