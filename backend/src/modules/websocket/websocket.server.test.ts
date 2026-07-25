import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { startServer } from "../../server.js";
import type { ContractEvent } from "../events/events.types.js";

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
};

function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for message")), 3000);
    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (predicate(msg)) {
        clearTimeout(timeout);
        resolve(msg);
      }
    });
  });
}

test("WebSocket Server", async (t) => {
  const { server, runtime } = await startServer(mockEnv as any);

  if (!server.listening) {
    await new Promise((resolve) => server.once("listening", resolve));
  }

  const address: any = server.address();
  const wsUrl = `ws://127.0.0.1:${address.port}`;

  await t.test("client can connect and receive events", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    const eventPromise = waitForMessage(ws, (m) => m.type === "contract_event");

    const mockEvent: ContractEvent = {
      id: "test-event-1",
      contractId: "CDTEST",
      topic: ["proposal_created", "123"],
      value: { proposal_id: "123" },
      ledger: 100,
      ledgerClosedAt: new Date().toISOString(),
    };

    runtime.wsServer?.broadcastEvent(mockEvent);

    const receivedEvent = await eventPromise;
    assert.equal(receivedEvent.payload.id, "test-event-1");
    assert.equal(receivedEvent.payload.topic[0], "proposal_created");

    ws.close();
  });

  await t.test("client can subscribe using flat topics format", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    ws.send(JSON.stringify({ type: "subscribe", topics: ["proposal_executed"] }));

    await waitForMessage(ws, (m) => m.type === "subscribed");

    const receivedEvents: any[] = [];
    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "contract_event") receivedEvents.push(msg.payload);
    });

    const event1: ContractEvent = {
      id: "test-event-1",
      contractId: "CDTEST",
      topic: ["proposal_created"],
      value: {},
      ledger: 100,
      ledgerClosedAt: new Date().toISOString(),
    };

    const event2: ContractEvent = {
      id: "test-event-2",
      contractId: "CDTEST",
      topic: ["proposal_executed"],
      value: {},
      ledger: 101,
      ledgerClosedAt: new Date().toISOString(),
    };

    runtime.wsServer?.broadcastEvent(event1);
    runtime.wsServer?.broadcastEvent(event2);

    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.equal(receivedEvents.length, 1);
    assert.equal(receivedEvents[0].id, "test-event-2");

    ws.close();
  });

  await t.test("client can subscribe using legacy payload format", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    ws.send(JSON.stringify({ type: "subscribe", payload: { eventTypes: ["proposal_approved"] } }));

    await waitForMessage(ws, (m) => m.type === "subscribed");

    const receivedEvents: any[] = [];
    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "contract_event") receivedEvents.push(msg.payload);
    });

    const event1: ContractEvent = {
      id: "test-event-1",
      contractId: "CDTEST",
      topic: ["proposal_created"],
      value: {},
      ledger: 100,
      ledgerClosedAt: new Date().toISOString(),
    };

    const event2: ContractEvent = {
      id: "test-event-2",
      contractId: "CDTEST",
      topic: ["proposal_approved"],
      value: {},
      ledger: 101,
      ledgerClosedAt: new Date().toISOString(),
    };

    runtime.wsServer?.broadcastEvent(event1);
    runtime.wsServer?.broadcastEvent(event2);

    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.equal(receivedEvents.length, 1);
    assert.equal(receivedEvents[0].id, "test-event-2");

    ws.close();
  });

  await t.test("subscription confirmation includes subscribed topics", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    ws.send(JSON.stringify({ type: "subscribe", topics: ["proposal_created", "proposal_executed"] }));

    const confirmation = await waitForMessage(ws, (m) => m.type === "subscribed");

    assert.ok(Array.isArray(confirmation.topics));
    assert.deepEqual(confirmation.topics, ["proposal_created", "proposal_executed"]);

    ws.close();
  });

  await t.test("unsubscribed client receives all events", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    const receivedEvents: any[] = [];
    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "contract_event") receivedEvents.push(msg.payload);
    });

    const event1: ContractEvent = {
      id: "test-event-1",
      contractId: "CDTEST",
      topic: ["proposal_created"],
      value: {},
      ledger: 100,
      ledgerClosedAt: new Date().toISOString(),
    };

    const event2: ContractEvent = {
      id: "test-event-2",
      contractId: "CDTEST",
      topic: ["insurance_locked"],
      value: {},
      ledger: 101,
      ledgerClosedAt: new Date().toISOString(),
    };

    runtime.wsServer?.broadcastEvent(event1);
    runtime.wsServer?.broadcastEvent(event2);

    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.equal(receivedEvents.length, 2);

    ws.close();
  });

  await t.test("broadcast handles non-serializable event gracefully without throwing", async () => {
    const circularValue: any = {};
    circularValue.self = circularValue;

    const badEvent: ContractEvent = {
      id: "bad-event",
      contractId: "CDTEST",
      topic: ["proposal_created"],
      value: circularValue,
      ledger: 100,
      ledgerClosedAt: new Date().toISOString(),
    };

    // Should not throw even though the value has a circular reference
    assert.doesNotThrow(() => runtime.wsServer?.broadcastEvent(badEvent));
  });

  // ---------------------------------------------------------------------------
  // Unsubscribe cleanup verification (#1373)
  // ---------------------------------------------------------------------------

  await t.test("no events received after unsubscribe — subscription fully cleaned up", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    // Subscribe to a topic
    ws.send(JSON.stringify({ type: "subscribe", topics: ["proposal_executed"] }));
    await waitForMessage(ws, (m) => m.type === "subscribed");

    // Now unsubscribe
    ws.send(JSON.stringify({ type: "unsubscribe", topics: ["proposal_executed"] }));
    const unsubMsg = await waitForMessage(ws, (m) => m.type === "unsubscribed");

    // Confirm the topic is gone from remainingTopics
    assert.ok(Array.isArray(unsubMsg.remainingTopics), "remainingTopics must be an array");
    assert.equal(
      unsubMsg.remainingTopics.includes("notification:events:PROPOSAL_EXECUTED"),
      false,
      "unsubscribed topic must not appear in remainingTopics",
    );

    // Broadcast the event — client should NOT receive it
    const receivedEvents: any[] = [];
    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "contract_event") receivedEvents.push(msg);
    });

    const event: ContractEvent = {
      id: "after-unsub-1",
      contractId: "CDTEST",
      topic: ["proposal_executed"],
      value: {},
      ledger: 200,
      ledgerClosedAt: new Date().toISOString(),
    };

    runtime.wsServer?.broadcastEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.equal(receivedEvents.length, 0, "no events should arrive after unsubscribe");
    ws.close();
  });

  await t.test("unsubscribed envelope includes subscriber identity and removedTopics", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    ws.send(JSON.stringify({ type: "subscribe", topics: ["proposal_approved"] }));
    await waitForMessage(ws, (m) => m.type === "subscribed");

    ws.send(JSON.stringify({ type: "unsubscribe", topics: ["proposal_approved"] }));
    const msg = await waitForMessage(ws, (m) => m.type === "unsubscribed");

    assert.ok(typeof msg.subscriber === "string" && msg.subscriber.length > 0,
      "envelope must include a non-empty subscriber field");
    assert.ok(Array.isArray(msg.removedTopics), "envelope must include removedTopics array");
    assert.ok(
      msg.removedTopics.includes("notification:events:PROPOSAL_APPROVED"),
      "removedTopics must list the normalized topic that was removed",
    );

    ws.close();
  });

  await t.test("unsubscribing a topic does not affect other active subscriptions", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    // Subscribe to two topics
    ws.send(JSON.stringify({ type: "subscribe", topics: ["proposal_approved", "proposal_executed"] }));
    await waitForMessage(ws, (m) => m.type === "subscribed");

    // Unsubscribe from one
    ws.send(JSON.stringify({ type: "unsubscribe", topics: ["proposal_executed"] }));
    const unsubMsg = await waitForMessage(ws, (m) => m.type === "unsubscribed");

    // The retained topic must still appear in remainingTopics
    assert.ok(
      unsubMsg.remainingTopics.includes("notification:events:PROPOSAL_APPROVED"),
      "retained topic must remain in remainingTopics",
    );
    assert.equal(
      unsubMsg.remainingTopics.includes("notification:events:PROPOSAL_EXECUTED"),
      false,
      "removed topic must not appear in remainingTopics",
    );

    // Broadcast to retained topic — must be delivered
    const received: any[] = [];
    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "contract_event") received.push(msg.payload);
    });

    runtime.wsServer?.broadcastEvent({
      id: "retained-evt",
      contractId: "CDTEST",
      topic: ["proposal_approved"],
      value: {},
      ledger: 300,
      ledgerClosedAt: new Date().toISOString(),
    });

    runtime.wsServer?.broadcastEvent({
      id: "removed-evt",
      contractId: "CDTEST",
      topic: ["proposal_executed"],
      value: {},
      ledger: 301,
      ledgerClosedAt: new Date().toISOString(),
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.equal(received.length, 1, "only the retained topic event should arrive");
    assert.equal(received[0].id, "retained-evt");

    ws.close();
  });

  await t.test("unsubscribing a topic not subscribed to is a no-op", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    // Do NOT subscribe to anything first — then try unsubscribing
    ws.send(JSON.stringify({ type: "unsubscribe", topics: ["proposal_created"] }));
    const msg = await waitForMessage(ws, (m) => m.type === "unsubscribed");

    // removedTopics should be empty since there was nothing to remove
    assert.ok(Array.isArray(msg.removedTopics), "removedTopics must still be an array");
    assert.equal(msg.removedTopics.length, 0, "removedTopics must be empty for a no-op unsubscribe");

    ws.close();
  });

  // Clean up server
  runtime.wsServer?.stop();
  await runtime.jobManager.stopAll();
  if (typeof (server as any).closeAllConnections === "function") {
    (server as any).closeAllConnections();
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});
