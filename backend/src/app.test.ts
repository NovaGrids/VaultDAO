import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./app.js";
import { Server } from "node:http";
import { once } from "node:events";
import { MetricsRegistry } from "./modules/health/metrics.registry.js";
import { createMemoryPersistence } from "./modules/proposals/index.js";
import { TransactionsService } from "./modules/transactions/transactions.service.js";
import { REQUEST_ID_HEADER } from "./shared/http/requestId.js";

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
  // Required by /metrics route (runtime.metricsRegistry.render())
  metricsRegistry: new MetricsRegistry(),
  // Required by createTransactionsRouter and createProposalsRouter
  proposalActivityPersistence: createMemoryPersistence(),
  get transactionsService() {
    return new TransactionsService(this.proposalActivityPersistence);
  },
};

test("App Integration Tests", async (t) => {
  let server: Server;
  let baseUrl: string;

  // Setup server once for this test suite
  const app = await createApp(mockEnv as any, mockRuntime as any);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (typeof address === "object" && address !== null) {
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

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
    const app = await createApp(envWithNoRpc as any, mockRuntime as any);

    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;

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
    }
  });
});

// Regression guard: GET /api/v1/proposals/stats must return stats, not a 404
// from /:id shadowing. This test fails if /stats is moved after /:id in the router.
test("GET /api/v1/proposals/stats route ordering", async (t) => {
  await t.test(
    "returns 200 with a stats payload — not a 404 from /:id shadowing",
    async () => {
      const app = await createApp(mockEnv as any, mockRuntime as any);

      const server = app.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;

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
      }
    },
  );
});

// ─── Middleware Chain Integration Tests ──────────────────────────────────────
// Covers the 7 required scenarios end-to-end against a real HTTP server.
// The server is spun up on a random port (port 0) and torn down cleanly after.
// No real RPC or external API calls are made — all runtime deps are mocked.
test("Middleware Chain Integration Tests", async (t) => {
  let server: Server;
  let baseUrl: string;

  // ── Lifecycle ──────────────────────────────────────────────────────────────
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

  // ── Scenario 1: GET /health → 200 { status: 'ok' } ───────────────────────
  await t.test("1. GET /health returns 200 with { ok: true }", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as any;
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.ok, true);
  });

  // ── Scenario 2: GET /api/v1/status → 200 with version info ───────────────
  await t.test(
    "2. GET /api/v1/status returns 200 with rpcUrl, horizonUrl and websocketUrl",
    async () => {
      const res = await fetch(`${baseUrl}/api/v1/status`);
      assert.strictEqual(res.status, 200);
      const body = (await res.json()) as any;
      assert.strictEqual(body.success, true);
      // Version field must be present (comes from package.json)
      assert.ok(
        typeof body.data.version === "string" && body.data.version.length > 0,
        "version should be a non-empty string",
      );
      assert.strictEqual(body.data.rpcUrl, mockEnv.sorobanRpcUrl);
      assert.strictEqual(body.data.horizonUrl, mockEnv.horizonUrl);
      assert.strictEqual(body.data.websocketUrl, mockEnv.websocketUrl);
    },
  );

  // ── Scenario 3: GET /nonexistent → 404 standard error shape ──────────────
  await t.test(
    "3. GET /nonexistent returns 404 with standard error shape",
    async () => {
      const res = await fetch(`${baseUrl}/nonexistent`);
      assert.strictEqual(res.status, 404);
      const body = (await res.json()) as any;
      assert.strictEqual(body.success, false);
      assert.ok(
        typeof body.error === "object" && body.error !== null,
        "body.error must be an object",
      );
      assert.strictEqual(body.error.message, "Not Found");
      assert.strictEqual(body.error.code, "NOT_FOUND");
    },
  );

  // ── Scenario 4: POST /api/v1/snapshots/test/rebuild → 401 without auth ───
  // The route is protected by authMiddleware (Bearer token layer) first.
  // Omitting all auth headers triggers a 401 before the request reaches the handler.
  await t.test(
    "4. POST /api/v1/snapshots/test/rebuild returns 401 when no auth is provided",
    async () => {
      const res = await fetch(`${baseUrl}/api/v1/snapshots/test/rebuild`, {
        method: "POST",
      });
      assert.strictEqual(res.status, 401);
      const body = (await res.json()) as any;
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, "UNAUTHORIZED");
    },
  );

  // ── Scenario 5: X-Request-ID is echoed back verbatim ─────────────────────
  await t.test(
    "5. Request Tracking — X-Request-ID sent by client is echoed back in response headers",
    async () => {
      const sentId = "my-trace-id-123";
      const res = await fetch(`${baseUrl}/health`, {
        headers: { [REQUEST_ID_HEADER]: sentId },
      });
      assert.strictEqual(res.status, 200);
      const echoedId = res.headers.get(REQUEST_ID_HEADER);
      assert.strictEqual(
        echoedId,
        sentId,
        `Expected response header ${REQUEST_ID_HEADER} to equal "${sentId}", got "${echoedId}"`,
      );
    },
  );

  // ── Scenario 6: Oversized body → 413 Payload Too Large ───────────────────
  // mockEnv.requestBodyLimit is "1mb". Send ~1.1 MiB to exceed it.
  // express.json() emits a PayloadTooLargeError (status 413) before the handler runs.
  await t.test(
    "6. Payload Limits — oversized request body triggers a 413 Payload Too Large",
    async () => {
      // Build a JSON object whose stringified form exceeds 1 MiB
      const oversizedPayload = JSON.stringify({
        data: "x".repeat(Math.ceil(1.1 * 1024 * 1024)),
      });
      const res = await fetch(`${baseUrl}/api/v1/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mockEnv.apiKey}`,
        },
        body: oversizedPayload,
      });
      assert.strictEqual(
        res.status,
        413,
        `Expected 413 Payload Too Large, got ${res.status}`,
      );
    },
  );

  // ── Scenario 7: CORS OPTIONS preflight → 204 + CORS headers ──────────────
  await t.test(
    "7. CORS Preflight — OPTIONS request returns 204 No Content with correct CORS headers",
    async () => {
      const origin = "http://localhost:5173";
      const res = await fetch(`${baseUrl}/health`, {
        method: "OPTIONS",
        headers: { Origin: origin },
      });
      assert.strictEqual(
        res.status,
        204,
        `Expected 204 No Content for OPTIONS, got ${res.status}`,
      );
      // corsOrigin is ["*"] in mockEnv, so the middleware echoes the origin back
      const allowOrigin = res.headers.get("Access-Control-Allow-Origin");
      assert.ok(
        allowOrigin === origin || allowOrigin === "*",
        `Expected Access-Control-Allow-Origin to be "${origin}" or "*", got "${allowOrigin}"`,
      );
      assert.ok(
        res.headers.get("Access-Control-Allow-Methods"),
        "Access-Control-Allow-Methods header must be present",
      );
      assert.ok(
        res.headers.get("Access-Control-Allow-Headers"),
        "Access-Control-Allow-Headers header must be present",
      );
    },
  );

  // ── Scenario 8: Request ID propagated to response header ─────────────────
  await t.test(
    "8. Request Tracing — generated UUID v4 request ID is propagated to response header",
    async () => {
      const res = await fetch(`${baseUrl}/api/v1/status`);
      assert.strictEqual(res.status, 200);
      const returnedId = res.headers.get(REQUEST_ID_HEADER);
      assert.ok(returnedId, `Expected ${REQUEST_ID_HEADER} header to be present`);
      // UUID v4 pattern
      const uuidV4Re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      assert.ok(
        uuidV4Re.test(returnedId!),
        `Expected ${REQUEST_ID_HEADER} to be a UUID v4, got "${returnedId}"`,
      );
    },
  );

  // ── Scenario 9: Request ID present in error response body ────────────────
  await t.test(
    "9. Request Tracing — requestId is included in error response body under meta.requestId",
    async () => {
      const sentId = "trace-error-test-id";
      const res = await fetch(`${baseUrl}/nonexistent`, {
        headers: { [REQUEST_ID_HEADER]: sentId },
      });
      assert.strictEqual(res.status, 404);
      const body = (await res.json()) as any;
      assert.strictEqual(body.success, false);
      // requestId must appear in error object
      assert.strictEqual(
        body.error.requestId,
        sentId,
        `Expected error.requestId to be "${sentId}", got "${body.error.requestId}"`,
      );
      // requestId must also appear in meta.requestId
      assert.ok(body.meta, "Expected meta field to be present in error response");
      assert.strictEqual(
        body.meta.requestId,
        sentId,
        `Expected meta.requestId to be "${sentId}", got "${body.meta?.requestId}"`,
      );
    },
  );
});

