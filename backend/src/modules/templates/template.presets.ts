/**
 * Official VaultDAO preset templates (#2081).
 *
 * Each preset is a fully-specified `VaultTemplateRecord`. Adding a community
 * template means adding a new entry here (see docs/guides/COMMUNITY_TEMPLATE.md
 * for the full DX guide).
 *
 * Ratio semantics:
 *   All *Pct / *RatioPct fields are percentages of the caller-supplied
 *   `base_spending_limit`. The on-chain `initialize_from_template` function
 *   scales them back to absolute values before writing to contract storage.
 *
 * Ledger durations (approximate at 5 s/ledger):
 *   1 440  ≈  2 hours
 *   8 640  ≈  12 hours
 *  17 280  ≈  24 hours
 *  86 400  ≈  5 days
 * 120 960  ≈  7 days
 */

import {
  FEATURE_RETRY,
  FEATURE_WHITELIST_MODE,
  TEMPLATE_SCHEMA_VERSION,
  type VaultTemplateRecord,
} from "./template.types.js";

// ---------------------------------------------------------------------------
// Preset: Startup (2-of-3 multisig, low friction, no whitelist)
// ---------------------------------------------------------------------------

export const PRESET_STARTUP: VaultTemplateRecord = {
  id: "startup-v1",
  name: "Startup Treasury",
  description:
    "Lightweight 2-of-3 multisig for early-stage teams. Low timelock threshold, " +
    "generous daily limits, no recipient whitelist. Optimised for speed over ceremony.",
  preset: "startup",
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  contractVersion: 1,
  publishedAt: "2026-08-01",
  official: true,
  tags: ["startup", "2of3", "low-friction"],

  // --- governance ---
  thresholdRatioPct: 67,       // ceil(2/3 × 100) = 67% → 2 of 3
  quorumPct: 0,                // quorum disabled
  timelockDelayLedgers: 8_640, // ~12 hours
  timelockThresholdPct: 50,    // timelock kicks in at 50% of spending limit
  vetoWindowLedgers: 0,        // veto disabled
  gracePeriodLedgers: 1_440,   // ~2 hours
  highImpactThreshold: 80,
  voteWeight: "Flat",
  adminRotationDelayLedgers: 1_440,

  // --- limits ---
  dailyLimitRatioPct: 300,     // 3× spending limit per day
  weeklyLimitRatioPct: 1_000,  // 10× spending limit per week

  // --- features ---
  enabledFeatures: FEATURE_RETRY, // retry on transient failures; no whitelist

  // --- validation constraints ---
  minBaseSpendingLimit: 1_000_000n,         // 0.1 XLM
  maxBaseSpendingLimit: 100_000_000_000n,   // 10 000 XLM
  minSigners: 2,
  maxSigners: 10,
};

// ---------------------------------------------------------------------------
// Preset: DAO (3-of-5 multisig, strong quorum, timelock on all proposals)
// ---------------------------------------------------------------------------

export const PRESET_DAO: VaultTemplateRecord = {
  id: "dao-v1",
  name: "DAO Treasury",
  description:
    "Robust 3-of-5 governance for established DAOs. Mandatory 60% quorum, " +
    "24-hour timelock on all proposals, recipient whitelist, veto window.",
  preset: "dao",
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  contractVersion: 1,
  publishedAt: "2026-08-01",
  official: true,
  tags: ["dao", "3of5", "quorum", "timelock", "whitelist"],

  // --- governance ---
  thresholdRatioPct: 60,        // 3 of 5
  quorumPct: 60,
  timelockDelayLedgers: 17_280, // ~24 hours
  timelockThresholdPct: 0,      // timelock on EVERY proposal (threshold = 0% of limit → always triggered)
  vetoWindowLedgers: 17_280,    // 24-hour veto window
  gracePeriodLedgers: 2_880,    // ~4 hours
  highImpactThreshold: 70,
  voteWeight: "Flat",
  adminRotationDelayLedgers: 17_280, // 24 h admin rotation delay

  // --- limits ---
  dailyLimitRatioPct: 200,      // 2× spending limit per day
  weeklyLimitRatioPct: 700,     // 7× spending limit per week

  // --- features ---
  enabledFeatures: FEATURE_WHITELIST_MODE | FEATURE_RETRY,

  // --- validation constraints ---
  minBaseSpendingLimit: 10_000_000n,          // 1 XLM
  maxBaseSpendingLimit: 1_000_000_000_000n,   // 100 000 XLM
  minSigners: 3,
  maxSigners: 20,
};

// ---------------------------------------------------------------------------
// Preset: Grants (1-of-N disbursement, high daily cap, timelock on large amounts)
// ---------------------------------------------------------------------------

export const PRESET_GRANTS: VaultTemplateRecord = {
  id: "grants-v1",
  name: "Grants Program",
  description:
    "High-throughput treasury for grant disbursements. Single-signer execution " +
    "with a high daily cap and mandatory timelock for amounts above 10% of the limit. " +
    "Recipient whitelist enforced.",
  preset: "grants",
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  contractVersion: 1,
  publishedAt: "2026-08-01",
  official: true,
  tags: ["grants", "1ofN", "whitelist", "high-volume"],

  // --- governance ---
  thresholdRatioPct: 34,        // ceil(1/N × 100) — effectively 1 signer
  quorumPct: 0,
  timelockDelayLedgers: 8_640,  // ~12 hours
  timelockThresholdPct: 10,     // timelock above 10% of spending limit
  vetoWindowLedgers: 8_640,     // 12-hour veto window
  gracePeriodLedgers: 1_440,
  highImpactThreshold: 60,
  voteWeight: "Flat",
  adminRotationDelayLedgers: 1_440,

  // --- limits ---
  dailyLimitRatioPct: 500,      // 5× for high-volume disbursements
  weeklyLimitRatioPct: 2_000,   // 20×

  // --- features ---
  enabledFeatures: FEATURE_WHITELIST_MODE | FEATURE_RETRY,

  // --- validation constraints ---
  minBaseSpendingLimit: 5_000_000n,           // 0.5 XLM
  maxBaseSpendingLimit: 10_000_000_000_000n,  // 1 000 000 XLM
  minSigners: 1,
  maxSigners: 50,
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** All official presets, keyed by id. */
export const OFFICIAL_PRESETS: ReadonlyMap<string, VaultTemplateRecord> =
  new Map([
    [PRESET_STARTUP.id, PRESET_STARTUP],
    [PRESET_DAO.id,     PRESET_DAO],
    [PRESET_GRANTS.id,  PRESET_GRANTS],
  ]);

/** Returns a preset by id, or undefined if not found. */
export function getPreset(id: string): VaultTemplateRecord | undefined {
  return OFFICIAL_PRESETS.get(id);
}

/** Returns all presets as an array. */
export function listPresets(): VaultTemplateRecord[] {
  return Array.from(OFFICIAL_PRESETS.values());
}
