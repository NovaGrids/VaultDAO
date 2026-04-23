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
  eventPollingEnabled: false, // We'll trigger broadcast manually
};

test("WebSocket Server", async (t) => {
  const { server, runtime } = startServer(mockEnv as any);

  // Wait for server to be listening
  if (!server.listening) {
    await new Promise((resolve) => server.once("listening", resolve));
  }

  const address: any = server.address();
  const wsUrl = `ws://127.0.0.1:${address.port}`;

  await t.test("client can connect and receive events", async () => {
    const ws = new WebSocket(wsUrl);

    const eventPromise = new Promise<any>((resolve) => {
      ws.on("message", (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "contract_event") {
          resolve(msg.payload);
        }
      });
    });

    await new Promise((resolve) => ws.on("open", resolve));

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
    assert.equal(receivedEvent.id, "test-event-1");
    assert.equal(receivedEvent.topic[0], "proposal_created");

    ws.close();
  });

  await t.test("client can subscribe to specific event types", async () => {
    const ws = new WebSocket(wsUrl);

    await new Promise((resolve) => ws.on("open", resolve));

    // Subscribe to only 'proposal_executed'
    ws.send(
      JSON.stringify({
        type: "subscribe",
        payload: { eventTypes: ["proposal_executed"] },
      }),
    );

    // Wait for subscription confirmation
    await new Promise<void>((resolve) => {
      ws.on("message", (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "subscribed") resolve();
      });
    });

    const receivedEvents: any[] = [];
    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "contract_event") {
        receivedEvents.push(msg.payload);
      }
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

    // Give it a moment to receive
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.equal(receivedEvents.length, 1);
    assert.equal(receivedEvents[0].id, "test-event-2");

    ws.close();
  });

  // Clean up server
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});
