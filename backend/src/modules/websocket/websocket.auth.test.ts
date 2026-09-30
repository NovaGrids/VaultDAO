/**
 * Tests for WebSocket token authentication and constant-time comparison (Issue #1787).
 *
 * Verifies that token comparison is constant-time and length-safe across:
 * - Query parameter authentication (?token=...)
 * - Explicit "authenticate" message authentication
 * - Shared isValidKey constant-time comparison helper
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test, { describe, it } from "node:test";
import { WebSocket } from "ws";
import {
  EventWebSocketServer,
  WS_CLOSE_POLICY_VIOLATION,
} from "./websocket.server.js";
import { isValidKey } from "../../shared/http/auth.js";

async function startWsServer(
  authTimeoutMs = 5000,
): Promise<{ http: Server; wsServer: EventWebSocketServer; url: string }> {
  const http = createServer();
  const wsServer = new EventWebSocketServer(http, 100, undefined, {
    authTimeoutMs,
  });
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

function waitForMessage(
  ws: WebSocket,
  type: string,
  timeoutMs = 3000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${type}`)),
      timeoutMs,
    );
    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === type) {
          clearTimeout(timer);
          resolve(msg);
        }
      } catch {
        // ignore parse errors for other frames
      }
    });
  });
}

function withApiKey(key: string | undefined): () => void {
  const original = process.env["API_KEY"];
  if (key === undefined) delete process.env["API_KEY"];
  else process.env["API_KEY"] = key;
  return () => {
    if (original === undefined) delete process.env["API_KEY"];
    else process.env["API_KEY"] = original;
  };
}

describe("isValidKey constant-time comparison helper", () => {
  const expectedKey = "test-secret-api-key-12345";

  it("accepts an exact matching key", () => {
    assert.equal(isValidKey(expectedKey, expectedKey), true);
  });

  it("rejects an incorrect key of the same length", () => {
    const wrongSameLength = "test-secret-api-key-99999";
    assert.equal(wrongSameLength.length, expectedKey.length);
    assert.equal(isValidKey(wrongSameLength, expectedKey), false);
  });

  it("rejects an incorrect key of a shorter length", () => {
    const shorter = "short";
    assert.notEqual(shorter.length, expectedKey.length);
    assert.equal(isValidKey(shorter, expectedKey), false);
  });

  it("rejects an incorrect key of a longer length", () => {
    const longer = "test-secret-api-key-12345-extra-long-suffix";
    assert.notEqual(longer.length, expectedKey.length);
    assert.equal(isValidKey(longer, expectedKey), false);
  });

  it("rejects an empty token", () => {
    assert.equal(isValidKey("", expectedKey), false);
  });

  it("rejects non-string input safely without throwing", () => {
    assert.equal(isValidKey(undefined as any, expectedKey), false);
    assert.equal(isValidKey(null as any, expectedKey), false);
    assert.equal(isValidKey(12345 as any, expectedKey), false);
    assert.equal(isValidKey({} as any, expectedKey), false);
  });
});

describe("WebSocket Query Param Authentication", () => {
  const apiKey = "ws-secret-key-123";

  it("accepts a correct token via query parameter and authenticates immediately", async () => {
    const restore = withApiKey(apiKey);
    const { http, wsServer, url } = await startWsServer();
    try {
      const ws = new WebSocket(`${url}?token=${apiKey}`);
      await waitForOpen(ws);

      // Verify connection is alive and can subscribe immediately
      ws.send(JSON.stringify({ type: "subscribe", topics: ["proposal_created"] }));
      const subMsg = await waitForMessage(ws, "subscribed");
      assert.equal(subMsg.type, "subscribed");
      ws.close();
    } finally {
      await stopWsServer(http, wsServer);
      restore();
    }
  });

  it("rejects an incorrect token of the same length via query parameter with 4401", async () => {
    const restore = withApiKey(apiKey);
    const { http, wsServer, url } = await startWsServer();
    try {
      const wrongSameLen = "ws-secret-key-999";
      assert.equal(wrongSameLen.length, apiKey.length);

      const ws = new WebSocket(`${url}?token=${wrongSameLen}`);
      const { code, reason } = await waitForClose(ws);
      assert.equal(code, 4401);
      assert.match(reason, /Unauthorized/);
    } finally {
      await stopWsServer(http, wsServer);
      restore();
    }
  });

  it("rejects an incorrect token of a different length via query parameter with 4401", async () => {
    const restore = withApiKey(apiKey);
    const { http, wsServer, url } = await startWsServer();
    try {
      // Shorter token
      const wsShort = new WebSocket(`${url}?token=short`);
      const { code: codeShort, reason: reasonShort } = await waitForClose(wsShort);
      assert.equal(codeShort, 4401);
      assert.match(reasonShort, /Unauthorized/);

      // Longer token
      const wsLong = new WebSocket(`${url}?token=${apiKey}-longer-token-param`);
      const { code: codeLong, reason: reasonLong } = await waitForClose(wsLong);
      assert.equal(codeLong, 4401);
      assert.match(reasonLong, /Unauthorized/);
    } finally {
      await stopWsServer(http, wsServer);
      restore();
    }
  });

  it("rejects an empty query param token with 4401", async () => {
    const restore = withApiKey(apiKey);
    const { http, wsServer, url } = await startWsServer();
    try {
      const ws = new WebSocket(`${url}?token=`);
      const { code, reason } = await waitForClose(ws);
      assert.equal(code, 4401);
      assert.match(reason, /Unauthorized/);
    } finally {
      await stopWsServer(http, wsServer);
      restore();
    }
  });

  it("allows connection without query param token into connecting state", async () => {
    const restore = withApiKey(apiKey);
    const { http, wsServer, url } = await startWsServer();
    try {
      const ws = new WebSocket(url);
      await waitForOpen(ws);
      assert.equal(ws.readyState, WebSocket.OPEN);
      assert.equal(wsServer.getActiveConnectionCount(), 1);
      ws.close();
    } finally {
      await stopWsServer(http, wsServer);
      restore();
    }
  });
});

describe("WebSocket Authenticate Message Authentication", () => {
  const apiKey = "ws-message-auth-key-456";

  it("accepts a correct token via authenticate message", async () => {
    const restore = withApiKey(apiKey);
    const { http, wsServer, url } = await startWsServer();
    try {
      const ws = new WebSocket(url);
      await waitForOpen(ws);

      const authedPromise = waitForMessage(ws, "authenticated");
      ws.send(JSON.stringify({ type: "authenticate", token: apiKey }));
      const authedMsg = await authedPromise;
      assert.equal(authedMsg.type, "authenticated");

      // Verify connection can now subscribe
      ws.send(JSON.stringify({ type: "subscribe", topics: ["proposal_created"] }));
      const subMsg = await waitForMessage(ws, "subscribed");
      assert.equal(subMsg.type, "subscribed");
      ws.close();
    } finally {
      await stopWsServer(http, wsServer);
      restore();
    }
  });

  it("rejects an incorrect token of the same length via authenticate message with 1008", async () => {
    const restore = withApiKey(apiKey);
    const { http, wsServer, url } = await startWsServer();
    try {
      const ws = new WebSocket(url);
      await waitForOpen(ws);

      const wrongSameLen = "ws-message-auth-key-999";
      assert.equal(wrongSameLen.length, apiKey.length);

      const closePromise = waitForClose(ws);
      ws.send(JSON.stringify({ type: "authenticate", token: wrongSameLen }));
      const { code, reason } = await closePromise;
      assert.equal(code, WS_CLOSE_POLICY_VIOLATION);
      assert.match(reason, /Policy Violation: invalid token/);
    } finally {
      await stopWsServer(http, wsServer);
      restore();
    }
  });

  it("rejects an incorrect token of a different length via authenticate message with 1008", async () => {
    const restore = withApiKey(apiKey);
    const { http, wsServer, url } = await startWsServer();
    try {
      // Shorter token
      const wsShort = new WebSocket(url);
      await waitForOpen(wsShort);
      const closeShortPromise = waitForClose(wsShort);
      wsShort.send(JSON.stringify({ type: "authenticate", token: "short" }));
      const { code: codeShort, reason: reasonShort } = await closeShortPromise;
      assert.equal(codeShort, WS_CLOSE_POLICY_VIOLATION);
      assert.match(reasonShort, /Policy Violation: invalid token/);

      // Longer token
      const wsLong = new WebSocket(url);
      await waitForOpen(wsLong);
      const closeLongPromise = waitForClose(wsLong);
      wsLong.send(
        JSON.stringify({
          type: "authenticate",
          token: `${apiKey}-extra-length-characters`,
        }),
      );
      const { code: codeLong, reason: reasonLong } = await closeLongPromise;
      assert.equal(codeLong, WS_CLOSE_POLICY_VIOLATION);
      assert.match(reasonLong, /Policy Violation: invalid token/);
    } finally {
      await stopWsServer(http, wsServer);
      restore();
    }
  });

  it("rejects an empty or missing token via authenticate message with 1008", async () => {
    const restore = withApiKey(apiKey);
    const { http, wsServer, url } = await startWsServer();
    try {
      // Empty string token
      const wsEmpty = new WebSocket(url);
      await waitForOpen(wsEmpty);
      const closeEmptyPromise = waitForClose(wsEmpty);
      wsEmpty.send(JSON.stringify({ type: "authenticate", token: "" }));
      const { code: codeEmpty, reason: reasonEmpty } = await closeEmptyPromise;
      assert.equal(codeEmpty, WS_CLOSE_POLICY_VIOLATION);
      assert.match(reasonEmpty, /Policy Violation: invalid token/);

      // Missing token field entirely
      const wsMissing = new WebSocket(url);
      await waitForOpen(wsMissing);
      const closeMissingPromise = waitForClose(wsMissing);
      wsMissing.send(JSON.stringify({ type: "authenticate" }));
      const { code: codeMissing, reason: reasonMissing } = await closeMissingPromise;
      assert.equal(codeMissing, WS_CLOSE_POLICY_VIOLATION);
      assert.match(reasonMissing, /Policy Violation: invalid token/);
    } finally {
      await stopWsServer(http, wsServer);
      restore();
    }
  });
});
