import assert from "node:assert/strict";
import test from "node:test";

import { MetricsRegistry } from "../health/metrics.registry.js";
import { SorobanRpcError } from "../../shared/rpc/soroban-rpc.client.js";
import type {
  GetEventsParams,
  GetEventsResult,
  RawContractEvent,
} from "../../shared/rpc/soroban-rpc.types.js";
import type { ContractEvent } from "./events.types.js";
import {
  INDEXER_MODE_SWITCH_COUNTER,
  LedgerEventDeduper,
  StreamingEventIndexer,
  isRateLimitError,
  loadStreamingIndexerConfig,
  type EventPageSource,
  type EventStreamHandlers,
  type EventStreamSource,
  type IndexerMode,
  type ModeSwitchReason,
  type StreamingIndexerConfig,
} from "./streaming-indexer.js";

const CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await delay(5);
  }
}

function ev(ledger: number, n: number): RawContractEvent {
  const id = `${String(ledger).padStart(10, "0")}-${String(n).padStart(10, "0")}`;
  return {
    id,
    type: "contract",
    ledger,
    ledgerClosedAt: "2026-01-01T00:00:00Z",
    contractId: CONTRACT,
    topic: ["proposal_created"],
    value: { xdr: "AAAA" },
    pagingToken: id,
  };
}

/** Controllable stream: the test pushes events and drops the connection. */
class FakeStream implements EventStreamSource {
  handlers: EventStreamHandlers | null = null;
  subscribeCalls: number[] = [];
  closed = 0;
  failNext = 0;

  subscribe(params: { startLedger: number }, handlers: EventStreamHandlers) {
    this.subscribeCalls.push(params.startLedger);
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("ws connect refused");
    }
    this.handlers = handlers;
    return {
      close: () => {
        this.closed++;
      },
    };
  }

  push(...events: RawContractEvent[]): void {
    for (const e of events) this.handlers?.onEvent(e);
  }

  drop(): void {
    this.handlers?.onClose();
  }
}

/** Ledger-ordered event log served through paginated getEvents. */
class FakePages implements EventPageSource {
  calls: GetEventsParams[] = [];
  /** Throw on these call indices (0-based). */
  failOn = new Map<number, unknown>();

  constructor(public log: RawContractEvent[], public latestLedger = 100) {}

  async getEventsPage(params: GetEventsParams): Promise<GetEventsResult> {
    const index = this.calls.length;
    this.calls.push(params);
    const failure = this.failOn.get(index);
    if (failure !== undefined) throw failure;
    const limit = params.pagination?.limit ?? 100;
    const cursor = params.pagination?.cursor;
    let candidates = this.log.filter((e) => e.ledger >= params.startLedger);
    if (cursor) candidates = candidates.filter((e) => e.pagingToken > cursor);
    return { events: candidates.slice(0, limit), latestLedger: this.latestLedger };
  }
}

function harness(opts: {
  stream?: FakeStream;
  pages: FakePages;
  startLedger?: number;
  config?: Partial<StreamingIndexerConfig>;
}) {
  const projected: ContractEvent[] = [];
  const switches: Array<{ from: IndexerMode; to: IndexerMode; reason: ModeSwitchReason }> = [];
  const metrics = new MetricsRegistry();
  const indexer = new StreamingEventIndexer({
    contractIds: [CONTRACT],
    pageSource: opts.pages,
    streamSource: opts.stream,
    startLedger: opts.startLedger ?? 10,
    sink: (e) => {
      projected.push(e);
    },
    metrics,
    onModeChange: (from, to, reason) => switches.push({ from, to, reason }),
    config: {
      stallTimeoutMs: 10_000,
      streamRetryIntervalMs: 10_000,
      pollIntervalMs: 10_000,
      initialPageSize: 2,
      minPageSize: 1,
      maxPageSize: 8,
      pageGrowAfterSuccesses: 100,
      rateLimitBackoffMs: 5,
      ...opts.config,
    },
  });
  const uniqueKeys = () => new Set(projected.map((e) => `${e.ledger}:${e.id}`)).size;
  return { indexer, projected, switches, metrics, uniqueKeys };
}

test("prefers stream mode when a stream source is available", async () => {
  const stream = new FakeStream();
  const h = harness({ stream, pages: new FakePages([]) });
  await h.indexer.start();
  assert.equal(h.indexer.getStatus().mode, "stream");
  assert.deepEqual(h.switches[0], { from: "stopped", to: "stream", reason: "startup" });
  await h.indexer.stop();
});

test("falls back to poll when no stream source is configured", async () => {
  const pages = new FakePages([ev(10, 1)]);
  const h = harness({ pages, config: { pollIntervalMs: 10_000 } });
  await h.indexer.start();
  assert.equal(h.indexer.getStatus().mode, "poll");
  assert.equal(h.switches[0].reason, "stream_unavailable");
  await waitFor(() => h.projected.length === 1);
  await h.indexer.stop();
});

