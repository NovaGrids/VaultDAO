/**
 * EventReplayService
 * 
 * A service for replaying and backfilling contract events.
 * Reuses existing event normalization and cursor storage from the events module.
 */

import { EventNormalizer } from "../normalizers/index.js";
import { FileCursorAdapter } from "../cursor/file-cursor.adapter.js";
import type { CursorStorage } from "../cursor/cursor.types.js";
import { SorobanRpcClient } from "../../../shared/rpc/soroban-rpc.client.js";
import {
  sortAndSequenceEvents,
  dedupeEvents,
  validateReplayIntegrity,
  type SequencedEvent,
} from "./event-sequence.js";
import type {
  ReplayOptions,
  EventProcessingResult,
  ReplayStats,
  ProgressCallback,
  EventBatch,
  ReplayEventConsumer,
  ReplayBatchConsumer,
} from "./replay.types.js";
import type { ContractEvent } from "../events.types.js";
import type { GetEventsParams } from "../../../shared/rpc/soroban-rpc.types.js";
import {
  FileReplayCheckpointStore,
  REPLAY_CHECKPOINT_VERSION,
  decodeResumeToken,
  encodeResumeToken,
  resolveResumeLedger,
  type ReplayCheckpoint,
  type ReplayCheckpointStore,
} from "./replay-checkpoint.js";
import type { NormalizedEvent } from "../types.js";
import type { BackendEnv } from "../../../config/env.js";

/**
 * EventReplayService
 * 
 * Provides event replay and backfill capabilities for rebuilding local indexed state.
 * Designed to be safe for local contributors and supports configurable start points.
 */
export class EventReplayService {
  private readonly cursorAdapter: CursorStorage;
  private readonly rpc: SorobanRpcClient;
  private startTime: number = 0;
  private stats: ReplayStats;
  private readonly eventConsumers: ReplayEventConsumer[] = [];
  private readonly batchConsumers: ReplayBatchConsumer[] = [];
  /** Batch consumers whose failures abort the run (see registerBatchConsumer). */
  private readonly criticalBatchConsumers = new Set<ReplayBatchConsumer>();
  private readonly checkpointStore: ReplayCheckpointStore;
  private lastCheckpoint: ReplayCheckpoint | null = null;

  constructor(
    private readonly env: BackendEnv,
    private readonly options: ReplayOptions,
    deps: {
      checkpointStore?: ReplayCheckpointStore;
      cursorStorage?: CursorStorage;
    } = {},
  ) {
    this.cursorAdapter =
      deps.cursorStorage ?? new FileCursorAdapter(options.outputDir);
    // The checkpoint (resume token) lives next to the cursor file.
    this.checkpointStore =
      deps.checkpointStore ?? new FileReplayCheckpointStore(options.outputDir);
    this.rpc = new SorobanRpcClient({
      url: options.rpcUrl ?? env.sorobanRpcUrl,
    });
    this.stats = this.initStats();
  }

  /**
   * Initializes the replay statistics.
   */
  private initStats(): ReplayStats {
    return {
      totalEventsProcessed: 0,
      successCount: 0,
      errorCount: 0,
      skippedCount: 0,
      startLedger: this.options.startLedger,
      endLedger: this.options.endLedger ?? 0,
      durationMs: 0,
      processedLedgers: 0,
      eventsByType: {},
      resumedFromLedger: null,
      lastCheckpointLedger: null,
      checkpointsWritten: 0,
      targetLedger: this.options.endLedger ?? 0,
    };
  }

