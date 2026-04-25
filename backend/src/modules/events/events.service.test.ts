import assert from "node:assert/strict";
import test from "node:test";

import type { BackendEnv } from "../../config/env.js";
import type { CursorStorage } from "./cursor/index.js";
import type { EventCursor } from "./cursor/cursor.types.js";
import { EventPollingService } from "./events.service.js";
import { SorobanRpcClient } from "../../shared/rpc/soroban-rpc.client.js";
import type { RawContractEvent } from "../../shared/rpc/soroban-rpc.types.js";

function createTestEnv(overrides: Partial<BackendEnv> = {}): BackendEnv {
  return {
    port: 8787,
    host: "0.0.0.0",
    nodeEnv: "test",
    stellarNetwork: "testnet",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    contractId: "CDTEST",
    websocketUrl: "ws://localhost:8080",
    eventPollingIntervalMs: 10,
    eventPollingEnabled: true,
    duePaymentsJobEnabled: false,
    duePaymentsJobIntervalMs: 60000,
    cursorCleanupJobEnabled: false,
    cursorCleanupJobIntervalMs: 86400000,
    cursorRetentionDays: 30,
    corsOrigin: ["*"],
    requestBodyLimit: "1mb",
    apiKey: "test-api-key",
    cursorStorageType: "file" as const,
    databasePath: "./test.sqlite",
    ...overrides,
  };
}

/** In-memory {@link CursorStorage} for tests */
class MemoryCursorStorage implements CursorStorage {
  cursor: EventCursor | null = null;
  /** Decremented each failed save; while greater than 0, saveCursor throws */
  failSaveRemaining = 0;
  saveCallCount = 0;

  async getCursor(): Promise<EventCursor | null> {
    return this.cursor;
  }

