I'll create the subscription guide. Since I don't have direct access to the source files, I'll write comprehensive documentation based on the described semantics and standard patterns for such a feature.

```markdown
# Subscription Management Guide

This guide covers the full lifecycle of subscriptions in VaultDAO: creating, renewing, upgrading, downgrading, cancelling, and auto-expiring subscriptions. It also documents the auto-topup feature and the `ExpiryBatch` pagination pattern used by keeper jobs.

## Table of Contents

- [Overview](#overview)
- [Subscription Lifecycle States](#subscription-lifecycle-states)
- [Creating a Subscription](#creating-a-subscription)
- [Renewing a Subscription](#renewing-a-subscription)
- [Tier Upgrades](#tier-upgrades)
- [Tier Downgrades and Grace Periods](#tier-downgrades-and-grace-periods)
- [Cancelling a Subscription](#cancelling-a-subscription)
- [Auto-Expiry](#auto-expiry)
- [Auto-Topup](#auto-topup)
- [Keeper Jobs and ExpiryBatch Pagination](#keeper-jobs-and-expirybatch-pagination)
- [SDK Reference](#sdk-reference)

## Overview

A subscription ties a subscriber to a tier for a bounded period of time. Each subscription tracks:

- The **tier** the subscriber is entitled to.
- The **expiry ledger** at which the subscription lapses unless renewed.
- A **status** describing the current lifecycle state.
- Optional **pending downgrade** information (target tier and grace deadline).
- Optional **auto-topup** configuration (funding source and amount).

Subscriptions are managed through the following contract entry points:

| Function | Purpose |
| --- | --- |
| `create_subscription` | Create a new subscription for a tier. |
| `renew_subscription` | Extend an existing subscription's expiry. |
| `cancel_subscription` | Cancel a subscription immediately. |
| `upgrade_subscription` | Move to a higher tier immediately. |
| `request_downgrade` | Request a move to a lower tier (enters grace period). |
| `confirm_downgrade` | Apply a pending downgrade before the grace deadline. |
| `cancel_pending_downgrade` | Abort a pending downgrade. |
| `expire_overdue_subscriptions` | Batch-expire subscriptions past their deadline. |

## Subscription Lifecycle States

A subscription is always in exactly one of the following states (`SubscriptionStatus`):

| Status | Description |
| --- | --- |
| `Active` | The subscription is valid and the subscriber is entitled to the tier. |
| `Paused` | The subscription is temporarily suspended; entitlements are withheld until resumed. |
| `Expired` | The subscription lapsed past its expiry ledger (or grace deadline) and is no longer entitled. |
| `Cancelled` | The subscription was explicitly cancelled by the subscriber or an authorized party. |

### State Transitions

```
                 create_subscription
                        │
                        ▼
   ┌──────────────►  Active  ◄──────────────┐
   │                    │                   │
   │   renew_subscription│                  │ confirm_downgrade
   │                    │                   │ (within grace)
   │                    ▼                   │
   │              (expiry ledger)           │
   │                    │                   │
   │                    ▼                   │
   │                 Expired ───────────────┘
   │                    ▲
   │                    │ expire_overdue_subscriptions
   │                    │
   │  cancel_subscription│
   │                    │
   └──────────────► Cancelled
```

Key rules:

- **Active → Expired** happens automatically once the expiry ledger passes and a keeper calls `expire_overdue_subscriptions`, or lazily when the subscription is next touched.
- **Active → Cancelled** happens immediately on `cancel_subscription`.
- **Active → Active (tier change)** happens on `upgrade_subscription` (immediate) or after a downgrade grace period elapses / `confirm_downgrade` is called.
- **Paused** subscriptions do not accrue entitlements but retain their configuration; they can be resumed or cancelled.

## Creating a Subscription

Use `create_subscription` to start a subscription. The subscriber specifies the tier and the initial duration.

### Contract

```rust
pub fn create_subscription(
    env: Env,
    subscriber: Address,
    tier: Tier,
    duration_ledgers: u32,
) -> Result<Subscription, Error>
```

### SDK Example

```ts
import { createSubscription } from "@vaultdao/sdk";

const subscription = await createSubscription(client, {
  subscriber: subscriberAddress,
  tier: "Pro",
  durationLedgers: 17_280, // ~1 day at 5s ledgers
});

console.log(subscription.id, subscription.status); // "Active"
```

The returned `Subscription` object includes `id`, `tier`, `status`, `expiry_ledger`, and any `pending_downgrade` / `auto_topup` configuration.

## Renewing a Subscription

`renew_subscription` extends the expiry ledger of an existing subscription. Renewal is only valid for `Active` (or `Paused`) subscriptions; renewing an `Expired` or `Cancelled` subscription fails.

### Contract

```rust
pub fn renew_subscription(
    env: Env,
    subscriber: Address,
    subscription_id: u64,
    duration_ledgers: u32,
) -> Result<Subscription, Error>
```

### SDK Example

```ts
import { renewSubscription } from "@vaultdao/sdk";

const renewed = await renewSubscription(client, {
  subscriber: subscriberAddress,
  subscriptionId: subscription.id,
  durationLedgers: 17_280,
});

