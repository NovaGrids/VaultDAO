/**
 * Tests for WebSocket subscription rate limiting per client (#1372).
 *
 * Covers both WebSocket implementations:
 *  - EventWebSocketServer (legacy event-broadcasting server)
 *  - RealtimeServer (new topic-based realtime server)
 */

import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { startServer } from "../../server.js";
import { RealtimeServer } from "../realtime/realtime-server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function waitForMessage(
  ws: WebSocket,
  predicate: (msg: any) => boolean,
  timeoutMs = 3000,
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

/** Collect all messages received within a short window. */
function collectMessages(ws: WebSocket, durationMs = 200): Promise<any[]> {
  return new Promise((resolve) => {
    const msgs: any[] = [];
    const handler = (data: Buffer) => msgs.push(JSON.parse(data.toString()));
    ws.on("message", handler);
    setTimeout(() => {
      ws.off("message", handler);
      resolve(msgs);
    }, durationMs);
  });
}

/** Register a mock connection directly into a RealtimeServer (mirrors realtime-streaming.test.ts). */
function registerMockConnection(
  server: RealtimeServer,
  id: string,
  recv: any[],
): void {
  const conn = {
    id,
    ws: {
      readyState: 1 /* OPEN */,
      ping: () => {},
      terminate: () => {},
      close: () => {},
    },
    lastPong: Date.now(),
    send: (msg: any) => recv.push(msg),
    close: () => {},
  };
  (server as any).connections.set(id, conn);
  (server as any).hooks.onConnected?.(id);
  conn.send({
    type: "hello",
    ts: new Date().toISOString(),
    payload: { connectionId: id, status: "connected" },
  });
}

// ---------------------------------------------------------------------------
// RealtimeServer — unit tests (no live HTTP server needed)
// ---------------------------------------------------------------------------

