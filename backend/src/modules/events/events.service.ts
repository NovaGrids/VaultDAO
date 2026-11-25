import { createLogger } from "../../shared/logging/logger.js";
import type { BackendEnv } from "../../config/env.js";
import type { ContractEvent, PollingState } from "./events.types.js";
import type { CursorStorage } from "./cursor/index.js";
import { CachingEventNormalizer } from "./normalizers/caching-event-normalizer.js";
import type { ProposalActivityConsumer } from "../proposals/consumer.js";
import type { EventWebSocketServer } from "../websocket/websocket.server.js";
import type { SnapshotService } from "../snapshots/snapshot.service.js";
import { SnapshotNormalizer } from "../snapshots/normalizer.js";
import { TimeoutError } from "../../shared/http/fetchWithTimeout.js";
import { SorobanRpcClient } from "../../shared/rpc/soroban-rpc.client.js";
import type { MetricsRegistry } from "../health/metrics.registry.js";
import DeadLetterService from "./deadletter.service.js";
import { CircuitBreaker } from "../../shared/http/circuit-breaker.js";
import type { CacheManager } from "../../shared/cache/cache-manager.js";

/** Maximum backoff delay: 5 minutes */
const MAX_BACKOFF_MS = 5 * 60 * 1000;

/** Maximum number of events to request per RPC page. */
const EVENTS_PAGE_LIMIT = 200;

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
  "recipient_list_changed",
  "recipient_list_bulk_changed",
  "proposal_amended",
  "proposal_from_template",
  "scheduled_proposal_cancelled",
  "delegated_vote",
  "voting_deadline_ext",
  "quorum_reached",
]);

export interface VaultPollingHealth {
  readonly contractId: string;
  readonly lastLedger: number;
  readonly lag: number;
  readonly consecutiveErrors: number;
  readonly lastErrorClass: string | null;
}

/**
 * EventPollingService
 *
 * A background service that polls the Soroban RPC for contract events.
 * Supports per-contract cursor persistence to resume safely across restarts,
 * bounded-concurrency multi-vault polling, and per-vault lag/error reporting.
 */
export class EventPollingService {
  private readonly logger = createLogger("events-service");
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private lastLedgerPolled: number = 0;
  private consecutiveErrors: number = 0;
  private processedEventIds: Set<string> = new Set();
  private readonly MAX_PROCESSED_IDS = 1000;
  private readonly rpcClient: SorobanRpcClient;
  private readonly cachingNormalizer: CachingEventNormalizer;
  private readonly perVaultStates: Map<string, VaultPollingHealth> = new Map();

  private readonly circuitBreaker: CircuitBreaker;

