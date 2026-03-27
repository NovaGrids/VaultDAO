import assert from "node:assert/strict";
import test from "node:test";

import type { BackendEnv } from "../../config/env.js";
import type { CursorStorage } from "./cursor/index.js";
import type { EventCursor } from "./cursor/cursor.types.js";
import { EventPollingService } from "./events.service.js";

function createTestEnv(
  overrides: Partial<BackendEnv> = {}
): BackendEnv {
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
    storage
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
    "first poll save should fail and increment errors"
  );

  await delay(40);
  assert.equal(
    svc.getStatus().errors,
    0,
    "after successful poll, consecutiveErrors resets"
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
    "poll should advance lastLedgerPolled"
  );

  svc.stop();
});
