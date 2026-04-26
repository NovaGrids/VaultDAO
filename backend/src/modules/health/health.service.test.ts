import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHealthPayload,
  buildReadinessPayload,
  buildStatusPayload,
  checkRpc,
  checkEventPolling,
  checkJobRunner,
  buildDetailedHealthPayload,
} from "./health.service.js";

const mockEnv = {
  port: 8787,
  host: "0.0.0.0",
  nodeEnv: "test",
  stellarNetwork: "testnet",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  contractId: "CDTEST",
  websocketUrl: "ws://localhost:8080",
  eventPollingIntervalMs: 5000,
  eventPollingEnabled: false,
  duePaymentsJobEnabled: false,
  duePaymentsJobIntervalMs: 60000,
  cursorCleanupJobEnabled: false,
  cursorCleanupJobIntervalMs: 86400000,
  cursorRetentionDays: 30,
  corsOrigin: ["*"],
  requestBodyLimit: "1mb",
  cursorStorageType: "file" as const,
  databasePath: "./test.sqlite",
};

const mockRuntime = {
  startedAt: "2026-03-25T00:00:00.000Z",
  eventPollingService: {
    getStatus: () => ({ running: false, lastCheck: null }),
  },
  jobManager: {
    getAllJobs: () => [
      { name: "event-polling", isRunning: () => true },
      { name: "recurring-indexer", isRunning: () => true },
    ],
  },
};

test("builds a minimal liveness payload", () => {
  const payload = buildHealthPayload(mockEnv, mockRuntime as any);

  assert.equal(payload.ok, true);
  assert.deepEqual(payload.jobs, [
    { name: "event-polling", running: true },
    { name: "recurring-indexer", running: true },
  ]);
});

test("buildHealthPayload returns ok: false when any job is not running", () => {
  const runtime = {
    ...mockRuntime,
    jobManager: {
      getAllJobs: () => [
        { name: "event-polling", isRunning: () => true },
        { name: "recurring-indexer", isRunning: () => false },
      ],
    },
  };

  const payload = buildHealthPayload(mockEnv, runtime as any);

  assert.equal(payload.ok, false);
  assert.deepEqual(payload.jobs, [
    { name: "event-polling", running: true },
    { name: "recurring-indexer", running: false },
  ]);
});

test("buildHealthPayload returns ok: true when no jobs are registered", () => {
  const runtime = {
    ...mockRuntime,
    jobManager: { getAllJobs: () => [] },
  };

  const payload = buildHealthPayload(mockEnv, runtime as any);

  assert.equal(payload.ok, true);
  assert.deepEqual(payload.jobs, []);
});

test("builds a status payload", () => {
  const payload = buildStatusPayload(mockEnv, mockRuntime as any);

  assert.equal(payload.service, "vaultdao-backend");
  assert.equal(payload.environment, "test");
  assert.equal(payload.contractId, "CDTEST");
  assert.match(payload.rpcUrl, /soroban-testnet/);
});

test("health and status mask contractId in production", () => {
  const longId = "CDO4B7X6FUM2YUH2BNVQKSHSM5M7XED3SFEHVYJ4V47PVML2P5FCHQ4";
  const prodEnv = { ...mockEnv, nodeEnv: "production", contractId: longId };

  const health = buildHealthPayload(prodEnv, mockRuntime as any);
  const status = buildStatusPayload(prodEnv, mockRuntime as any);

  assert.equal(health.ok, true);
  assert.equal(
    status.contractId,
    `${longId.slice(0, 6)}...${longId.slice(-6)}`,
  );
});

test("builds a readiness payload with dependency checks", () => {
  const payload = buildReadinessPayload(mockEnv, mockRuntime as any);

  assert.equal(payload.ready, true);
  assert.equal(payload.service, "vaultdao-backend");
  assert.equal(payload.checks.app.status, "ready");
  assert.equal(payload.checks.app.checked, true);
  assert.equal(payload.checks.rpc.status, "ready");
  assert.equal(payload.checks.rpc.configured, true);
  assert.equal(payload.checks.rpc.checked, false);
  assert.match(payload.checks.rpc.details, /no live connectivity check/i);
  assert.equal(payload.checks.websocket.status, "ready");
  assert.equal(payload.checks.websocket.configured, true);
  assert.equal(payload.checks.websocket.checked, false);
  assert.equal(payload.checks.storage.status, "ready");
  assert.equal(payload.checks.storage.configured, false);
  assert.equal(payload.checks.storage.checked, false);
  assert.equal(typeof payload.uptimeSeconds, "number");
});