  constructor(
    private readonly env: BackendEnv,
    private readonly storage: CursorStorage,
    private readonly proposalConsumer?: ProposalActivityConsumer,
    private readonly wsServer?: EventWebSocketServer,
    private readonly snapshotService?: SnapshotService,
    rpcClient?: SorobanRpcClient,
    private readonly metrics?: MetricsRegistry,
    circuitBreaker?: CircuitBreaker,
    private readonly cacheManager?: CacheManager,
    private readonly deadLetterService?: DeadLetterService,
  ) {
    this.rpcClient =
      rpcClient ?? new SorobanRpcClient({ url: env.sorobanRpcUrl });
    this.circuitBreaker = circuitBreaker ?? new CircuitBreaker();
    this.cachingNormalizer = new CachingEventNormalizer(
      env.normalizerCacheMaxSize,
      metrics,
    );
  }

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
   *
   * On the very first run (`lastLedgerPolled === 0`) the service has no
   * starting point, so it fetches the current chain head and persists it as
   * the initial cursor without processing any historical events.
   *
   * On subsequent runs it pages through all events in the range
   * `[lastLedgerPolled + 1, latestLedger]` using cursor-based pagination,
   * then advances the cursor to `latestLedger`.
   */
  private async poll(): Promise<void> {
    // ── First-run initialisation ─────────────────────────────────────────────
    if (this.lastLedgerPolled === 0) {
      const result = await this.circuitBreaker.execute(() =>
        this.rpcClient.getLatestLedger(),
      );
      if (!result.success) {
        this.logger.warn("circuit breaker prevented getLatestLedger call", {
          state: result.state,
          error: result.error?.message,
        });
        throw result.error;
      }
      const latestLedger = result.data;
      if (latestLedger === undefined) {
        throw new Error("getLatestLedger returned no ledger");
      }
      this.logger.info(`initializing polling cursor at ledger ${latestLedger}`);
      await this.storage.saveCursor({
        lastLedger: latestLedger,
        updatedAt: new Date().toISOString(),
      });
      this.lastLedgerPolled = latestLedger;
      return;
    }

    // ── Paginated event fetch ────────────────────────────────────────────────
    const startLedger = this.lastLedgerPolled + 1;
    const allEvents: ContractEvent[] = [];
    let cursor: string | undefined;
    let latestLedger = this.lastLedgerPolled;

    do {
      const result = await this.circuitBreaker.execute(() =>
        this.rpcClient.getEventsPage({
          startLedger,
          filters: [
            {
              type: "contract",
              contractIds: [this.env.contractId],
            },
          ],
          pagination: {
            limit: EVENTS_PAGE_LIMIT,
            ...(cursor !== undefined ? { cursor } : {}),
          },
        }),
      );
      if (!result.success) {
        this.logger.warn("circuit breaker prevented getEventsPage call", {
          state: result.state,
          error: result.error?.message,
        });
        throw result.error;
      }
      const pageResult = result.data;
      if (!pageResult) {
        throw new Error("getEventsPage returned null result");
      }

      latestLedger = pageResult.latestLedger;

      allEvents.push(
        ...pageResult.events.map((raw) => ({
          id: raw.id,
          contractId: raw.contractId,
          topic: raw.topic,
          value: raw.value,
          ledger: raw.ledger,
          ledgerClosedAt: raw.ledgerClosedAt,
        })),
      );

      // Continue paginating when the page was full — there may be more events.
      cursor =
        pageResult.events.length === EVENTS_PAGE_LIMIT
          ? pageResult.events[pageResult.events.length - 1].pagingToken
          : undefined;
    } while (cursor !== undefined);

    if (allEvents.length > 0) {
      await this.handleBatch(allEvents);
    }

    await this.storage.saveCursor({
      lastLedger: latestLedger,
      updatedAt: new Date().toISOString(),
    });
    if (this.metrics) {
      this.metrics.setGauge(
        "vaultdao_polling_lag_ledgers",
        latestLedger - this.lastLedgerPolled,
      );
    }
    this.lastLedgerPolled = latestLedger;
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
          if (firstId !== undefined) {
            this.processedEventIds.delete(firstId);
            this.logger.debug(
              "processedEventIds at capacity, removing oldest entry",
              {
                removedId: firstId,
                currentSize: this.processedEventIds.size,
              },
            );
          }
        }
      }

      // Process the event normally
      if (this.wsServer) {
        this.wsServer.broadcastEvent(event);
      }

      // Increment events processed metric
      if (this.metrics) {
        this.metrics.incrementCounter("vaultdao_events_processed_total");
        this.metrics.incrementCounter("vaultdao_events_polled_total");
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
      const normalized = this.cachingNormalizer.normalize(event);

      // Tag-based cache invalidation for contract events (#1459)
      if (this.cacheManager) {
        if (PROPOSAL_TOPICS.has(topic)) {
          const proposalId = (normalized as any).proposalId ?? (normalized as any).id ?? event.topic[1];
          if (proposalId !== undefined) {
            this.cacheManager.invalidateProposal(proposalId);
          }
          this.cacheManager.invalidateSnapshots(event.contractId);
        }

        if (topic.includes("role") || topic.includes("signer")) {
          const address = (normalized as any).address ?? (normalized as any).account;
          if (address) {
            this.cacheManager.invalidateRole(address);
          }
        }

        if (topic === "cache_invalidated") {
          const tag = (normalized as any).tag ?? (event.value as any)?.tag ?? event.topic[1];
          if (tag) {
            this.cacheManager.invalidateByTag(String(tag), "on_chain_event");
          }
        }

        if (
          SnapshotNormalizer.isSnapshotEvent(normalized.type as any) ||
          topic.includes("config")
        ) {
          this.cacheManager.invalidateSnapshots(event.contractId);
        }
      }

      // Proposal events → proposalConsumer
      if (this.proposalConsumer && PROPOSAL_TOPICS.has(topic)) {
        await this.proposalConsumer.process(normalized);
        return;
      }

      // Dead-letter entries emitted by the contract — persist to backend DLQ
      if (topic === "dead_letter_added" && this.deadLetterService) {
        try {
          const recordIdRaw = event.topic[1] ?? (normalized as any).recordId ?? 0;
          const recordId = Number(recordIdRaw);
          const retryCount = (normalized as any).retryCount ?? 0;
          const dlEntry = {
            id: String(recordId),
            contractId: event.contractId,
            recordId,
            retryCount,
            addedAt: Date.now(),
            processed: false,
          };
          this.deadLetterService.add(dlEntry as any);
        } catch (err) {
          this.logger.error("failed to persist dead-letter entry", { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      // Snapshot events → snapshotService
      if (
        this.snapshotService &&
        SnapshotNormalizer.isSnapshotEvent(normalized.type as any)
      ) {
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

  /**
   * Returns the circuit breaker instance used by this service.
   */
  public getCircuitBreaker(): CircuitBreaker | undefined {
    return this.circuitBreaker;
  }

  /**
   * Returns the configured list of vault contract IDs to index.
   */
  public getTargetContractIds(): string[] {
    if (this.env.contractIds && this.env.contractIds.length > 0) {
      return this.env.contractIds;
    }
    return this.env.contractId ? [this.env.contractId] : [];
  }

  /**
   * Returns per-vault polling health (lastLedger, lag, consecutiveErrors, lastErrorClass).
   */
  public getPerVaultStates(): Record<string, VaultPollingHealth> {
    const out: Record<string, VaultPollingHealth> = {};
    for (const [id, state] of this.perVaultStates.entries()) {
      out[id] = state;
    }
    return out;
  }

  private classifyError(error: unknown): string {
    if (error instanceof TimeoutError) return "timeout";
    const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (msg.includes("circuit")) return "circuit_open";
    if (msg.includes("timeout")) return "timeout";
    if (msg.includes("rpc") || msg.includes("fetch") || msg.includes("network")) return "rpc_error";
    return "unknown";
  }

  /**
   * Polls all configured vault contracts with bounded concurrency (`indexingParallelism`).
   * One vault's RPC outage/timeout does not stall other vaults, and cursors fail closed
   * on partial page failures.
   */
  public async pollAllContracts(): Promise<void> {
    const targets = this.getTargetContractIds();
    const concurrency = Math.max(1, this.env.indexingParallelism || 1);

    for (let i = 0; i < targets.length; i += concurrency) {
      const batch = targets.slice(i, i + concurrency);
      await Promise.allSettled(batch.map((contractId) => this.pollContract(contractId)));
    }
  }

  /**
   * Polls a single vault contract using its own isolated cursor.
   * Fails closed: if any page fails, the cursor is not advanced.
   */
  public async pollContract(contractId: string): Promise<void> {
    const prev = this.perVaultStates.get(contractId) ?? {
      contractId,
      lastLedger: 0,
      lag: 0,
      consecutiveErrors: 0,
      lastErrorClass: null,
    };

    try {
      const existingCursor = this.storage.getCursorForContract
        ? await this.storage.getCursorForContract(contractId)
        : await this.storage.getCursor();

      let lastLedger = existingCursor?.lastLedger ?? prev.lastLedger;

      if (lastLedger === 0) {
        const headResult = await this.circuitBreaker.execute(() =>
          this.rpcClient.getLatestLedger(),
        );
        if (!headResult.success || headResult.data === undefined) {
          throw headResult.error ?? new Error("getLatestLedger returned no ledger");
        }
        lastLedger = headResult.data;
        const cursorObj = { lastLedger, updatedAt: new Date().toISOString() };
        if (this.storage.saveCursorForContract) {
          await this.storage.saveCursorForContract(contractId, cursorObj);
        } else {
          await this.storage.saveCursor(cursorObj);
        }
        this.perVaultStates.set(contractId, {
          contractId,
          lastLedger,
          lag: 0,
          consecutiveErrors: 0,
          lastErrorClass: null,
        });
        return;
      }

      const startLedger = lastLedger + 1;
      const allEvents: ContractEvent[] = [];
      let cursor: string | undefined;
      let latestLedger = lastLedger;

      do {
        const result = await this.circuitBreaker.execute(() =>
          this.rpcClient.getEventsPage({
            startLedger,
            filters: [{ type: "contract", contractIds: [contractId] }],
            pagination: {
              limit: EVENTS_PAGE_LIMIT,
              ...(cursor !== undefined ? { cursor } : {}),
            },
          }),
        );
        if (!result.success || !result.data) {
          throw result.error ?? new Error("getEventsPage failed");
        }

        latestLedger = result.data.latestLedger;
        allEvents.push(
          ...result.data.events.map((raw) => ({
            id: raw.id,
            contractId: raw.contractId,
            topic: raw.topic,
            value: raw.value,
            ledger: raw.ledger,
            ledgerClosedAt: raw.ledgerClosedAt,
          })),
        );

        cursor =
          result.data.events.length === EVENTS_PAGE_LIMIT
            ? result.data.events[result.data.events.length - 1].pagingToken
            : undefined;
      } while (cursor !== undefined);

      if (allEvents.length > 0) {
        await this.handleBatch(allEvents);
      }

      const nextCursor = { lastLedger: latestLedger, updatedAt: new Date().toISOString() };
      if (this.storage.saveCursorForContract) {
        await this.storage.saveCursorForContract(contractId, nextCursor);
      } else {
        await this.storage.saveCursor(nextCursor);
      }

      const lag = Math.max(0, latestLedger - lastLedger);
      this.perVaultStates.set(contractId, {
        contractId,
        lastLedger: latestLedger,
        lag,
        consecutiveErrors: 0,
        lastErrorClass: null,
      });
    } catch (error) {
      this.perVaultStates.set(contractId, {
        contractId,
        lastLedger: prev.lastLedger,
        lag: prev.lag,
        consecutiveErrors: prev.consecutiveErrors + 1,
        lastErrorClass: this.classifyError(error),
      });
      throw error;
    }
  }
}
