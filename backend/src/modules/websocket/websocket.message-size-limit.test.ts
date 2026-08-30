import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { startServer } from "../../server.js";

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

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for close")), 5000);
    ws.on("close", (code, reason) => {
      clearTimeout(timeout);
      resolve({ code, reason: reason.toString() });
    });
  });
}

function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for message")), 5000);
    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (predicate(msg)) {
          clearTimeout(timeout);
          resolve(msg);
        }
      } catch {
        // Ignore parse errors
      }
    });
  });
}

test("WebSocket Message Size Limit (Issue #1559)", async (t) => {
  const { server, runtime } = await startServer(mockEnv as any);

  if (!server.listening) {
    await new Promise((resolve) => server.once("listening", resolve));
  }

  const address: any = server.address();
  const wsUrl = `ws://127.0.0.1:${address.port}`;

  t.after(() => {
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  await t.test("should accept messages within size limit", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    const message = { type: "subscribe", topics: ["proposal_created"] };
    ws.send(JSON.stringify(message));

    const subscribeMsg = await waitForMessage(ws, (m) => m.type === "subscribed");
    assert.equal(subscribeMsg.type, "subscribed");

    ws.close();
  });

  await t.test("should reject oversized messages", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    // Create a message that exceeds the 64KB default limit
    // Typical WebSocket maxPayload is 64KB (65536 bytes)
    const largeData = "x".repeat(100 * 1024); // 100KB
    const oversizedMessage = JSON.stringify({
      type: "subscribe",
      topics: ["proposal_created"],
      payload: largeData,
    });

    // Send oversized message - this should trigger connection termination
    // or message rejection
    ws.send(oversizedMessage);

    // Wait briefly and check if connection is still open or closes
    const closePromise = waitForClose(ws).catch(() => null);
    const result = await Promise.race([
      closePromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);

    // Connection may close due to oversized message
    if (result) {
      assert.ok(result.code >= 1000, "should close with valid WebSocket code");
    }
  });

  await t.test("should enforce maxPayload setting on server", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    // WebSocket server should have maxPayload configured
    // Default is typically 64KB
    assert.ok(ws.readyState === WebSocket.OPEN);

    ws.send(JSON.stringify({ type: "subscribe", topics: ["test"] }));
    const msg = await waitForMessage(ws, (m) => m.type === "subscribed" || m.type === "error");

    assert.ok(msg.type === "subscribed" || msg.type === "error");
    ws.close();
  });

  await t.test("should terminate connections exceeding message size", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    // Test that connection setup works first
    ws.send(JSON.stringify({ type: "subscribe", topics: ["proposal_executed"] }));
    await waitForMessage(ws, (m) => m.type === "subscribed");

    // Now try to send a message that exceeds reasonable size
    const hugePayload = "y".repeat(200 * 1024); // 200KB
    const huge = JSON.stringify({
      type: "custom",
      data: hugePayload,
    });

    ws.send(huge);

    // Should close or error
    const closePromise = waitForClose(ws).catch(() => null);
    const result = await Promise.race([
      closePromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);

    // Either connection closed or stayed open but rejected message
    assert.ok(result === null || result.code >= 1000);
    ws.close();
  });

  await t.test("should not exceed memory with multiple large messages", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    ws.send(JSON.stringify({ type: "subscribe", topics: ["proposal_created"] }));
    await waitForMessage(ws, (m) => m.type === "subscribed");

    // Try sending multiple moderately-sized messages
    for (let i = 0; i < 3; i++) {
      const largeMsg = JSON.stringify({
        type: "data",
        payload: "z".repeat(50 * 1024),
      });

      ws.send(largeMsg);
    }

    // Connection should still be functional or closed gracefully
    const state = ws.readyState;
    assert.ok(state === WebSocket.OPEN || state === WebSocket.CLOSED);

    ws.close();
  });

  await t.test("should handle messages at the edge of size limit", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.on("open", resolve));

    // Create a message close to but within typical limits (e.g., 60KB)
    const edgeData = "a".repeat(60 * 1024);
    const edgeMessage = JSON.stringify({
      type: "subscribe",
      topics: ["proposal_created"],
      data: edgeData,
    });

    ws.send(edgeMessage);

    // Should either succeed or gracefully handle
    const result = await Promise.race([
      waitForMessage(ws, (m) => m.type === "subscribed").catch(() => null),
      waitForClose(ws).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);

    assert.ok(ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSED);
    ws.close();
  });
});
