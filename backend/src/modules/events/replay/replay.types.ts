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
