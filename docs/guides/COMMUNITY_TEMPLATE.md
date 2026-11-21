# Adding a Community Vault Template

This guide explains how to contribute a new vault policy template to the VaultDAO catalog. It covers the full DX loop: defining the template, validating it locally, writing tests, registering it in the backend, and opening a PR.

---

## Table of Contents

1. [What is a vault template?](#1-what-is-a-vault-template)
2. [Schema versioning](#2-schema-versioning)
3. [Define your template](#3-define-your-template)
4. [Validate it locally](#4-validate-it-locally)
5. [Write tests](#5-write-tests)
6. [Register it in the backend](#6-register-it-in-the-backend)
7. [Version migration path](#7-version-migration-path)
8. [Open a PR](#8-open-a-pr)

---

## 1. What is a vault template?

A vault template is a portable, ratio-based policy configuration for a VaultDAO treasury. Rather than storing absolute amounts (which depend on a specific asset and denomination), templates store everything as percentages of a caller-supplied `base_spending_limit`. When a new vault is created from a template, the on-chain `initialize_from_template` function scales those ratios back to concrete limits.

This means one template can be reused across vaults of wildly different sizes — a startup with a 1 000 XLM treasury and a DAO with a 1 000 000 XLM treasury can both use the same `dao-v1` template, each getting proportionally appropriate limits.

---

## 2. Schema versioning

The `schemaVersion` field tracks the template record shape, independent of the on-chain contract version. The current schema version is **1** (see `TEMPLATE_SCHEMA_VERSION` in `backend/src/modules/templates/template.types.ts`).

When a new field is added to `VaultTemplateRecord`:
1. Bump `TEMPLATE_SCHEMA_VERSION` in `template.types.ts`.
2. Add a migration case to `migrateTemplateRecord` in `template.validator.ts` with a safe default for the new field.
3. Document the migration in [§7](#7-version-migration-path) below.

The `contractVersion` field tracks the on-chain `VaultTemplate::CURRENT_VERSION` (currently `1`). It tells the backend which contract ABI to use when constructing the `initialize_from_template` transaction. If the contract is upgraded with a breaking change to the template struct, bump `contractVersion`.

---

## 3. Define your template

Add an entry to `backend/src/modules/templates/template.presets.ts`:

```typescript
import {
  FEATURE_WHITELIST_MODE,
  FEATURE_RETRY,
  TEMPLATE_SCHEMA_VERSION,
  type VaultTemplateRecord,
} from "./template.types.js";

export const PRESET_MY_COMMUNITY: VaultTemplateRecord = {
  // --- identity ---
  id: "my-community-v1",          // unique slug, never reuse an existing id
  name: "My Community Treasury",
  description: "A one-sentence description shown in the catalog.",
  preset: "community",            // "startup" | "dao" | "grants" | "community"
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  contractVersion: 1,
  publishedAt: "2026-09-01",
  official: false,                // only NovaGrids sets this to true
  tags: ["community", "2of3"],

  // --- governance ratios ---
  thresholdRatioPct: 67,          // 1–100 (ceil-rounded to nearest whole signer)
  quorumPct: 0,                   // 0 = disabled
  timelockDelayLedgers: 8_640,    // ~12 hours at 5 s/ledger
  timelockThresholdPct: 25,       // timelock kicks in at 25% of spending limit
  vetoWindowLedgers: 0,           // 0 = veto disabled
  gracePeriodLedgers: 1_440,
  highImpactThreshold: 75,        // 0–100
  voteWeight: "Flat",             // "Flat" | "TokenWeighted" | "Quadratic"
  adminRotationDelayLedgers: 1_440, // must be ≥ 1 440

  // --- spending limit ratios ---
  dailyLimitRatioPct: 400,        // must be ≥ 100
  weeklyLimitRatioPct: 1_200,     // must be ≥ dailyLimitRatioPct

  // --- features (compose FEATURE_* constants) ---
  enabledFeatures: FEATURE_RETRY,

  // --- validation constraints (server-side only) ---
  minBaseSpendingLimit: 1_000_000n,         // 0.1 XLM minimum
  maxBaseSpendingLimit: 500_000_000_000n,   // 50 000 XLM maximum
  minSigners: 2,
  maxSigners: 15,
};
```

**Rules for ratio fields:**

| Field | Rule |
|---|---|
| `thresholdRatioPct` | 1–100 |
| `quorumPct` | 0–100 |
| `dailyLimitRatioPct` | ≥ 100 (daily must be ≥ single proposal) |
| `weeklyLimitRatioPct` | ≥ `dailyLimitRatioPct` |
| `highImpactThreshold` | 0–100 |
| `adminRotationDelayLedgers` | ≥ 1 440 (~24 h) |
| `minBaseSpendingLimit` | > 0 |
| `maxBaseSpendingLimit` | ≥ `minBaseSpendingLimit` |
| `minSigners` | ≥ 1 |
| `maxSigners` | ≥ `minSigners` |

---

## 4. Validate it locally

Run the structural validator against your record before opening a PR:

```typescript
// scripts/validate-template.ts
import { validateTemplateRecord } from "../backend/src/modules/templates/template.validator.js";
import { PRESET_MY_COMMUNITY } from "../backend/src/modules/templates/template.presets.js";

const { valid, errors } = validateTemplateRecord(PRESET_MY_COMMUNITY);
if (!valid) {
  console.error("Template invalid:", errors);
  process.exit(1);
}
console.log("Template is valid.");
```

```bash
node --import tsx/esm scripts/validate-template.ts
```

Also check the HTTP validate endpoint:

```bash
cd backend && npm run dev &
curl -s -X POST http://localhost:3000/api/v1/templates/my-community-v1/validate \
  -H "Content-Type: application/json" \
  -d '{"baseSpendingLimit":"10000000000","signerCount":3}' | jq .
```

A `valid: true` response with a `preview` block confirms the backend and the derived values look right before you touch the chain.

---

## 5. Write tests

Add at least these two test types:

### Backend unit test (TypeScript)

Add to `backend/src/modules/templates/template.validator.test.ts` or create a new file:

```typescript
test("my-community-v1 passes structural validation", () => {
  const { valid, errors } = validateTemplateRecord(PRESET_MY_COMMUNITY);
  assert.ok(valid, `Errors: ${errors.join("; ")}`);
});

test("my-community-v1: valid deploy params accepted", () => {
  const result = validateDeployParams({
    template: PRESET_MY_COMMUNITY,
    baseSpendingLimit: 10_000_000_000n,
    signerCount: 3,
  });
  assert.ok(result.valid);
  // Add assertions on result.preview.threshold, dailyLimit, etc.
});

test("my-community-v1: below-minimum spending limit rejected", () => {
  const result = validateDeployParams({
    template: PRESET_MY_COMMUNITY,
    baseSpendingLimit: 1n,
    signerCount: 3,
  });
  assert.ok(!result.valid);
});
```

### On-chain test (Rust)

Add to `contracts/vault/src/test_template_presets.rs`:

```rust
/// Instantiate from my-community-v1 and verify derived config.
#[test]
fn test_preset_my_community_derived_config() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultDAO, ());
    let client = VaultDAOClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let mut signers = Vec::new(&env);
    for _ in 0..3 { signers.push_back(Address::generate(&env)); }

    let template = VaultTemplate {
        version: VaultTemplate::CURRENT_VERSION,
        threshold_ratio_percent: 67,
        quorum_percentage: 0,
        timelock_delay_ledgers: 8_640,
        timelock_threshold_pct: 25,
        veto_window_ledgers: 0,
        daily_limit_ratio_percent: 400,
        weekly_limit_ratio_percent: 1_200,
        fee_tiers: Vec::new(&env),
        base_fee_bps: 0,
        enabled_features: 0,
        grace_period_ledgers: 1_440,
        vote_weight: crate::types::VoteWeight::Flat,
        high_impact_threshold: 75,
        admin_rotation_delay: 1_440,
    };

    let base = 10_000i128;
    client.initialize_from_template(&admin, &template, &signers, &base);

    let cfg = client.get_config();
    assert_eq!(cfg.threshold, 3);              // ceil(67% × 3)
    assert_eq!(cfg.daily_limit, 40_000);       // 400% × 10 000
    assert_eq!(cfg.weekly_limit, 120_000);     // 1 200% × 10 000
    assert_eq!(cfg.timelock_threshold, 2_500); // 25% × 10 000
}
```

Run the Rust tests:

```bash
cd contracts/vault
cargo test test_preset_my_community -- --nocapture
```

---

## 6. Register it in the backend

Add your preset to the `OFFICIAL_PRESETS` map only if it has been reviewed and merged by a maintainer. For community templates, register it via `registerTemplate()` at application startup in `backend/src/app.ts` (or whichever startup file is appropriate for your deployment):

```typescript
import { registerTemplate } from "./modules/templates/templates.routes.js";
import { PRESET_MY_COMMUNITY } from "./modules/templates/template.presets.js";

registerTemplate(PRESET_MY_COMMUNITY);
```

The catalog API (`GET /api/v1/templates`) will then include it.

---

## 7. Version migration path

When the `VaultTemplateRecord` interface gains a new field:

1. **Bump `TEMPLATE_SCHEMA_VERSION`** in `template.types.ts`.
2. **Add a migration case** in `migrateTemplateRecord` (`template.validator.ts`):

```typescript
// Example: v1 → v2 adds "emergencyPauseDelayLedgers"
if (fromVersion === 1) {
  return {
    ...(raw as VaultTemplateRecord),
    schemaVersion: 2 as TemplateSchemaVersion,
    // safe default for the new field
    emergencyPauseDelayLedgers: 2_880,
  };
}
```

3. **Update `validateTemplateRecord`** to validate the new field.
4. **Update `TEMPLATE_SCHEMA_VERSION`** in this doc's Table of Contents.
5. **Add a migration test** in `template.validator.test.ts`:

```typescript
test("migrates v1 record to v2 with safe emergencyPauseDelayLedgers default", () => {
  const v1 = { ...someV1Record }; // no emergencyPauseDelayLedgers field
  const migrated = migrateTemplateRecord(v1, 1);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.emergencyPauseDelayLedgers, 2_880);
  const { valid } = validateTemplateRecord(migrated);
  assert.ok(valid);
});
```

Existing templates stored externally (e.g. in a database or config file) are migrated on read by calling `migrateTemplateRecord(raw, getSchemaVersion(raw))` before validation. The migration function is a pure function — it never mutates the original object.

---

## 8. Open a PR

Checklist before opening your PR:

- [ ] `validateTemplateRecord(PRESET_MY_COMMUNITY)` returns `valid: true` locally.
- [ ] `validateDeployParams` tests pass with the minimum and maximum allowed inputs.
- [ ] On-chain Rust test passes: `cargo test test_preset_my_community`.
- [ ] `official: false` is set (only maintainers may set `true`).
- [ ] `id` is unique across all entries in `template.presets.ts`.
- [ ] `publishedAt` is set to today's date.
- [ ] PR description includes the output of the validate endpoint for at least one realistic set of params.
- [ ] PR title follows Conventional Commits: `feat: add my-community-v1 vault template`.
