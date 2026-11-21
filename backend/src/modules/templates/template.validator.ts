/**
 * Server-side validation for vault template presets (#2081).
 *
 * This module runs BEFORE the caller ever reaches the chain, rejecting
 * obviously invalid configurations with actionable error messages.
 * The on-chain `initialize_from_template` contract function performs its own
 * validation as a second layer — these two gates must remain consistent.
 *
 * Rules enforced here:
 *   1. Schema version is supported.
 *   2. thresholdRatioPct ∈ [1, 100].
 *   3. quorumPct ∈ [0, 100].
 *   4. dailyLimitRatioPct ≥ 100 (daily ≥ single proposal).
 *   5. weeklyLimitRatioPct ≥ dailyLimitRatioPct.
 *   6. highImpactThreshold ∈ [0, 100].
 *   7. adminRotationDelayLedgers ≥ 1 440 (24 h minimum).
 *   8. gracePeriodLedgers ≥ 1.
 *   9. base_spending_limit ∈ [minBaseSpendingLimit, maxBaseSpendingLimit].
 *  10. signerCount ∈ [minSigners, maxSigners].
 *  11. Derived threshold (ceil(thresholdRatioPct × signerCount / 100)) ≥ 1
 *      and ≤ signerCount.
 */

import {
  TEMPLATE_SCHEMA_VERSION,
  type TemplateSchemaVersion,
  type VaultTemplateRecord,
} from "./template.types.js";

// ---------------------------------------------------------------------------
// Supported schema versions
// ---------------------------------------------------------------------------

const SUPPORTED_VERSIONS = new Set<TemplateSchemaVersion>([1]);

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Structural validation (template record shape, independent of caller input)
// ---------------------------------------------------------------------------

/**
 * Validates the structural integrity of a `VaultTemplateRecord`.
 * Called when loading presets at startup and when accepting community templates.
 */
