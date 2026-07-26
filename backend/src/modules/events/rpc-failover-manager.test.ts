/**
 * Tests for RpcFailoverManager
 *
 * Covers:
 *  - Per-endpoint cursor tracked independently
 *  - Failover with consistent cursors (no divergence, fast path)
 *  - Failover with diverged cursors (warning path, resync triggers)
 *  - Resync finds correct common prefix (not too early, not skipping events)
 *  - Resync finds no common point → ServiceUnavailableError, not silent resume
 *  - Multi-failover sequence: primary → backup → primary again
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RpcFailoverManager,
  findCommonSuffix,
  VALIDATION_WINDOW,
  MAX_LOOKBACK_STEPS,
} from "./rpc-failover-manager.js";
import { SorobanRpcClient } from "../../shared/rpc/soroban-rpc.client.js";
import { ServiceUnavailableError } from "../../shared/errors/AppError.js";
import type { RawContractEvent } from "../../shared/rpc/soroban-rpc.types.js";
import type { EventCursor } from "./cursor/cursor.types.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

const CONTRACT_ID = "CDTEST000000000000000000000000000000000000000000000";

/**
 * Build a SorobanRpcClient backed by a fake fetch that returns `events` for
 * any `getEvents` call. `latestLedger` defaults to the max ledger in the
 * events array or 100.
 */
function buildClientWithEvents(
  url: string,
  events: RawContractEvent[],
  latestLedgerOverride?: number,
): SorobanRpcClient {
  const latestLedger =
    latestLedgerOverride ??
    (events.length > 0 ? Math.max(...events.map((e) => e.ledger)) : 100);

  const fakeFetch: typeof fetch = async (_url, options) => {
    const body = JSON.parse((options?.body ?? "{}") as string) as {
      id: number;
      method: string;
      params?: unknown;
    };

    let result: unknown;
    if (body.method === "getLatestLedger") {
      result = { sequence: latestLedger };
    } else if (body.method === "getEvents") {
      const params = (body.params ?? {}) as {
        startLedger?: number;
        pagination?: { limit?: number; cursor?: string };
      };
      const startLedger = params.startLedger ?? 0;
      const limit = params.pagination?.limit ?? VALIDATION_WINDOW;
      const filtered = events.filter((e) => e.ledger >= startLedger).slice(0, limit);
      result = { events: filtered, latestLedger };
    } else {
      result = {};
    }

    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: (body as any).id, result }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  return new SorobanRpcClient({ url }, fakeFetch);
}

/** Build a client that throws on every RPC call. */
function buildFailingClient(url: string): SorobanRpcClient {
  const fakeFetch: typeof fetch = async () => {
    throw new TypeError("network failure");
  };
  return new SorobanRpcClient({ url, maxRetries: 0 }, fakeFetch);
}

/** Factory for minimal valid RawContractEvent. */
function makeEvent(
  id: string,
  ledger: number,
  overrides: Partial<RawContractEvent> = {},
): RawContractEvent {
  return {
    id,
    type: "contract",
    ledger,
    ledgerClosedAt: "2026-01-01T00:00:00Z",
    contractId: CONTRACT_ID,
    topic: ["proposal_created"],
    value: { xdr: "AAAA" },
    pagingToken: id,
    ...overrides,
  };
}

