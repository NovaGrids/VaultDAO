/**
 * Tests for per-contract scoping of WebSocket subscriptions (Issue #1951).
 *
 * In a multi-vault deployment a client subscribed to one contract must never
 * receive events (proposals, recipients, amounts) from another contract.
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

/** Collects every contract_event payload a client receives into `into`. */
function collectEvents(ws: WebSocket, into: ContractEvent[]) {
  ws.on("message", (data: Buffer) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "contract_event") into.push(msg.payload);
  });
}

function makeEvent(id: string, contractId: string): ContractEvent {
  return {
    id,
    contractId,
    topic: ["proposal_created", id],
    value: { proposal_id: id },
    ledger: 100,
    ledgerClosedAt: new Date().toISOString(),
  };
}

test("clients subscribed to different contracts only receive their own contract's events", async () => {
  const { http, wsServer, url } = await startWsServer();
  try {
    const clientA = new WebSocket(url);
    const clientB = new WebSocket(url);
    await Promise.all([waitForOpen(clientA), waitForOpen(clientB)]);

    clientA.send(
      JSON.stringify({
        type: "subscribe",
        topics: ["proposal_created"],
        contractIds: ["CDVAULTA"],
      }),
    );
    clientB.send(
      JSON.stringify({
        type: "subscribe",
        topics: ["proposal_created"],
        contractIds: ["CDVAULTB"],
      }),
    );
    await Promise.all([
      waitForMessage(clientA, "subscribed"),
      waitForMessage(clientB, "subscribed"),
    ]);

    const receivedByA: ContractEvent[] = [];
    const receivedByB: ContractEvent[] = [];
    collectEvents(clientA, receivedByA);
    collectEvents(clientB, receivedByB);

    wsServer.broadcastEvent(makeEvent("vault-a-proposal", "CDVAULTA"));
    wsServer.broadcastEvent(makeEvent("vault-b-proposal", "CDVAULTB"));

    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.deepEqual(
      receivedByA.map((e) => e.id),
      ["vault-a-proposal"],
      "client A must not see contract B's events",
    );
    assert.deepEqual(
      receivedByB.map((e) => e.id),
      ["vault-b-proposal"],
      "client B must not see contract A's events",
    );

    clientA.close();
    clientB.close();
  } finally {
    await stopWsServer(http, wsServer);
  }
});
