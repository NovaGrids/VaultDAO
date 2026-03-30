import { createLogger } from "../../shared/logging/logger.js";
import type { BackendEnv } from "../../config/env.js";
import type { ContractEvent, PollingState } from "./events.types.js";
import type { CursorStorage } from "./cursor/index.js";
import { EventNormalizer } from "./normalizers/index.js";
import type { ProposalActivityConsumer } from "../proposals/consumer.js";
import type { EventWebSocketServer } from "../websocket/websocket.server.js";
import type { SnapshotService } from "../snapshots/snapshot.service.js";
import { SnapshotNormalizer } from "../snapshots/normalizer.js";
import { TimeoutError } from "../../shared/http/fetchWithTimeout.js";

/** Maximum backoff delay: 5 minutes */
const MAX_BACKOFF_MS = 5 * 60 * 1000;

/** Contract topics that should be forwarded to the proposal consumer. */
const PROPOSAL_TOPICS = new Set([
  "proposal_created",
  "proposal_approved",
  "proposal_abstained",
  "proposal_ready",
  "proposal_scheduled",
  "proposal_executed",
  "proposal_expired",
  "proposal_cancelled",
  "proposal_rejected",
  "proposal_deadline_rejected",
  "proposal_vetoed",
  "proposal_amended",
  "proposal_from_template",
  "scheduled_proposal_cancelled",
  "delegated_vote",
  "voting_deadline_ext",
  "quorum_reached",
]);

/**
 * EventPollingService
 *
 * A background service that polls the Soroban RPC for contract events.
 * Now supports cursor persistence to resume safely across restarts.
 * Includes event deduplication to handle overlapping poll windows.
 */
export class EventPollingService {
  private readonly logger = createLogger("events-service");
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private lastLedgerPolled: number = 0;
  private consecutiveErrors: number = 0;
  private processedEventIds: Set<string> = new Set();
  private readonly MAX_PROCESSED_IDS = 1000;

  constructor(
    private readonly env: BackendEnv,
    private readonly storage: CursorStorage,
    private readonly proposalConsumer?: ProposalActivityConsumer,
    private readonly wsServer?: EventWebSocketServer,
    private readonly snapshotService?: SnapshotService,
  ) {}