test("API key rotation flow", async (t) => {
  let server: Server;
  let baseUrl: string;

  const envWithRotation = {
    ...mockEnv,
    apiKey: "old-primary-key",
    apiKeyNext: "next-rotation-key",
  };

  t.before(async () => {
    const app = await createApp(envWithRotation as any, mockRuntime as any);
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

  await t.test("old key works while rotation is pending", async () => {
    const res = await fetch(`${baseUrl}/api/v1/proposals/stats`, {
      headers: { Authorization: "Bearer old-primary-key" },
    });
    assert.equal(res.status, 200);
  });

  await t.test("new key works while rotation is pending", async () => {
    const res = await fetch(`${baseUrl}/api/v1/proposals/stats`, {
      headers: { Authorization: "Bearer next-rotation-key" },
    });
    assert.equal(res.status, 200);
  });

  await t.test("after rotation old key is rejected and new key is primary", async () => {
    const rotateRes = await fetch(`${baseUrl}/api/v1/admin/rotate-key`, {
      method: "POST",
      headers: { Authorization: "Bearer old-primary-key" },
    });
    assert.equal(rotateRes.status, 200);

    const statusRes = await fetch(`${baseUrl}/api/v1/admin/key-status`, {
      headers: { Authorization: "Bearer next-rotation-key" },
    });
    assert.equal(statusRes.status, 200);
    const statusBody = (await statusRes.json()) as any;
    assert.equal(statusBody.data.rotationPending, false);
    assert.equal(statusBody.data.oldKeyActive, false);

    const oldKeyRes = await fetch(`${baseUrl}/api/v1/proposals/stats`, {
      headers: { Authorization: "Bearer old-primary-key" },
    });
    assert.equal(oldKeyRes.status, 401);

    const newKeyRes = await fetch(`${baseUrl}/api/v1/proposals/stats`, {
      headers: { Authorization: "Bearer next-rotation-key" },
    });
    assert.equal(newKeyRes.status, 200);
  });
});
