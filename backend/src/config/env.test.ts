import assert from "node:assert/strict";
import test from "node:test";
import { loadEnv } from "./env.js";

test("loadEnv - EVENT_POLLING_INTERVAL_MS validation", () => {
  // Save original env
  const originalEnv = { ...process.env };

  try {
    // Case 1: Value too low (100ms)
    process.env.EVENT_POLLING_INTERVAL_MS = "100";
    assert.throws(() => loadEnv(), (err: Error) => {
      return err.message.includes("EVENT_POLLING_INTERVAL_MS must be at least 1000ms");
    });

    // Case 2: Minimum value (1000ms)
    process.env.EVENT_POLLING_INTERVAL_MS = "1000";
    // Should not throw if other required envs are present
    // We might need to mock other required envs to avoid unrelated errors
    process.env.NODE_ENV = "development";
    process.env.HOST = "localhost";
    process.env.SOROBAN_RPC_URL = "http://localhost:8000";
    process.env.HORIZON_URL = "http://localhost:8000";
    process.env.VITE_WS_URL = "ws://localhost:8080";
    
    const env = loadEnv();
    assert.equal(env.eventPollingIntervalMs, 1000);

    // Case 3: Valid value (5000ms)
    process.env.EVENT_POLLING_INTERVAL_MS = "5000";
    const env2 = loadEnv();
    assert.equal(env2.eventPollingIntervalMs, 5000);

  } finally {
    // Restore original env
    process.env = originalEnv;
  }
});
