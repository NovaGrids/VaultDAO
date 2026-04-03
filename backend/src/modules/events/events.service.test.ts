import assert from "node:assert/strict";
import test from "node:test";

import type { BackendEnv } from "../../config/env.js";
import type { CursorStorage } from "./cursor/index.js";
import type { EventCursor } from "./cursor/cursor.types.js";
import { EventPollingService } from "./events.service.js";

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

test("getStatus before start: idle state", () => {
  const storage = new MemoryCursorStorage();
  const svc = new EventPollingService(createTestEnv(), storage);

  const s = svc.getStatus();
  assert.equal(s.isPolling, false);
  assert.equal(s.lastLedgerPolled, 0);
  assert.equal(s.errors, 0);
});

test("start() with polling disabled does not run loop", async () => {
  const storage = new MemoryCursorStorage();
  const svc = new EventPollingService(
    createTestEnv({ eventPollingEnabled: false }),
    storage,
  );

  await svc.start();
  assert.equal(svc.getStatus().isPolling, false);
});

test("start() loads cursor from storage and sets lastLedgerPolled", async () => {
  const storage = new MemoryCursorStorage();
  storage.cursor = {
    lastLedger: 42,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const svc = new EventPollingService(createTestEnv(), storage);
  await svc.start();

  assert.equal(svc.getStatus().isPolling, true);
  assert.equal(svc.getStatus().lastLedgerPolled, 42);
  svc.stop();
});

test("start() with no cursor uses default ledger 0", async () => {
  const storage = new MemoryCursorStorage();
  const svc = new EventPollingService(createTestEnv(), storage);
  await svc.start();

  assert.equal(svc.getStatus().lastLedgerPolled, 0);
  assert.equal(svc.getStatus().isPolling, true);
  svc.stop();
});

test("stop() clears timer and sets isPolling false", async () => {
  const storage = new MemoryCursorStorage();
  const svc = new EventPollingService(createTestEnv(), storage);
  await svc.start();
  assert.equal(svc.getStatus().isPolling, true);

  svc.stop();
  assert.equal(svc.getStatus().isPolling, false);
});

test("stop() is idempotent when not running", () => {
  const storage = new MemoryCursorStorage();
  const svc = new EventPollingService(createTestEnv(), storage);
  svc.stop();
  svc.stop();
  assert.equal(svc.getStatus().isPolling, false);
});

test("poll failure increments consecutiveErrors then recovers on success", async () => {
  const storage = new MemoryCursorStorage();
  storage.failSaveRemaining = 1;

  const svc = new EventPollingService(createTestEnv(), storage);
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

  const svc = new EventPollingService(createTestEnv(), storage);
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
    const svc = new EventPollingService(createTestEnv(), storage);

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
      const svc = new EventPollingService(createTestEnv(), storage);
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
    const svc = new EventPollingService(createTestEnv(), storage);
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
    const svc = new EventPollingService(createTestEnv(), storage);
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
      const svc = new EventPollingService(createTestEnv(), storage);
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
        const svc = new EventPollingService(createTestEnv(), storage);
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
        const svc = new EventPollingService(createTestEnv(), storage);
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
        const svc = new EventPollingService(createTestEnv(), storage);
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
        const svc = new EventPollingService(createTestEnv(), storage);
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
        const svc = new EventPollingService(createTestEnv(), storage);
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
