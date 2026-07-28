/**
 * Tests for subscribe-filter validation (malformed filters are rejected with
 * a clear error instead of crashing the subscribe/normalize path).
 *
 * Constructs EventWebSocketServer directly against a plain node http.Server
 * rather than going through server.ts, so this suite stays independent of
 * unrelated modules wired into the full app.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { EventWebSocketServer } from "./websocket.server.js";

function waitForMessage(
  ws: WebSocket,
  predicate: (msg: any) => boolean,
  timeoutMs = 2000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("timed out waiting for message")),
      timeoutMs,
    );
    const handler = (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (predicate(msg)) {
        clearTimeout(timeout);
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

async function withServer(
  fn: (wsUrl: string) => Promise<void>,
): Promise<void> {
  const httpServer = createServer();
  const wsServer = new EventWebSocketServer(httpServer);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address: any = httpServer.address();
  const wsUrl = `ws://127.0.0.1:${address.port}`;

  try {
    await fn(wsUrl);
  } finally {
    wsServer.stop();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
}

test("subscribe filter validation", async (t) => {
  await t.test("valid topics still subscribe successfully", () =>
    withServer(async (wsUrl) => {
      const ws = new WebSocket(wsUrl);
      await new Promise((resolve) => ws.on("open", resolve));

      ws.send(JSON.stringify({ type: "subscribe", topics: ["proposal_executed"] }));
      const confirmation = await waitForMessage(ws, (m) => m.type === "subscribed");
      assert.deepEqual(confirmation.topics, ["proposal_executed"]);

      ws.close();
    }),
  );

  await t.test(
    "non-string topic entries are rejected with INVALID_FILTER instead of crashing the connection",
    () =>
      withServer(async (wsUrl) => {
        const ws = new WebSocket(wsUrl);
        await new Promise((resolve) => ws.on("open", resolve));

        ws.send(
          JSON.stringify({
            type: "subscribe",
            topics: ["proposal_executed", 42, { evil: true }],
          }),
        );

        const err = await waitForMessage(ws, (m) => m.type === "error");
        assert.equal(err.code, "INVALID_FILTER");
        assert.ok(Array.isArray(err.errors) && err.errors.length > 0);

        // Connection must still be alive and usable afterwards.
        ws.send(JSON.stringify({ type: "subscribe", topics: ["proposal_executed"] }));
        const confirmation = await waitForMessage(ws, (m) => m.type === "subscribed");
        assert.deepEqual(confirmation.topics, ["proposal_executed"]);

        ws.close();
      }),
  );

  await t.test("SQL-like topic strings are rejected", () =>
    withServer(async (wsUrl) => {
      const ws = new WebSocket(wsUrl);
      await new Promise((resolve) => ws.on("open", resolve));

      ws.send(
        JSON.stringify({
          type: "subscribe",
          topics: ["x'; DROP TABLE events; --"],
        }),
      );

      const err = await waitForMessage(ws, (m) => m.type === "error");
      assert.equal(err.code, "INVALID_FILTER");

      ws.close();
    }),
  );

  await t.test("oversized topic arrays are rejected", () =>
    withServer(async (wsUrl) => {
      const ws = new WebSocket(wsUrl);
      await new Promise((resolve) => ws.on("open", resolve));

      const tooMany = Array.from({ length: 51 }, (_, i) => `topic_${i}`);
      ws.send(JSON.stringify({ type: "subscribe", topics: tooMany }));

      const err = await waitForMessage(ws, (m) => m.type === "error");
      assert.equal(err.code, "INVALID_FILTER");
      assert.ok(err.errors.some((e: string) => e.includes("at most 50")));

      ws.close();
    }),
  );

  await t.test("legacy payload.eventTypes form is still validated the same way", () =>
    withServer(async (wsUrl) => {
      const ws = new WebSocket(wsUrl);
      await new Promise((resolve) => ws.on("open", resolve));

      ws.send(
        JSON.stringify({ type: "subscribe", payload: { eventTypes: [null, 1] } }),
      );

      const err = await waitForMessage(ws, (m) => m.type === "error");
      assert.equal(err.code, "INVALID_FILTER");

      ws.close();
    }),
  );
});