  /**
   * Starts the polling loop if enabled in config.
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    if (!this.env.eventPollingEnabled) {
      this.logger.info("event polling is disabled in config");
      return;
    }

    // Clear processed event IDs on startup for fresh session
    this.processedEventIds.clear();

    // Load last cursor from storage
    const lastCursor = await this.storage.getCursor();
    if (lastCursor) {
      this.lastLedgerPolled = lastCursor.lastLedger;
      this.logger.info(`resuming from cursor: ledger ${this.lastLedgerPolled}`);
    } else {
      // Default to 0 or a safe starter ledger from env
      this.lastLedgerPolled = 0;
      this.logger.info("no cursor found, starting from default ledger 0");
    }

    this.isRunning = true;
    this.logger.info("starting event polling loop", {
      rpc: this.env.sorobanRpcUrl,
      contract: this.env.contractId,
      interval: `${this.env.eventPollingIntervalMs}ms`,
    });

    this.scheduleNextPoll();
  }

  /**
   * Gracefully stops the polling loop.
   */
  public stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.logger.info("stopped event polling loop");
  }

  /**
   * Schedules the next execution of the poll loop.
   * Implements exponential backoff on consecutive errors.
   */
  private scheduleNextPoll(): void {
    if (!this.isRunning) return;

    // Calculate delay with exponential backoff
    const baseInterval = this.env.eventPollingIntervalMs;
    const multiplier = Math.pow(2, this.consecutiveErrors);
    const delayWithoutCap = baseInterval * multiplier;
    const delay = Math.min(delayWithoutCap, MAX_BACKOFF_MS);

    // Log backoff activation
    if (this.consecutiveErrors > 0) {
      this.logger.info("scheduling next poll with backoff", {
        delayMs: delay,
        attempt: this.consecutiveErrors,
      });
    }

    this.timer = setTimeout(async () => {
      // Re-check running state in case stop() was called during timer wait
      if (!this.isRunning) return;

      try {
        await this.poll();
        this.consecutiveErrors = 0;
      } catch (error) {
        this.consecutiveErrors++;
        
        // Handle timeout errors with additional context
        if (error instanceof TimeoutError) {
          this.logger.error("RPC timeout during poll", {
            attempt: this.consecutiveErrors,
            error: error.message,
            rpc: this.env.sorobanRpcUrl,
            timeoutMs: 10000,
          });
        } else {
          this.logger.error("poll error", {
            attempt: this.consecutiveErrors,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        this.scheduleNextPoll();
      }
    }, delay);
  }

  /**
   * Performs the actual RPC call to find new events.
   */
  private async poll(): Promise<void> {
    // Placeholder for RPC call to get events
    // Example (future implementation):
    // const results = await this.rpcService.getContractEvents({
    //   startLedger: this.lastLedgerPolled + 1,
    //   contractIds: [this.env.contractId],
    // });

    // For now, we mock the polling activity
    const mockEvents: ContractEvent[] = [];

    if (mockEvents.length > 0) {
      await this.handleBatch(mockEvents);
    }

    // Advance the "last polled" pointer (simulation)
    // Normally this would be updated based on the last event's ledger or the RPC's newest ledger.
    this.lastLedgerPolled += 1;

    // Persist new cursor
    await this.storage.saveCursor({
      lastLedger: this.lastLedgerPolled,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Processes a batch of events discovered during polling.
   * Deduplicates events based on event ID to handle overlapping poll windows.
   */
  private async handleBatch(events: ContractEvent[]): Promise<void> {
    this.logger.info(`processing batch of ${events.length} events`);
    
    let duplicateCount = 0;
    
    for (const event of events) {
      // Check if event has already been processed
      if (event.id && this.processedEventIds.has(event.id)) {
        duplicateCount++;
        this.logger.debug("skipping duplicate event", {
          eventId: event.id,
          topic: event.topic[0] ?? "unknown",
          ledger: (event as any).ledger ?? "unknown",
        });
        continue;
      }

      // Add event ID to processed set
      if (event.id) {
        this.processedEventIds.add(event.id);

        // Maintain bounded set size (FIFO eviction)
        if (this.processedEventIds.size > this.MAX_PROCESSED_IDS) {
          const firstId = this.processedEventIds.values().next().value;
          this.processedEventIds.delete(firstId);
          this.logger.debug("processedEventIds at capacity, removing oldest entry", {
            removedId: firstId,
            currentSize: this.processedEventIds.size,
          });
        }
      }

      // Process the event normally
      if (this.wsServer) {
        this.wsServer.broadcastEvent(event);
      }
      await this.processEvent(event);
    }

    // Log summary if duplicates were found
    if (duplicateCount > 0) {
      this.logger.debug("batch processing summary", {
        total: events.length,
        duplicates: duplicateCount,
        processed: events.length - duplicateCount,
      });
    }
  }

  /**
   * Normalizes and routes a single contract event to the appropriate consumer.
   * All event types from events.rs are handled; unknown topics are warned.
   */
  private async processEvent(event: ContractEvent): Promise<void> {
    const topic = event.topic[0] ?? "";
    try {
      const normalized = EventNormalizer.normalize(event);

      // Proposal events → proposalConsumer
      if (this.proposalConsumer && PROPOSAL_TOPICS.has(topic)) {
        await this.proposalConsumer.process(normalized);
        return;
      }

      // Snapshot events → snapshotService
      if (this.snapshotService && SnapshotNormalizer.isSnapshotEvent(normalized.type as any)) {
        try {
          await this.snapshotService.processEvent(normalized as any);
        } catch (error) {
          this.logger.error(`error processing snapshot event "${topic}"`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }

      // All other known topics are normalized and available for future consumers.
      // Unknown topics are already warned inside EventNormalizer.normalize().
      this.logger.debug("processed event", { topic, id: event.id });
    } catch (error) {
      this.logger.error(`error processing event "${topic}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Returns current service state for health monitoring.
   */
  public getStatus(): PollingState {
    return {
      lastLedgerPolled: this.lastLedgerPolled,
      isPolling: this.isRunning,
      errors: this.consecutiveErrors,
    };
  }
}
