import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./app.js";
import { Server } from "node:http";

const mockEnv = {
  port: 0, // Random port
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
};

test("App Integration Tests", async (t) => {
  let server: Server;
  let baseUrl: string;

  // Setup server once for this test suite
  await new Promise<void>((resolve) => {
    const app = createApp(mockEnv as any, mockRuntime as any);
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        baseUrl = `http://127.0.0.1:${address.port}`;
      }
      resolve(undefined);
    });
  });

  // Teardown server
  t.after(() => {
    return new Promise((resolve) => {
      server.close(() => resolve(undefined));
    });
  });

  await t.test("GET /health returns 200 with correct shape", async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as any;

    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.ok, true);
    assert.ok(Array.isArray(body.data.jobs));
    assert.deepStrictEqual(body.data.jobs, [
      { name: "event-polling", running: true },
      { name: "recurring-indexer", running: true },
    ]);
  });

  await t.test("GET /ready returns 200 when configured", async () => {
    const response = await fetch(`${baseUrl}/ready`);
    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as any;

    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.ready, true);
    assert.strictEqual(body.data.checks.rpc.status, "ready");
  });

  await t.test("GET /api/v1/status returns correct fields", async () => {
    const response = await fetch(`${baseUrl}/api/v1/status`);
    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as any;

    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.rpcUrl, mockEnv.sorobanRpcUrl);
    assert.strictEqual(body.data.horizonUrl, mockEnv.horizonUrl);
    assert.strictEqual(body.data.websocketUrl, mockEnv.websocketUrl);
  });

  await t.test("GET /unknown-route returns 404", async () => {
    const response = await fetch(`${baseUrl}/unknown-route`);
    assert.strictEqual(response.status, 404);
    const body = (await response.json()) as any;

    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.message, "Not Found");
  });
});

test("Readiness Failure", async (t) => {
  await t.test("GET /ready returns 503 when RPC URL is empty", async () => {
    const envWithNoRpc = { ...mockEnv, sorobanRpcUrl: "" };
    const app = createApp(envWithNoRpc as any, mockRuntime as any);

    await new Promise<void>((resolve) => {
      const server = app.listen(0, "127.0.0.1", async () => {
        const address = server.address();
        const port = (address as any).port;

        try {
          const response = await fetch(`http://127.0.0.1:${port}/ready`);
          assert.strictEqual(response.status, 503);
          const body = (await response.json()) as any;

          assert.strictEqual(body.success, false);
          assert.strictEqual(body.error.message, "Service not ready");
        } finally {
          if (typeof (server as any).closeAllConnections === "function") {
            (server as any).closeAllConnections();
          }
          await new Promise<void>((closeResolve) =>
            server.close(() => closeResolve()),
          );
          resolve();
        }
      });
    });
  });
});

// Regression guard: GET /api/v1/proposals/stats must return stats, not a 404
// from /:id shadowing. This test fails if /stats is moved after /:id in the router.
test("GET /api/v1/proposals/stats route ordering", async (t) => {
  await t.test(
    "returns 200 with a stats payload — not a 404 from /:id shadowing",
    async () => {
      const app = createApp(mockEnv as any, mockRuntime as any);

      await new Promise<void>((resolve) => {
        const server = app.listen(0, "127.0.0.1", async () => {
          const address = server.address();
          const port = (address as any).port;

          try {
            const response = await fetch(
              `http://127.0.0.1:${port}/api/v1/proposals/stats`,
              {
                headers: {
                  Authorization: `Bearer ${mockEnv.apiKey}`,
                },
              },
            );
            assert.strictEqual(response.status, 200);
            const body = (await response.json()) as any;
            assert.strictEqual(body.success, true);
            assert.ok(
              typeof body.data.totalProposals === "number",
              "totalProposals should be a number",
            );
          } finally {
            if (typeof (server as any).closeAllConnections === "function") {
              (server as any).closeAllConnections();
            }
            await new Promise<void>((closeResolve) =>
              server.close(() => closeResolve()),
            );
            resolve();
          }
        });
      });
    },
  );
});