export function validateTemplateRecord(t: VaultTemplateRecord): ValidationResult {
  const errors: string[] = [];

  if (!SUPPORTED_VERSIONS.has(t.schemaVersion as TemplateSchemaVersion)) {
    errors.push(
      `schemaVersion ${t.schemaVersion} is not supported (supported: ${[...SUPPORTED_VERSIONS].join(", ")})`
    );
  }

  if (t.thresholdRatioPct < 1 || t.thresholdRatioPct > 100) {
    errors.push(
      `thresholdRatioPct must be 1–100, got ${t.thresholdRatioPct}`
    );
  }

  if (t.quorumPct < 0 || t.quorumPct > 100) {
    errors.push(`quorumPct must be 0–100, got ${t.quorumPct}`);
  }

  if (t.dailyLimitRatioPct < 100) {
    errors.push(
      `dailyLimitRatioPct must be ≥ 100 (daily limit must be ≥ spending limit), got ${t.dailyLimitRatioPct}`
    );
  }

  if (t.weeklyLimitRatioPct < t.dailyLimitRatioPct) {
    errors.push(
      `weeklyLimitRatioPct (${t.weeklyLimitRatioPct}) must be ≥ dailyLimitRatioPct (${t.dailyLimitRatioPct})`
    );
  }

  if (t.highImpactThreshold < 0 || t.highImpactThreshold > 100) {
    errors.push(
      `highImpactThreshold must be 0–100, got ${t.highImpactThreshold}`
    );
  }

  if (t.adminRotationDelayLedgers < 1_440) {
    errors.push(
      `adminRotationDelayLedgers must be ≥ 1 440 (~24 h), got ${t.adminRotationDelayLedgers}`
    );
  }

  if (t.gracePeriodLedgers < 1) {
    errors.push(`gracePeriodLedgers must be ≥ 1, got ${t.gracePeriodLedgers}`);
  }

  if (t.minBaseSpendingLimit <= 0n) {
    errors.push(`minBaseSpendingLimit must be > 0`);
  }

  if (t.maxBaseSpendingLimit < t.minBaseSpendingLimit) {
    errors.push(
      `maxBaseSpendingLimit (${t.maxBaseSpendingLimit}) must be ≥ minBaseSpendingLimit (${t.minBaseSpendingLimit})`
    );
  }

  if (t.minSigners < 1) {
    errors.push(`minSigners must be ≥ 1, got ${t.minSigners}`);
  }

  if (t.maxSigners < t.minSigners) {
    errors.push(
      `maxSigners (${t.maxSigners}) must be ≥ minSigners (${t.minSigners})`
    );
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Deploy-time validation (caller-supplied baseSpendingLimit + signerCount)
// ---------------------------------------------------------------------------

export interface DerivePreviewInput {
  template: VaultTemplateRecord;
  baseSpendingLimit: bigint;
  signerCount: number;
}

export interface DerivedPreview {
  threshold: number;
  dailyLimit: bigint;
  weeklyLimit: bigint;
  timelockThreshold: bigint;
}

/**
 * Validates caller-supplied parameters against a template's constraints and
 * returns the derived concrete values as a preview.
 *
 * Returns `ValidationResult` with `valid: false` if any constraint is violated.
 * When `valid: true`, the `preview` field contains the values the contract will
 * use — show these to the user before they submit the deploy transaction.
 */
export function validateDeployParams(
  input: DerivePreviewInput
): ValidationResult & { preview?: DerivedPreview } {
  const { template, baseSpendingLimit, signerCount } = input;
  const errors: string[] = [];

  if (baseSpendingLimit <= 0n) {
    errors.push("baseSpendingLimit must be > 0");
  }

  if (baseSpendingLimit < template.minBaseSpendingLimit) {
    errors.push(
      `baseSpendingLimit ${baseSpendingLimit} is below the minimum of ${template.minBaseSpendingLimit} for preset "${template.id}"`
    );
  }

  if (baseSpendingLimit > template.maxBaseSpendingLimit) {
    errors.push(
      `baseSpendingLimit ${baseSpendingLimit} exceeds the maximum of ${template.maxBaseSpendingLimit} for preset "${template.id}"`
    );
  }

  if (signerCount < template.minSigners) {
    errors.push(
      `signerCount ${signerCount} is below the minimum of ${template.minSigners} for preset "${template.id}"`
    );
  }

  if (signerCount > template.maxSigners) {
    errors.push(
      `signerCount ${signerCount} exceeds the maximum of ${template.maxSigners} for preset "${template.id}"`
    );
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Derive concrete values (mirrors the on-chain logic in lib.rs).
  const threshold = Math.max(
    1,
    Math.min(
      signerCount,
      Math.ceil((template.thresholdRatioPct * signerCount) / 100)
    )
  );

  const dailyLimit = bigMax(
    (baseSpendingLimit * BigInt(template.dailyLimitRatioPct)) / 100n,
    baseSpendingLimit
  );

  const weeklyLimit = bigMax(
    (baseSpendingLimit * BigInt(template.weeklyLimitRatioPct)) / 100n,
    dailyLimit
  );

  const timelockThreshold =
    (baseSpendingLimit * BigInt(template.timelockThresholdPct)) / 100n;

  return {
    valid: true,
    errors: [],
    preview: { threshold, dailyLimit, weeklyLimit, timelockThreshold },
  };
}

function bigMax(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

/**
 * Migrate a raw template record from an older schema version to the current one.
 *
 * Version history:
 *   0 → 1: Added schemaVersion, adminRotationDelayLedgers, highImpactThreshold,
 *           voteWeight, minBaseSpendingLimit, maxBaseSpendingLimit, minSigners,
 *           maxSigners. All new fields receive safe defaults.
 *
 * Returns the migrated record ready for `validateTemplateRecord`.
 */
export function migrateTemplateRecord(
  raw: Record<string, unknown>,
  fromVersion: number
): VaultTemplateRecord {
  if (fromVersion === 0) {
    // Apply v0 → v1 defaults for all fields that didn't exist in v0.
    return {
      schemaVersion: 1,
      contractVersion: (raw["contractVersion"] as number | undefined) ?? 1,
      id: String(raw["id"] ?? ""),
      name: String(raw["name"] ?? ""),
      description: String(raw["description"] ?? ""),
      preset: (raw["preset"] as VaultTemplateRecord["preset"]) ?? "community",
      publishedAt: String(raw["publishedAt"] ?? new Date().toISOString()),
      official: false,
      tags: (raw["tags"] as string[] | undefined) ?? [],
      thresholdRatioPct: (raw["thresholdRatioPct"] as number | undefined) ?? 67,
      quorumPct: (raw["quorumPct"] as number | undefined) ?? 0,
      timelockDelayLedgers: (raw["timelockDelayLedgers"] as number | undefined) ?? 0,
      timelockThresholdPct: (raw["timelockThresholdPct"] as number | undefined) ?? 0,
      vetoWindowLedgers: (raw["vetoWindowLedgers"] as number | undefined) ?? 0,
      dailyLimitRatioPct: Math.max(100, (raw["dailyLimitRatioPct"] as number | undefined) ?? 300),
      weeklyLimitRatioPct: Math.max(100, (raw["weeklyLimitRatioPct"] as number | undefined) ?? 700),
      gracePeriodLedgers: (raw["gracePeriodLedgers"] as number | undefined) ?? 100,
      highImpactThreshold: 70,         // new in v1
      enabledFeatures: (raw["enabledFeatures"] as number | undefined) ?? 0,
      voteWeight: "Flat",              // new in v1
      adminRotationDelayLedgers: 1_440, // new in v1
      minBaseSpendingLimit: 1_000_000n, // new in v1
      maxBaseSpendingLimit: 1_000_000_000_000n, // new in v1
      minSigners: 1,                   // new in v1
      maxSigners: 20,                  // new in v1
    };
  }

  // Already at current version — cast directly (caller should re-validate).
  return raw as unknown as VaultTemplateRecord;
}