test("buildReadinessPayload returns ready: false when RPC URL is empty", () => {
  const envWithoutRpc = {
    ...mockEnv,
    sorobanRpcUrl: "", // Missing RPC URL
  };

  const payload = buildReadinessPayload(envWithoutRpc, mockRuntime as any);

  assert.equal(payload.ready, false);
  assert.equal(payload.checks.rpc.status, "not_ready");
  assert.equal(payload.checks.rpc.configured, false);
  assert.match(payload.checks.rpc.details, /RPC endpoint URL is missing/i);
});

test("buildReadinessPayload returns ready: true when all required checks pass", () => {
  const envWithAllChecks = {
    ...mockEnv,
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    websocketUrl: "ws://localhost:8080",
  };

  const payload = buildReadinessPayload(envWithAllChecks, mockRuntime as any);

  assert.equal(payload.ready, true);
  assert.equal(payload.checks.app.status, "ready");
  assert.equal(payload.checks.rpc.status, "ready");
  assert.equal(payload.checks.rpc.configured, true);
  // Optional dependencies should not affect ready status
  assert.equal(payload.checks.websocket.configured, true);
  assert.equal(payload.checks.storage.configured, false);
});

test("buildReadinessPayload includes correct uptime calculation", () => {
  // Mock Date.now() to a fixed value
  const originalDateNow = Date.now;
  const fixedNow = new Date("2026-03-25T00:05:30.000Z").getTime(); // 5 minutes 30 seconds later

  Date.now = () => fixedNow;

  try {
    const runtime = {
      startedAt: "2026-03-25T00:00:00.000Z",
      eventPollingService: {
        getStatus: () => ({ running: false, lastCheck: null }),
      },
    };

    const payload = buildReadinessPayload(mockEnv, runtime as any);

    // 5 minutes 30 seconds = 330 seconds
    assert.equal(payload.uptimeSeconds, 330);
    assert.equal(typeof payload.timestamp, "string");
  } finally {
    Date.now = originalDateNow;
  }
});

test("buildReadinessPayload calculates uptime accurately for various durations", () => {
  const originalDateNow = Date.now;

  try {
    // Test 1 second uptime
    Date.now = () => new Date("2026-03-25T00:00:01.000Z").getTime();
    let payload = buildReadinessPayload(mockEnv, {
      startedAt: "2026-03-25T00:00:00.000Z",
      eventPollingService: {
        getStatus: () => ({ running: false, lastCheck: null }),
      },
    } as any);
    assert.equal(payload.uptimeSeconds, 1);

    // Test 1 hour uptime
    Date.now = () => new Date("2026-03-25T01:00:00.000Z").getTime();
    payload = buildReadinessPayload(mockEnv, {
      startedAt: "2026-03-25T00:00:00.000Z",
      eventPollingService: {
        getStatus: () => ({ running: false, lastCheck: null }),
      },
    } as any);
    assert.equal(payload.uptimeSeconds, 3600);

    // Test 1 day uptime
    Date.now = () => new Date("2026-03-26T00:00:00.000Z").getTime();
    payload = buildReadinessPayload(mockEnv, {
      startedAt: "2026-03-25T00:00:00.000Z",
      eventPollingService: {
        getStatus: () => ({ running: false, lastCheck: null }),
      },
    } as any);
    assert.equal(payload.uptimeSeconds, 86400);
  } finally {
    Date.now = originalDateNow;
  }
});

test("buildReadinessPayload dependency checks include all required fields", () => {
  const payload = buildReadinessPayload(mockEnv, mockRuntime as any);

  const checks = [
    payload.checks.app,
    payload.checks.rpc,
    payload.checks.websocket,
    payload.checks.storage,
  ];

  checks.forEach((check) => {
    assert.ok(check.name, "Check should have a name");
    assert.ok(
      typeof check.required === "boolean",
      "Check should have required property",
    );
    assert.ok(
      check.status === "ready" || check.status === "not_ready",
      "Check status should be ready or not_ready",
    );
    assert.ok(
      typeof check.configured === "boolean",
      "Check should have configured property",
    );
    assert.ok(
      typeof check.checked === "boolean",
      "Check should have checked property",
    );
    assert.ok(check.details, "Check should have details");
  });
});

test("buildStatusPayload includes version and build info", () => {
  const payload = buildStatusPayload(mockEnv, mockRuntime as any);

  assert.ok(payload.version, "Should include version");
  assert.match(payload.version, /\d+\.\d+\.\d+/, "Version should be semantic");
  assert.equal(typeof payload.timestamp, "string");
  assert.ok(payload.timestamp.length > 0);
});

test("buildStatusPayload includes all endpoint URLs", () => {
  const payload = buildStatusPayload(mockEnv, mockRuntime as any);

  assert.equal(typeof payload.rpcUrl, "string");
  assert.equal(typeof payload.horizonUrl, "string");
  assert.equal(typeof payload.websocketUrl, "string");
  assert.equal(payload.rpcUrl, mockEnv.sorobanRpcUrl);
  assert.equal(payload.horizonUrl, mockEnv.horizonUrl);
  assert.equal(payload.websocketUrl, mockEnv.websocketUrl);
});

