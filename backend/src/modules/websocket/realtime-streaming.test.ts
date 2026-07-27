/**
 * Unit tests for WebSocket room-based proposal streaming.
 *
 * Covers:
 *  - RealtimeServer: subscribe, multi-subscriber delivery, connection cleanup, lifecycle hooks
 *  - ProposalActivityConsumer onActivity hook
 *
 * Integration tests (EventWebSocketServer with a live HTTP server) are in
 * realtime-streaming.integration.test.ts and require better-sqlite3.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { RealtimeServer } from "../realtime/realtime-server.js";
import { ProposalActivityConsumer } from "../proposals/consumer.js";
import type { NormalizedEvent } from "../events/types.js";
import { EventType } from "../events/types.js";

// ---------------------------------------------------------------------------
// Test-only helper: register a mock connection directly into RealtimeServer
// ---------------------------------------------------------------------------

function registerMockConnection(
  server: RealtimeServer,
  id: string,
  recv: any[],
): void {
  // Access private map directly for testing
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
// RealtimeServer unit tests
// ---------------------------------------------------------------------------

test("RealtimeServer", async (t) => {
  await t.test("subscribe and deliver to single connection", () => {
    const server = new RealtimeServer();
    const received: any[] = [];

    registerMockConnection(server, "conn-1", received);
    const topic = server.createTopic("proposal", "123");
    server.subscribe("conn-1", topic);
    server.broadcast(topic, { status: "CREATED" });

    const events = received.filter((m) => m.type === "event");
    assert.equal(events.length, 1);
    assert.equal((events[0].payload as any).status, "CREATED");
  });

  await t.test(
    "multi-subscriber delivery — both connections receive broadcast",
    () => {
      const server = new RealtimeServer();
      const recv1: any[] = [];
      const recv2: any[] = [];

      registerMockConnection(server, "c1", recv1);
      registerMockConnection(server, "c2", recv2);

      const topic = server.createTopic("proposal", "456");
      server.subscribe("c1", topic);
      server.subscribe("c2", topic);

      const count = server.broadcast(topic, { status: "APPROVED" });

      assert.equal(count, 2);
      assert.equal(recv1.filter((m) => m.type === "event").length, 1);
      assert.equal(recv2.filter((m) => m.type === "event").length, 1);
    },
  );

  await t.test("unregisterConnection cleans up subscriptions", () => {
    const server = new RealtimeServer();
    registerMockConnection(server, "c3", []);

    const topic = server.createTopic("proposal", "789");
    server.subscribe("c3", topic);
    assert.equal(server.getSubscriptions("c3").size, 1);

    server.unregisterConnection("c3");
    assert.equal(server.getConnectionCount(), 0);
    assert.equal(server.getSubscriptions("c3").size, 0);

    // Broadcast to now-empty topic should deliver 0
    assert.equal(server.broadcast(topic, {}), 0);
  });

  await t.test(
    "broadcastProposalActivity delivers to proposal and contract topics",
    () => {
      const server = new RealtimeServer();
      const recv4: any[] = [];
      const recv5: any[] = [];

      registerMockConnection(server, "c4", recv4);
      registerMockConnection(server, "c5", recv5);

      // c4 subscribes to proposal topic, c5 to contract topic
      server.subscribe("c4", server.createTopic("proposal", "10"));
      server.subscribe("c5", server.createTopic("proposal", "contract-CDTEST"));

      server.broadcastProposalActivity({
        proposalId: "10",
        type: "PROPOSAL_EXECUTED",
        metadata: { contractId: "CDTEST" },
        data: { amount: "100" },
      });

      assert.equal(recv4.filter((m) => m.type === "event").length, 1);
      assert.equal(recv5.filter((m) => m.type === "event").length, 1);
    },
  );

  await t.test(
    "lifecycle hooks are called on connect/disconnect/subscribe",
    () => {
      const log: string[] = [];
      const server = new RealtimeServer({
        onConnected: (id) => log.push(`connected:${id}`),
        onDisconnected: (id) => log.push(`disconnected:${id}`),
        onSubscribed: (id, topic) => log.push(`subscribed:${id}:${topic}`),
      });

      registerMockConnection(server, "hook-conn", []);
      const topic = server.createTopic("activity", "ledger");
      server.subscribe("hook-conn", topic);
      server.unregisterConnection("hook-conn");

      assert.ok(log.includes("connected:hook-conn"));
      assert.ok(log.includes(`subscribed:hook-conn:${topic}`));
      assert.ok(log.includes("disconnected:hook-conn"));
    },
  );

  await t.test("subscribe returns false for unknown connection", () => {
    const server = new RealtimeServer();
    const topic = server.createTopic("proposal", "999");
    assert.equal(server.subscribe("ghost", topic), false);
  });

  await t.test("duplicate subscribe returns false", () => {
    const server = new RealtimeServer();
    registerMockConnection(server, "dup", []);
    const topic = server.createTopic("proposal", "dup");
    assert.equal(server.subscribe("dup", topic), true);
    assert.equal(server.subscribe("dup", topic), false);
  });

  await t.test("unsubscribe stops delivery", () => {
    const server = new RealtimeServer();
    const recv: any[] = [];
    registerMockConnection(server, "unsub", recv);

    const topic = server.createTopic("proposal", "unsub");
    server.subscribe("unsub", topic);
    server.unsubscribe("unsub", topic);

    server.broadcast(topic, { status: "VETOED" });
    assert.equal(recv.filter((m) => m.type === "event").length, 0);
  });

  await t.test("getConnectionCount reflects active connections", () => {
    const server = new RealtimeServer();
    assert.equal(server.getConnectionCount(), 0);
    registerMockConnection(server, "cnt-1", []);
    assert.equal(server.getConnectionCount(), 1);
    registerMockConnection(server, "cnt-2", []);
    assert.equal(server.getConnectionCount(), 2);
    server.unregisterConnection("cnt-1");
    assert.equal(server.getConnectionCount(), 1);
  });

  // ---------------------------------------------------------------------------
  // Unsubscribe cleanup verification (#1373)
  // ---------------------------------------------------------------------------

  await t.test(
    "no events delivered after unsubscribe — subscription fully cleaned up",
    () => {
      const server = new RealtimeServer();
      const recv: any[] = [];
      registerMockConnection(server, "cleanup-1", recv);

      const topic = server.createTopic("proposal", "cleanup");
      server.subscribe("cleanup-1", topic);

      // Sanity: broadcast reaches the subscriber before unsubscribe
      const beforeCount = server.broadcast(topic, { before: true });
      assert.equal(beforeCount, 1, "should deliver before unsubscribe");

      // Unsubscribe
      const removed = server.unsubscribe("cleanup-1", topic);
      assert.equal(removed, true, "unsubscribe should return true");

      // Verify subscription is gone from registry
      assert.equal(
        server.getSubscriptions("cleanup-1").has(topic),
        false,
        "topic must not remain in subscriptions after unsubscribe",
      );

      // Clear received messages, then broadcast again
      recv.length = 0;
      const afterCount = server.broadcast(topic, { after: true });
      assert.equal(afterCount, 0, "no events should be delivered after unsubscribe");

      const events = recv.filter((m) => m.type === "event");
      assert.equal(events.length, 0, "recv buffer must contain no events after unsubscribe");
    },
  );

  await t.test(
    "unsubscribed envelope carries subscriber identity and topic",
    () => {
      const server = new RealtimeServer();
      const recv: any[] = [];
      registerMockConnection(server, "payload-check", recv);

      const topic = server.createTopic("proposal", "payload-check");
      server.subscribe("payload-check", topic);

      // Clear hello/subscribed messages
      recv.length = 0;

      server.unsubscribe("payload-check", topic);

      const envelope = recv.find((m) => m.type === "unsubscribed");
      assert.ok(envelope, "unsubscribed envelope must be delivered");
      assert.equal(
        (envelope.payload as any).subscriber,
        "payload-check",
        "envelope payload must include subscriber identity",
      );
      assert.equal(
        (envelope.payload as any).topic,
        topic,
        "envelope payload must include the unsubscribed topic",
      );
    },
  );

  await t.test(
    "unsubscribe returns false and emits no event for unknown topic",
    () => {
      const server = new RealtimeServer();
      const recv: any[] = [];
      registerMockConnection(server, "noop-check", recv);

      const topic = server.createTopic("proposal", "never-subscribed");

      // Clear hello message
      recv.length = 0;

      const removed = server.unsubscribe("noop-check", topic);
      assert.equal(removed, false, "unsubscribe of unknown topic must return false");

      const envelope = recv.find((m) => m.type === "unsubscribed");
      assert.equal(envelope, undefined, "no unsubscribed envelope when topic was not subscribed");
    },
  );

  await t.test(
    "unsubscribe one topic does not affect other subscriptions",
    () => {
      const server = new RealtimeServer();
      const recv: any[] = [];
      registerMockConnection(server, "partial-unsub", recv);

      const topicA = server.createTopic("proposal", "keep");
      const topicB = server.createTopic("proposal", "remove");

      server.subscribe("partial-unsub", topicA);
      server.subscribe("partial-unsub", topicB);

      server.unsubscribe("partial-unsub", topicB);

      // topicA must still be active
      assert.equal(
        server.getSubscriptions("partial-unsub").has(topicA),
        true,
        "retained topic must still be in subscriptions",
      );
      assert.equal(
        server.getSubscriptions("partial-unsub").has(topicB),
        false,
        "removed topic must not be in subscriptions",
      );

      // Broadcast to topicA still reaches the client; topicB does not
      recv.length = 0;
      assert.equal(server.broadcast(topicA, { t: "A" }), 1);
      assert.equal(server.broadcast(topicB, { t: "B" }), 0);

      const events = recv.filter((m) => m.type === "event");
      assert.equal(events.length, 1);
      assert.equal((events[0].payload as any).t, "A");
    },
  );

  await t.test(
    "onUnsubscribed lifecycle hook fires after successful unsubscribe",
    () => {
      const fired: Array<{ id: string; topic: string }> = [];
      const server = new RealtimeServer({
        onUnsubscribed: (id, topic) => fired.push({ id, topic }),
      });

      registerMockConnection(server, "hook-unsub", []);
      const topic = server.createTopic("activity", "hook-test");
      server.subscribe("hook-unsub", topic);
      server.unsubscribe("hook-unsub", topic);

      assert.equal(fired.length, 1);
      assert.equal(fired[0].id, "hook-unsub");
      assert.equal(fired[0].topic, topic);
    },
  );
});

// ---------------------------------------------------------------------------
// ProposalActivityConsumer — onActivity hook
// ---------------------------------------------------------------------------

test("ProposalActivityConsumer onActivity hook", async (t) => {
  await t.test("onActivity is called for each processed event", async () => {
    const fired: string[] = [];
    const consumer = new ProposalActivityConsumer({
      onActivity: (record) => fired.push(record.proposalId),
    });

    const event: NormalizedEvent = {
      type: EventType.PROPOSAL_CREATED,
      metadata: {
        id: "evt-1",
        contractId: "CDTEST",
        ledger: 1,
        ledgerClosedAt: new Date().toISOString(),
      },
      data: {
        proposalId: "42",
        proposer: "GABC",
        recipient: "GXYZ",
        token: "XLM",
        amount: "100",
        insuranceAmount: "0",
      },
    };

    await consumer.process(event);
    assert.deepEqual(fired, ["42"]);
  });

  await t.test(
    "onActivity is called before persistence and consumers",
    async () => {
      const order: string[] = [];
      const consumer = new ProposalActivityConsumer({
        onActivity: () => order.push("broadcast"),
      });
      consumer.registerConsumer(async () => {
        order.push("consumer");
      });

      const event: NormalizedEvent = {
        type: EventType.PROPOSAL_APPROVED,
        metadata: {
          id: "evt-2",
          contractId: "CDTEST",
          ledger: 2,
          ledgerClosedAt: new Date().toISOString(),
        },
        data: {
          proposalId: "7",
          approver: "GABC",
          approvalCount: 2,
          threshold: 3,
        },
      };

      await consumer.process(event);
      assert.equal(order[0], "broadcast");
      assert.equal(order[1], "consumer");
    },
  );

  await t.test(
    "onActivity is not required (no error when absent)",
    async () => {
      const consumer = new ProposalActivityConsumer();
      const event: NormalizedEvent = {
        type: EventType.PROPOSAL_CREATED,
        metadata: {
          id: "evt-3",
          contractId: "CDTEST",
          ledger: 3,
          ledgerClosedAt: new Date().toISOString(),
        },
        data: {
          proposalId: "99",
          proposer: "GABC",
          recipient: "GXYZ",
          token: "XLM",
          amount: "50",
          insuranceAmount: "0",
        },
      };

      await assert.doesNotReject(() => consumer.process(event));
    },
  );
});