test("integration: stream drop mid-page falls back to poll without duplicates or gaps", async () => {
  // Ledger 11 has five events; the stream delivers only the first two before
  // dropping, i.e. in the middle of what poll mode will read as page 1.
  const log = [ev(10, 1), ev(11, 1), ev(11, 2), ev(11, 3), ev(11, 4), ev(11, 5), ev(12, 1)];
  const pages = new FakePages(log);
  // The second poll page fails once (RPC hiccup mid-pagination).
  pages.failOn.set(1, new Error("socket hang up"));
  const stream = new FakeStream();
  const h = harness({ stream, pages, config: { pollIntervalMs: 5 } });

  await h.indexer.start();
  stream.push(ev(10, 1), ev(11, 1), ev(11, 2));
  stream.drop();

  assert.equal(h.indexer.getStatus().mode, "poll");
  assert.equal(h.switches.at(-1)?.reason, "stream_disconnect");

  await waitFor(() => h.projected.length === log.length);
  await h.indexer.drain();
  // Poll must resume from the highest ledger seen, inclusive.
  assert.equal(pages.calls[0].startLedger, 11);
  assert.equal(h.uniqueKeys(), h.projected.length, "no duplicate projections");
  assert.deepEqual(
    h.projected.map((e) => e.id),
    log.map((e) => e.id),
  );
  assert.ok(h.indexer.getStatus().duplicatesSkipped >= 2);

  const snapshot = h.metrics.snapshot();
  const key = `${INDEXER_MODE_SWITCH_COUNTER}{from="stream",to="poll",reason="stream_disconnect"}`;
  assert.equal(snapshot.values.get(key), 1, "mode switch is observable in metrics");
  await h.indexer.stop();
});

test("flapping stream↔poll never projects an event twice", async () => {
  const log = [ev(20, 1), ev(20, 2), ev(21, 1), ev(21, 2), ev(22, 1)];
  const pages = new FakePages(log);
  const stream = new FakeStream();
  const h = harness({
    stream,
    pages,
    startLedger: 20,
    config: { pollIntervalMs: 5, streamRetryIntervalMs: 20 },
  });

  await h.indexer.start();
  for (let round = 0; round < 3; round++) {
    await waitFor(() => h.indexer.getStatus().mode === "stream");
    // Each reconnect replays the overlap from the highest ledger seen.
    stream.push(...log);
    stream.drop();
    await waitFor(() => h.indexer.getStatus().mode === "poll");
    await delay(15);
  }
  await waitFor(() => h.indexer.getStatus().mode === "stream");
  await h.indexer.drain();

  assert.ok(h.switches.length >= 6, "indexer flapped repeatedly");
  assert.equal(h.projected.length, log.length);
  assert.equal(h.uniqueKeys(), log.length);
  // Every resubscribe started at a ledger ≤ highest seen (inclusive resume).
  for (const start of stream.subscribeCalls.slice(1)) assert.ok(start <= 22);
  await h.indexer.stop();
});

test("stall watchdog switches to poll when the stream goes silent", async () => {
  const stream = new FakeStream();
  const h = harness({ stream, pages: new FakePages([]), config: { stallTimeoutMs: 20 } });
  await h.indexer.start();
  stream.handlers?.onHeartbeat?.();
  await waitFor(() => h.indexer.getStatus().mode === "poll");
  assert.equal(h.switches.at(-1)?.reason, "stream_stall");
  await h.indexer.stop();
});

test("failed resubscribe keeps polling and retries later", async () => {
  const stream = new FakeStream();
  stream.failNext = 2;
  const h = harness({
    stream,
    pages: new FakePages([ev(10, 1)]),
    config: { pollIntervalMs: 5, streamRetryIntervalMs: 10 },
  });
  await h.indexer.start();
  assert.equal(h.indexer.getStatus().mode, "poll");
  assert.equal(h.switches[0].reason, "stream_error");
  await waitFor(() => h.indexer.getStatus().mode === "stream");
  assert.equal(stream.subscribeCalls.length, 3);
  assert.equal(h.switches.at(-1)?.reason, "stream_recovered");
  await h.indexer.stop();
});

test("adaptive page size shrinks on rate limit and grows after successes", async () => {
  const log = Array.from({ length: 12 }, (_, i) => ev(30, i + 1));
  const pages = new FakePages(log);
  pages.failOn.set(0, new SorobanRpcError("RPC HTTP error: 429 Too Many Requests", 429));
  const h = harness({
    pages,
    startLedger: 30,
    config: { initialPageSize: 4, minPageSize: 1, maxPageSize: 8, pageGrowAfterSuccesses: 2, pollIntervalMs: 5 },
  });
  await h.indexer.start();
  await waitFor(() => h.projected.length === log.length);

  assert.equal(pages.calls[0].pagination?.limit, 4);
  assert.equal(pages.calls[1].pagination?.limit, 2, "halved after 429");
  const limits = pages.calls.map((c) => c.pagination?.limit ?? 0);
  assert.ok(Math.max(...limits.slice(2)) > 2, "grew back after successful pages");
  assert.equal(h.uniqueKeys(), log.length);
  await h.indexer.stop();
});

test("deduper keys by (ledger, event_id) and stays bounded", () => {
  const d = new LedgerEventDeduper(2);
  assert.equal(d.markIfNew(1, "a"), true);
  assert.equal(d.markIfNew(1, "a"), false);
  assert.equal(d.markIfNew(2, "a"), true, "same id on another ledger is distinct");
  d.markIfNew(3, "c");
  assert.equal(d.size, 2);
});

test("rate-limit detection and config knobs", () => {
  assert.equal(isRateLimitError(new SorobanRpcError("x", 429)), true);
  assert.equal(isRateLimitError(new Error("rate limit exceeded")), true);
  assert.equal(isRateLimitError(new SorobanRpcError("x", 503)), false);

  const cfg = loadStreamingIndexerConfig({
    INDEXER_STREAM_ENABLED: "false",
    INDEXER_STREAM_STALL_TIMEOUT_MS: "1500",
    INDEXER_PAGE_SIZE_MIN: "5",
    INDEXER_PAGE_SIZE_MAX: "50",
  });
  assert.equal(cfg.streamEnabled, false);
  assert.equal(cfg.stallTimeoutMs, 1500);
  assert.equal(cfg.minPageSize, 5);
  assert.equal(cfg.maxPageSize, 50);
  assert.throws(() =>
    loadStreamingIndexerConfig({ INDEXER_PAGE_SIZE_MIN: "60", INDEXER_PAGE_SIZE_MAX: "50" }),
  );
});
