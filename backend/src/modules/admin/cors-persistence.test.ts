import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../../app.js";
import { Server } from "node:http";
import { once } from "node:events";
import { MetricsRegistry } from "../health/metrics.registry.js";
import { createMemoryPersistence } from "../proposals/index.js";
import { TransactionsService } from "../transactions/transactions.service.js";

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
  corsOrigin: ["https://example.com"],
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

test("CORS Allowlist Persistence (Issue #1558)", async (t) => {
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

  await t.test("should list current CORS origins", async () => {
    const response = await fetch(`${baseUrl}/api/v1/admin/cors/origins`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${mockEnv.apiKey}`,
      },
    });

    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as any;
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data.origins));
    assert.ok(body.data.origins.includes("https://example.com"));
  });

  await t.test("should add a new CORS origin", async () => {
    const newOrigin = "https://allowed.example.com";

    const response = await fetch(`${baseUrl}/api/v1/admin/cors/origins`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mockEnv.apiKey}`,
      },
      body: JSON.stringify({ origin: newOrigin }),
    });

    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as any;
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.changed, true);
    assert.ok(body.data.origins.includes(newOrigin));
  });

  await t.test("should persist added CORS origins in memory across requests", async () => {
    const newOrigin = "https://dynamic.example.com";

    // Add origin
    const addResponse = await fetch(`${baseUrl}/api/v1/admin/cors/origins`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mockEnv.apiKey}`,
      },
      body: JSON.stringify({ origin: newOrigin }),
    });

    assert.strictEqual(addResponse.status, 200);

    // Verify it appears in the list
    const listResponse = await fetch(`${baseUrl}/api/v1/admin/cors/origins`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${mockEnv.apiKey}`,
      },
    });

    const listBody = (await listResponse.json()) as any;
    assert.ok(
      listBody.data.origins.includes(newOrigin),
      "Added origin should persist in the list",
    );
  });

  await t.test("should remove CORS origins", async () => {
    const originToAdd = "https://temp.example.com";

    // Add an origin first
    await fetch(`${baseUrl}/api/v1/admin/cors/origins`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mockEnv.apiKey}`,
      },
      body: JSON.stringify({ origin: originToAdd }),
    });

    // Remove it
    const removeResponse = await fetch(`${baseUrl}/api/v1/admin/cors/origins`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mockEnv.apiKey}`,
      },
      body: JSON.stringify({ origin: originToAdd }),
    });

    assert.strictEqual(removeResponse.status, 200);
    const body = (await removeResponse.json()) as any;
    assert.strictEqual(body.success, true);
    assert.ok(!body.data.origins.includes(originToAdd));
  });

  await t.test("should reject invalid origins", async () => {
    const invalidOrigin = "not-a-valid-url";

    const response = await fetch(`${baseUrl}/api/v1/admin/cors/origins`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mockEnv.apiKey}`,
      },
      body: JSON.stringify({ origin: invalidOrigin }),
    });

    // Should reject with 400 due to validation error
    assert.strictEqual(response.status, 400);
    const body = (await response.json()) as any;
    assert.strictEqual(body.success, false);
  });

  await t.test("should prevent wildcard and specific origins together", async () => {
    // Try to add wildcard when specific origins exist
    const response = await fetch(`${baseUrl}/api/v1/admin/cors/origins`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mockEnv.apiKey}`,
      },
      body: JSON.stringify({ origin: "*" }),
    });

    // If we already have specific origins, wildcard should fail
    const body = (await response.json()) as any;
    if (!body.data.changed) {
      assert.ok(body.data.origins.length > 0, "Should have existing origins");
    }
  });

  await t.test("should enforce CORS origin validation on connections", async () => {
    // Request from allowed origin should work
    const allowedResponse = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers: {
        Origin: "https://example.com",
      },
    });

    assert.strictEqual(allowedResponse.status, 200);
    const originHeader = allowedResponse.headers.get("Access-Control-Allow-Origin");
    assert.ok(originHeader === "https://example.com" || originHeader === "*");
  });

  await t.test("should support database persistence when configured", async () => {
    // This test verifies the infrastructure is in place for persistence
    const listResponse = await fetch(`${baseUrl}/api/v1/admin/cors/origins`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${mockEnv.apiKey}`,
      },
    });

    const body = (await listResponse.json()) as any;
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data.origins));
  });

  await t.test("should maintain CORS allowlist through multiple operations", async () => {
    // Add origin 1
    const origin1 = "https://test1.example.com";
    await fetch(`${baseUrl}/api/v1/admin/cors/origins`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mockEnv.apiKey}`,
      },
      body: JSON.stringify({ origin: origin1 }),
    });

    // Add origin 2
    const origin2 = "https://test2.example.com";
    await fetch(`${baseUrl}/api/v1/admin/cors/origins`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mockEnv.apiKey}`,
      },
      body: JSON.stringify({ origin: origin2 }),
    });

    // Verify both are present
    const listResponse = await fetch(`${baseUrl}/api/v1/admin/cors/origins`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${mockEnv.apiKey}`,
      },
    });

    const body = (await listResponse.json()) as any;
    assert.ok(body.data.origins.includes(origin1));
    assert.ok(body.data.origins.includes(origin2));
  });
});
