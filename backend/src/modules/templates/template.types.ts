/**
 * Policy-as-code vault template types (#2081).
 *
 * These types are the single source of truth for the template catalog.
 * They mirror the on-chain `VaultTemplate` struct (types.rs) but add:
 *   - schema version tracking
 *   - human-readable metadata for the catalog API
 *   - server-side validation constraints per preset
 */

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Current catalog schema version. Bump when field shape changes. */
export const TEMPLATE_SCHEMA_VERSION = 1 as const;

/** Supported schema versions for migration purposes. */
export type TemplateSchemaVersion = 1;

// ---------------------------------------------------------------------------
// Feature flags (mirrors VaultTemplate::FEATURE_* bitmask in types.rs)
// ---------------------------------------------------------------------------

export const FEATURE_WHITELIST_MODE  = 1 << 0;
export const FEATURE_RETRY           = 1 << 1;
export const FEATURE_STAKING         = 1 << 2;
export const FEATURE_FEE_COLLECTION  = 1 << 3;

// ---------------------------------------------------------------------------
// Core template shape
// ---------------------------------------------------------------------------

/**
 * Server-side representation of a vault policy template.
 *
 * All ratio fields (threshold_ratio_percent, daily_limit_ratio_percent, etc.)
 * are expressed as percentages of the caller-supplied `base_spending_limit`,
 * matching the on-chain `initialize_from_template` contract function.
 */
export interface VaultTemplateRecord {
  /** Template unique identifier (slug, e.g. "startup-v1"). */
  id: string;

  /** Human-readable display name. */
  name: string;

  /** Short description shown in catalog listings. */
  description: string;

  /**
   * Preset category — determines which validation constraints apply and
   * how the template is grouped in the catalog.
   */
  preset: TemplatePreset;

  /** Schema version of this record (for migration). */
  schemaVersion: TemplateSchemaVersion;

  /** On-chain template version produced by the contract build. */
  contractVersion: number;

  /** ISO 8601 date this record was published. */
  publishedAt: string;

  /** Whether this is an official NovaGrids preset or a community submission. */
  official: boolean;

  /** Governance / compliance tags (e.g. ["dao", "grants", "multisig-2of3"]). */
  tags: string[];

  // ---- on-chain fields (all ratio-based, not absolute) ----

  /**
   * Required approvals as a percentage of signer count (1–100).
   * Rounded up to the nearest whole signer.
   */
  thresholdRatioPct: number;

  /** Quorum requirement as a percentage of total signers (0 = disabled). */
  quorumPct: number;

  /** Delay in ledgers before a timelocked proposal becomes executable. */
  timelockDelayLedgers: number;

  /**
   * Proposal amount above which a timelock applies, as a percentage of
   * `base_spending_limit` (0 = no timelock).
   */
  timelockThresholdPct: number;

  /** Veto window in ledgers after proposal creation (0 = veto disabled). */
  vetoWindowLedgers: number;

  /**
   * Daily aggregate spending limit as a percentage of `base_spending_limit`.
   * Must be ≥ 100 (daily ≥ single proposal).
   */
  dailyLimitRatioPct: number;

  /**
   * Weekly aggregate spending limit as a percentage of `base_spending_limit`.
   * Must be ≥ dailyLimitRatioPct.
   */
  weeklyLimitRatioPct: number;

  /** Grace period in ledgers after voting deadline before auto-expiry. */
  gracePeriodLedgers: number;

  /** High impact score threshold (0–100). */
  highImpactThreshold: number;

  /**
   * Feature flags bitmask. Use FEATURE_* constants to compose.
   * Example: FEATURE_WHITELIST_MODE | FEATURE_RETRY
   */
  enabledFeatures: number;

  /** Vote weight model: "Flat" | "TokenWeighted" | "Quadratic". */
  voteWeight: "Flat" | "TokenWeighted" | "Quadratic";

  /** Minimum delay in ledgers before admin role can be rotated (≥ 1440). */
  adminRotationDelayLedgers: number;

  // ---- validation constraints (server-side only, not sent to chain) ----

  /** Minimum `base_spending_limit` a caller may supply (stroops). */
  minBaseSpendingLimit: bigint;

  /** Maximum `base_spending_limit` a caller may supply (stroops). */
  maxBaseSpendingLimit: bigint;

  /** Minimum number of signers this template requires. */
  minSigners: number;

  /** Maximum number of signers this template allows. */
  maxSigners: number;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export type TemplatePreset = "startup" | "dao" | "grants" | "community";

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

/** Catalog listing item — omits server-side validation constraints. */
export type TemplateSummary = Omit<
  VaultTemplateRecord,
  "minBaseSpendingLimit" | "maxBaseSpendingLimit" | "minSigners" | "maxSigners"
>;

/** Full template detail response (includes constraints for client-side UX). */
export interface TemplateDetailResponse extends TemplateSummary {
  constraints: {
    minBaseSpendingLimit: string; // bigint serialised as string
    maxBaseSpendingLimit: string;
    minSigners: number;
    maxSigners: number;
  };
}

/** Request body for POST /api/v1/templates/:id/validate */
export interface ValidateTemplateRequest {
  baseSpendingLimit: string; // bigint as string
  signerCount: number;
}

/** Response from POST /api/v1/templates/:id/validate */
export interface ValidateTemplateResponse {
  valid: boolean;
  errors: string[];
  /** Derived concrete values for preview (shown to user before they deploy). */
  preview?: {
    threshold: number;
    dailyLimit: string;
    weeklyLimit: string;
    timelockThreshold: string;
  };
}

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

/**
 * Returns the schema version of a raw record object without fully parsing it.
 * Used by the migration path to decide which upgrade function to apply.
 */
export function getSchemaVersion(raw: unknown): number {
  if (
    raw !== null &&
    typeof raw === "object" &&
    "schemaVersion" in raw &&
    typeof (raw as Record<string, unknown>).schemaVersion === "number"
  ) {
    return (raw as Record<string, unknown>).schemaVersion as number;
  }
  // Records that pre-date schema versioning are treated as version 0.
  return 0;
}
