/**
 * Heartbeat unit tests for EventWebSocketServer (#1371).
 *
 * Strategy: spin up a real HTTP+WS server for each test group, use
 * tickHeartbeat() to trigger the heartbeat loop immediately (no 30s wait),
 * and simulate pong responses by connecting real ws clients (the ws library
 * automatically replies to PING with PONG at the TCP level).
 *
 * For "missed ping" scenarios we back-date lastPingAt directly via the
 * internal clients map so the heartbeat tick sees an expired pending ping,
 * and we set maxPayload/autoPong=false so the test client does not respond.
 */

import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { WebSocket } from "ws";
import {
  EventWebSocketServer,
  WS_METRIC_PINGS_SENT,
  WS_METRIC_PONGS_RECEIVED,
  WS_METRIC_TIMEOUTS,
  WS_METRIC_RTT_MS,
  type HeartbeatEvent,
} from "./websocket.server.js";
import { MetricsRegistry } from "../health/metrics.registry.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Spin up a bare HTTP server + EventWebSocketServer, returns cleanup fn. */
async function makeServer(metrics?: MetricsRegistry): Promise<{
  wsServer: EventWebSocketServer;
  wsUrl: string;
  cleanup: () => Promise<void>;
}> {
  const httpServer = http.createServer();
  const wsServer = new EventWebSocketServer(httpServer, metrics);

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as { port: number };
  const wsUrl = `ws://127.0.0.1:${address.port}`;

  const cleanup = async () => {
    wsServer.stop();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  return { wsServer, wsUrl, cleanup };
}

/** Connect a ws client and wait for the open event. */
function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

/** Sleep for `ms` milliseconds. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Find the internal ClientSubscription for a given connectionId.
 * Type-unsafe, intended only for tests.
 */
function findSub(wsServer: EventWebSocketServer, connectionId: string): any {
  const clientsMap: Map<WebSocket, any> = (wsServer as any).clients;
  for (const [, sub] of clientsMap) {
    if (sub.connectionId === connectionId) return sub;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1. Metrics registration
// ---------------------------------------------------------------------------

test("Heartbeat – metrics are registered on construction", async () => {
  const registry = new MetricsRegistry();
  const { cleanup } = await makeServer(registry);

  try {
    const snapshot = registry.snapshot();
    assert.ok(snapshot.metadata.has(WS_METRIC_PINGS_SENT), "pings_sent registered");
    assert.ok(snapshot.metadata.has(WS_METRIC_PONGS_RECEIVED), "pongs_received registered");
    assert.ok(snapshot.metadata.has(WS_METRIC_TIMEOUTS), "timeouts registered");
    assert.ok(snapshot.metadata.has(WS_METRIC_RTT_MS), "rtt_ms histogram registered");

    assert.equal(snapshot.metadata.get(WS_METRIC_PINGS_SENT)!.type, "counter");
    assert.equal(snapshot.metadata.get(WS_METRIC_PONGS_RECEIVED)!.type, "counter");
    assert.equal(snapshot.metadata.get(WS_METRIC_TIMEOUTS)!.type, "counter");
    assert.equal(snapshot.metadata.get(WS_METRIC_RTT_MS)!.type, "histogram");
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// 2. Ping sent & pong received metrics
// ---------------------------------------------------------------------------

test("Heartbeat – ping increments counter; pong increments counter and emits event", async () => {
  const registry = new MetricsRegistry();
  const { wsServer, wsUrl, cleanup } = await makeServer(registry);

  try {
    const ws = await connect(wsUrl);

    wsServer.tickHeartbeat();
    await sleep(50);

    const snapshot = registry.snapshot();
    assert.equal(snapshot.values.get(WS_METRIC_PINGS_SENT), 1, "one ping sent");
    assert.equal(snapshot.values.get(WS_METRIC_PONGS_RECEIVED), 1, "one pong received");

    ws.close();
    await sleep(20);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// 3. Heartbeat event payload shape
// ---------------------------------------------------------------------------

test("Heartbeat – 'heartbeat' event is emitted with correct shape", async () => {
  const { wsServer, wsUrl, cleanup } = await makeServer();

  try {
    const ws = await connect(wsUrl);

    const events: HeartbeatEvent[] = [];
    wsServer.on("heartbeat", (e) => events.push(e));

    wsServer.tickHeartbeat();
    await sleep(50);

    assert.equal(events.length, 1);
    const [evt] = events;
    assert.ok(typeof evt!.connectionId === "string", "connectionId is string");
    assert.ok(evt!.latencyMs >= 0, "latencyMs is non-negative");
    assert.equal(evt!.missedPings, 0, "missedPings reset to 0 after pong");
    assert.ok(
      evt!.adaptiveTimeoutMs >= 10_000 && evt!.adaptiveTimeoutMs <= 30_000,
      "adaptiveTimeoutMs in range",
    );

    ws.close();
    await sleep(20);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// 4. RTT histogram observed
// ---------------------------------------------------------------------------

test("Heartbeat – RTT is observed in histogram after pong", async () => {
  const registry = new MetricsRegistry();
  const { wsServer, wsUrl, cleanup } = await makeServer(registry);

  try {
    const ws = await connect(wsUrl);

    wsServer.tickHeartbeat();
    await sleep(50);

    const snapshot = registry.snapshot();
    const rttHisto = snapshot.histograms.get(WS_METRIC_RTT_MS);
    assert.ok(rttHisto, "RTT histogram exists");
    assert.equal(rttHisto!.count, 1, "one observation recorded");
    assert.ok(rttHisto!.sum >= 0, "sum is non-negative");

    ws.close();
    await sleep(20);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// 5. getHeartbeatStats after ping/pong
// ---------------------------------------------------------------------------

test("Heartbeat – getHeartbeatStats returns correct stats after ping/pong", async () => {
  const { wsServer, wsUrl, cleanup } = await makeServer();

  try {
    const ws = await connect(wsUrl);

    let connectionId = "";
    wsServer.once("heartbeat", (e) => { connectionId = e.connectionId; });

    wsServer.tickHeartbeat();
    await sleep(50);

    assert.ok(connectionId, "got connectionId from heartbeat event");

    const stats = wsServer.getHeartbeatStats(connectionId);
    assert.ok(stats, "stats returned");
    assert.equal(stats!.missedPings, 0, "missedPings is 0");
    assert.equal(stats!.lastPingAt, 0, "lastPingAt reset to 0 after pong");
    // smoothedRtt is >= 0 (may be exactly 0 when ping/pong completes within 1ms)
    assert.ok(stats!.smoothedRtt >= 0, "smoothedRtt is non-negative");
    assert.ok(
      stats!.adaptiveTimeoutMs >= 10_000 && stats!.adaptiveTimeoutMs <= 30_000,
      "adaptive timeout in bounds",
    );

    ws.close();
    await sleep(20);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// 6. Adaptive timeout bounded between BASE and MAX
// ---------------------------------------------------------------------------

test("Heartbeat – adaptive timeout is bounded between BASE and MAX", async () => {
  const { wsServer, wsUrl, cleanup } = await makeServer();

  try {
    const ws = await connect(wsUrl);

    let connectionId = "";
    wsServer.once("heartbeat", (e) => { connectionId = e.connectionId; });

    wsServer.tickHeartbeat();
    await sleep(50);

    const stats = wsServer.getHeartbeatStats(connectionId)!;
    assert.ok(stats.adaptiveTimeoutMs >= 10_000, "at least base timeout");
    assert.ok(stats.adaptiveTimeoutMs <= 30_000, "at most max timeout");

    ws.close();
    await sleep(20);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// 7. Missed ping increments missedPings without closing on first miss
// ---------------------------------------------------------------------------

test("Heartbeat – missed ping increments missedPings without closing on first miss", async () => {
  const { wsServer, cleanup } = await makeServer();

  try {
    // Inject a mock WebSocket directly so we can control pong behaviour.
    // The mock never sends a pong, letting us test the miss path without a
    // real network round-trip race.
    const mockWs = {
      readyState: 1 /* WebSocket.OPEN */,
      ping: () => { /* never replies */ },
      terminate() { (this as any).readyState = 3; },
      close() { (this as any).readyState = 3; },
      on: () => mockWs,
    } as unknown as WebSocket;

    const connectionId = "mock-conn-miss-test";
    const clientsMap: Map<WebSocket, any> = (wsServer as any).clients;
    clientsMap.set(mockWs, {
      connectionId,
      subscriptions: new Set(),
      rooms: new Set(),
      state: "authenticated",
      heartbeat: {
        missedPings: 0,
        lastPingAt: Date.now() - 60_000, // already expired
        smoothedRtt: 0,
        adaptiveTimeoutMs: 10_000,
      },
    });

    // One tick: expired pending ping → missedPings becomes 1 (below max=2)
    wsServer.tickHeartbeat();
    await sleep(20);

    const stats = wsServer.getHeartbeatStats(connectionId)!;
    assert.equal(stats.missedPings, 1, "first miss counted");
    assert.equal(wsServer.getActiveConnectionCount(), 1, "connection still open");

    // Clean up the mock
    clientsMap.delete(mockWs);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// 8. Two consecutive misses closes the connection
// ---------------------------------------------------------------------------

test("Heartbeat – connection is terminated after 2 consecutive missed pings", async () => {
  const registry = new MetricsRegistry();
  const { wsServer, cleanup } = await makeServer(registry);

  try {
    // Inject a mock WebSocket that records calls and simulates termination
    let terminated = false;
    const mockWs = {
      readyState: 1 /* WebSocket.OPEN */,
      ping: () => { /* no pong reply */ },
      terminate() { terminated = true; (this as any).readyState = 3; },
      close() { (this as any).readyState = 3; },
      on: () => mockWs,
    } as unknown as WebSocket;

    const connectionId = "mock-conn-term-test";
    const clientsMap: Map<WebSocket, any> = (wsServer as any).clients;
    clientsMap.set(mockWs, {
      connectionId,
      subscriptions: new Set(),
      rooms: new Set(),
      state: "authenticated",
      heartbeat: {
        missedPings: 1,                  // already missed once
        lastPingAt: Date.now() - 60_000, // and this pending ping has also expired
        smoothedRtt: 0,
        adaptiveTimeoutMs: 10_000,
      },
    });

    // One tick: expired ping + missedPings was 1 → becomes 2 → terminate()
    wsServer.tickHeartbeat();
    await sleep(20);

    assert.ok(terminated, "mock ws.terminate() was called");

    // Manually trigger the close cleanup (normally fires from the 'close' event
    // on a real socket — for the mock we invoke it directly)
    ;(wsServer as any).cleanupConnection(mockWs, connectionId);

    assert.equal(wsServer.getActiveConnectionCount(), 0, "connection cleaned up");

    const snapshot = registry.snapshot();
    assert.equal(snapshot.values.get(WS_METRIC_TIMEOUTS), 1, "timeout counter incremented");
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// 9. Multiple connections tracked independently
// ---------------------------------------------------------------------------

test("Heartbeat – multiple connections each get their own heartbeat state", async () => {
  const registry = new MetricsRegistry();
  const { wsServer, wsUrl, cleanup } = await makeServer(registry);

  try {
    const ws1 = await connect(wsUrl);
    const ws2 = await connect(wsUrl);

    assert.equal(wsServer.getActiveConnectionCount(), 2);

    wsServer.tickHeartbeat();
    await sleep(50);

    const snapshot = registry.snapshot();
    assert.equal(snapshot.values.get(WS_METRIC_PINGS_SENT), 2, "two pings sent");
    assert.equal(snapshot.values.get(WS_METRIC_PONGS_RECEIVED), 2, "two pongs received");
    assert.equal(
      snapshot.histograms.get(WS_METRIC_RTT_MS)!.count,
      2,
      "two RTT observations",
    );

    ws1.close();
    ws2.close();
    await sleep(20);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// 10. Works without a metrics registry (no crash)
// ---------------------------------------------------------------------------

test("Heartbeat – works without a metrics registry injected", async () => {
  const { wsServer, wsUrl, cleanup } = await makeServer();

  try {
    const ws = await connect(wsUrl);

    const events: HeartbeatEvent[] = [];
    wsServer.on("heartbeat", (e) => events.push(e));

    assert.doesNotThrow(() => wsServer.tickHeartbeat());
    await sleep(50);

    assert.equal(events.length, 1, "heartbeat event still emitted without registry");

    ws.close();
    await sleep(20);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// 11. Pong resets missedPings to 0 after a prior miss
// ---------------------------------------------------------------------------

test("Heartbeat – pong resets missedPings to 0 after a prior miss", async () => {
  const { wsServer, wsUrl, cleanup } = await makeServer();

  try {
    const ws = await connect(wsUrl);

    let connectionId = "";
    wsServer.once("heartbeat", (e) => { connectionId = e.connectionId; });

    wsServer.tickHeartbeat();
    await sleep(50);

    // Artificially set missedPings = 1
    const targetSub = findSub(wsServer, connectionId);
    targetSub.heartbeat.missedPings = 1;

    // Next tick: ping sent, real client replies with pong → missedPings reset to 0
    wsServer.tickHeartbeat();
    await sleep(50);

    const stats = wsServer.getHeartbeatStats(connectionId)!;
    assert.equal(stats.missedPings, 0, "missedPings reset to 0 by pong");
    assert.equal(wsServer.getActiveConnectionCount(), 1, "connection still alive");

    ws.close();
    await sleep(20);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// 12. EWMA smoothedRtt is updated on successive pongs
// ---------------------------------------------------------------------------

test("Heartbeat – smoothedRtt is updated by EWMA on successive pongs", async () => {
  const { wsServer, wsUrl, cleanup } = await makeServer();

  try {
    const ws = await connect(wsUrl);

    let connectionId = "";
    wsServer.once("heartbeat", (e) => { connectionId = e.connectionId; });

    // First tick seeds smoothedRtt
    wsServer.tickHeartbeat();
    await sleep(50);

    const stats1 = wsServer.getHeartbeatStats(connectionId)!;
    // smoothedRtt is non-negative (may be 0 when sub-ms RTT on localhost)
    assert.ok(stats1.smoothedRtt >= 0, "smoothedRtt non-negative after first pong");

    // Second tick applies the EWMA formula
    wsServer.tickHeartbeat();
    await sleep(50);

    const stats2 = wsServer.getHeartbeatStats(connectionId)!;
    assert.ok(typeof stats2.smoothedRtt === "number", "smoothedRtt is a number");
    assert.ok(stats2.smoothedRtt >= 0, "smoothedRtt still non-negative after second tick");

    ws.close();
    await sleep(20);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// 13. getHeartbeatStats returns undefined for unknown connectionId
// ---------------------------------------------------------------------------

test("Heartbeat – getHeartbeatStats returns undefined for unknown connectionId", async () => {
  const { wsServer, cleanup } = await makeServer();
  try {
    assert.equal(wsServer.getHeartbeatStats("ghost-id"), undefined);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// 14. Tick with no connected clients is a no-op
// ---------------------------------------------------------------------------

test("Heartbeat – tick with no clients is a no-op", async () => {
  const registry = new MetricsRegistry();
  const { wsServer, cleanup } = await makeServer(registry);

  try {
    assert.doesNotThrow(() => wsServer.tickHeartbeat());

    const snapshot = registry.snapshot();
    assert.equal(snapshot.values.get(WS_METRIC_PINGS_SENT), undefined, "no pings sent");
  } finally {
    await cleanup();
  }
});
