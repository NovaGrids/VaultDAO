# SDK Migration Guide

This guide describes how to migrate between **breaking** versions of the SDK. For a full list of changes (including non-breaking ones), see [`CHANGELOG.md`](./CHANGELOG.md).

The SDK is versioned independently from the on-chain contract, but each SDK release targets a specific **contract schema version**. When the contract schema version increments, you must upgrade to an SDK version that supports it. The table below maps contract schema versions to the minimum SDK version that supports them.

## Contract schema version → minimum SDK version

| Contract schema version | Minimum SDK version | Notes |
| ----------------------- | ------------------- | ----- |
| `1`                     | `0.1.0`             | Baseline. See [0.1.x](#01x) below. |
| `2` (planned)           | `1.0.0`             | Forward-looking. See [0.x → 1.0.0](#0x--100) below. |

> **Note:** The public surface of the SDK is defined in [`src/index.ts`](./src/index.ts) (re-exports), [`src/types.ts`](./src/types.ts) (public types), and [`src/contract.ts`](./src/contract.ts) (contract bindings). Only symbols exported from `src/index.ts` are considered public API. Anything imported from a deep path (e.g. `@sdk/src/...`) is internal and may change without notice.

---

## 0.1.x

**Targets contract schema version:** `1`

**Breaking changes:** None.

`0.1.0` is the baseline release. There are no prior versions to migrate from, so no API changes, new required parameters, or deprecations apply. If you are starting fresh, install the latest `0.1.x` release and follow the usage examples in [`README.md`](./README.md).

### Deprecated functions

None.

### ScVal converter helpers

The ScVal converter helpers exported from [`src/index.ts`](./src/index.ts) (backed by [`src/types.ts`](./src/types.ts)) are stable in `0.1.x`. They **may change in a future breaking release** and will receive a deprecation notice in `CHANGELOG.md` and in this guide before removal. Avoid depending on their exact internal representation; use the exported helper functions rather than constructing ScVal values by hand.

---

## 0.x → 1.0.0

**Targets contract schema version:** `2`

> **Status:** Forward-looking. This section documents the intended breaking changes for the `1.0.0` release. Details may be refined before release; check `CHANGELOG.md` for the final list.

`1.0.0` is the first major release and aligns the SDK with contract schema version `2`. It contains breaking changes to the public surface exported from [`src/index.ts`](./src/index.ts), the public types in [`src/types.ts`](./src/types.ts), and the contract bindings in [`src/contract.ts`](./src/contract.ts).

### Removed / renamed APIs

APIs removed or renamed in `1.0.0`. Update imports and call sites accordingly.

**Before (`0.x`):**

```ts
import { createClient, invokeContract } from "@sdk";

const client = createClient({ network: "testnet" });
const result = await invokeContract(client, "transfer", { amount: 100n });
```

**After (`1.0.0`):**

```ts
import { Client, invoke } from "@sdk";

const client = new Client({ network: "testnet" });
const result = await invoke(client, "transfer", { amount: 100n });
```

- `createClient` (factory function) → `Client` (class, constructed with `new`).
- `invokeContract` → `invoke`.
- Any type previously exported under a `Contract*` prefix in [`src/types.ts`](./src/types.ts) is renamed to drop the prefix (e.g. `ContractConfig` → `Config`). Update type imports accordingly.

### New required parameters

Parameters that were optional in `0.x` and are now **required** in `1.0.0`. Omitting them is a compile-time error.

**Before (`0.x`):**

```ts
const client = createClient({ network: "testnet" });
```

**After (`1.0.0`):**

```ts
const client = new Client({
  network: "testnet",
  contractId: "C...", // now required
  schemaVersion: 2,   // now required
});
```

- `contractId` is now a required field of the client configuration (previously resolved implicitly).
- `schemaVersion` is now a required field so the SDK can validate against the correct contract schema. Pass `2` for contract schema version `2`.

### Deprecated functions

Functions deprecated in `1.0.0`. They remain available but emit a deprecation warning and will be removed in a future major release.

**Before (`0.x`):**

```ts
import { parseAmount } from "@sdk";

const amount = parseAmount("100");
```

**After (`1.0.0`):**

```ts
import { toScVal } from "@sdk";

const amount = toScVal("100");
```

- `parseAmount` is deprecated in favor of `toScVal`.
- The ScVal converter helpers exported from [`src/index.ts`](./src/index.ts) are being consolidated. The legacy helpers remain exported for one major cycle with a deprecation notice; migrate to the consolidated `toScVal` / `fromScVal` pair.

### ScVal converter helpers

The ScVal converter helpers (backed by [`src/types.ts`](./src/types.ts)) are consolidated in `1.0.0`. The legacy helpers are deprecated (see above) and will be removed in a subsequent major release. This change is announced here and in `CHANGELOG.md` with a deprecation notice before removal.

---

## Getting help

- Review the full change history in [`CHANGELOG.md`](./CHANGELOG.md).
- See usage examples in [`README.md`](./README.md).
- If you encounter a migration issue not covered here, please open an issue.