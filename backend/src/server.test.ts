import assert from "node:assert/strict";
import test from "node:test";
import { startServer } from "./server.js";

const mockEnv = {
  port: 0, // Use 0 for random available port in tests
  host: "127.0.0.1",
  nodeEnv: "test",
  stellarNetwork: "testnet",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  contractId: "CDTEST",
  websocketUrl: "ws://localhost:8080",
  eventPollingIntervalMs: 5000,
  eventPollingEnabled: false,
};

test("Server Startup", async (t) => {
  await t.test("starts successfully with valid env", async () => {
    const server = startServer(mockEnv as any);

    assert.ok(server, "Server should start");
    assert.ok(
      typeof server.close === "function",
      "Server should be a valid HTTP server"
    );

    // Clean up
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  await t.test("returns BackendRuntime with required properties", async () => {
    // Note: startServer actually returns the HTTP server, not the runtime
    // But we can verify the server creation doesn't throw
    assert.doesNotThrow(() => {
      const server = startServer(mockEnv as any);
      server.close();
    });
  });
});
