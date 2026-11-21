/**
 * Tests for template.validator.ts (#2081)
 *
 * Covers:
 *   - validateTemplateRecord: structural validation of the record shape
 *   - validateDeployParams: pre-deploy validation with caller inputs
 *   - migrateTemplateRecord: v0 → v1 migration
 *   - Official presets pass structural validation
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  validateTemplateRecord,
  validateDeployParams,
  migrateTemplateRecord,
} from "./template.validator.js";
import {
  PRESET_STARTUP,
  PRESET_DAO,
  PRESET_GRANTS,
  OFFICIAL_PRESETS,
} from "./template.presets.js";
import {
  TEMPLATE_SCHEMA_VERSION,
  FEATURE_RETRY,
  type VaultTemplateRecord,
} from "./template.types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validRecord(overrides: Partial<VaultTemplateRecord> = {}): VaultTemplateRecord {
  return {
    id: "test-v1",
    name: "Test Template",
    description: "A test template",
    preset: "community",
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    contractVersion: 1,
    publishedAt: "2026-01-01",
    official: false,
    tags: [],
    thresholdRatioPct: 67,
    quorumPct: 0,
    timelockDelayLedgers: 0,
    timelockThresholdPct: 0,
    vetoWindowLedgers: 0,
    dailyLimitRatioPct: 300,
    weeklyLimitRatioPct: 700,
    gracePeriodLedgers: 100,
    highImpactThreshold: 70,
    enabledFeatures: 0,
    voteWeight: "Flat",
    adminRotationDelayLedgers: 1_440,
    minBaseSpendingLimit: 1_000_000n,
    maxBaseSpendingLimit: 1_000_000_000_000n,
    minSigners: 1,
    maxSigners: 20,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateTemplateRecord
// ---------------------------------------------------------------------------

describe("validateTemplateRecord", () => {
  test("accepts a fully valid record", () => {
    const { valid, errors } = validateTemplateRecord(validRecord());
    assert.ok(valid, `Expected valid but got errors: ${errors.join(", ")}`);
    assert.equal(errors.length, 0);
  });

  test("rejects unsupported schemaVersion", () => {
    const { valid, errors } = validateTemplateRecord(validRecord({ schemaVersion: 99 as 1 }));
    assert.ok(!valid);
    assert.ok(errors.some((e) => e.includes("schemaVersion")));
  });

  test("rejects thresholdRatioPct = 0", () => {
    const { valid, errors } = validateTemplateRecord(validRecord({ thresholdRatioPct: 0 }));
    assert.ok(!valid);
    assert.ok(errors.some((e) => e.includes("thresholdRatioPct")));
  });

  test("rejects thresholdRatioPct > 100", () => {
    const { valid, errors } = validateTemplateRecord(validRecord({ thresholdRatioPct: 101 }));
    assert.ok(!valid);
    assert.ok(errors.some((e) => e.includes("thresholdRatioPct")));
  });

  test("rejects quorumPct > 100", () => {
    const { valid, errors } = validateTemplateRecord(validRecord({ quorumPct: 101 }));
    assert.ok(!valid);
    assert.ok(errors.some((e) => e.includes("quorumPct")));
  });

  test("rejects dailyLimitRatioPct < 100", () => {
    const { valid, errors } = validateTemplateRecord(validRecord({ dailyLimitRatioPct: 99 }));
    assert.ok(!valid);
    assert.ok(errors.some((e) => e.includes("dailyLimitRatioPct")));
  });

  test("rejects weeklyLimitRatioPct < dailyLimitRatioPct", () => {
    const { valid, errors } = validateTemplateRecord(
      validRecord({ dailyLimitRatioPct: 300, weeklyLimitRatioPct: 200 })
    );
    assert.ok(!valid);
    assert.ok(errors.some((e) => e.includes("weeklyLimitRatioPct")));
  });

  test("rejects adminRotationDelayLedgers < 1440", () => {
    const { valid, errors } = validateTemplateRecord(
      validRecord({ adminRotationDelayLedgers: 1_000 })
    );
    assert.ok(!valid);
    assert.ok(errors.some((e) => e.includes("adminRotationDelayLedgers")));
  });

  test("rejects minBaseSpendingLimit = 0", () => {
    const { valid, errors } = validateTemplateRecord(
      validRecord({ minBaseSpendingLimit: 0n })
    );
    assert.ok(!valid);
    assert.ok(errors.some((e) => e.includes("minBaseSpendingLimit")));
  });

  test("rejects maxBaseSpendingLimit < minBaseSpendingLimit", () => {
    const { valid, errors } = validateTemplateRecord(
      validRecord({ minBaseSpendingLimit: 1_000n, maxBaseSpendingLimit: 500n })
    );
    assert.ok(!valid);
    assert.ok(errors.some((e) => e.includes("maxBaseSpendingLimit")));
  });

  test("rejects minSigners < 1", () => {
    const { valid, errors } = validateTemplateRecord(validRecord({ minSigners: 0 }));
    assert.ok(!valid);
    assert.ok(errors.some((e) => e.includes("minSigners")));
  });

  test("rejects maxSigners < minSigners", () => {
    const { valid, errors } = validateTemplateRecord(
      validRecord({ minSigners: 5, maxSigners: 3 })
    );
    assert.ok(!valid);
    assert.ok(errors.some((e) => e.includes("maxSigners")));
  });

  test("collects multiple errors in one call", () => {
    const { valid, errors } = validateTemplateRecord(
      validRecord({
        thresholdRatioPct: 0,
        dailyLimitRatioPct: 50,
        adminRotationDelayLedgers: 100,
      })
    );
    assert.ok(!valid);
    assert.ok(errors.length >= 3, `Expected ≥ 3 errors, got ${errors.length}`);
  });
});

// ---------------------------------------------------------------------------
// Official presets pass validateTemplateRecord
// ---------------------------------------------------------------------------

describe("official presets pass structural validation", () => {
  for (const [id, preset] of OFFICIAL_PRESETS) {
    test(`preset "${id}" is structurally valid`, () => {
      const { valid, errors } = validateTemplateRecord(preset);
      assert.ok(
        valid,
        `Preset "${id}" failed validation: ${errors.join("; ")}`
      );
    });
  }
});

// ---------------------------------------------------------------------------
// validateDeployParams
// ---------------------------------------------------------------------------

describe("validateDeployParams", () => {
  test("accepts valid inputs for startup preset", () => {
    const result = validateDeployParams({
      template: PRESET_STARTUP,
      baseSpendingLimit: 10_000_000_000n, // 1 000 XLM
      signerCount: 3,
    });
    assert.ok(result.valid, `Errors: ${result.errors.join(", ")}`);
    assert.ok(result.preview);
    assert.equal(result.preview.threshold, 2); // ceil(67% × 3) = 2
    assert.equal(result.preview.dailyLimit, 30_000_000_000n);  // 300% × 1000 XLM
    assert.equal(result.preview.weeklyLimit, 100_000_000_000n); // 1000% × 1000 XLM
  });

  test("accepts valid inputs for dao preset", () => {
    const result = validateDeployParams({
      template: PRESET_DAO,
      baseSpendingLimit: 100_000_000_000n, // 10 000 XLM
      signerCount: 5,
    });
    assert.ok(result.valid);
    assert.ok(result.preview);
    assert.equal(result.preview.threshold, 3); // ceil(60% × 5) = 3
  });

  test("accepts valid inputs for grants preset", () => {
    const result = validateDeployParams({
      template: PRESET_GRANTS,
      baseSpendingLimit: 50_000_000_000n,
      signerCount: 3,
    });
    assert.ok(result.valid);
    assert.ok(result.preview);
    assert.equal(result.preview.threshold, 2); // ceil(34% × 3) = 2 — effectively 1-of-3
  });

  test("rejects baseSpendingLimit below preset minimum", () => {
    const result = validateDeployParams({
      template: PRESET_STARTUP,
      baseSpendingLimit: 1n, // below 1_000_000
      signerCount: 3,
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes("minimum")));
  });

  test("rejects baseSpendingLimit above preset maximum", () => {
    const result = validateDeployParams({
      template: PRESET_STARTUP,
      baseSpendingLimit: PRESET_STARTUP.maxBaseSpendingLimit + 1n,
      signerCount: 3,
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes("maximum")));
  });

  test("rejects signerCount below preset minimum", () => {
    const result = validateDeployParams({
      template: PRESET_DAO,
      baseSpendingLimit: 100_000_000_000n,
      signerCount: 1, // below DAO minimum of 3
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes("minimum")));
  });

  test("rejects signerCount above preset maximum", () => {
    const result = validateDeployParams({
      template: PRESET_STARTUP,
      baseSpendingLimit: 10_000_000_000n,
      signerCount: 999, // above startup maximum of 10
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes("maximum")));
  });

  test("rejects zero baseSpendingLimit", () => {
    const result = validateDeployParams({
      template: PRESET_STARTUP,
      baseSpendingLimit: 0n,
      signerCount: 3,
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes("baseSpendingLimit")));
  });

  test("derived dailyLimit is always >= baseSpendingLimit", () => {
    // Even if ratio is exactly 100%, daily limit should equal spending limit.
    const tpl = validRecord({ dailyLimitRatioPct: 100, weeklyLimitRatioPct: 100 });
    const result = validateDeployParams({
      template: tpl,
      baseSpendingLimit: 5_000_000n,
      signerCount: 1,
    });
    assert.ok(result.valid);
    assert.ok(result.preview!.dailyLimit >= 5_000_000n);
  });

  test("derived weeklyLimit is always >= dailyLimit", () => {
    const result = validateDeployParams({
      template: PRESET_DAO,
      baseSpendingLimit: 10_000_000_000n,
      signerCount: 5,
    });
    assert.ok(result.valid);
    assert.ok(result.preview!.weeklyLimit >= result.preview!.dailyLimit);
  });
});

// ---------------------------------------------------------------------------
// migrateTemplateRecord
// ---------------------------------------------------------------------------

describe("migrateTemplateRecord", () => {
  test("migrates v0 record to v1 with safe defaults", () => {
    const v0 = {
      id: "legacy-v0",
      name: "Legacy",
      description: "Old template",
      preset: "community",
      thresholdRatioPct: 67,
      dailyLimitRatioPct: 300,
      weeklyLimitRatioPct: 700,
      gracePeriodLedgers: 100,
      enabledFeatures: 0,
      // missing: schemaVersion, adminRotationDelayLedgers, highImpactThreshold, voteWeight, etc.
    };

    const migrated = migrateTemplateRecord(v0, 0);
    assert.equal(migrated.schemaVersion, 1);
    assert.equal(migrated.adminRotationDelayLedgers, 1_440);
    assert.equal(migrated.highImpactThreshold, 70);
    assert.equal(migrated.voteWeight, "Flat");
    assert.equal(migrated.minSigners, 1);
    assert.equal(migrated.maxSigners, 20);
    assert.equal(migrated.official, false);

    // Migrated record should pass structural validation.
    const { valid, errors } = validateTemplateRecord(migrated);
    assert.ok(valid, `Migrated record failed: ${errors.join("; ")}`);
  });

  test("v0 → v1 caps dailyLimitRatioPct at minimum 100", () => {
    const v0 = { dailyLimitRatioPct: 50, weeklyLimitRatioPct: 200 };
    const migrated = migrateTemplateRecord(v0, 0);
    assert.ok(migrated.dailyLimitRatioPct >= 100);
  });
});
