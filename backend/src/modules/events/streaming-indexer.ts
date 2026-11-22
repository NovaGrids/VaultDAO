import { createLogger } from "../../shared/logging/logger.js";
import { SorobanRpcError } from "../../shared/rpc/soroban-rpc.client.js";
import type {
  GetEventsParams,
  GetEventsResult,
  RawContractEvent,
} from "../../shared/rpc/soroban-rpc.types.js";
import type { MetricsRegistry } from "../health/metrics.registry.js";
import type { ContractEvent } from "./events.types.js";

/**
 * Streaming-first Soroban event indexer with automatic fallback to paginated
 * `getEvents` polling (#2049).
 *
 * - **stream mode** (preferred): events are pushed by an {@link EventStreamSource}.
 *   A watchdog detects stalls (no event / heartbeat for `stallTimeoutMs`) and
 *   disconnects, then switches to poll mode.
 * - **poll mode** (fallback): pages through `getEvents` from the last ledger
 *   seen. Page size adapts to rate limits (halved on 429, grown after a run of
 *   successful pages). While polling, the indexer periodically retries the
 *   stream and switches back when it reconnects.
 *
 * Every event, regardless of the mode that delivered it, passes through one
 * dedupe window keyed by `(ledger, event_id)`, so flapping stream↔poll never
 * produces duplicate projections. Both modes resume from the highest ledger
 * seen (inclusive) so a drop in the middle of a ledger or page never loses
 * events; the overlap is absorbed by the dedupe window.
 */

export type IndexerMode = "stream" | "poll" | "stopped";

export type ModeSwitchReason =
  | "startup"
  | "stream_unavailable"
  | "stream_stall"
  | "stream_disconnect"
  | "stream_error"
  | "stream_recovered"
  | "stopped";

export interface EventStreamHandlers {
  /** A raw event pushed by the stream. */
  onEvent(event: RawContractEvent): void;
  /** Liveness signal without an event (keeps the stall watchdog quiet). */
  onHeartbeat?(): void;
  /** The stream failed; the indexer will fall back to polling. */
  onError(error: unknown): void;
  /** The stream closed; the indexer will fall back to polling. */
  onClose(): void;
}

export interface EventStreamSubscription {
  close(): void;
}

/**
 * RPC stream/subscribe transport. Implementations wrap whatever push channel
 * the RPC provider exposes (WebSocket subscription, SSE, ...). When the
 * provider has no streaming support, omit the source and the indexer runs in
 * poll mode only.
 */
export interface EventStreamSource {
  subscribe(
    params: { readonly startLedger: number; readonly contractIds: string[] },
    handlers: EventStreamHandlers,
  ): EventStreamSubscription | Promise<EventStreamSubscription>;
}

/** Paginated `getEvents` transport — satisfied by `SorobanRpcClient`. */
export interface EventPageSource {
  getEventsPage(params: GetEventsParams): Promise<GetEventsResult>;
}

export interface StreamingIndexerConfig {
  /** Prefer the stream when a stream source is configured. */
  readonly streamEnabled: boolean;
  /** No event/heartbeat for this long in stream mode ⇒ stall ⇒ poll. */
  readonly stallTimeoutMs: number;
  /** While polling, retry the stream this often. */
  readonly streamRetryIntervalMs: number;
  /** Delay between poll cycles in poll mode. */
  readonly pollIntervalMs: number;
  /** Starting `getEvents` page size. */
  readonly initialPageSize: number;
  /** Lower bound for the adaptive page size. */
  readonly minPageSize: number;
  /** Upper bound for the adaptive page size. */
  readonly maxPageSize: number;
  /** Successful pages in a row before the page size is grown again. */
  readonly pageGrowAfterSuccesses: number;
  /** Extra delay applied after a rate-limited page request. */
  readonly rateLimitBackoffMs: number;
  /** Number of `(ledger, event_id)` keys remembered for dedupe. */
  readonly dedupeWindowSize: number;
}