test("RealtimeServer subscription limits", async (t) => {
  await t.test("subscribe succeeds up to the configured limit", () => {
    const server = new RealtimeServer({ maxSubscriptionsPerClient: 3 });
    const recv: any[] = [];
    registerMockConnection(server, "c1", recv);

    for (let i = 1; i <= 3; i++) {
      const result = server.subscribe("c1", server.createTopic("proposal", String(i)));
      assert.equal(result, true, `subscribe #${i} should succeed`);
    }

    assert.equal(server.getSubscriptions("c1").size, 3);
  });

  await t.test("subscribe returns false and sends error envelope when limit is exceeded", () => {
    const server = new RealtimeServer({ maxSubscriptionsPerClient: 2 });
    const recv: any[] = [];
    registerMockConnection(server, "c2", recv);

    server.subscribe("c2", server.createTopic("proposal", "a"));
    server.subscribe("c2", server.createTopic("proposal", "b"));

    // Third subscribe should be rejected
    const result = server.subscribe("c2", server.createTopic("proposal", "c"));
    assert.equal(result, false, "subscribe beyond limit should return false");

    // Should not be added
    assert.equal(server.getSubscriptions("c2").size, 2);

    // An error envelope should have been delivered
    const errors = recv.filter((m) => m.type === "error");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].payload.code, "SUBSCRIPTION_LIMIT_REACHED");
    assert.equal(errors[0].payload.limit, 2);
    assert.equal(errors[0].payload.remaining, 0);
  });

  await t.test("error envelope includes the rejected topic", () => {
    const server = new RealtimeServer({ maxSubscriptionsPerClient: 1 });
    const recv: any[] = [];
    registerMockConnection(server, "c3", recv);

    server.subscribe("c3", server.createTopic("proposal", "first"));
    const rejectedTopic = server.createTopic("proposal", "second");
    server.subscribe("c3", rejectedTopic);

    const errors = recv.filter((m) => m.type === "error");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].topic, rejectedTopic);
  });

  await t.test("subscribe succeeds again after unsubscribing below the limit", () => {
    const server = new RealtimeServer({ maxSubscriptionsPerClient: 2 });
    const recv: any[] = [];
    registerMockConnection(server, "c4", recv);

    const t1 = server.createTopic("proposal", "1");
    const t2 = server.createTopic("proposal", "2");
    const t3 = server.createTopic("proposal", "3");

    server.subscribe("c4", t1);
    server.subscribe("c4", t2);

    // At limit — t3 rejected
    assert.equal(server.subscribe("c4", t3), false);

    // Free up a slot
    server.unsubscribe("c4", t1);
    assert.equal(server.getSubscriptions("c4").size, 1);

    // Now t3 should succeed
    assert.equal(server.subscribe("c4", t3), true);
    assert.equal(server.getSubscriptions("c4").size, 2);
  });

  await t.test("each client enforces its own independent limit", () => {
    const server = new RealtimeServer({ maxSubscriptionsPerClient: 2 });
    const recvA: any[] = [];
    const recvB: any[] = [];
    registerMockConnection(server, "cA", recvA);
    registerMockConnection(server, "cB", recvB);

    server.subscribe("cA", server.createTopic("proposal", "1"));
    server.subscribe("cA", server.createTopic("proposal", "2"));

    // cA is at limit — cB should still be able to subscribe freely
    assert.equal(server.subscribe("cB", server.createTopic("proposal", "3")), true);
    assert.equal(server.subscribe("cB", server.createTopic("proposal", "4")), true);

    // cA third sub is rejected
    assert.equal(
      server.subscribe("cA", server.createTopic("proposal", "5")),
      false,
    );
    // cB third sub is rejected
    assert.equal(
      server.subscribe("cB", server.createTopic("proposal", "6")),
      false,
    );

    assert.equal(recvA.filter((m) => m.type === "error").length, 1);
    assert.equal(recvB.filter((m) => m.type === "error").length, 1);
  });

  await t.test("default limit is 100", () => {
    const server = new RealtimeServer(); // no maxSubscriptionsPerClient
    const recv: any[] = [];
    registerMockConnection(server, "default-limit", recv);

    // Subscribe 100 topics — all should succeed
    for (let i = 0; i < 100; i++) {
      const ok = server.subscribe(
        "default-limit",
        server.createTopic("custom", `topic-${i}`),
      );
      assert.equal(ok, true, `topic ${i} should succeed`);
    }

    // 101st should be rejected
    const rejected = server.subscribe(
      "default-limit",
      server.createTopic("custom", "over-limit"),
    );
    assert.equal(rejected, false);
    assert.equal(server.getSubscriptions("default-limit").size, 100);

    const errors = recv.filter((m) => m.type === "error");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].payload.limit, 100);
    assert.equal(errors[0].payload.remaining, 0);
  });

  await t.test("limit of 0 rejects every subscription", () => {
    const server = new RealtimeServer({ maxSubscriptionsPerClient: 0 });
    const recv: any[] = [];
    registerMockConnection(server, "zero", recv);

    const result = server.subscribe("zero", server.createTopic("proposal", "x"));
    assert.equal(result, false);
    assert.equal(server.getSubscriptions("zero").size, 0);
    assert.equal(recv.filter((m) => m.type === "error").length, 1);
  });

  await t.test("subscription count resets to zero after unregisterConnection", () => {
    const server = new RealtimeServer({ maxSubscriptionsPerClient: 3 });
    const recv: any[] = [];
    registerMockConnection(server, "cleanup", recv);

    server.subscribe("cleanup", server.createTopic("proposal", "1"));
    server.subscribe("cleanup", server.createTopic("proposal", "2"));
    assert.equal(server.getSubscriptions("cleanup").size, 2);

    server.unregisterConnection("cleanup");
    assert.equal(server.getSubscriptions("cleanup").size, 0);
    assert.equal(server.getConnectionCount(), 0);
  });
});

// ---------------------------------------------------------------------------
// EventWebSocketServer — integration tests via live HTTP server
// ---------------------------------------------------------------------------

