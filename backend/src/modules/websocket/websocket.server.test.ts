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
  const { server, runtime } = startServer(mockEnv as any);

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

  // Clean up server
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});
