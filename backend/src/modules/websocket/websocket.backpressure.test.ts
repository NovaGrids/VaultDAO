/**
 * Tests for WebSocket backpressure handling (Issue #1950).
 *
 * A client that stops reading must not accumulate every broadcast in the
 * server's socket buffer. The server should skip or drop such a client,
 * close it after a grace period with a dedicated close code, count dropped
 * messages in the metrics registry, and keep serving healthy clients.
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { WebSocket } from "ws";
import { EventWebSocketServer } from "./websocket.server.js";
import { MetricsRegistry } from "../health/metrics.registry.js";
import type { ContractEvent } from "../events/events.types.js";

const LARGE_PAYLOAD = "x".repeat(256 * 1024);
const FLOOD_EVENT_COUNT = 200;
const CLOSE_TIMEOUT_MS = 15_000;

async function startWsServer(
  metrics: MetricsRegistry,
): Promise<{ http: Server; wsServer: EventWebSocketServer; url: string }> {
  const http = createServer();
  const wsServer = new EventWebSocketServer(http, metrics, 100);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address: any = http.address();
  return { http, wsServer, url: `ws://127.0.0.1:${address.port}` };
}

async function stopWsServer(http: Server, wsServer: EventWebSocketServer) {
  wsServer.stop();
  http.closeAllConnections?.();
  await new Promise<void>((resolve) => http.close(() => resolve()));
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

function waitForClose(ws: WebSocket, timeoutMs = CLOSE_TIMEOUT_MS): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for close")),
      timeoutMs,
    );
    ws.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function makeEvent(id: number): ContractEvent {
  return {
    id: `backpressure-event-${id}`,
    contractId: "CDTEST",
    topic: ["proposal_created", String(id)],
    value: { proposal_id: String(id), blob: LARGE_PAYLOAD },
    ledger: id,
    ledgerClosedAt: new Date().toISOString(),
  };
}

test("a client that stops reading is closed with an application close code", async () => {
  const metrics = new MetricsRegistry();
  const { http, wsServer, url } = await startWsServer(metrics);
  try {
    const stalled = new WebSocket(url);
    await waitForOpen(stalled);
    // Stop reading from the socket so the server's send buffer fills up.
    (stalled as any)._socket.pause();
    const closed = waitForClose(stalled);

    for (let i = 0; i < FLOOD_EVENT_COUNT; i++) {
      wsServer.broadcastEvent(makeEvent(i));
    }

    const code = await closed;
    assert.ok(code >= 4000, `expected an application close code (>= 4000), got ${code}`);
  } finally {
    await stopWsServer(http, wsServer);
  }
});

test("healthy clients keep receiving events while a stalled client is dropped", async () => {
  const metrics = new MetricsRegistry();
  const { http, wsServer, url } = await startWsServer(metrics);
  try {
    const stalled = new WebSocket(url);
    const healthy = new WebSocket(url);
    await Promise.all([waitForOpen(stalled), waitForOpen(healthy)]);
    (stalled as any)._socket.pause();

    let healthyReceived = 0;
    healthy.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "contract_event") healthyReceived++;
    });

    for (let i = 0; i < FLOOD_EVENT_COUNT; i++) {
      wsServer.broadcastEvent(makeEvent(i));
      await new Promise((resolve) => setImmediate(resolve));
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(healthyReceived, FLOOD_EVENT_COUNT);

    healthy.close();
    stalled.terminate();
  } finally {
    await stopWsServer(http, wsServer);
  }
});

test("messages dropped for slow clients are counted in the metrics registry", async () => {
  const metrics = new MetricsRegistry();
  const { http, wsServer, url } = await startWsServer(metrics);
  try {
    const stalled = new WebSocket(url);
    await waitForOpen(stalled);
    (stalled as any)._socket.pause();

    for (let i = 0; i < FLOOD_EVENT_COUNT; i++) {
      wsServer.broadcastEvent(makeEvent(i));
    }

    // The metric name is not fixed by the issue, so match any dropped-message counter.
    const rendered = metrics.render();
    assert.match(
      rendered,
      /^\S*dropped\S*(\{[^}]*\})?\s+[1-9]\d*/im,
      "expected a non-zero dropped-messages counter in the metrics output",
    );

    stalled.terminate();
  } finally {
    await stopWsServer(http, wsServer);
  }
});