  /**
   * Resolves where this run starts: the requested start ledger, or the ledger
   * after the last checkpoint when a matching checkpoint / resume token exists.
   */
  private async resolveStart(
    contractId: string,
    endLedger: number,
  ): Promise<{ startLedger: number; checkpoint: ReplayCheckpoint | null }> {
    const requestedStart = this.options.startLedger;

    if (this.options.resumeToken) {
      const token = decodeResumeToken(this.options.resumeToken);
      const resumeAt = resolveResumeLedger(token, contractId, requestedStart, endLedger);
      if (resumeAt === null) {
        throw new Error(
          `Resume token (replay ${token.replayId}, contract ${token.contractId}, checkpoint ledger ${token.lastCheckpointLedger}) does not apply to contract ${contractId} range ${requestedStart}-${endLedger}.`,
        );
      }
      return { startLedger: resumeAt, checkpoint: token };
    }

    // Dry runs never read (or write) the persisted checkpoint so they stay
    // side-effect free and reproducible; pass --resume-token to preview a resume.
    if (this.options.dryRun || this.options.resume === false) {
      return { startLedger: requestedStart, checkpoint: null };
    }

    const stored = await this.checkpointStore.load();
    const resumeAt = resolveResumeLedger(stored, contractId, requestedStart, endLedger);
    if (resumeAt === null || stored === null) {
      return { startLedger: requestedStart, checkpoint: null };
    }
    return { startLedger: resumeAt, checkpoint: stored };
  }

  /**
   * Executes the replay/backfill operation.
   *
   * Ledgers are processed in `batchSize` windows. After each window every
   * consumer has been awaited, so once at least `checkpointEvery` ledgers
   * have passed since the last checkpoint (and always at the end of the
   * range) the checkpoint + cursor are persisted. A crash therefore loses at
   * most `checkpointEvery` ledgers of work, and the idempotent projections
   * make re-applying that tail safe.
   */
  public async replay(onProgress?: ProgressCallback): Promise<ReplayStats> {
    this.startTime = Date.now();
    this.stats = this.initStats();
    const contractId = this.options.contractId ?? this.env.contractId;
    const endLedger = this.options.endLedger ?? (await this.getLatestLedger());
    const checkpointEvery = Math.max(
      1,
      this.options.checkpointEvery ?? this.options.batchSize,
    );

    const { startLedger, checkpoint: prior } = await this.resolveStart(
      contractId,
      endLedger,
    );
    const replayId = prior?.replayId ?? this.generateReplayId();
    let eventsApplied = prior?.eventsApplied ?? 0;
    let lastCheckpointLedger = prior ? prior.lastCheckpointLedger : startLedger - 1;
    let lastEventId: string | undefined = prior?.lastEventId;

    this.stats = {
      ...this.stats,
      startLedger,
      targetLedger: endLedger,
      resumedFromLedger: prior ? startLedger : null,
      lastCheckpointLedger: prior ? prior.lastCheckpointLedger : null,
    };

    this.log(`[replay] Starting backfill from ledger ${startLedger} to ${endLedger}`);
    if (prior) {
      this.log(
        `[replay] Resuming replay ${replayId} after checkpoint at ledger ${prior.lastCheckpointLedger}`,
      );
    }
    this.log(`[replay] Contract: ${contractId}`);
    this.log(`[replay] RPC: ${this.options.rpcUrl ?? this.env.sorobanRpcUrl}`);
    this.log(`[replay] Batch size: ${this.options.batchSize}`);
    this.log(`[replay] Checkpoint every: ${checkpointEvery} ledgers`);
    this.log(`[replay] Dry run: ${this.options.dryRun}`);

    if (this.options.dryRun) {
      this.log("[replay] DRY RUN MODE - No state will be persisted");
    }

    let currentLedger = startLedger;

    try {
      while (currentLedger <= endLedger) {
        const batchEndLedger = Math.min(currentLedger + this.options.batchSize - 1, endLedger);

        this.log(`[replay] Fetching events for ledgers ${currentLedger}-${batchEndLedger}`);

        const batch = await this.fetchEventBatch(currentLedger, batchEndLedger);

        if (batch.events.length === 0) {
          this.log(`[replay] No events found in ledgers ${currentLedger}-${batchEndLedger}`);
        } else {
          this.log(`[replay] Processing batch of ${batch.events.length} events`);
          const normalizedBatch: NormalizedEvent[] = [];

          for (const event of batch.events) {
            const result = await this.processEvent(event);
            this.updateStats(result);
            if (result.normalized) {
              normalizedBatch.push(result.normalized);
            }
            eventsApplied += 1;
            lastEventId = event.id;
          }

          if (normalizedBatch.length > 0) {
            await this.dispatchBatch(normalizedBatch);
          }
        }

        // Persist a checkpoint (and cursor) once enough ledgers have been
        // applied, and always at the end of the range. Never in dry-run mode.
        const isLastBatch = batchEndLedger === endLedger;
        if (
          !this.options.dryRun &&
          (isLastBatch || batchEndLedger - lastCheckpointLedger >= checkpointEvery)
        ) {
          const checkpoint: ReplayCheckpoint = {
            version: REPLAY_CHECKPOINT_VERSION,
            replayId,
            contractId,
            fromLedger: prior?.fromLedger ?? startLedger,
            toLedger: endLedger,
            lastCheckpointLedger: batchEndLedger,
            lastEventId,
            eventsApplied,
            completed: isLastBatch,
            updatedAt: new Date().toISOString(),
          };
          await this.checkpointStore.save(checkpoint);
          await this.cursorAdapter.saveCursor({
            lastLedger: batchEndLedger,
            lastEventId,
            updatedAt: checkpoint.updatedAt,
          });
          this.lastCheckpoint = checkpoint;
          lastCheckpointLedger = batchEndLedger;
          this.stats = {
            ...this.stats,
            lastCheckpointLedger: batchEndLedger,
            checkpointsWritten: this.stats.checkpointsWritten + 1,
          };
          this.log(`[replay] Checkpoint written at ledger ${batchEndLedger}`);
        }

        // Update progress
        this.stats = {
          ...this.stats,
          endLedger: batchEndLedger,
          processedLedgers: this.stats.processedLedgers + 1,
          durationMs: Date.now() - this.startTime,
        };

        if (onProgress) {
          onProgress(this.stats, currentLedger);
        }

        currentLedger = batchEndLedger + 1;
      }

      this.stats = {
        ...this.stats,
        durationMs: Date.now() - this.startTime,
      };

      this.logSummary();

      return this.stats;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log(`[replay] ERROR during replay: ${errorMessage}`);
      if (this.lastCheckpoint) {
        this.log(
          `[replay] Last checkpoint: ledger ${this.lastCheckpoint.lastCheckpointLedger}. Re-run the same command to resume, or pass --resume-token ${encodeResumeToken(this.lastCheckpoint)}`,
        );
      }
      throw error;
    }
  }

