/**
 * Semantic Diff Rules Configuration
 *
 * Defines rules for classifying snapshot field changes into semantic changes
 * with severity levels. Rules are evaluated in declaration order; the first
 * matching rule wins for each changed field.
 *
 * Adding new rules here requires no code change in the service.
 */

import type { SemanticChangeSeverity } from "./types.js";

export interface SemanticRule {
  /**
   * The snapshot field this rule applies to. Use "*" to match any field
   * not covered by a more specific rule (catch-all/default).
   */
  readonly field: string;

  /**
   * Optional predicate on the old value. If omitted, any old value matches.
   */
  readonly when?: (oldValue: unknown, newValue: unknown) => boolean;

  /** Severity to assign when this rule matches. */
  readonly severity: SemanticChangeSeverity;

  /**
   * Human-readable description factory. Receives old and new values so it
   * can produce context-aware messages.
   */
  readonly describe: (oldValue: unknown, newValue: unknown) => string;
}

/**
 * Counts the number of keys in a record-like value.
 * Returns 0 if the value is not an object.
 */
function keyCount(value: unknown): number {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as object).length;
  }
  return 0;
}

/**
 * Attempts to extract a numeric threshold from a snapshot field value.
 * Handles plain numbers, strings like "2/3" (returns numerator), and
 * objects with a `threshold` property.
 */
function extractThreshold(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    // e.g. "2/3" → 2
    const match = /^(\d+)\/(\d+)$/.exec(value);
    if (match) return Number(match[1]);
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("threshold" in obj) return extractThreshold(obj["threshold"]);
  }
  return null;
}

/**
 * Default semantic rules.
 *
 * Rules are evaluated in order; the first matching rule for a given field wins.
 * The `*` catch-all must always be last.
 */
export const DEFAULT_SEMANTIC_RULES: SemanticRule[] = [
  // ── Threshold changes ─────────────────────────────────────────────────────

  {
    field: "threshold",
    when: (oldVal, newVal) => {
      const oldN = extractThreshold(oldVal);
      const newN = extractThreshold(newVal);
      return oldN !== null && newN !== null && newN < oldN;
    },
    severity: "critical",
    describe: (oldVal, newVal) =>
      `Approval threshold reduced from ${oldVal} to ${newVal}. This lowers the security bar for transaction approvals.`,
  },
  {
    field: "threshold",
    when: (oldVal, newVal) => {
      const oldN = extractThreshold(oldVal);
      const newN = extractThreshold(newVal);
      return oldN !== null && newN !== null && newN > oldN;
    },
    severity: "info",
    describe: (oldVal, newVal) =>
      `Approval threshold increased from ${oldVal} to ${newVal}.`,
  },
  {
    field: "threshold",
    severity: "warning",
    describe: (oldVal, newVal) =>
      `Approval threshold changed from ${oldVal} to ${newVal}.`,
  },

  // ── Signer set changes ────────────────────────────────────────────────────

  {
    field: "signers",
    when: (oldVal, newVal) => keyCount(newVal) > keyCount(oldVal),
    severity: "warning",
    describe: (oldVal, newVal) => {
      const added = keyCount(newVal) - keyCount(oldVal);
      return `${added} new signer(s) added to the vault. Signer count changed from ${keyCount(oldVal)} to ${keyCount(newVal)}.`;
    },
  },
  {
    field: "signers",
    when: (oldVal, newVal) => keyCount(newVal) < keyCount(oldVal),
    severity: "critical",
    describe: (oldVal, newVal) => {
      const removed = keyCount(oldVal) - keyCount(newVal);
      return `${removed} signer(s) removed from the vault. Signer count changed from ${keyCount(oldVal)} to ${keyCount(newVal)}.`;
    },
  },
  {
    field: "signers",
    severity: "info",
    describe: (_oldVal, _newVal) => `Signer set updated.`,
  },

  // ── Signer count scalar ───────────────────────────────────────────────────

  {
    field: "totalSigners",
    when: (oldVal, newVal) =>
      typeof oldVal === "number" &&
      typeof newVal === "number" &&
      newVal < oldVal,
    severity: "critical",
    describe: (oldVal, newVal) =>
      `Total signer count decreased from ${oldVal} to ${newVal}.`,
  },
  {
    field: "totalSigners",
    when: (oldVal, newVal) =>
      typeof oldVal === "number" &&
      typeof newVal === "number" &&
      newVal > oldVal,
    severity: "warning",
    describe: (oldVal, newVal) =>
      `Total signer count increased from ${oldVal} to ${newVal}.`,
  },
  {
    field: "totalSigners",
    severity: "info",
    describe: (oldVal, newVal) =>
      `Total signer count changed from ${oldVal} to ${newVal}.`,
  },

  // ── Role changes ──────────────────────────────────────────────────────────

  {
    field: "roles",
    severity: "warning",
    describe: (oldVal, newVal) => {
      const oldCount = keyCount(oldVal);
      const newCount = keyCount(newVal);
      if (newCount !== oldCount) {
        return `Role assignments changed from ${oldCount} to ${newCount} entries.`;
      }
      return `Role assignment(s) updated.`;
    },
  },
  {
    field: "totalRoleAssignments",
    severity: "info",
    describe: (oldVal, newVal) =>
      `Total role assignments changed from ${oldVal} to ${newVal}.`,
  },

  // ── Catch-all ─────────────────────────────────────────────────────────────

  {
    field: "*",
    severity: "info",
    describe: (oldVal, newVal) =>
      `Field changed from ${JSON.stringify(oldVal)} to ${JSON.stringify(newVal)}.`,
  },
];
