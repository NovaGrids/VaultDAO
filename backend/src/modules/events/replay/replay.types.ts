/**
 * ReplayModule Types
 * 
 * Type definitions for the event replay and backfill command.
 */

import type { ContractEvent } from "../events.types.js";
import type { NormalizedEvent } from "../types.js";

export type ReplayEventConsumer = (
  event: NormalizedEvent,
) => void | Promise<void>;

export type ReplayBatchConsumer = (
  events: NormalizedEvent[],
) => void | Promise<void>;

/**
 * Configuration options for the replay command.
 */
export type ReplayOutputFormat = "human" | "json";

export interface ReplayOptions {
  /** Starting ledger for backfill (inclusive). Defaults to 0. */
  readonly startLedger: number;
  /** Ending ledger for backfill (inclusive). Defaults to latest. */
  readonly endLedger?: number;
  /** Batch size for fetching events. Defaults to 100. */
  readonly batchSize: number;
  /** Contract ID to replay events for. Defaults to env config. */
  readonly contractId?: string;
  /** RPC URL for Soroban. Defaults to env config. */
  readonly rpcUrl?: string;
  /** Output directory for cursor/state files. */
  readonly outputDir?: string;
  /** Dry run mode - don't persist state or process events. */
  readonly dryRun: boolean;
  /** Verbose logging output. */
  readonly verbose: boolean;
  /** Clear existing state before replay. */
  readonly clear: boolean;
  /** Filter by event types (e.g. PROPOSAL_CREATED, SIGNER_ADDED). */
  readonly eventTypes?: string[];
  /** Output format: human-readable or JSON. Defaults to human. */
  readonly outputFormat?: ReplayOutputFormat;
  /**
   * Write a checkpoint (and cursor) at least every N ledgers. A crashed run
   * resumes from the last checkpoint. Defaults to `batchSize`.
   */
  readonly checkpointEvery?: number;
  /**
   * Resume from the checkpoint stored alongside the cursor when it applies to
   * this run. Defaults to true; `--no-resume` disables it.
   */
  readonly resume?: boolean;
  /** Explicit resume token (takes precedence over the stored checkpoint). */
  readonly resumeToken?: string;
  /** Path of the SQLite database holding replay projections. */
  readonly projectionDbPath?: string;
}

/**
 * Result of processing a single event during replay.
 */
export interface EventProcessingResult {
  readonly event: ContractEvent;
  readonly normalized: NormalizedEvent | null;
  readonly success: boolean;
  readonly error?: string;
  readonly ledger: number;
}

/**
 * Statistics collected during a replay run.
 */
export interface ReplayStats {
  readonly totalEventsProcessed: number;
  readonly successCount: number;
  readonly errorCount: number;
  readonly skippedCount: number;
  readonly startLedger: number;
  readonly endLedger: number;
  readonly durationMs: number;
  readonly processedLedgers: number;
  /** Events seen per normalized event type (`NORMALIZATION_ERROR` on failure). */
  readonly eventsByType: Readonly<Record<string, number>>;
  /** Ledger the run resumed from, or null for a fresh run. */
  readonly resumedFromLedger: number | null;
  /** Last ledger covered by a persisted checkpoint, or null if none yet. */
  readonly lastCheckpointLedger: number | null;
  readonly checkpointsWritten: number;
  /** Target ledger of the run (resolved latest ledger when `endLedger` is unset). */
  readonly targetLedger: number;
}

/**
 * Progress callback for replay operations.
 */
export type ProgressCallback = (stats: ReplayStats, currentLedger: number) => void;

/**
 * Batch of events fetched from RPC.
 */
export interface EventBatch {
  readonly events: ContractEvent[];
  readonly startLedger: number;
  readonly endLedger: number;
  readonly latestLedger: number;
  readonly hasMore: boolean;
}

/**
 * Cursor state for replay operation.
 */
export interface ReplayCursor {
  readonly lastProcessedLedger: number;
  readonly lastProcessedEventId?: string;
  readonly updatedAt: string;
  readonly replayId: string;
}
