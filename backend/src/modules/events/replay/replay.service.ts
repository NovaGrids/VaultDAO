/**
 * EventReplayService
 * 
 * A service for replaying and backfilling contract events.
 * Reuses existing event normalization and cursor storage from the events module.
 */

import { EventNormalizer } from "../normalizers/index.js";
import { FileCursorAdapter } from "../cursor/file-cursor.adapter.js";
import type {
  ReplayOptions,
  EventProcessingResult,
  ReplayStats,
  ProgressCallback,
  EventBatch,
  ReplayCursor,
} from "./replay.types.js";
import type { ContractEvent } from "../events.types.js";
import type { NormalizedEvent } from "../types.js";
import type { BackendEnv } from "../../../config/env.js";

/**
 * EventReplayService
 * 
 * Provides event replay and backfill capabilities for rebuilding local indexed state.
 * Designed to be safe for local contributors and supports configurable start points.
 */
export class EventReplayService {
  private readonly cursorAdapter: FileCursorAdapter;
  private startTime: number = 0;
  private stats: ReplayStats;

  constructor(
    private readonly env: BackendEnv,
    private readonly options: ReplayOptions,
  ) {
    this.cursorAdapter = new FileCursorAdapter(options.outputDir);
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
    };
  }

  /**
   * Executes the replay/backfill operation.
   */
  public async replay(onProgress?: ProgressCallback): Promise<ReplayStats> {
    this.startTime = Date.now();
    this.stats = this.initStats();
    const startLedger = this.options.startLedger;
    const endLedger = this.options.endLedger ?? (await this.getLatestLedger());

    this.log(`[replay] Starting backfill from ledger ${startLedger} to ${endLedger}`);
    this.log(`[replay] Contract: ${this.options.contractId ?? this.env.contractId}`);
    this.log(`[replay] RPC: ${this.options.rpcUrl ?? this.env.sorobanRpcUrl}`);
    this.log(`[replay] Batch size: ${this.options.batchSize}`);
    this.log(`[replay] Dry run: ${this.options.dryRun}`);

    if (this.options.dryRun) {
      this.log("[replay] DRY RUN MODE - No state will be persisted");
    }

    let currentLedger = startLedger;
    let replayId = this.generateReplayId();

    try {
      while (currentLedger <= endLedger) {
        const batchEndLedger = Math.min(currentLedger + this.options.batchSize - 1, endLedger);

        this.log(`[replay] Fetching events for ledgers ${currentLedger}-${batchEndLedger}`);

        const batch = await this.fetchEventBatch(currentLedger, batchEndLedger);
        
        if (batch.events.length === 0) {
          this.log(`[replay] No events found in ledgers ${currentLedger}-${batchEndLedger}`);
        } else {
          this.log(`[replay] Processing batch of ${batch.events.length} events`);

          for (const event of batch.events) {
            const result = this.processEvent(event);
            this.updateStats(result);
          }
        }

        // Update cursor if not in dry run mode
        if (!this.options.dryRun) {
          const cursor: ReplayCursor = {
            lastProcessedLedger: batchEndLedger,
            updatedAt: new Date().toISOString(),
            replayId,
          };
          await this.cursorAdapter.saveCursor(cursor as any);
        }

        // Update progress
        this.stats = {
          ...this.stats,
          endLedger: batchEndLedger,
          processedLedgers: this.stats.processedLedgers + 1,
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
      throw error;
    }
  }

  /**
   * Processes a single event through normalization.
   */
  private processEvent(event: ContractEvent): EventProcessingResult {
    try {
      const normalized = EventNormalizer.normalize(event);
      
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
    this.stats = {
      ...this.stats,
      totalEventsProcessed: this.stats.totalEventsProcessed + 1,
      successCount: result.success ? this.stats.successCount + 1 : this.stats.successCount,
      errorCount: result.success ? this.stats.errorCount : this.stats.errorCount + 1,
    };
  }

  /**
   * Fetches a batch of events from the RPC.
   * This is a placeholder implementation that should be replaced with actual RPC calls.
   */
  private async fetchEventBatch(startLedger: number, endLedger: number): Promise<EventBatch> {
    // In a real implementation, this would call the Soroban RPC:
    // const response = await fetch(`${this.options.rpcUrl ?? this.env.sorobanRpcUrl}`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     jsonrpc: '2.0',
    //     id: 1,
    //     method: 'getEvents',
    //     params: {
    //       startLedger,
    //       endLedger,
    //       filters: [{
    //         type: 'contract',
    //         contractIds: [this.options.contractId ?? this.env.contractId],
    //       }],
    //     },
    //   }),
    // });

    // Mock implementation for demonstration
    const mockEvents: ContractEvent[] = [];
    
    return {
      events: mockEvents,
      startLedger,
      endLedger,
      latestLedger: endLedger,
      hasMore: false,
    };
  }

  /**
   * Gets the latest ledger number from RPC.
   */
  private async getLatestLedger(): Promise<number> {
    // In a real implementation, this would call:
    // const response = await fetch(`${this.options.rpcUrl ?? this.env.sorobanRpcUrl}`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     jsonrpc: '2.0',
    //     id: 1,
    //     method: 'getLatestLedger',
    //   }),
    // });

    // Mock implementation - return current ledger estimate
    return 1000;
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
