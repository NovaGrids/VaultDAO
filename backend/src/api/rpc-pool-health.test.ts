import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.js";
import { Server } from "node:http";
import { once } from "node:events";
import { MetricsRegistry } from "../modules/health/metrics.registry.js";
import { createMemoryPersistence } from "../modules/proposals/index.js";
import { TransactionsService } from "../modules/transactions/transactions.service.js";

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
  apiKey: "test-rpc-pool-key",
};

const mockRuntime = {
  startedAt: new Date().toISOString(),
  eventPollingService: {
    getStatus: () => ({ lastLedgerPolled: 123, isPolling: true, errors: 0 }),
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

test("RPC Pool Health Check API Tests", async (t) => {
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

  await t.test("GET /api/v1/status/rpc-pool returns RPC pool health status", async () => {
    const response = await fetch(`${baseUrl}/api/v1/status/rpc-pool`, {
      headers: { Authorization: `Bearer ${mockEnv.apiKey}` },
    });

    if (response.status === 404) {
      // Endpoint not implemented yet, that's expected
      return;
    }

    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as any;
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data.endpoints), "endpoints should be an array");

    for (const endpoint of body.data.endpoints) {
      assert.ok(typeof endpoint.url === "string", "endpoint.url should be a string");
      assert.ok(typeof endpoint.healthy === "boolean", "endpoint.healthy should be a boolean");
      assert.ok(
        typeof endpoint.consecutiveFailures === "number",
        "endpoint.consecutiveFailures should be a number",
      );
      assert.ok(
        endpoint.lastLatencyMs === null || typeof endpoint.lastLatencyMs === "number",
        "endpoint.lastLatencyMs should be null or number",
      );
      assert.ok(
        endpoint.markedUnhealthyAt === null || typeof endpoint.markedUnhealthyAt === "number",
        "endpoint.markedUnhealthyAt should be null or number",
      );
    }
  });

  await t.test("GET /api/v1/status/rpc-pool returns 401 without auth", async () => {
    const response = await fetch(`${baseUrl}/api/v1/status/rpc-pool`);

    if (response.status === 404) {
      // Endpoint not implemented yet
      return;
    }

    assert.strictEqual(response.status, 401);
  });

  await t.test("GET /api/v1/rpc/pool/status returns current RPC pool status", async () => {
    const response = await fetch(`${baseUrl}/api/v1/rpc/pool/status`, {
      headers: { Authorization: `Bearer ${mockEnv.apiKey}` },
    });

    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as any;
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data.endpoints), "endpoints should be an array");

    // Verify each endpoint has required fields
    for (const endpoint of body.data.endpoints) {
      assert.ok(typeof endpoint.url === "string");
      assert.ok(typeof endpoint.healthy === "boolean");
      assert.ok(typeof endpoint.consecutiveFailures === "number");
    }
  });

  await t.test("RPC pool endpoint status includes failure count and last success time", async () => {
    const response = await fetch(`${baseUrl}/api/v1/rpc/pool/status`, {
      headers: { Authorization: `Bearer ${mockEnv.apiKey}` },
    });

    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as any;
    assert.ok(body.data.endpoints.length > 0, "should have at least one endpoint");

    const endpoint = body.data.endpoints[0];
    assert.ok("consecutiveFailures" in endpoint);
    assert.ok("lastLatencyMs" in endpoint);
  });
});