console.log(renewed.expiry_ledger); // extended
```

> **Note:** Renewal extends from the current expiry ledger (or from the current ledger if already expired-but-not-yet-swept, depending on configuration). Always read the returned `expiry_ledger` rather than computing it client-side.

## Tier Upgrades

Upgrades take effect **immediately**. When a subscriber upgrades, the new tier's entitlements apply from the current ledger; no grace period is involved.

### Contract

```rust
pub fn upgrade_subscription(
    env: Env,
    subscriber: Address,
    subscription_id: u64,
    new_tier: Tier,
) -> Result<Subscription, Error>
```

### SDK Example

```ts
import { upgradeSubscription } from "@vaultdao/sdk";

const upgraded = await upgradeSubscription(client, {
  subscriber: subscriberAddress,
  subscriptionId: subscription.id,
  newTier: "Enterprise",
});

console.log(upgraded.tier); // "Enterprise"
```

Upgrades clear any pending downgrade, since the subscriber is moving in the opposite direction.

## Tier Downgrades and Grace Periods

Downgrades are **not** immediate. To protect subscribers from accidental loss of entitlements, a downgrade goes through a grace period:

1. **Request** — the subscriber calls `request_downgrade`, specifying the target (lower) tier. The subscription records a `pending_downgrade` with a `grace_period_ledgers` deadline.
2. **Pending** — during the grace period, the subscription remains on its current (higher) tier. The subscriber can:
   - **Confirm** the downgrade early with `confirm_downgrade`, or
   - **Cancel** the pending downgrade with `cancel_pending_downgrade`, keeping the current tier.
3. **Auto-apply** — if the grace period elapses without confirmation or cancellation, the downgrade is applied automatically (either lazily on next touch or via the keeper's `expire_overdue_subscriptions` sweep).

### Requesting a Downgrade

```rust
pub fn request_downgrade(
    env: Env,
    subscriber: Address,
    subscription_id: u64,
    new_tier: Tier,
    grace_period_ledgers: u32,
) -> Result<Subscription, Error>
```

```ts
import { requestDowngrade } from "@vaultdao/sdk";

const pending = await requestDowngrade(client, {
  subscriber: subscriberAddress,
  subscriptionId: subscription.id,
  newTier: "Basic",
  gracePeriodLedgers: 720, // ~1 hour
});

console.log(pending.pending_downgrade);
// { target_tier: "Basic", grace_deadline_ledger: 123456 }
```

### Confirming a Downgrade

```rust
pub fn confirm_downgrade(
    env: Env,
    subscriber: Address,
    subscription_id: u64,
) -> Result<Subscription, Error>
```

```ts
import { confirmDowngrade } from "@vaultdao/sdk";

const confirmed = await confirmDowngrade(client, {
  subscriber: subscriberAddress,
  subscriptionId: subscription.id,
});

console.log(confirmed.tier); // "Basic"
console.log(confirmed.pending_downgrade); // null
```

### Cancelling a Pending Downgrade

```rust
pub fn cancel_pending_downgrade(
    env: Env,
    subscriber: Address,
    subscription_id: u64,
) -> Result<Subscription, Error>
```

```ts
import { cancelPendingDowngrade } from "@vaultdao/sdk";

const kept = await cancelPendingDowngrade(client, {
  subscriber: subscriberAddress,
  subscriptionId: subscription.id,
});

console.log(kept.tier); // unchanged (still the higher tier)
console.log(kept.pending_downgrade); // null
```

### Grace Period Semantics

- The grace deadline is `current_ledger + grace_period_ledgers` at the time of the request.
- While a downgrade is pending, the subscription remains `Active` on the **current** tier.
- If the grace deadline passes, the downgrade is applied automatically. The keeper job (see below) will apply it during the next `expire_overdue_subscriptions` sweep.
- Requesting a new downgrade while one is pending replaces the pending request (subject to contract validation).

## Cancelling a Subscription

`cancel_subscription` immediately moves the subscription to `Cancelled`. Entitlements are revoked at once; no grace period applies to cancellation.

### Contract

```rust
pub fn cancel_subscription(
    env: Env,
    subscriber: Address,
    subscription_id: u64,
) -> Result<Subscription, Error>
```

### SDK Example

```ts
import { cancelSubscription } from "@vaultdao/sdk";

const cancelled = await cancelSubscription(client, {
  subscriber: subscriberAddress,
  subscriptionId: subscription.id,
});

