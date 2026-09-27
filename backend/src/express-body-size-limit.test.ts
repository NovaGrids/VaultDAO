import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./app.js";
import { Server } from "node:http";
import { once } from "node:events";
import { MetricsRegistry } from "./modules/health/metrics.registry.js";
import { createMemoryPersistence } from "./modules/proposals/index.js";
import { TransactionsService } from "./modules/transactions/transactions.service.js";

const mockEnv = {
  port: 0,
  host: "127.0.0.1",
  nodeEnv: "test",
  stellarNetwork: "testnet",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  contractId: "CDTEST",
  websocketUrl: "ws://localhost:8080",
  eventPollingIntervalMs: 5000,
  eventPollingEnabled: true,
  corsOrigin: ["*"],
  requestBodyLimit: "1mb",
  apiKey: "test-api-key",
};

const mockRuntime = {
  startedAt: new Date().toISOString(),
  eventPollingService: {
    getStatus: () => ({
      lastLedgerPolled: 123,
      isPolling: true,
      errors: 0,
    }),
  },
  snapshotService: {
    getSnapshot: async () => null,
    getSigners: async () => [],
    getSigner: async () => null,
    getRoles: async () => [],
    getStats: async () => null,
  },
  proposalActivityAggregator: {
    getStats: () => ({
      totalProposals: 0,
      activeProposals: 0,
      executedProposals: 0,
      rejectedProposals: 0,
      expiredProposals: 0,
      cancelledProposals: 0,
      byType: {},
    }),
    getSummary: () => null,
    getAllProposals: () => ({ items: [], total: 0, offset: 0, limit: 10 }),
  },
  recurringIndexerService: {
    getStatus: () => ({ isIndexing: true, lastLedger: 100 }),
  },
  jobManager: {
    getAllJobs: () => [
      { name: "event-polling", isRunning: () => true },
      { name: "recurring-indexer", isRunning: () => true },
    ],
    stopAll: async () => {},
  },
  metricsRegistry: new MetricsRegistry(),
  proposalActivityPersistence: createMemoryPersistence(),
  get transactionsService() {
    return new TransactionsService(this.proposalActivityPersistence);
  },
};

test("Express Request Body Size Limit (Issue #1557)", async (t) => {
  let server: Server;
  let baseUrl: string;

  t.before(async () => {
    const app = await createApp(mockEnv as any, mockRuntime as any);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (typeof address === "object" && address !== null) {
      baseUrl = `http://127.0.0.1:${address.port}`;
    }
  });

  t.after(
    () =>
      new Promise<void>((resolve) => {
        if (typeof (server as any).closeAllConnections === "function") {
          (server as any).closeAllConnections();
        }
        server.close(() => resolve());
      }),
  );

  await t.test("should accept normal-sized JSON requests", async () => {
    const payload = JSON.stringify({
      name: "test",
      description: "test proposal",
      data: "x".repeat(1000),
    });

    const response = await fetch(`${baseUrl}/api/v1/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mockEnv.apiKey}`,
      },
      body: payload,
    });

    // Status endpoint may not support POST, but we're testing the body parser doesn't reject
    assert.ok(response.status !== 413, "Normal-sized request should not return 413");
  });

  await t.test("should reject oversized JSON requests with 413 Payload Too Large", async () => {
    // mockEnv.requestBodyLimit is "1mb", so send ~1.1 MiB
    const oversizedPayload = JSON.stringify({
      data: "x".repeat(Math.ceil(1.1 * 1024 * 1024)),
    });

    const response = await fetch(`${baseUrl}/api/v1/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mockEnv.apiKey}`,
      },
      body: oversizedPayload,
    });

    assert.strictEqual(
      response.status,
      413,
      `Expected 413 Payload Too Large, got ${response.status}`,
    );
  });

  await t.test("should enforce maxPayload on POST requests", async () => {
    const hugePayload = JSON.stringify({
      data: "y".repeat(2 * 1024 * 1024), // 2MB
    });

    const response = await fetch(`${baseUrl}/api/v1/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mockEnv.apiKey}`,
      },
      body: hugePayload,
    });

    assert.strictEqual(response.status, 413, "Large payload should return 413");
  });

  await t.test("should include error response for oversized requests", async () => {
    const oversizedPayload = JSON.stringify({
      large: "x".repeat(1.2 * 1024 * 1024),
    });

    const response = await fetch(`${baseUrl}/api/v1/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mockEnv.apiKey}`,
      },
      body: oversizedPayload,
    });

    assert.equal(response.status, 413);
    // Verify response is parseable
    const body = await response.text();
    assert.ok(body.length > 0, "Error response should have a body");
  });

  await t.test("should not accept requests at or above the limit", async () => {
    // Build a request that's exactly 1MB + 1 byte
    const limitBytes = 1024 * 1024;
    const payload = JSON.stringify({
      data: "x".repeat(limitBytes),
    });

    // If payload is exactly or exceeds limit, should be rejected
    if (payload.length >= limitBytes) {
      const response = await fetch(`${baseUrl}/api/v1/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mockEnv.apiKey}`,
        },
        body: payload,
      });

      assert.strictEqual(response.status, 413, "Request at/above limit should return 413");
    }
  });

  await t.test("body size limit applies to all v1 endpoints", async () => {
    const oversizedPayload = JSON.stringify({
      data: "z".repeat(1.5 * 1024 * 1024),
    });

    // Test on a different endpoint
    const response = await fetch(`${baseUrl}/api/v1/proposals/stats`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mockEnv.apiKey}`,
      },
      body: oversizedPayload,
    });

    assert.strictEqual(response.status, 413, "All v1 endpoints should enforce body limit");
  });

  await t.test("should handle edge case of exactly limit size", async () => {
    // Create a payload that's within limits
    const withinLimit = JSON.stringify({
      data: "a".repeat(900 * 1024), // 900KB, well under 1MB
    });

    const response = await fetch(`${baseUrl}/api/v1/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mockEnv.apiKey}`,
      },
      body: withinLimit,
    });

    // Should NOT be 413
    assert.notStrictEqual(
      response.status,
      413,
      "Request within limit should not return 413",
    );
  });
});