/** Build a cursor at a given ledger. */
function cursor(lastLedger: number, lastEventId?: string): EventCursor {
  return {
    lastLedger,
    lastEventId,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// ─── findCommonSuffix unit tests ──────────────────────────────────────────────

test("findCommonSuffix: returns null for disjoint arrays", () => {
  assert.equal(findCommonSuffix(["a", "b", "c"], ["d", "e", "f"]), null);
});

test("findCommonSuffix: returns most recent common ID", () => {
  // Both share "c" and "b"; most recent common is "c"
  assert.equal(findCommonSuffix(["a", "b", "c"], ["b", "c", "d"]), "c");
});

test("findCommonSuffix: handles empty arrays", () => {
  assert.equal(findCommonSuffix([], ["a", "b"]), null);
  assert.equal(findCommonSuffix(["a", "b"], []), null);
  assert.equal(findCommonSuffix([], []), null);
});

test("findCommonSuffix: single-element arrays with match", () => {
  assert.equal(findCommonSuffix(["x"], ["x"]), "x");
});

test("findCommonSuffix: returns latest match, not earliest", () => {
  // "a" matches, "c" matches — should return "c" (most recent)
  assert.equal(findCommonSuffix(["a", "b", "c"], ["a", "c", "e"]), "c");
});

// ─── Per-endpoint cursor tracking ─────────────────────────────────────────────

test("test_per_endpoint_cursor_tracked_independently: primary and backup cursors don't clobber each other", () => {
  const primaryUrl = "https://primary.rpc";
  const backupUrl = "https://backup.rpc";

  const manager = new RpcFailoverManager([
    { url: primaryUrl, client: buildClientWithEvents(primaryUrl, []) },
    { url: backupUrl, client: buildClientWithEvents(backupUrl, []) },
  ]);

  // Set different cursors for each endpoint
  manager.setCursorForEndpoint(primaryUrl, cursor(500));
  manager.setCursorForEndpoint(backupUrl, cursor(480));

  // Each endpoint retains its own cursor independently
  assert.deepEqual(manager.getCursorForEndpoint(primaryUrl), cursor(500));
  assert.deepEqual(manager.getCursorForEndpoint(backupUrl), cursor(480));

  // Updating one does not affect the other
  manager.setCursorForEndpoint(primaryUrl, cursor(510));
  assert.deepEqual(manager.getCursorForEndpoint(primaryUrl), cursor(510));
  assert.deepEqual(manager.getCursorForEndpoint(backupUrl), cursor(480));
});

test("getCursorForEndpoint returns null for an unknown endpoint", () => {
  const manager = new RpcFailoverManager([
    { url: "https://a.rpc", client: buildClientWithEvents("https://a.rpc", []) },
  ]);
  assert.equal(manager.getCursorForEndpoint("https://unknown.rpc"), null);
});

test("getAllEndpointCursors lists every endpoint with its cursor or null", () => {
  const primaryUrl = "https://primary.rpc";
  const backupUrl = "https://backup.rpc";

  const manager = new RpcFailoverManager([
    { url: primaryUrl, client: buildClientWithEvents(primaryUrl, []) },
    { url: backupUrl, client: buildClientWithEvents(backupUrl, []) },
  ]);

  manager.setCursorForEndpoint(primaryUrl, cursor(100));
  // backup left unset

  const all = manager.getAllEndpointCursors();
  assert.equal(all.length, 2);
  assert.deepEqual(all.find((e) => e.url === primaryUrl)?.cursor, cursor(100));
  assert.equal(all.find((e) => e.url === backupUrl)?.cursor, null);
});

// ─── Failover with consistent cursors ─────────────────────────────────────────

test("test_failover_with_consistent_cursors: failover proceeds without warning, cursor carries over", async () => {
  // Both endpoints share the same events around ledger 100
  const sharedEvents = [
    makeEvent("evt-95", 95),
    makeEvent("evt-96", 96),
    makeEvent("evt-97", 97),
    makeEvent("evt-98", 98),
    makeEvent("evt-99", 99),
    makeEvent("evt-100", 100),
  ];

  const primaryUrl = "https://primary.rpc";
  const backupUrl = "https://backup.rpc";

  const manager = new RpcFailoverManager([
    { url: primaryUrl, client: buildClientWithEvents(primaryUrl, sharedEvents) },
    { url: backupUrl, client: buildClientWithEvents(backupUrl, sharedEvents) },
  ]);

  const primaryCursor = cursor(100, "evt-100");
  const result = await manager.failover(primaryCursor, CONTRACT_ID);

  // Should switch to backup
  assert.equal(result.endpoint.url, backupUrl);
  // Cursor should be unchanged (consistent, fast path)
  assert.equal(result.cursor.lastLedger, 100);
  // No resync needed
  assert.equal(result.resynced, false);
});

// ─── Failover with diverged cursors ───────────────────────────────────────────

test("test_failover_with_diverged_cursors: diverged cursors trigger resync", async () => {
  // Primary has events 90–100; backup has different events for the same ledger
  // range (simulating a different view of the chain)
  const primaryEvents = [
    makeEvent("evt-p-90", 90),
    makeEvent("evt-p-91", 91),
    makeEvent("evt-common-80", 80), // a common event that exists in both
    makeEvent("evt-p-92", 92),
    makeEvent("evt-p-100", 100),
  ];
  const backupEvents = [
    makeEvent("evt-b-88", 88),
    makeEvent("evt-common-80", 80), // same common event
    makeEvent("evt-b-91", 91),
    makeEvent("evt-b-92", 92),
    makeEvent("evt-b-100", 100),
  ];

  const primaryUrl = "https://primary.rpc";
  const backupUrl = "https://backup.rpc";

  const manager = new RpcFailoverManager([
    { url: primaryUrl, client: buildClientWithEvents(primaryUrl, primaryEvents) },
    { url: backupUrl, client: buildClientWithEvents(backupUrl, backupEvents) },
  ]);

  const primaryCursor = cursor(100, "evt-p-100");

  // Failover should succeed, finding the common event
  const result = await manager.failover(primaryCursor, CONTRACT_ID);

  assert.equal(result.endpoint.url, backupUrl);
  // Resynced because histories diverged
  assert.equal(result.resynced, true);
  // Common event was "evt-common-80" at ledger 80
  assert.equal(result.cursor.lastEventId, "evt-common-80");
  assert.equal(result.cursor.lastLedger, 80);
});

// ─── Resync finds correct common prefix ───────────────────────────────────────

test("test_resync_finds_common_prefix: correctly identifies common point, not too early or late", async () => {
  // 200 events total, shared up to event 150, then diverge.
  // Primary: evt-001..evt-150 + evt-p-151..evt-p-200
  // Backup:  evt-001..evt-150 + evt-b-151..evt-b-200
  const sharedEvents = Array.from({ length: 150 }, (_, i) =>
    makeEvent(`evt-${String(i + 1).padStart(3, "0")}`, i + 1),
  );
  const primaryOnly = Array.from({ length: 50 }, (_, i) =>
    makeEvent(`evt-p-${String(i + 151).padStart(3, "0")}`, i + 151),
  );
  const backupOnly = Array.from({ length: 50 }, (_, i) =>
    makeEvent(`evt-b-${String(i + 151).padStart(3, "0")}`, i + 151),
  );

  const primaryUrl = "https://primary.rpc";
  const backupUrl = "https://backup.rpc";

  const manager = new RpcFailoverManager([
    {
      url: primaryUrl,
      client: buildClientWithEvents(primaryUrl, [...sharedEvents, ...primaryOnly]),
    },
    {
      url: backupUrl,
      client: buildClientWithEvents(backupUrl, [...sharedEvents, ...backupOnly]),
    },
  ]);

  const primaryCursor = cursor(200, "evt-p-200");
  const result = await manager.failover(primaryCursor, CONTRACT_ID);

  assert.equal(result.endpoint.url, backupUrl);
  assert.equal(result.resynced, true);

  // The common point must be at or before ledger 150 (where histories agree)
  // and must NOT be 0 (would skip all shared history) or 200 (wrong endpoint's events)
  assert.ok(
    result.cursor.lastLedger <= 150,
    `resume ledger ${result.cursor.lastLedger} should be ≤ 150 (divergence point)`,
  );
  assert.ok(
    result.cursor.lastLedger > 0,
    `resume ledger should be > 0, not at genesis`,
  );

  // The event ID used as the common point must be from the shared history
  assert.ok(
    result.cursor.lastEventId?.startsWith("evt-"),
    `common event ID ${result.cursor.lastEventId} should be from shared history`,
  );
  assert.ok(
    !result.cursor.lastEventId?.startsWith("evt-p-"),
    `common event ID should not be a primary-only event`,
  );
  assert.ok(
    !result.cursor.lastEventId?.startsWith("evt-b-"),
    `common event ID should not be a backup-only event`,
  );
});

// ─── Resync: no common point found ────────────────────────────────────────────

test("test_resync_no_common_point_found: throws ServiceUnavailableError, no silent resume", async () => {
  // Completely different histories — no overlap at all
  const primaryEvents = Array.from({ length: 30 }, (_, i) =>
    makeEvent(`evt-primary-${i}`, i + 1),
  );
  const backupEvents = Array.from({ length: 30 }, (_, i) =>
    makeEvent(`evt-backup-${i}`, i + 1),
  );

  const primaryUrl = "https://primary.rpc";
  const backupUrl = "https://backup.rpc";

  const manager = new RpcFailoverManager([
    { url: primaryUrl, client: buildClientWithEvents(primaryUrl, primaryEvents) },
    { url: backupUrl, client: buildClientWithEvents(backupUrl, backupEvents) },
  ]);

  const primaryCursor = cursor(30, "evt-primary-29");

  await assert.rejects(
    () => manager.failover(primaryCursor, CONTRACT_ID),
    (err: unknown) => {
      // Must be a ServiceUnavailableError — not a silent fallback
      assert.ok(
        err instanceof ServiceUnavailableError,
        `expected ServiceUnavailableError, got ${(err as Error)?.constructor?.name}`,
      );
      // Error message must include both endpoint URLs for diagnostics
      assert.ok(
        (err as Error).message.includes(primaryUrl),
        "error should mention the primary URL",
      );
      assert.ok(
        (err as Error).message.includes(backupUrl),
        "error should mention the backup URL",
      );
      return true;
    },
  );
});

test("failover throws ServiceUnavailableError when only one endpoint is configured", async () => {
  const url = "https://only.rpc";
  const manager = new RpcFailoverManager([
    { url, client: buildClientWithEvents(url, []) },
  ]);

  await assert.rejects(
    () => manager.failover(cursor(100), CONTRACT_ID),
    (err: unknown) => {
      assert.ok(err instanceof ServiceUnavailableError);
      return true;
    },
  );
});

// ─── Multi-failover sequence ───────────────────────────────────────────────────

test("test_multi_failover_sequence: primary → backup → primary, cursors stay correct", async () => {
  // Shared history for all three endpoints: events 1–100
  const sharedEvents = Array.from({ length: 100 }, (_, i) =>
    makeEvent(`evt-${String(i + 1).padStart(3, "0")}`, i + 1),
  );

  const primaryUrl = "https://primary.rpc";
  const backupUrl = "https://backup.rpc";
  const secondaryUrl = "https://secondary.rpc";

  const manager = new RpcFailoverManager([
    { url: primaryUrl, client: buildClientWithEvents(primaryUrl, sharedEvents) },
    { url: backupUrl, client: buildClientWithEvents(backupUrl, sharedEvents) },
    { url: secondaryUrl, client: buildClientWithEvents(secondaryUrl, sharedEvents) },
  ]);

  // Initial state: polling on primary
  assert.equal(manager.getActiveEndpoint().url, primaryUrl);

  // Record cursors for primary and backup as if they've been running
  manager.setCursorForEndpoint(primaryUrl, cursor(100, "evt-100"));
  manager.setCursorForEndpoint(backupUrl, cursor(95));

  // First failover: primary → backup
  const result1 = await manager.failover(cursor(100, "evt-100"), CONTRACT_ID);
  assert.equal(result1.endpoint.url, backupUrl);

  // Simulate backup advancing its cursor
  manager.setCursorForEndpoint(backupUrl, cursor(110, "evt-110"));

  // Second failover: backup → secondary
  const result2 = await manager.failover(cursor(110, "evt-110"), CONTRACT_ID);
  assert.equal(result2.endpoint.url, secondaryUrl);

  // Simulate secondary advancing and then primary recovering
  manager.setCursorForEndpoint(secondaryUrl, cursor(120, "evt-120"));

  // Third failover: secondary → primary (wraps around)
  const result3 = await manager.failover(cursor(120, "evt-120"), CONTRACT_ID);
  assert.equal(result3.endpoint.url, primaryUrl);

  // Primary cursor should still be whatever we set earlier (independent tracking)
  assert.deepEqual(
    manager.getCursorForEndpoint(primaryUrl),
    cursor(100, "evt-100"),
    "primary cursor should be unchanged by the other endpoints' updates",
  );

  // Backup cursor should be the value we set (not clobbered by secondary)
  assert.deepEqual(
    manager.getCursorForEndpoint(backupUrl),
    cursor(110, "evt-110"),
    "backup cursor should be independent of secondary updates",
  );

  // Secondary cursor should be the value we set
  assert.deepEqual(
    manager.getCursorForEndpoint(secondaryUrl),
    cursor(120, "evt-120"),
  );
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

test("failover when backup fetch fails: treated as empty overlap, triggers lookback", async () => {
  // Primary has events, backup network-fails on all calls.
  // The manager should handle the backup fetch failure gracefully (returns
  // empty IDs, which means no common suffix found anywhere → ServiceUnavailableError).
  const primaryEvents = Array.from({ length: 20 }, (_, i) =>
    makeEvent(`evt-${i}`, i + 1),
  );

  const primaryUrl = "https://primary.rpc";
  const backupUrl = "https://backup.rpc";

  const manager = new RpcFailoverManager([
    { url: primaryUrl, client: buildClientWithEvents(primaryUrl, primaryEvents) },
    { url: backupUrl, client: buildFailingClient(backupUrl) },
  ]);

  // The failing backup returns no event IDs, so no common suffix can be found.
  await assert.rejects(
    () => manager.failover(cursor(20, "evt-19"), CONTRACT_ID),
    (err: unknown) => {
      assert.ok(err instanceof ServiceUnavailableError);
      return true;
    },
  );
});

test("manager initialises with first endpoint as active", () => {
  const url1 = "https://ep1.rpc";
  const url2 = "https://ep2.rpc";

  const manager = new RpcFailoverManager([
    { url: url1, client: buildClientWithEvents(url1, []) },
    { url: url2, client: buildClientWithEvents(url2, []) },
  ]);

  assert.equal(manager.getActiveEndpoint().url, url1);
  assert.equal(manager.getActiveClient(), manager.getActiveEndpoint().client);
});

test("manager construction throws with zero endpoints", () => {
  assert.throws(
    () => new RpcFailoverManager([]),
    /at least one endpoint/,
  );
});

// ─── Resync lookback respects MAX_LOOKBACK_STEPS bound ────────────────────────

test("resync search is bounded by MAX_LOOKBACK_STEPS — never scans unbounded history", async () => {
  // Track how many getEvents calls are made to the backup. There should be at
  // most 1 (validation) + MAX_LOOKBACK_STEPS calls.
  let backupCallCount = 0;

  const primaryEvents = Array.from({ length: 100 }, (_, i) =>
    makeEvent(`evt-primary-${i}`, i + 1),
  );

  const primaryUrl = "https://primary.rpc";
  const backupUrl = "https://backup.rpc";

  // Custom backup fake that counts calls and returns nothing in common
  const backupFetch: typeof fetch = async (_url, options) => {
    const body = JSON.parse((options?.body ?? "{}") as string) as {
      method: string;
      id: number;
    };
    if (body.method === "getEvents") {
      backupCallCount++;
    }
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { events: [], latestLedger: 100 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const backupClient = new SorobanRpcClient(
    { url: backupUrl, maxRetries: 0 },
    backupFetch,
  );

  const manager = new RpcFailoverManager([
    { url: primaryUrl, client: buildClientWithEvents(primaryUrl, primaryEvents) },
    { url: backupUrl, client: backupClient },
  ]);

  await assert.rejects(
    () => manager.failover(cursor(100, "evt-primary-99"), CONTRACT_ID),
    (err: unknown) => {
      assert.ok(err instanceof ServiceUnavailableError);
      return true;
    },
  );

  // 1 initial validation call + at most MAX_LOOKBACK_STEPS further calls
  const maxExpectedCalls = 1 + MAX_LOOKBACK_STEPS;
  assert.ok(
    backupCallCount <= maxExpectedCalls,
    `backup was called ${backupCallCount} times but max expected is ${maxExpectedCalls}`,
  );
});
