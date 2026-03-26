import assert from "node:assert/strict";
import test from "node:test";
import { EventPollingService } from "./events.service.js";
import type { BackendEnv } from "../../config/env.js";
import type { CursorStorage } from "./cursor/index.js";
import type { EventCursor } from "./cursor/cursor.types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockEnv: BackendEnv = {
  port: 8787,
  host: "0.0.0.0",
  nodeEnv: "test",
  stellarNetwork: "testnet",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  contractId: "CDTEST",
  websocketUrl: "ws://localhost:8080",
  eventPollingIntervalMs: 60_000,
  eventPollingEnabled: true,
};

function makeCursorStorage(initial?: EventCursor): CursorStorage & {
  saved: EventCursor[];
} {
  const saved: EventCursor[] = [];
  return {
    saved,
    async getCursor() {
      return initial ?? null;
    },
    async saveCursor(cursor) {
      saved.push(cursor);
    },
  };
}

function makeRpcResponse(
  events: object[],
  latestLedger: number,
): Response {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { events, latestLedger },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("EventPollingService", async (t) => {
  await t.test(
    "updates lastLedgerPolled from RPC latestLedger on empty response",
    async () => {
      const storage = makeCursorStorage();
      const service = new EventPollingService(mockEnv, storage);

      // Patch global fetch to return an empty event list at ledger 500
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => makeRpcResponse([], 500);

      try {
        // Access private poll() via any cast
        await (service as any).poll();
      } finally {
        globalThis.fetch = originalFetch;
      }

      assert.equal(
        (service as any).lastLedgerPolled,
        500,
        "lastLedgerPolled should reflect RPC latestLedger",
      );
      assert.equal(storage.saved.length, 1);
      assert.equal(storage.saved[0]!.lastLedger, 500);
    },
  );

  await t.test(
    "parses real contract events and updates lastLedgerPolled",
    async () => {
      const storage = makeCursorStorage();
      const service = new EventPollingService(mockEnv, storage);

      const fakeEvent = {
        id: "evt-1",
        contractId: "CDTEST",
        topic: ["proposal_created"],
        value: { xdr: "AAAA" },
        ledger: 420,
        ledgerClosedAt: "2026-01-01T00:00:00Z",
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => makeRpcResponse([fakeEvent], 420);

      try {
        await (service as any).poll();
      } finally {
        globalThis.fetch = originalFetch;
      }

      assert.equal((service as any).lastLedgerPolled, 420);
      assert.equal(storage.saved[0]!.lastLedger, 420);
    },
  );

  await t.test("throws on non-OK HTTP response", async () => {
    const storage = makeCursorStorage();
    const service = new EventPollingService(mockEnv, storage);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response("Service Unavailable", { status: 503 });

    try {
      await assert.rejects(
        () => (service as any).poll(),
        /RPC HTTP error: 503/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("throws on RPC-level error in response body", async () => {
    const storage = makeCursorStorage();
    const service = new EventPollingService(mockEnv, storage);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32600, message: "Invalid request" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    try {
      await assert.rejects(
        () => (service as any).poll(),
        /RPC error -32600/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test(
    "resumes from persisted cursor on start",
    async () => {
      const storage = makeCursorStorage({
        lastLedger: 999,
        updatedAt: "2026-01-01T00:00:00Z",
      });
      const service = new EventPollingService(
        { ...mockEnv, eventPollingEnabled: false },
        storage,
      );

      // start() with polling disabled just loads the cursor and returns
      await service.start();

      assert.equal(
        (service as any).lastLedgerPolled,
        999,
        "should resume from persisted cursor",
      );
    },
  );
});