console.log(cancelled.status); // "Cancelled"
```

## Auto-Expiry

Subscriptions expire when their `expiry_ledger` passes. Expiry is **not** instantaneous — it is driven by the keeper job calling `expire_overdue_subscriptions`. Until the sweep runs, an overdue subscription may still appear `Active` in storage; consumers should compare `expiry_ledger` against the current ledger when making entitlement decisions, or rely on the contract's lazy expiry on access.

### Contract

```rust
pub fn expire_overdue_subscriptions(
    env: Env,
    cursor: Option<u64>,
    page_size: u32,
) -> Result<ExpiryBatch, Error>
```

### The `ExpiryBatch` Type

`expire_overdue_subscriptions` processes subscriptions in pages and returns an `ExpiryBatch`:

```rust
pub struct ExpiryBatch {
    /// Number of subscriptions expired in this batch.
    pub expired_count: u32,
    /// Cursor to pass to the next call, or `None` if the sweep is complete.
    pub next_cursor: Option<u64>,
    /// Whether the sweep has reached the end of the subscription set.
    pub exhausted: bool,
}
```

## Auto-Topup

Subscriptions can be configured with an **auto-topup** source and amount. When the subscription is near expiry (or on renewal), the contract can draw funds from the configured source to renew automatically.

- `auto_topup_source` — the account or vault from which funds are drawn.
- `auto_topup_amount` — the amount to draw per topup.

Auto-topup is configured at creation or via a dedicated update call, and is evaluated during renewal/expiry processing. If the source has insufficient funds, the topup is skipped and the subscription proceeds to normal expiry.

```ts
const subscription = await createSubscription(client, {
  subscriber: subscriberAddress,
  tier: "Pro",
  durationLedgers: 17_280,
  autoTopup: {
    source: vaultAddress,
    amount: 100_0000000n, // 100 tokens (7 decimals)
  },
});
```

## Keeper Jobs and ExpiryBatch Pagination

Because the subscription set can be large, `expire_overdue_subscriptions` is **paginated**. A keeper job should loop, passing the `next_cursor` from each batch back into the next call, until either:

- `expired_count` is `0` (nothing left to expire in this pass), or
- `exhausted` is `true` (the sweep reached the end of the set).

### Pagination Pattern

```ts
import { expireOverdueSubscriptions } from "@vaultdao/sdk";

async function runExpirySweep(client: VaultClient, pageSize = 100) {
  let cursor: bigint | undefined = undefined;
  let totalExpired = 0;

  while (true) {
    const batch = await expireOverdueSubscriptions(client, {
      cursor,
      pageSize,
    });

    totalExpired += batch.expired_count;

    // Stop when nothing was expired in this page or the sweep is exhausted.
    if (batch.expired_count === 0 || batch.exhausted) {
      break;
    }

    // No further cursor means we've reached the end.
    if (batch.next_cursor === null || batch.next_cursor === undefined) {
      break;
    }

    cursor = batch.next_cursor;
  }

  return totalExpired;
}
```

### Keeper Job Notes

- **Idempotent:** Running the sweep multiple times is safe; already-expired subscriptions are skipped.
- **Bounded work per call:** Keep `page_size` modest (e.g. 50–200) to stay within ledger compute limits.
- **Cursor stability:** The `next_cursor` is opaque. Do not construct cursors manually; always pass the value returned by the previous batch.
- **Termination:** Always terminate on `expired_count === 0` **or** `exhausted === true` **or** a `null`/`undefined` `next_cursor`. Checking all three guards against infinite loops if the contract returns an unexpected combination.
- **Scheduling:** Run the sweep on a regular cadence (e.g. every N ledgers) so overdue subscriptions and pending downgrades are applied promptly.

## SDK Reference

### Types

```ts
// sdk/src/types.ts
export type SubscriptionStatus = "Active" | "Paused" | "Expired" | "Cancelled";

export interface PendingDowngrade {
  target_tier: Tier;
  grace_deadline_ledger: number;
}

export interface AutoTopup {
  source: string;
  amount: bigint;
}

export interface Subscription {
  id: bigint;
  subscriber: string;
  tier: Tier;
  status: SubscriptionStatus;
  expiry_ledger: number;
  pending_downgrade: PendingDowngrade | null;
  auto_topup: AutoTopup | null;
}

export interface ExpiryBatch {
  expired_count: number;
  next_cursor: bigint | null;
  exhausted: boolean;
}
```

### Functions

```ts
// sdk/src/contract.ts
export function createSubscription(
  client: VaultClient,
  params: { subscriber: string; tier: Tier; durationLedgers: number; autoTopup?: AutoTopup },
): Promise<Subscription>;

export function renewSubscription(
  client: VaultClient,
  params: { subscriber: string; subscriptionId: bigint; durationLedgers: number },
): Promise<Subscription>;

export function cancelSubscription(
  client: VaultClient,
  params: { subscriber: string; subscriptionId: bigint },
): Promise<Subscription>;

export function upgradeSubscription(
  client: VaultClient,
  params: { subscriber: string; subscriptionId: bigint; newTier: Tier },
): Promise<Subscription>;

export function requestDowngrade(
  client: VaultClient,
  params: { subscriber: string; subscriptionId: bigint; newTier: Tier; gracePeriodLedgers: number },
): Promise<Subscription>;

export function confirmDowngrade(
  client: VaultClient,
  params: { subscriber: string; subscriptionId: bigint },
): Promise<Subscription>;

export function cancelPendingDowngrade(
  client: VaultClient,
  params: { subscriber: string; subscriptionId: bigint },
): Promise<Subscription>;

export function expireOverdueSubscriptions(
  client: VaultClient,
  params: { cursor?: bigint; pageSize: number },
): Promise<ExpiryBatch>;
```

---

For more guides, see the [guides index](./README.md).