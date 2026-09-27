/**
 * Tests for WebSocket auth deadline and connection caps.
 *
 * - Clients that connect without a token while API_KEY is set start in the
 *   "connecting" state and are closed (4408) if they do not authenticate
 *   within the configured deadline — heartbeats no longer keep them alive.
 * - Global and per-IP connection limits close excess connections with 1013.
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { WebSocket } from "ws";
import {
  EventWebSocketServer,
  WS_CLOSE_AUTH_TIMEOUT,
  WS_CLOSE_TRY_AGAIN_LATER,
  type WebSocketConnectionLimits,
} from "./websocket.server.js";

async function startWsServer(
  limits: WebSocketConnectionLimits,
): Promise<{ http: Server; wsServer: EventWebSocketServer; url: string }> {
  const http = createServer();
  const wsServer = new EventWebSocketServer(http, 100, undefined, limits);
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

function waitForClose(
  ws: WebSocket,
  timeoutMs = 3000,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for close")),
      timeoutMs,
    );
    ws.once("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

function waitForMessage(ws: WebSocket, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${type}`)),
      3000,
    );
    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withApiKey(key: string | undefined): () => void {
  const original = process.env["API_KEY"];
  if (key === undefined) delete process.env["API_KEY"];
  else process.env["API_KEY"] = key;
  return () => {
    if (original === undefined) delete process.env["API_KEY"];
    else process.env["API_KEY"] = original;
  };
}

// ---------------------------------------------------------------------------
// Auth deadline
// ---------------------------------------------------------------------------

test("auth deadline: unauthenticated client is closed after the deadline", async () => {
  const restore = withApiKey("deadline-key");
  const { http, wsServer, url } = await startWsServer({ authTimeoutMs: 150 });
  try {
    const ws = new WebSocket(url);
    const closed = waitForClose(ws);
    await waitForOpen(ws);
    assert.equal(wsServer.getActiveConnectionCount(), 1);

    // Heartbeats must not keep an unauthenticated connection alive.
    wsServer.tickHeartbeat();

    const { code, reason } = await closed;
    assert.equal(code, WS_CLOSE_AUTH_TIMEOUT);
    assert.match(reason, /Authentication timeout/);
    await sleep(20);
    assert.equal(wsServer.getActiveConnectionCount(), 0);
  } finally {
    await stopWsServer(http, wsServer);
    restore();
  }
});

test("auth deadline: client that authenticates in time stays connected", async () => {
  const restore = withApiKey("deadline-key");
  const { http, wsServer, url } = await startWsServer({ authTimeoutMs: 150 });
  try {
    const ws = new WebSocket(url);
    await waitForOpen(ws);

    const authed = waitForMessage(ws, "authenticated");
    ws.send(JSON.stringify({ type: "authenticate", token: "deadline-key" }));
    await authed;

    await sleep(300);
    assert.equal(ws.readyState, WebSocket.OPEN);
    assert.equal(wsServer.getActiveConnectionCount(), 1);

    ws.send(JSON.stringify({ type: "subscribe", topics: ["proposal_created"] }));
    await waitForMessage(ws, "subscribed");
    ws.close();
  } finally {
    await stopWsServer(http, wsServer);
    restore();
  }
});

test("auth deadline: wrong query-param token is still rejected with 4401", async () => {
  const restore = withApiKey("deadline-key");
  const { http, wsServer, url } = await startWsServer({ authTimeoutMs: 5_000 });
  try {
    const ws = new WebSocket(`${url}?token=nope`);
    const { code } = await waitForClose(ws);
    assert.equal(code, 4401);
  } finally {
    await stopWsServer(http, wsServer);
    restore();
  }
});

test("auth deadline: no timer applies when API_KEY is not configured", async () => {
  const restore = withApiKey(undefined);
  const { http, wsServer, url } = await startWsServer({ authTimeoutMs: 100 });
  try {
    const ws = new WebSocket(url);
    await waitForOpen(ws);
    await sleep(250);
    assert.equal(ws.readyState, WebSocket.OPEN);
    ws.close();
  } finally {
    await stopWsServer(http, wsServer);
    restore();
  }
});

// ---------------------------------------------------------------------------
// Connection limits
// ---------------------------------------------------------------------------

test("per-IP limit: connections beyond the cap are closed with 1013", async () => {
  const restore = withApiKey(undefined);
  const { http, wsServer, url } = await startWsServer({
    maxConnectionsPerIp: 2,
    maxConnections: 100,
  });
  try {
    const a = new WebSocket(url);
    const b = new WebSocket(url);
    await Promise.all([waitForOpen(a), waitForOpen(b)]);

    const c = new WebSocket(url);
    const { code, reason } = await waitForClose(c);
    assert.equal(code, WS_CLOSE_TRY_AGAIN_LATER);
    assert.match(reason, /Per-IP/);
    assert.equal(wsServer.getActiveConnectionCount(), 2);

    // Closing one frees a slot for the same IP.
    const aClosed = waitForClose(a);
    a.close();
    await aClosed;
    await sleep(20);

    const d = new WebSocket(url);
    await waitForOpen(d);
    assert.equal(wsServer.getActiveConnectionCount(), 2);

    b.close();
    d.close();
  } finally {
    await stopWsServer(http, wsServer);
    restore();
  }
});

test("global limit: connections beyond the cap are closed with 1013", async () => {
  const restore = withApiKey(undefined);
  const { http, wsServer, url } = await startWsServer({
    maxConnections: 1,
    maxConnectionsPerIp: 100,
  });
  try {
    const a = new WebSocket(url);
    await waitForOpen(a);

    const b = new WebSocket(url);
    const { code, reason } = await waitForClose(b);
    assert.equal(code, WS_CLOSE_TRY_AGAIN_LATER);
    assert.match(reason, /Server connection limit/);
    assert.equal(wsServer.getActiveConnectionCount(), 1);
    a.close();
  } finally {
    await stopWsServer(http, wsServer);
    restore();
  }
});

test("rejected connections do not consume per-IP slots", async () => {
  const restore = withApiKey("slot-key");
  const { http, wsServer, url } = await startWsServer({
    maxConnectionsPerIp: 1,
  });
  try {
    // Wrong token is rejected before accounting.
    const bad = new WebSocket(`${url}?token=wrong`);
    await waitForClose(bad);

    const good = new WebSocket(`${url}?token=slot-key`);
    await waitForOpen(good);
    assert.equal(wsServer.getActiveConnectionCount(), 1);
    good.close();
  } finally {
    await stopWsServer(http, wsServer);
    restore();
  }
});