// ── Detailed health tests ─────────────────────────────────────────────────────

test("checkRpc returns healthy status when RPC responds", async () => {
  const mockFetch = async (_url: string, _opts?: any) => ({
    json: async () => ({ result: { sequence: 1234567 } }),
  });

  // Temporarily override global fetch for this test
  const originalFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = mockFetch;

  try {
    const result = await checkRpc("https://soroban-testnet.stellar.org", 5000);
    assert.equal(result.status, "healthy");
    assert.equal(typeof result.latencyMs, "number");
    assert.ok(result.latencyMs >= 0);
    assert.equal(result.ledger, 1234567);
    assert.equal(result.error, undefined);
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test("checkRpc returns degraded status when fetch throws", async () => {
  const originalFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async () => {
    throw new Error("connection refused");
  };

  try {
    const result = await checkRpc("https://unreachable.example.com", 5000);
    assert.equal(result.status, "degraded");
    assert.ok(result.error?.includes("connection refused"));
    assert.equal(typeof result.latencyMs, "number");
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test("checkEventPolling returns event polling status from runtime", () => {
  const runtime = {
    ...mockRuntime,
    eventPollingService: {
      getStatus: () => ({ lastLedgerPolled: 500, isPolling: true, errors: 0 }),
    },
  };

  const status = checkEventPolling(runtime as any);

  assert.equal(status.lastLedgerPolled, 500);
  assert.equal(status.isPolling, true);
  assert.equal(status.errors, 0);
});

test("checkJobRunner returns job counts and statuses", () => {
  const runtime = {
    ...mockRuntime,
    jobManager: {
      getAllJobs: () => [
        { name: "event-polling", isRunning: () => true },
        { name: "recurring-indexer", isRunning: () => false },
      ],
    },
  };

  const result = checkJobRunner(runtime as any);

  assert.equal(result.total, 2);
  assert.equal(result.running, 1);
  assert.equal(result.jobs.length, 2);
  assert.equal(result.jobs[0].name, "event-polling");
  assert.equal(result.jobs[0].running, true);
  assert.equal(result.jobs[1].running, false);
});

test("buildDetailedHealthPayload returns ok:true when RPC is healthy", async () => {
  const originalFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async () => ({
    json: async () => ({ result: { sequence: 9999 } }),
  });

  try {
    const payload = await buildDetailedHealthPayload(mockEnv as any, mockRuntime as any);

    assert.equal(payload.ok, true);
    assert.equal(payload.rpc.status, "healthy");
    assert.equal(payload.rpc.ledger, 9999);
    assert.ok(typeof payload.version === "string");
    assert.ok(typeof payload.uptime === "number");
    assert.ok(typeof payload.eventPolling === "object");
    assert.ok(typeof payload.jobRunner === "object");
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test("buildDetailedHealthPayload returns ok:false when RPC is unreachable", async () => {
  const originalFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async () => {
    throw new Error("ECONNREFUSED");
  };

  try {
    const payload = await buildDetailedHealthPayload(mockEnv as any, mockRuntime as any);

    assert.equal(payload.ok, false);
    assert.equal(payload.rpc.status, "degraded");
    assert.ok(payload.rpc.error?.includes("ECONNREFUSED"));
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test("buildDetailedHealthPayload response includes all required fields", async () => {
  const originalFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async () => ({
    json: async () => ({ result: { sequence: 1 } }),
  });

  try {
    const payload = await buildDetailedHealthPayload(mockEnv as any, mockRuntime as any);

    assert.ok("ok" in payload);
    assert.ok("version" in payload);
    assert.ok("uptime" in payload);
    assert.ok("rpc" in payload);
    assert.ok("eventPolling" in payload);
    assert.ok("jobRunner" in payload);
    assert.ok("status" in payload.rpc);
    assert.ok("latencyMs" in payload.rpc);
    assert.ok("total" in payload.jobRunner);
    assert.ok("running" in payload.jobRunner);
    assert.ok("jobs" in payload.jobRunner);
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
});

test("buildReadinessPayload with missing websocket URL shows not_ready but not required", () => {
  const envWithoutWebsocket = {
    ...mockEnv,
    websocketUrl: "", // Missing websocket URL
  };

  const payload = buildReadinessPayload(
    envWithoutWebsocket,
    mockRuntime as any,
  );

  // Should still be ready because websocket is not required
  assert.equal(payload.ready, true);
  assert.equal(payload.checks.websocket.status, "not_ready");
  assert.equal(payload.checks.websocket.required, false);
  assert.equal(payload.checks.websocket.configured, false);
  assert.match(
    payload.checks.websocket.details,
    /not configured yet|optional/i,
  );
});
