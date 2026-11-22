/**
 * Replay progress metrics and the final reconciliation report.
 */

import type { ReplayStats } from "./replay.types.js";
import type { ReplayCheckpoint } from "./replay-checkpoint.js";
import { encodeResumeToken } from "./replay-checkpoint.js";
import type { ProjectionSummary } from "./replay-projections.js";

export interface ReplayProgressMetrics {
  readonly currentLedger: number;
  readonly targetLedger: number;
  /** 0–100, relative to the ledgers this run covers. */
  readonly percentComplete: number;
  readonly eventsProcessed: number;
  readonly eventsPerSecond: number;
  readonly elapsedMs: number;
  readonly lastCheckpointLedger: number | null;
}

export interface ReplayReconciliationReport {
  readonly contractId: string;
  readonly dryRun: boolean;
  readonly fromLedger: number;
  readonly toLedger: number;
  readonly resumedFromLedger: number | null;
  readonly lastCheckpointLedger: number | null;
  readonly checkpointsWritten: number;
  readonly totalEvents: number;
  readonly successCount: number;
  readonly errorCount: number;
  /** Events per normalized event type, sorted by type name. */
  readonly countsByEventType: Readonly<Record<string, number>>;
  readonly projections: ProjectionSummary;
  readonly durationMs: number;
  /** Resume token for the last checkpoint (null for dry runs / no checkpoint). */
  readonly resumeToken: string | null;
}

export function computeProgress(
  stats: ReplayStats,
  currentLedger: number,
): ReplayProgressMetrics {
  const first = stats.resumedFromLedger ?? stats.startLedger;
  const span = Math.max(1, stats.targetLedger - first + 1);
  const done = Math.min(span, Math.max(0, stats.endLedger - first + 1));
  const elapsedMs = Math.max(0, stats.durationMs);
  return {
    currentLedger,
    targetLedger: stats.targetLedger,
    percentComplete: Math.round((done / span) * 1000) / 10,
    eventsProcessed: stats.totalEventsProcessed,
    eventsPerSecond:
      elapsedMs > 0
        ? Math.round((stats.totalEventsProcessed / elapsedMs) * 1000 * 10) / 10
        : 0,
    elapsedMs,
    lastCheckpointLedger: stats.lastCheckpointLedger,
  };
}

export function buildReconciliationReport(input: {
  readonly contractId: string;
  readonly dryRun: boolean;
  readonly fromLedger: number;
  readonly stats: ReplayStats;
  readonly projections: ProjectionSummary;
  readonly checkpoint: ReplayCheckpoint | null;
}): ReplayReconciliationReport {
  const { stats } = input;
  const countsByEventType: Record<string, number> = {};
  for (const type of Object.keys(stats.eventsByType).sort()) {
    countsByEventType[type] = stats.eventsByType[type]!;
  }
  return {
    contractId: input.contractId,
    dryRun: input.dryRun,
    fromLedger: input.fromLedger,
    toLedger: stats.targetLedger,
    resumedFromLedger: stats.resumedFromLedger,
    lastCheckpointLedger: stats.lastCheckpointLedger,
    checkpointsWritten: stats.checkpointsWritten,
    totalEvents: stats.totalEventsProcessed,
    successCount: stats.successCount,
    errorCount: stats.errorCount,
    countsByEventType,
    projections: input.projections,
    durationMs: stats.durationMs,
    resumeToken:
      input.dryRun || !input.checkpoint ? null : encodeResumeToken(input.checkpoint),
  };
}

export function formatReconciliationReport(report: ReplayReconciliationReport): string {
  const lines = [
    "========== REPLAY RECONCILIATION REPORT ==========",
    `Contract:            ${report.contractId}`,
    `Mode:                ${report.dryRun ? "dry-run (no writes)" : "write"}`,
    `Range:               ${report.fromLedger}-${report.toLedger}`,
    `Resumed from:        ${report.resumedFromLedger ?? "-"}`,
    `Last checkpoint:     ${report.lastCheckpointLedger ?? "-"}`,
    `Checkpoints written: ${report.checkpointsWritten}`,
    `Events:              ${report.totalEvents} (ok ${report.successCount}, errors ${report.errorCount})`,
    "",
    "Counts by event type:",
  ];
  const types = Object.entries(report.countsByEventType);
  if (types.length === 0) {
    lines.push("  (none)");
  } else {
    const width = Math.max(...types.map(([t]) => t.length));
    for (const [type, count] of types) {
      lines.push(`  ${type.padEnd(width)}  ${count}`);
    }
  }
  const verb = report.dryRun ? "would apply" : "applied";
  lines.push(
    "",
    "Projections:",
    `  proposals  ${verb} ${report.projections.proposal.applied}, skipped (already applied) ${report.projections.proposal.skipped}`,
    `  recurring  ${verb} ${report.projections.recurring.applied}, skipped (already applied) ${report.projections.recurring.skipped}`,
    `  not projected: ${report.projections.ignored}`,
    "",
    `Duration:            ${(report.durationMs / 1000).toFixed(2)}s`,
  );
  if (report.resumeToken) {
    lines.push(`Resume token:        ${report.resumeToken}`);
  }
  lines.push("==================================================");
  return lines.join("\n");
}
