import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./app.js";
import { Server } from "node:http";
import { once } from "node:events";
import { MetricsRegistry } from "./modules/health/metrics.registry.js";
import {
  createMemoryPersistence,
  createProposalAggregator,
  ProposalActivityType,
} from "./modules/proposals/index.js";
import { TransactionsService } from "./modules/transactions/transactions.service.js";
import type { ProposalActivityRecord } from "./modules/proposals/types.js";
import { REQUEST_ID_HEADER } from "./shared/http/requestId.js";
import { randomUUID } from "node:crypto";

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

function createTestRecord(overrides: Partial<ProposalActivityRecord> = {}): ProposalActivityRecord {
  const id = randomUUID();
  return {
    activityId: id,
    proposalId: overrides.proposalId ?? "proposal-1",
    type: overrides.type ?? ProposalActivityType.EXECUTED,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    metadata: {
      id,
      contractId: "CDTEST",
      ledger: 1000,
      ledgerClosedAt: new Date().toISOString(),
      transactionHash: overrides.metadata?.transactionHash ?? `txhash-${id}`,
      eventIndex: 0,
      ...overrides.metadata,
    },
    data: overrides.data ?? {
      activityType: ProposalActivityType.EXECUTED,
      executor: "GABC",
      recipient: "GXYZ",
      token: "XLM",
      amount: "500",
      executionLedger: 1000,
    },
  };
}

test("E2E Integration: full request lifecycle", async (t) => {
  let server: Server;
  let baseUrl: string;
  const persistence = createMemoryPersistence();
  const aggregator = createProposalAggregator();

  const metricsRegistry = new MetricsRegistry();
  const runtime = {
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
    proposalActivityAggregator: aggregator,
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
    metricsRegistry,
    proposalActivityPersistence: persistence,
    get transactionsService() {
      return new TransactionsService(this.proposalActivityPersistence);
    },
  };

  t.before(async () => {
    const record1 = createTestRecord({
      proposalId: "proposal-1",
      metadata: { id: "e1", contractId: "CDTEST", ledger: 1000, ledgerClosedAt: new Date().toISOString(), transactionHash: "txhash-001", eventIndex: 0 },
      data: { activityType: ProposalActivityType.EXECUTED, executor: "GABC", recipient: "GXYZ", token: "XLM", amount: "100", executionLedger: 1000 },
    });
    const record2 = createTestRecord({
      proposalId: "proposal-2",
      metadata: { id: "e2", contractId: "CDTEST", ledger: 1001, ledgerClosedAt: new Date().toISOString(), transactionHash: "txhash-002", eventIndex: 0 },
      data: { activityType: ProposalActivityType.EXECUTED, executor: "GABC", recipient: "GDEF", token: "USDC", amount: "500", executionLedger: 1001 },
    });
    const record3 = createTestRecord({
      proposalId: "proposal-3",
      type: ProposalActivityType.CREATED,
      metadata: { id: "e3", contractId: "CDTEST", ledger: 1002, ledgerClosedAt: new Date().toISOString(), transactionHash: "txhash-003", eventIndex: 0 },
      data: { activityType: ProposalActivityType.CREATED, proposer: "GABC", recipient: "GHIJ", token: "XLM", amount: "200", insuranceAmount: "0", description: "Test" },
    });

    await persistence.save(record1);
    await persistence.save(record2);
    await persistence.save(record3);

    aggregator.addRecord(record1);
    aggregator.addRecord(record2);
    aggregator.addRecord(record3);

    const app = await createApp(mockEnv as any, runtime as any);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (typeof address === "object" && address !== null) {
      baseUrl = `http://127.0.0.1:${address.port}`;
    }
  });

  t.after(() =>
    new Promise<void>((resolve) => {
      if (typeof (server as any).closeAllConnections === "function") {
        (server as any).closeAllConnections();
      }
      server.close(() => resolve());
    }),
  );

  await t.test("health → middleware → controller → response (full lifecycle)", async () => {
    const requestId = "e2e-trace-001";
    const res = await fetch(`${baseUrl}/health`, {
      headers: { [REQUEST_ID_HEADER]: requestId },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get(REQUEST_ID_HEADER), requestId);
    const body = (await res.json()) as any;
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.ok, true);
  });

  await t.test("transactions endpoint: request → middleware → controller → service → persistence → response", async () => {
    const res = await fetch(`${baseUrl}/api/v1/transactions?contractId=CDTEST`, {
      headers: { Authorization: `Bearer ${mockEnv.apiKey}` },
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as any;
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data.data));
    assert.strictEqual(body.data.data.length, 2);
    assert.ok(body.data.data.every((tx: any) => tx.contractId === "CDTEST"));
  });

  await t.test("transactions by proposal: full lifecycle through service layer", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/transactions/by-proposal/proposal-1?contractId=CDTEST`,
      { headers: { Authorization: `Bearer ${mockEnv.apiKey}` } },
    );
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as any;
    assert.strictEqual(body.success, true);
    assert.ok(Array.isArray(body.data.data));
    assert.ok(body.data.data.length >= 1);
    assert.ok(body.data.data.every((tx: any) => tx.proposalId === "proposal-1"));
  });

  await t.test("transaction by hash: full lifecycle with 404 for missing", async () => {
    const res = await fetch(
      `${baseUrl}/api/v1/transactions/nonexistent-hash?contractId=CDTEST`,
      { headers: { Authorization: `Bearer ${mockEnv.apiKey}` } },
    );
    assert.strictEqual(res.status, 404);
    const body = (await res.json()) as any;
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, "NOT_FOUND");
  });

  await t.test("proposals stats: request → auth middleware → controller → aggregator → response", async () => {
    const res = await fetch(`${baseUrl}/api/v1/proposals/stats`, {
      headers: { Authorization: `Bearer ${mockEnv.apiKey}` },
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as any;
    assert.strictEqual(body.success, true);
    assert.ok(typeof body.data.totalProposals === "number");
    assert.ok(body.data.totalProposals >= 3);
  });

  await t.test("auth middleware rejects unauthenticated requests to protected routes", async () => {
    const res = await fetch(`${baseUrl}/api/v1/transactions`);
    assert.strictEqual(res.status, 401);
    const body = (await res.json()) as any;
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.error.code, "UNAUTHORIZED");
  });

  await t.test("middleware ordering: request ID is set even on error responses", async () => {
    const traceId = "e2e-error-trace";
    const res = await fetch(`${baseUrl}/nonexistent-route`, {
      headers: { [REQUEST_ID_HEADER]: traceId },
    });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.headers.get(REQUEST_ID_HEADER), traceId);
    const body = (await res.json()) as any;
    assert.strictEqual(body.error.requestId, traceId);
  });

  await t.test("CORS → routing → 404 handler chain", async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`, {
      method: "OPTIONS",
      headers: { Origin: "http://test.local" },
    });
    assert.strictEqual(res.status, 204);
    assert.ok(res.headers.get("Access-Control-Allow-Origin"));
  });
});