  /**
   * Processes a single event through normalization.
   */
  private async processEvent(event: ContractEvent): Promise<EventProcessingResult> {
    try {
      const normalized = EventNormalizer.normalize(event);

      await this.dispatchEvent(normalized);
      this.logEvent(event, normalized);

      return {
        event,
        normalized,
        success: true,
        ledger: event.ledger,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (this.options.verbose) {
        this.log(`[replay] ERROR normalizing event ${event.id}: ${errorMessage}`);
      }

      return {
        event,
        normalized: null,
        success: false,
        error: errorMessage,
        ledger: event.ledger,
      };
    }
  }

  /**
   * Updates the replay statistics based on processing result.
   */
  private updateStats(result: EventProcessingResult): void {
    const typeKey = result.normalized?.type ?? "NORMALIZATION_ERROR";
    this.stats = {
      ...this.stats,
      eventsByType: {
        ...this.stats.eventsByType,
        [typeKey]: (this.stats.eventsByType[typeKey] ?? 0) + 1,
      },
      totalEventsProcessed: this.stats.totalEventsProcessed + 1,
      successCount: result.success ? this.stats.successCount + 1 : this.stats.successCount,
      errorCount: result.success ? this.stats.errorCount : this.stats.errorCount + 1,
    };
  }

  /**
   * Fetches a batch of events from the Soroban RPC.
   *
   * The RPC caps each response at `limit` events, so a window with more
   * events than that is read page by page (via the paging cursor) until the
   * page is short or moves past `endLedger`. Skipping that would silently
   * drop events and let a checkpoint claim ledgers that were never applied.
   */
  private async fetchEventBatch(startLedger: number, endLedger: number): Promise<EventBatch> {
    const contractId = this.options.contractId ?? this.env.contractId;
    const limit = this.options.batchSize;
    const filters = [{ type: "contract" as const, contractIds: [contractId] }];

    const collected: ContractEvent[] = [];
    const seen = new Set<string>();
    let page = await this.rpc.getContractEvents({
      startLedger,
      filters,
      pagination: { limit },
    });
    let hasMore = false;

    for (;;) {
      let added = 0;
      let pastEnd = false;
      for (const event of page) {
        if (event.ledger > endLedger) {
          pastEnd = true;
          continue;
        }
        if (event.ledger < startLedger || seen.has(event.id)) continue;
        seen.add(event.id);
        collected.push(event);
        added += 1;
      }

      if (pastEnd) {
        hasMore = true;
        break;
      }
      // A short page, or a page with nothing new, means the window is drained.
      if (page.length < limit || added === 0) break;

      const cursor = page[page.length - 1]!.id;
      // The RPC treats `startLedger` and `pagination.cursor` as mutually
      // exclusive, so follow-up pages are requested by cursor only.
      page = await this.rpc.getContractEvents({
        filters,
        pagination: { limit, cursor },
      } as unknown as GetEventsParams);
    }

    // Transaction reordering upstream can make the RPC return events out of
    // order within/across ledgers — restore deterministic order before the
    // batch is handed to consumers.
    const ordered = sortAndSequenceEvents(collected);

    return {
      events: ordered,
      startLedger,
      endLedger,
      latestLedger: endLedger,
      hasMore,
    };
  }

  /**
   * Fetches, deterministically orders, and deduplicates all contract events
   * in `[fromLedger, toLedger]` (inclusive), without dispatching them to any
   * registered consumers or touching cursor state.
   *
   * Events are sorted by `(ledger, tx_index, event_index)` — never trusting
   * RPC response order — and each is annotated with a per-ledger
   * `eventSequenceNumber`. Duplicate ids (e.g. from overlapping fetch
   * windows) are removed, keeping the earliest occurrence in sequence order.
   */
  public async replayEvents(
    fromLedger: number,
    toLedger: number,
  ): Promise<SequencedEvent[]> {
    if (
      !Number.isInteger(fromLedger) ||
      !Number.isInteger(toLedger) ||
      fromLedger < 0 ||
      toLedger < fromLedger
    ) {
      throw new RangeError(
        `Invalid replay range: fromLedger=${fromLedger}, toLedger=${toLedger}`,
      );
    }

    const contractId = this.options.contractId ?? this.env.contractId;
    const collected: ContractEvent[] = [];
    let currentLedger = fromLedger;

    while (currentLedger <= toLedger) {
      const batchEndLedger = Math.min(
        currentLedger + this.options.batchSize - 1,
        toLedger,
      );

      const events = await this.rpc.getContractEvents({
        startLedger: currentLedger,
        filters: [{ type: "contract", contractIds: [contractId] }],
        pagination: { limit: this.options.batchSize },
      });

      for (const event of events) {
        if (event.ledger >= currentLedger && event.ledger <= batchEndLedger) {
          collected.push(event);
        }
      }

      currentLedger = batchEndLedger + 1;
    }

    const sorted = sortAndSequenceEvents(collected);

    const integrity = validateReplayIntegrity(sorted);
    if (integrity.duplicateIds.length > 0) {
      this.log(
        `[replay] replayEvents: ${integrity.duplicateIds.length} duplicate event id(s) detected in range ${fromLedger}-${toLedger}; de-duplicating.`,
      );
    }
    if (integrity.possibleGaps.length > 0) {
      this.log(
        `[replay] replayEvents: ${integrity.possibleGaps.length} possible event_index gap(s) detected in range ${fromLedger}-${toLedger}.`,
      );
    }

    return dedupeEvents(sorted);
  }

  /**
   * Gets the latest ledger number from the RPC.
   */
  private async getLatestLedger(): Promise<number> {
    return this.rpc.getLatestLedger();
  }

  /**
   * Registers a single normalized event consumer.
   */
  public registerConsumer(consumer: ReplayEventConsumer): void {
    this.eventConsumers.push(consumer);
  }

  /**
   * Registers a batch normalized event consumer.
   *
   * Errors from ordinary consumers are logged and swallowed. A `critical`
   * consumer (e.g. a projection writer) instead aborts the run: its error
   * propagates out of `replay()` before the batch is checkpointed, so a
   * crash never records ledgers whose writes did not land.
   */
  public registerBatchConsumer(
    consumer: ReplayBatchConsumer,
    options: { critical?: boolean } = {},
  ): void {
    this.batchConsumers.push(consumer);
    if (options.critical) this.criticalBatchConsumers.add(consumer);
  }

  private async dispatchEvent(event: NormalizedEvent): Promise<void> {
    for (const consumer of this.eventConsumers) {
      try {
        await consumer(event);
      } catch (error) {
        this.log(
          `[replay] consumer dispatch error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async dispatchBatch(events: NormalizedEvent[]): Promise<void> {
    for (const consumer of this.batchConsumers) {
      try {
        await consumer(events);
      } catch (error) {
        if (this.criticalBatchConsumers.has(consumer)) throw error;
        this.log(
          `[replay] batch consumer dispatch error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Logs event details when in verbose mode.
   */
  private logEvent(event: ContractEvent, normalized: NormalizedEvent): void {
    if (!this.options.verbose) return;

    const eventType = normalized.type;
    const ledger = event.ledger;
    
    console.log(`[replay] Event: ${eventType} @ ledger ${ledger} (${event.id})`);
  }

  /**
   * Logs a message with timestamp.
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
  }

  /**
   * Logs the final summary of the replay operation.
   */
  private logSummary(): void {
    this.log("[replay] ========== REPLAY SUMMARY ==========");
    this.log(`[replay] Total events processed: ${this.stats.totalEventsProcessed}`);
    this.log(`[replay] Successful: ${this.stats.successCount}`);
    this.log(`[replay] Errors: ${this.stats.errorCount}`);
    this.log(`[replay] Ledgers processed: ${this.stats.processedLedgers}`);
    this.log(`[replay] Checkpoints written: ${this.stats.checkpointsWritten}`);
    this.log(`[replay] Duration: ${(this.stats.durationMs / 1000).toFixed(2)}s`);
    this.log("[replay] =====================================");
  }

  /**
   * Generates a unique replay ID for tracking.
   */
  private generateReplayId(): string {
    return `replay-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Gets the current replay statistics.
   */
  public getStats(): ReplayStats {
    return {
      ...this.stats,
      durationMs: Date.now() - this.startTime,
    };
  }

  /**
   * Last checkpoint written by this service instance, if any.
   */
  public getLastCheckpoint(): ReplayCheckpoint | null {
    return this.lastCheckpoint;
  }

  /**
   * Returns the persisted checkpoint (if any) from the checkpoint store.
   */
  public async loadCheckpoint(): Promise<ReplayCheckpoint | null> {
    return this.checkpointStore.load();
  }

  /**
   * Removes the persisted checkpoint so the next run starts fresh.
   */
  public async clearCheckpoint(): Promise<void> {
    await this.checkpointStore.clear();
  }

  /**
   * Checks if the cursor storage has an existing replay cursor.
   */
  public async hasExistingCursor(): Promise<boolean> {
    const cursor = await this.cursorAdapter.getCursor();
    return cursor !== null;
  }

  /**
   * Gets the last processed ledger from cursor storage.
   */
  public async getLastProcessedLedger(): Promise<number | null> {
    const cursor = await this.cursorAdapter.getCursor();
    return cursor?.lastLedger ?? null;
  }
}