test("EventWebSocketServer subscription limits", async (t) => {
  // Use maxSubscriptionsPerClient: 3 via env override so tests run quickly
  const mockEnv = {
    port: 0,
    host: "127.0.0.1",
    nodeEnv: "test",
    stellarNetwork: "testnet",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    contractId: "CDTEST",
    websocketUrl: "ws://localhost:8080",
    eventPollingIntervalMs: 100,
    eventPollingEnabled: false,
    wsMaxSubscriptionsPerClient: 3,
  };

  const { server, runtime } = await startServer(mockEnv as any);

  if (!server.listening) {
    await new Promise((resolve) => server.once("listening", resolve));
  }

  const address: any = server.address();
  const wsUrl = `ws://127.0.0.1:${address.port}`;

  await t.test(
    "subscribing exactly at the limit succeeds without error",
    async () => {
      const ws = new WebSocket(wsUrl);
      await new Promise((resolve) => ws.on("open", resolve));

      ws.send(
        JSON.stringify({
          type: "subscribe",
          topics: ["proposal_created", "proposal_approved", "proposal_executed"],
        }),
      );

      const confirmation = await waitForMessage(ws, (m) => m.type === "subscribed");
      assert.ok(
        Array.isArray(confirmation.topics),
        "confirmation should have topics array",
      );
      assert.equal(confirmation.topics.length, 3);

      ws.close();
    },
  );

  await t.test(
    "subscribing beyond the limit returns an error with code SUBSCRIPTION_LIMIT_REACHED",
    async () => {
      const ws = new WebSocket(wsUrl);
      await new Promise((resolve) => ws.on("open", resolve));

      // Subscribe up to the limit
      ws.send(
        JSON.stringify({
          type: "subscribe",
          topics: ["proposal_created", "proposal_approved", "proposal_executed"],
        }),
      );
      await waitForMessage(ws, (m) => m.type === "subscribed");

      // Start collecting messages, then try to add a 4th subscription
      const future = collectMessages(ws, 400);
      ws.send(
        JSON.stringify({ type: "subscribe", topics: ["insurance_locked"] }),
      );
      const msgs = await future;

      const errors = msgs.filter((m) => m.type === "error");
      assert.equal(errors.length, 1, "should receive exactly one error");
      assert.equal(errors[0].code, "SUBSCRIPTION_LIMIT_REACHED");
      assert.equal(errors[0].limit, 3);
      assert.equal(errors[0].remaining, 0);

      ws.close();
    },
  );

  await t.test(
    "error message mentions the configured limit",
    async () => {
      const ws = new WebSocket(wsUrl);
      await new Promise((resolve) => ws.on("open", resolve));

      ws.send(
        JSON.stringify({
          type: "subscribe",
          topics: ["proposal_created", "proposal_approved", "proposal_executed"],
        }),
      );
      await waitForMessage(ws, (m) => m.type === "subscribed");

      const future = collectMessages(ws, 400);
      ws.send(JSON.stringify({ type: "subscribe", topics: ["proposal_vetoed"] }));
      const msgs = await future;

      const err = msgs.find((m) => m.type === "error");
      assert.ok(err, "error message should be present");
      assert.ok(
        typeof err.message === "string" && err.message.includes("3"),
        `error message should mention limit 3, got: ${err.message}`,
      );

      ws.close();
    },
  );

  await t.test(
    "clients do not affect each other's subscription quota",
    async () => {
      const wsA = new WebSocket(wsUrl);
      const wsB = new WebSocket(wsUrl);

      await Promise.all([
        new Promise((resolve) => wsA.on("open", resolve)),
        new Promise((resolve) => wsB.on("open", resolve)),
      ]);

      // Fill client A's quota
      wsA.send(
        JSON.stringify({
          type: "subscribe",
          topics: ["proposal_created", "proposal_approved", "proposal_executed"],
        }),
      );
      await waitForMessage(wsA, (m) => m.type === "subscribed");

      // Client B should still be able to subscribe up to its own limit
      wsB.send(
        JSON.stringify({
          type: "subscribe",
          topics: ["proposal_created", "proposal_approved", "proposal_executed"],
        }),
      );
      const confirmB = await waitForMessage(wsB, (m) => m.type === "subscribed");
      assert.equal(
        confirmB.topics.length,
        3,
        "client B should receive 3 confirmed topics",
      );

      wsA.close();
      wsB.close();
    },
  );

  // Teardown
  runtime.wsServer?.stop();
  await runtime.jobManager.stopAll();
  if (typeof (server as any).closeAllConnections === "function") {
    (server as any).closeAllConnections();
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});