export const DEFAULT_STREAMING_INDEXER_CONFIG: StreamingIndexerConfig = {
  streamEnabled: true,
  stallTimeoutMs: 30_000,
  streamRetryIntervalMs: 60_000,
  pollIntervalMs: 10_000,
  initialPageSize: 200,
  minPageSize: 10,
  maxPageSize: 1_000,
  pageGrowAfterSuccesses: 5,
  rateLimitBackoffMs: 2_000,
  dedupeWindowSize: 10_000,
};

function readPositiveInt(
  source: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = source[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer. Received "${raw}".`);
  }
  return parsed;
}

/**
 * Reads the indexer config knobs from the environment. See
 * `docs/guides/backend/STREAMING_INDEXER.md` for the full list.
 */
export function loadStreamingIndexerConfig(
  source: NodeJS.ProcessEnv = process.env,
): StreamingIndexerConfig {
  const d = DEFAULT_STREAMING_INDEXER_CONFIG;
  const config: StreamingIndexerConfig = {
    streamEnabled:
      (source.INDEXER_STREAM_ENABLED?.trim() ?? String(d.streamEnabled)) !==
      "false",
    stallTimeoutMs: readPositiveInt(source, "INDEXER_STREAM_STALL_TIMEOUT_MS", d.stallTimeoutMs),
    streamRetryIntervalMs: readPositiveInt(source, "INDEXER_STREAM_RETRY_INTERVAL_MS", d.streamRetryIntervalMs),
    pollIntervalMs: readPositiveInt(source, "INDEXER_POLL_INTERVAL_MS", d.pollIntervalMs),
    initialPageSize: readPositiveInt(source, "INDEXER_PAGE_SIZE_INITIAL", d.initialPageSize),
    minPageSize: readPositiveInt(source, "INDEXER_PAGE_SIZE_MIN", d.minPageSize),
    maxPageSize: readPositiveInt(source, "INDEXER_PAGE_SIZE_MAX", d.maxPageSize),
    pageGrowAfterSuccesses: readPositiveInt(source, "INDEXER_PAGE_GROW_AFTER", d.pageGrowAfterSuccesses),
    rateLimitBackoffMs: readPositiveInt(source, "INDEXER_RATE_LIMIT_BACKOFF_MS", d.rateLimitBackoffMs),
    dedupeWindowSize: readPositiveInt(source, "INDEXER_DEDUPE_WINDOW", d.dedupeWindowSize),
  };
  if (config.minPageSize > config.maxPageSize) {
    throw new Error("INDEXER_PAGE_SIZE_MIN must not exceed INDEXER_PAGE_SIZE_MAX.");
  }
  return config;
}

/** True when an RPC error means "slow down" rather than "broken". */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof SorobanRpcError && error.status === 429) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|rate.?limit|too many requests/i.test(message);
}

/** Bounded FIFO set of `(ledger, event_id)` keys shared by both modes. */
export class LedgerEventDeduper {
  private readonly seen = new Set<string>();

  constructor(private readonly capacity: number) {}

  static key(ledger: number, id: string): string {
    return `${ledger}:${id}`;
  }

  /** Records the key; returns false when it was already seen. */
  markIfNew(ledger: number, id: string): boolean {
    const key = LedgerEventDeduper.key(ledger, id);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > this.capacity) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }

  get size(): number {
    return this.seen.size;
  }
}

export interface StreamingEventIndexerOptions {
  readonly contractIds: string[];
  readonly pageSource: EventPageSource;
  readonly streamSource?: EventStreamSource;
  /** Projection sink; called once per unique `(ledger, event_id)`. */
  readonly sink: (event: ContractEvent) => Promise<void> | void;
  /** First ledger to index (inclusive). */
  readonly startLedger: number;
  readonly config?: Partial<StreamingIndexerConfig>;
  readonly metrics?: MetricsRegistry;
  /** Called after each mode switch (tests / external observers). */
  readonly onModeChange?: (
    from: IndexerMode,
    to: IndexerMode,
    reason: ModeSwitchReason,
  ) => void;
}

export interface StreamingIndexerStatus {
  readonly mode: IndexerMode;
  readonly highestLedger: number;
  readonly pageSize: number;
  readonly modeSwitches: number;
  readonly duplicatesSkipped: number;
  readonly eventsProjected: number;
}

export const INDEXER_MODE_GAUGE = "vaultdao_indexer_mode";
export const INDEXER_MODE_SWITCH_COUNTER = "vaultdao_indexer_mode_switch_total";
export const INDEXER_DUPLICATE_COUNTER = "vaultdao_indexer_duplicates_skipped_total";
export const INDEXER_RATE_LIMITED_COUNTER = "vaultdao_indexer_rate_limited_total";
export const INDEXER_PAGE_SIZE_GAUGE = "vaultdao_indexer_page_size";

function toContractEvent(raw: RawContractEvent): ContractEvent {
  return {
    id: raw.id,
    contractId: raw.contractId,
    topic: raw.topic,
    value: raw.value,
    ledger: raw.ledger,
    ledgerClosedAt: raw.ledgerClosedAt,
  };
}

export class StreamingEventIndexer {
  private readonly logger = createLogger("streaming-indexer");
  private readonly config: StreamingIndexerConfig;
  private readonly deduper: LedgerEventDeduper;

  private mode: IndexerMode = "stopped";
  private running = false;
  private highestLedger: number;
  private pageSize: number;
  private successfulPagesInRow = 0;
  private modeSwitches = 0;
  private duplicatesSkipped = 0;
  private eventsProjected = 0;

  /** Incremented on every mode switch; stale callbacks compare against it. */
  private generation = 0;
  private subscription: EventStreamSubscription | null = null;
  private stallTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private streamRetryTimer: NodeJS.Timeout | null = null;
  /** Serialises sink calls so projections stay in delivery order. */
  private sinkChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: StreamingEventIndexerOptions) {
    this.config = { ...DEFAULT_STREAMING_INDEXER_CONFIG, ...options.config };
    this.deduper = new LedgerEventDeduper(this.config.dedupeWindowSize);
    this.highestLedger = options.startLedger;
    this.pageSize = this.clampPageSize(this.config.initialPageSize);

    const m = options.metrics;
    if (m) {
      m.register(INDEXER_MODE_GAUGE, "Current indexer mode (1 = active) by mode label", "gauge");
      m.register(INDEXER_MODE_SWITCH_COUNTER, "Indexer stream/poll mode switches", "counter");
      m.register(INDEXER_DUPLICATE_COUNTER, "Events skipped by the (ledger, event_id) dedupe window", "counter");
      m.register(INDEXER_RATE_LIMITED_COUNTER, "getEvents pages rejected by RPC rate limiting", "counter");
      m.register(INDEXER_PAGE_SIZE_GAUGE, "Current adaptive getEvents page size", "gauge");
      m.setGauge(INDEXER_PAGE_SIZE_GAUGE, this.pageSize);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  public async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    if (this.canStream()) {
      await this.enterStream("startup");
    } else {
      this.enterPoll(this.options.streamSource ? "startup" : "stream_unavailable");
    }
  }

  public async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.switchMode("stopped", "stopped");
    this.teardown();
    await this.sinkChain;
  }

  public getStatus(): StreamingIndexerStatus {
    return {
      mode: this.mode,
      highestLedger: this.highestLedger,
      pageSize: this.pageSize,
      modeSwitches: this.modeSwitches,
      duplicatesSkipped: this.duplicatesSkipped,
      eventsProjected: this.eventsProjected,
    };
  }

  /** Resolves once every event delivered so far has reached the sink. */
  public async drain(): Promise<void> {
    await this.sinkChain;
  }

  // ── Stream mode ────────────────────────────────────────────────────────────

  private canStream(): boolean {
    return this.config.streamEnabled && this.options.streamSource !== undefined;
  }

  private async enterStream(reason: ModeSwitchReason): Promise<void> {
    const source = this.options.streamSource;
    if (!source) {
      this.enterPoll("stream_unavailable");
      return;
    }

    // Subscribe before tearing down polling so a failed reconnect keeps
    // polling running uninterrupted.
    const attemptGeneration = this.generation;
    const pending = this.streamHandlers(attemptGeneration + 1);
    let subscription: EventStreamSubscription;
    try {
      subscription = await source.subscribe(
        {
          // Inclusive: a drop mid-ledger must not lose the ledger's tail.
          startLedger: this.highestLedger,
          contractIds: this.options.contractIds,
        },
        pending.handlers,
      );
      if (pending.failed()) throw new Error("stream closed during subscribe");
    } catch (error) {
      this.logger.warn("stream subscribe failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (!this.running || this.generation !== attemptGeneration) return;
      if (this.mode === "stopped") {
        this.enterPoll("stream_error");
      } else if (this.mode === "poll") {
        this.scheduleStreamRetry();
      }
      return;
    }

    // stop() or another switch happened while subscribing.
    if (!this.running || this.generation !== attemptGeneration) {
      subscription.close();
      return;
    }

    this.teardown();
    this.switchMode("stream", reason);
    this.subscription = subscription;
    this.armStallWatchdog();
    pending.activate();
  }

  /**
   * Builds stream callbacks bound to one subscription attempt. Events pushed
   * before the attempt is activated (e.g. during `subscribe()`) are buffered
   * and flushed on activation; callbacks from superseded subscriptions are
   * ignored.
   */
  private streamHandlers(generation: number): {
    handlers: EventStreamHandlers;
    activate(): void;
    failed(): boolean;
  } {
    let activated = false;
    let failedEarly = false;
    const buffer: RawContractEvent[] = [];
    const live = () => activated && this.generation === generation && this.mode === "stream";
    const lost = (reason: ModeSwitchReason, error?: unknown) => {
      if (!activated) {
        failedEarly = true;
        return;
      }
      if (!live()) return;
      this.logger.warn("stream lost, falling back to polling", {
        reason,
        ...(error !== undefined
          ? { error: error instanceof Error ? error.message : String(error) }
          : {}),
      });
      this.enterPoll(reason);
    };
    return {
      handlers: {
        onEvent: (raw) => {
          if (!activated) {
            if (!failedEarly) buffer.push(raw);
            return;
          }
          if (!live()) return;
          this.armStallWatchdog();
          this.accept(raw);
        },
        onHeartbeat: () => {
          if (!live()) return;
          this.armStallWatchdog();
        },
        onError: (error) => lost("stream_error", error),
        onClose: () => lost("stream_disconnect"),
      },
      activate: () => {
        activated = true;
        for (const raw of buffer.splice(0)) this.accept(raw);
      },
      failed: () => failedEarly,
    };
  }

  private armStallWatchdog(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    const generation = this.generation;
    this.stallTimer = setTimeout(() => {
      if (this.generation !== generation || this.mode !== "stream") return;
      this.logger.warn("stream stalled, falling back to polling", {
        stallTimeoutMs: this.config.stallTimeoutMs,
        highestLedger: this.highestLedger,
      });
      this.enterPoll("stream_stall");
    }, this.config.stallTimeoutMs);
  }

  // ── Poll mode ──────────────────────────────────────────────────────────────

  private enterPoll(reason: ModeSwitchReason): void {
    if (!this.running) return;
    this.teardown();
    this.switchMode("poll", reason);
    this.schedulePoll(0);
    if (this.canStream()) this.scheduleStreamRetry();
  }

  private schedulePoll(delayMs: number): void {
    if (this.mode !== "poll") return;
    const generation = this.generation;
    this.pollTimer = setTimeout(async () => {
      if (this.generation !== generation || this.mode !== "poll") return;
      let nextDelay = this.config.pollIntervalMs;
      try {
        await this.pollOnce(generation);
      } catch (error) {
        if (isRateLimitError(error)) {
          nextDelay = this.config.rateLimitBackoffMs;
        } else {
          this.logger.error("poll cycle failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (this.generation === generation) this.schedulePoll(nextDelay);
      }
    }, delayMs);
  }

  private scheduleStreamRetry(): void {
    if (this.streamRetryTimer) clearTimeout(this.streamRetryTimer);
    const generation = this.generation;
    this.streamRetryTimer = setTimeout(() => {
      if (this.generation !== generation || this.mode !== "poll") return;
      void this.enterStream("stream_recovered");
    }, this.config.streamRetryIntervalMs);
  }

  /**
   * Pages through `getEvents` from the highest ledger seen (inclusive) up to
   * the chain head. Exposed for tests; normally driven by the poll timer.
   */
  public async pollOnce(generation: number = this.generation): Promise<void> {
    let cursor: string | undefined;
    const startLedger = this.highestLedger;

    do {
      if (this.generation !== generation) return; // switched mid-page
      const limit = this.pageSize;
      let page: GetEventsResult;
      try {
        page = await this.options.pageSource.getEventsPage({
          startLedger,
          filters: [{ type: "contract", contractIds: this.options.contractIds }],
          pagination: { limit, ...(cursor !== undefined ? { cursor } : {}) },
        });
      } catch (error) {
        if (isRateLimitError(error)) this.onRateLimited();
        throw error;
      }
      this.onPageSuccess();

      // A stream that recovered mid-page owns delivery now; dropping the rest
      // of the page is safe because the stream resumed from highestLedger.
      if (this.generation !== generation) return;

      for (const raw of page.events) this.accept(raw);

      cursor =
        page.events.length === limit && page.events.length > 0
          ? page.events[page.events.length - 1].pagingToken
          : undefined;
    } while (cursor !== undefined);

    await this.sinkChain;
  }

  private onRateLimited(): void {
    const previous = this.pageSize;
    this.pageSize = this.clampPageSize(Math.floor(this.pageSize / 2));
    this.successfulPagesInRow = 0;
    this.options.metrics?.incrementCounter(INDEXER_RATE_LIMITED_COUNTER);
    this.options.metrics?.setGauge(INDEXER_PAGE_SIZE_GAUGE, this.pageSize);
    this.logger.warn("getEvents rate limited, shrinking page size", {
      from: previous,
      to: this.pageSize,
    });
  }

  private onPageSuccess(): void {
    this.successfulPagesInRow++;
    if (
      this.successfulPagesInRow >= this.config.pageGrowAfterSuccesses &&
      this.pageSize < this.config.maxPageSize
    ) {
      this.pageSize = this.clampPageSize(this.pageSize * 2);
      this.successfulPagesInRow = 0;
      this.options.metrics?.setGauge(INDEXER_PAGE_SIZE_GAUGE, this.pageSize);
      this.logger.debug("growing getEvents page size", { to: this.pageSize });
    }
  }

  private clampPageSize(size: number): number {
    return Math.max(this.config.minPageSize, Math.min(this.config.maxPageSize, size));
  }

  // ── Shared ─────────────────────────────────────────────────────────────────

  /** Dedupe by `(ledger, event_id)` and enqueue for the sink. */
  private accept(raw: RawContractEvent): void {
    if (!this.deduper.markIfNew(raw.ledger, raw.id)) {
      this.duplicatesSkipped++;
      this.options.metrics?.incrementCounter(INDEXER_DUPLICATE_COUNTER, { mode: this.mode });
      return;
    }
    if (raw.ledger > this.highestLedger) this.highestLedger = raw.ledger;
    const event = toContractEvent(raw);
    this.sinkChain = this.sinkChain
      .then(() => this.options.sink(event))
      .then(() => {
        this.eventsProjected++;
      })
      .catch((error) => {
        this.logger.error("projection sink failed", {
          eventId: event.id,
          ledger: event.ledger,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  private switchMode(to: IndexerMode, reason: ModeSwitchReason): void {
    const from = this.mode;
    this.generation++;
    if (from === to) return;
    this.mode = to;
    this.modeSwitches++;

    this.logger.info("indexer mode switch", {
      from,
      to,
      reason,
      highestLedger: this.highestLedger,
    });
    const m = this.options.metrics;
    if (m) {
      m.incrementCounter(INDEXER_MODE_SWITCH_COUNTER, { from, to, reason });
      m.setGauge(INDEXER_MODE_GAUGE, to === "stream" ? 1 : 0, { mode: "stream" });
      m.setGauge(INDEXER_MODE_GAUGE, to === "poll" ? 1 : 0, { mode: "poll" });
    }
    this.options.onModeChange?.(from, to, reason);
  }

  private teardown(): void {
    if (this.subscription) {
      this.subscription.close();
      this.subscription = null;
    }
    for (const timer of [this.stallTimer, this.pollTimer, this.streamRetryTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.stallTimer = null;
    this.pollTimer = null;
    this.streamRetryTimer = null;
  }
}
