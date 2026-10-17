/**
 * Tests for opt-in WebSocket event delivery (Issue #1952).
 *
 * A client with no subscriptions must not receive the event firehose. This
 * covers a freshly connected client and a client that unsubscribed from its
 * last topic.
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { WebSocket } from "ws";
import { EventWebSocketServer } from "./websocket.server.js";
import type { ContractEvent } from "../events/events.types.js";

async function startWsServer(): Promise<{
  http: Server;
  wsServer: EventWebSocketServer;
  url: string;
}> {
  const http = createServer();
  const wsServer = new EventWebSocketServer(http, undefined, 100);
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

function waitForMessage(ws: WebSocket, type: string, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${type}`)),
      timeoutMs,
    );
    const onMessage = (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(msg);
      }
    };
    ws.on("message", onMessage);
  });
}

/** Collects the id of every contract_event the client receives into `into`. */
function collectEventIds(ws: WebSocket, into: string[]) {
  ws.on("message", (data: Buffer) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "contract_event") into.push(msg.payload.id);
  });
}

function makeEvent(id: string): ContractEvent {
  return {
    id,
    contractId: "CDTEST",
    topic: ["proposal_created", id],
    value: { proposal_id: id },
    ledger: 100,
    ledgerClosedAt: new Date().toISOString(),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

test("a client with no subscriptions receives no contract events", async () => {
  const { http, wsServer, url } = await startWsServer();
  try {
    const client = new WebSocket(url);
    await waitForOpen(client);

    const received: string[] = [];
    collectEventIds(client, received);

    wsServer.broadcastEvent(makeEvent("default-state-event"));
    await settle();

    assert.deepEqual(received, [], "an unsubscribed client must not receive the firehose");

    client.close();
  } finally {
    await stopWsServer(http, wsServer);
  }
});

test("a client that unsubscribes from its last topic stops receiving events", async () => {
  const { http, wsServer, url } = await startWsServer();
  try {
    const client = new WebSocket(url);
    await waitForOpen(client);

    client.send(JSON.stringify({ type: "subscribe", topics: ["proposal_created"] }));
    await waitForMessage(client, "subscribed");

    const received: string[] = [];
    collectEventIds(client, received);

    wsServer.broadcastEvent(makeEvent("while-subscribed"));
    await settle();
    assert.deepEqual(received, ["while-subscribed"]);

    client.send(JSON.stringify({ type: "unsubscribe", topics: ["proposal_created"] }));
    await waitForMessage(client, "unsubscribed");

    wsServer.broadcastEvent(makeEvent("after-unsubscribe-all"));
    await settle();
    assert.deepEqual(
      received,
      ["while-subscribed"],
      "after unsubscribing from every topic the client must receive nothing",
    );

    client.close();
  } finally {
    await stopWsServer(http, wsServer);
  }
});
