import type { BackendEnv } from "../../config/env.js";
import type { ContractEvent, PollingState } from "./events.types.js";
import type { CursorStorage } from "./cursor/index.js";
import { EventNormalizer } from "./normalizers/index.js";
import type { ProposalActivityConsumer } from "../proposals/consumer.js";
import type { EventWebSocketServer } from "../websocket/websocket.server.js";
import type { SnapshotService } from "../snapshots/snapshot.service.js";
import { SnapshotNormalizer } from "../snapshots/normalizer.js";

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
 */
export class EventPollingService {
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private lastLedgerPolled: number = 0;
  private consecutiveErrors: number = 0;

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
      console.log("[events-service] event polling is disabled in config");
      return;
    }

    // Load last cursor from storage
    const lastCursor = await this.storage.getCursor();
    if (lastCursor) {
      this.lastLedgerPolled = lastCursor.lastLedger;
      console.log(
        `[events-service] resuming from cursor: ledger ${this.lastLedgerPolled}`,
      );
    } else {
      // Default to 0 or a safe starter ledger from env
      this.lastLedgerPolled = 0;
      console.log(
        "[events-service] no cursor found, starting from default ledger 0",
      );
    }

    this.isRunning = true;
    console.log("[events-service] starting event polling loop");
    console.log(`- rpc: ${this.env.sorobanRpcUrl}`);
    console.log(`- contract: ${this.env.contractId}`);
    console.log(`- interval: ${this.env.eventPollingIntervalMs}ms`);

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
    console.log("[events-service] stopped event polling loop");
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
      console.log(
        `[events-service] scheduling next poll with backoff in ${delay}ms (attempt ${this.consecutiveErrors}, multiplier: 2^${this.consecutiveErrors})`,
      );
    }

    this.timer = setTimeout(async () => {
      // Re-check running state in case stop() was called during timer wait
      if (!this.isRunning) return;

      try {
        await this.poll();
        this.consecutiveErrors = 0;
      } catch (error) {
        this.consecutiveErrors++;
        console.error(
          `[events-service] poll error (attempt ${this.consecutiveErrors}):`,
          error,
        );
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
   */
  private async handleBatch(events: ContractEvent[]): Promise<void> {
    console.log(`[events-service] processing batch of ${events.length} events`);
    for (const event of events) {
      if (this.wsServer) {
        this.wsServer.broadcastEvent(event);
      }
      await this.processEvent(event);
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
          console.error(`[events-service] error processing snapshot event "${topic}":`, error);
        }
        return;
      }

      // All other known topics are normalized and available for future consumers.
      // Unknown topics are already warned inside EventNormalizer.normalize().
      console.debug(`[events-service] processed event: ${topic} (id: ${event.id})`);
    } catch (error) {
      console.error(`[events-service] error processing event "${topic}":`, error);
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