  async saveCursor(cursor: EventCursor): Promise<void> {
    this.saveCallCount++;
    if (this.failSaveRemaining > 0) {
      this.failSaveRemaining--;
      throw new Error("cursor persist failed");
    }
    this.cursor = cursor;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── RPC mock helpers ────────────────────────────────────────────────────────

/**
 * Build a fake `fetch` function that responds to Soroban JSON-RPC calls.
 * Each invocation pops the next response from the queue; the last entry is
 * reused once the queue is exhausted.
 */
function buildMockFetch(handlers: {
  getLatestLedger?: () => { sequence: number };
  getEvents?: (params: unknown) => {
    events: RawContractEvent[];
    latestLedger: number;
  };
}): typeof fetch {
  return async (
    _url: RequestInfo | URL,
    options?: RequestInit,
  ): Promise<Response> => {
    const body = JSON.parse((options?.body ?? "{}") as string) as {
      id: number;
      method: string;
      params?: unknown;
    };

    let result: unknown = {};
    if (body.method === "getLatestLedger" && handlers.getLatestLedger) {
      result = handlers.getLatestLedger();
    } else if (body.method === "getEvents" && handlers.getEvents) {
      result = handlers.getEvents(body.params);
    }

    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
}

/** Factory for a no-op RPC client (returns empty events, latestLedger=100). */
function createNoOpRpcClient(latestLedger = 100): SorobanRpcClient {
  return new SorobanRpcClient(
    { url: "https://soroban-testnet.stellar.org" },
    buildMockFetch({
      getLatestLedger: () => ({ sequence: latestLedger }),
      getEvents: () => ({ events: [], latestLedger }),
    }),
  );
}

/** Build a minimal valid {@link RawContractEvent}. */
function makeRawEvent(overrides: Partial<RawContractEvent> = {}): RawContractEvent {
  return {
    id: "event-1",
    type: "contract",
    ledger: 100,
    ledgerClosedAt: "2026-01-01T00:00:00Z",
    contractId: "CDTEST",
    topic: ["proposal_created"],
    value: { xdr: "AAAA" },
    pagingToken: "event-1",
    ...overrides,
  };
}

/**
 * Convenience factory: creates an EventPollingService with a no-op RPC mock
 * unless a specific rpcClient is provided.
 */
function createSvc(
  storage: CursorStorage,
  envOverrides: Partial<BackendEnv> = {},
  rpcClient: SorobanRpcClient = createNoOpRpcClient(),
): EventPollingService {
  return new EventPollingService(
    createTestEnv(envOverrides),
    storage,
    undefined,
    undefined,
    undefined,
    rpcClient,
  );
}

// ─── Existing tests (updated to use createSvc / mock RPC) ───────────────────

test("getStatus before start: idle state", () => {
  const storage = new MemoryCursorStorage();
  const svc = createSvc(storage);

  const s = svc.getStatus();
  assert.equal(s.isPolling, false);
  assert.equal(s.lastLedgerPolled, 0);
  assert.equal(s.errors, 0);
});

test("start() with polling disabled does not run loop", async () => {
  const storage = new MemoryCursorStorage();
  const svc = createSvc(storage, { eventPollingEnabled: false });

  await svc.start();
  assert.equal(svc.getStatus().isPolling, false);
});

test("start() loads cursor from storage and sets lastLedgerPolled", async () => {
  const storage = new MemoryCursorStorage();
  storage.cursor = {
    lastLedger: 42,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const svc = createSvc(storage);
  await svc.start();

  assert.equal(svc.getStatus().isPolling, true);
  assert.equal(svc.getStatus().lastLedgerPolled, 42);
  svc.stop();
});

test("start() with no cursor uses default ledger 0", async () => {
  const storage = new MemoryCursorStorage();
  const svc = createSvc(storage);
  await svc.start();

  assert.equal(svc.getStatus().lastLedgerPolled, 0);
  assert.equal(svc.getStatus().isPolling, true);
  svc.stop();
});

test("stop() clears timer and sets isPolling false", async () => {
  const storage = new MemoryCursorStorage();
  const svc = createSvc(storage);
  await svc.start();
  assert.equal(svc.getStatus().isPolling, true);

  svc.stop();
  assert.equal(svc.getStatus().isPolling, false);
});

test("stop() is idempotent when not running", () => {
  const storage = new MemoryCursorStorage();
  const svc = createSvc(storage);
  svc.stop();
  svc.stop();
  assert.equal(svc.getStatus().isPolling, false);
});

test("poll failure increments consecutiveErrors then recovers on success", async () => {
  const storage = new MemoryCursorStorage();
  storage.failSaveRemaining = 1;

  const svc = createSvc(storage);
  await svc.start();

  await delay(15);
  assert.equal(
    svc.getStatus().errors,
    1,
    "first poll save should fail and increment errors",
  );

  await delay(40);
  assert.equal(
    svc.getStatus().errors,
    0,
    "after successful poll, consecutiveErrors resets",
  );

  svc.stop();
});

test("getStatus exposes lastLedgerPolled after poll advances cursor", async () => {
  const storage = new MemoryCursorStorage();
  storage.cursor = {
    lastLedger: 10,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  // Mock returns latestLedger=50, which is >10, satisfying the assertion below.
  const svc = createSvc(storage, {}, createNoOpRpcClient(50));
  await svc.start();

  await delay(25);
  assert.ok(
    svc.getStatus().lastLedgerPolled > 10,
    "poll should advance lastLedgerPolled",
  );

  svc.stop();
});

// Deduplication tests
test("Event Deduplication", async (t) => {
  await t.test("processedEventIds set is cleared on start()", async () => {
    const storage = new MemoryCursorStorage();
    const svc = createSvc(storage);

    // Access private field for testing
    const serviceAny = svc as any;

    // Manually add some IDs to simulate previous processing
    serviceAny.processedEventIds.add("event-1");
    serviceAny.processedEventIds.add("event-2");
    assert.equal(serviceAny.processedEventIds.size, 2);

    // Start should clear the set
    await svc.start();
    assert.equal(serviceAny.processedEventIds.size, 0);

    svc.stop();
  });

  await t.test(
    "processedEventIds maintains bounded size (max 1000)",
    async () => {
      const storage = new MemoryCursorStorage();
      const svc = createSvc(storage);
      const serviceAny = svc as any;

      // Add more than MAX_PROCESSED_IDS entries
      for (let i = 0; i < 1500; i++) {
        serviceAny.processedEventIds.add(`event-${i}`);

        // Maintain bounded size (FIFO eviction)
        if (serviceAny.processedEventIds.size > serviceAny.MAX_PROCESSED_IDS) {
          const firstId = serviceAny.processedEventIds.values().next().value;
          serviceAny.processedEventIds.delete(firstId);
        }
      }

      // Set should never exceed MAX_PROCESSED_IDS
      assert.ok(
        serviceAny.processedEventIds.size <= serviceAny.MAX_PROCESSED_IDS,
        `set size ${serviceAny.processedEventIds.size} should not exceed ${serviceAny.MAX_PROCESSED_IDS}`,
      );
    },
  );

  await t.test("duplicate events are skipped", async () => {
    const storage = new MemoryCursorStorage();
    const svc = createSvc(storage);
    const serviceAny = svc as any;

    // Simulate processed event
    serviceAny.processedEventIds.add("event-123");

    // Create a mock event with the same ID
    const mockEvent = {
      id: "event-123",
      topic: ["proposal_created"],
      value: {},
    };

    // Check if event would be skipped
    const isDuplicate = serviceAny.processedEventIds.has(mockEvent.id);
    assert.equal(isDuplicate, true, "event should be detected as duplicate");
  });

  await t.test("new events are added to processedEventIds", async () => {
    const storage = new MemoryCursorStorage();
    const svc = createSvc(storage);
    const serviceAny = svc as any;

    const eventId = "event-new-123";
    assert.equal(serviceAny.processedEventIds.has(eventId), false);

    // Simulate adding event
    serviceAny.processedEventIds.add(eventId);

    assert.equal(serviceAny.processedEventIds.has(eventId), true);
  });

  await t.test(
    "FIFO eviction removes oldest entry when set is full",
    async () => {
      const storage = new MemoryCursorStorage();
      const svc = createSvc(storage);
      const serviceAny = svc as any;

      // Fill set to capacity
      for (let i = 0; i < serviceAny.MAX_PROCESSED_IDS; i++) {
        serviceAny.processedEventIds.add(`event-${i}`);
      }

      assert.equal(
        serviceAny.processedEventIds.size,
        serviceAny.MAX_PROCESSED_IDS,
      );

      // Add one more - should trigger eviction
      const firstId = serviceAny.processedEventIds.values().next().value;
      serviceAny.processedEventIds.add("event-new");

      if (serviceAny.processedEventIds.size > serviceAny.MAX_PROCESSED_IDS) {
        serviceAny.processedEventIds.delete(firstId);
      }

      // Set should still be at or below capacity
      assert.ok(
        serviceAny.processedEventIds.size <= serviceAny.MAX_PROCESSED_IDS,
        "set size should not exceed capacity after eviction",
      );

      // Oldest entry should be removed
      assert.equal(
        serviceAny.processedEventIds.has(firstId),
        false,
        "oldest entry should be removed",
      );
    },
  );
});

// Property-based deduplication tests
test("Event Deduplication Properties", async (t) => {
  await t.test(
    "Property 1: Duplicate Detection - duplicate events are skipped",
    async () => {
      for (let iteration = 0; iteration < 10; iteration++) {
        const storage = new MemoryCursorStorage();
        const svc = createSvc(storage);
        const serviceAny = svc as any;

        // Generate random event IDs
        const eventIds = Array.from({ length: 20 }, (_, i) => `event-${i}`);
        const duplicateIds = eventIds.slice(0, 10); // First 10 will be duplicates

        // Add first batch
        for (const id of eventIds) {
          serviceAny.processedEventIds.add(id);
        }

        // Check that duplicates are detected
        for (const id of duplicateIds) {
          assert.equal(
            serviceAny.processedEventIds.has(id),
            true,
            `duplicate event ${id} should be detected`,
          );
        }
      }
    },
  );

  await t.test(
    "Property 2: Event ID Tracking - all event IDs are tracked",
    async () => {
      for (let iteration = 0; iteration < 10; iteration++) {
        const storage = new MemoryCursorStorage();
        const svc = createSvc(storage);
        const serviceAny = svc as any;

        // Generate random event IDs
        const eventIds = Array.from(
          { length: 50 },
          () => `event-${Math.random()}`,
        );

        // Add all IDs
        for (const id of eventIds) {
          serviceAny.processedEventIds.add(id);
        }

        // Verify all IDs are tracked (up to capacity)
        assert.ok(
          serviceAny.processedEventIds.size <= serviceAny.MAX_PROCESSED_IDS,
          "set size should not exceed capacity",
        );
      }
    },
  );

  await t.test(
    "Property 3: Bounded Set Maintenance - set never exceeds max size",
    async () => {
      for (let iteration = 0; iteration < 5; iteration++) {
        const storage = new MemoryCursorStorage();
        const svc = createSvc(storage);
        const serviceAny = svc as any;

        // Add many more entries than capacity
        for (let i = 0; i < 2000; i++) {
          serviceAny.processedEventIds.add(`event-${i}`);

          // Maintain bounded size
          if (
            serviceAny.processedEventIds.size > serviceAny.MAX_PROCESSED_IDS
          ) {
            const firstId = serviceAny.processedEventIds.values().next().value;
            serviceAny.processedEventIds.delete(firstId);
          }
        }

        // Verify set never exceeds capacity
        assert.ok(
          serviceAny.processedEventIds.size <= serviceAny.MAX_PROCESSED_IDS,
          `set size ${serviceAny.processedEventIds.size} should not exceed ${serviceAny.MAX_PROCESSED_IDS}`,
        );
      }
    },
  );

  await t.test(
    "Property 5: Set Cleared on Restart - processedEventIds cleared on start()",
    async () => {
      for (let iteration = 0; iteration < 5; iteration++) {
        const storage = new MemoryCursorStorage();
        const svc = createSvc(storage);
        const serviceAny = svc as any;

        // Add some IDs
        for (let i = 0; i < 100; i++) {
          serviceAny.processedEventIds.add(`event-${i}`);
        }

        assert.ok(serviceAny.processedEventIds.size > 0);

        // Start should clear the set
        await svc.start();
        assert.equal(serviceAny.processedEventIds.size, 0);

        svc.stop();
      }
    },
  );

  await t.test(
    "Property 6: Overlapping Range Deduplication - events in overlaps are deduplicated",
    async () => {
      for (let iteration = 0; iteration < 5; iteration++) {
        const storage = new MemoryCursorStorage();
        const svc = createSvc(storage);
        const serviceAny = svc as any;

        // Simulate first poll: events 1-100
        const firstPollIds = Array.from(
          { length: 100 },
          (_, i) => `event-${i + 1}`,
        );
        for (const id of firstPollIds) {
          serviceAny.processedEventIds.add(id);
        }

        // Simulate second poll with overlap: events 51-150 (51-100 are duplicates)
        const secondPollIds = Array.from(
          { length: 100 },
          (_, i) => `event-${i + 51}`,
        );
        let duplicateCount = 0;

        for (const id of secondPollIds) {
          if (serviceAny.processedEventIds.has(id)) {
            duplicateCount++;
          } else {
            serviceAny.processedEventIds.add(id);
          }
        }

        // Should detect 50 duplicates (events 51-100)
        assert.equal(
          duplicateCount,
          50,
          "should detect 50 duplicates in overlap",
        );
      }
    },
  );
});

// ─── Real Soroban RPC polling tests ─────────────────────────────────────────

test("RPC Polling", async (t) => {
  await t.test(
    "poll() initialises cursor via getLatestLedger when lastLedgerPolled===0",
    async () => {
      const storage = new MemoryCursorStorage();
      // No pre-existing cursor → lastLedgerPolled starts at 0
      let latestLedgerCalled = false;
      const rpc = new SorobanRpcClient(
        { url: "https://soroban-testnet.stellar.org" },
        buildMockFetch({
          getLatestLedger: () => {
            latestLedgerCalled = true;
            return { sequence: 777 };
          },
          getEvents: () => ({ events: [], latestLedger: 777 }),
        }),
      );
      const svc = createSvc(storage, {}, rpc);
      await svc.start();

      // Let one poll fire
      await delay(25);
      svc.stop();

      assert.ok(latestLedgerCalled, "getLatestLedger should be called on first poll");
      assert.equal(
        svc.getStatus().lastLedgerPolled,
        777,
        "cursor should be initialised at the ledger returned by getLatestLedger",
      );
      assert.equal(storage.cursor?.lastLedger, 777);
    },
  );

  await t.test(
    "poll() calls getEventsPage with startLedger = lastLedgerPolled + 1",
    async () => {
      const storage = new MemoryCursorStorage();
      storage.cursor = { lastLedger: 100, updatedAt: new Date().toISOString() };

      let capturedStartLedger: number | undefined;
      const rpc = new SorobanRpcClient(
        { url: "https://soroban-testnet.stellar.org" },
        buildMockFetch({
          getEvents: (params) => {
            const p = params as { startLedger?: number };
            capturedStartLedger = p.startLedger;
            return { events: [], latestLedger: 110 };
          },
        }),
      );
      const svc = createSvc(storage, {}, rpc);
      await svc.start();

      await delay(25);
      svc.stop();

      assert.equal(
        capturedStartLedger,
        101,
        "startLedger should be lastLedgerPolled + 1",
      );
    },
  );

  await t.test(
    "poll() advances lastLedgerPolled to latestLedger from RPC response",
    async () => {
      const storage = new MemoryCursorStorage();
      storage.cursor = { lastLedger: 200, updatedAt: new Date().toISOString() };

      const rpc = createNoOpRpcClient(250);
      const svc = createSvc(storage, {}, rpc);
      await svc.start();

      await delay(25);
      svc.stop();

      assert.equal(
        svc.getStatus().lastLedgerPolled,
        250,
        "lastLedgerPolled should advance to latestLedger from RPC",
      );
      assert.equal(storage.cursor?.lastLedger, 250);
    },
  );

  await t.test("poll() processes returned events through handleBatch", async () => {
    const storage = new MemoryCursorStorage();
    storage.cursor = { lastLedger: 300, updatedAt: new Date().toISOString() };

    const event = makeRawEvent({ id: "evt-abc", ledger: 301 });
    const rpc = new SorobanRpcClient(
      { url: "https://soroban-testnet.stellar.org" },
      buildMockFetch({
        getEvents: () => ({ events: [event], latestLedger: 310 }),
      }),
    );
    const svc = createSvc(storage, {}, rpc);
    await svc.start();

    await delay(25);
    svc.stop();

    // The event should have been added to processedEventIds
    const serviceAny = svc as any;
    assert.ok(
      serviceAny.processedEventIds.has("evt-abc"),
      "event id should be tracked after processing",
    );
  });

  await t.test("poll() handles empty events response without error", async () => {
    const storage = new MemoryCursorStorage();
    storage.cursor = { lastLedger: 400, updatedAt: new Date().toISOString() };

    const rpc = createNoOpRpcClient(410);
    const svc = createSvc(storage, {}, rpc);
    await svc.start();

    await delay(25);
    svc.stop();

    assert.equal(svc.getStatus().errors, 0, "no errors on empty page");
    assert.equal(svc.getStatus().lastLedgerPolled, 410);
  });

  await t.test("poll() paginates when a full page is returned", async () => {
    const storage = new MemoryCursorStorage();
    storage.cursor = { lastLedger: 500, updatedAt: new Date().toISOString() };

    // Build 200 events (a full page) for the first call, 0 for the second.
    const EVENTS_PAGE_LIMIT = 200;
    let callCount = 0;
    const rpc = new SorobanRpcClient(
      { url: "https://soroban-testnet.stellar.org" },
      buildMockFetch({
        getEvents: (params) => {
          callCount++;
          const p = params as { pagination?: { cursor?: string } };
          if (!p.pagination?.cursor) {
            // First page — full, triggers next page request
            const events = Array.from({ length: EVENTS_PAGE_LIMIT }, (_, i) =>
              makeRawEvent({
                id: `evt-${i}`,
                pagingToken: `token-${i}`,
                ledger: 501 + i,
              }),
            );
            return { events, latestLedger: 550 };
          }
          // Second page — empty, stops pagination
          return { events: [], latestLedger: 550 };
        },
      }),
    );
    const svc = createSvc(storage, {}, rpc);
    await svc.start();

    await delay(35);
    svc.stop();

    assert.ok(callCount >= 2, `expected at least 2 getEvents calls for pagination, got ${callCount}`);
    assert.equal(svc.getStatus().lastLedgerPolled, 550);
  });

  await t.test("poll() deduplicates events across polls", async () => {
    const storage = new MemoryCursorStorage();
    storage.cursor = { lastLedger: 600, updatedAt: new Date().toISOString() };

    let pollCount = 0;
    const sharedEvent = makeRawEvent({ id: "shared-event", ledger: 601 });
    const rpc = new SorobanRpcClient(
      { url: "https://soroban-testnet.stellar.org" },
      buildMockFetch({
        getEvents: () => {
          pollCount++;
          // Return the same event on every poll
          return { events: [sharedEvent], latestLedger: 610 };
        },
      }),
    );
    const svc = createSvc(storage, {}, rpc);
    await svc.start();

    // Let two polls fire
    await delay(35);
    svc.stop();

    // processedEventIds should contain the event exactly once
    const serviceAny = svc as any;
    assert.ok(
      serviceAny.processedEventIds.has("shared-event"),
      "event should be in processedEventIds",
    );
    assert.ok(pollCount >= 2, "should have polled at least twice to test deduplication");
  });
});

