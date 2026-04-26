import assert from "node:assert/strict";
import test from "node:test";
import {
  createDuePaymentsScheduledJob,
  registerDuePaymentsJob,
} from "./due-payments-job.js";
import { RecurringStatus } from "../../recurring/types.js";
import type { BackendEnv } from "../../../config/env.js";
import type { NotificationEvent } from "../../notifications/notification.types.js";

function makeEnv(overrides?: Partial<BackendEnv>): BackendEnv {
  return {
    port: 8787,
    host: "0.0.0.0",
    nodeEnv: "test",
    stellarNetwork: "testnet",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    contractId: "CDTEST",
    websocketUrl: "ws://localhost:8080",
    eventPollingIntervalMs: 10_000,
    eventPollingEnabled: true,
    duePaymentsJobEnabled: true,
    duePaymentsJobIntervalMs: 42_000,
    cursorCleanupJobEnabled: false,
    cursorCleanupJobIntervalMs: 86_400_000,
    cursorRetentionDays: 30,
    corsOrigin: ["*"],
    requestBodyLimit: "1mb",
    apiKey: "test-api-key",
    cursorStorageType: "file",
    databasePath: "./test.sqlite",
    ...overrides,
  };
}

test("registerDuePaymentsJob registers only when enabled and uses configured interval", () => {
  const registered: Array<{ name: string; intervalMs: number }> = [];
  const runner = {
    register: (job: { name: string; intervalMs: number }) => {
      registered.push({ name: job.name, intervalMs: job.intervalMs });
    },
  };
  const recurringService = {
    getStatus: () => ({ lastLedgerProcessed: 100 }),
    getDuePaymentsAtLedger: async () => [],
  };
  const queue = {
    publish: async (_event: NotificationEvent) => {},
  };

  registerDuePaymentsJob(
    runner as any,
    makeEnv({ duePaymentsJobEnabled: false }),
    recurringService as any,
    queue as any,
  );
  assert.equal(registered.length, 0);

  registerDuePaymentsJob(
    runner as any,
    makeEnv({ duePaymentsJobEnabled: true, duePaymentsJobIntervalMs: 12_345 }),
    recurringService as any,
    queue as any,
  );

  assert.equal(registered.length, 1);
  assert.equal(registered[0]?.name, "due-payments");
  assert.equal(registered[0]?.intervalMs, 12_345);
});

test("due-payments job publishes one notification for each due payment", async () => {
  const published: NotificationEvent[] = [];
  const recurringService = {
    getStatus: () => ({ lastLedgerProcessed: 77 }),
    getDuePaymentsAtLedger: async (_currentLedger: number) => [
      {
        paymentId: "p-1",
        proposer: "A",
        recipient: "R1",
        token: "TOKEN",
        amount: "10",
        memo: "",
        intervalLedgers: 10,
        nextPaymentLedger: 70,
        paymentCount: 0,
        status: RecurringStatus.DUE,
        events: [],
        metadata: {
          id: "p-1",
          contractId: "C1",
          createdAt: new Date().toISOString(),
          lastUpdatedAt: new Date().toISOString(),
          ledger: 70,
        },
      },
      {
        paymentId: "p-2",
        proposer: "B",
        recipient: "R2",
        token: "TOKEN",
        amount: "20",
        memo: "",
        intervalLedgers: 10,
        nextPaymentLedger: 75,
        paymentCount: 0,
        status: RecurringStatus.DUE,
        events: [],
        metadata: {
          id: "p-2",
          contractId: "C1",
          createdAt: new Date().toISOString(),
          lastUpdatedAt: new Date().toISOString(),
          ledger: 75,
        },
      },
    ],
  };
  const queue = {
    publish: async (event: NotificationEvent) => {
      published.push(event);
    },
  };

  const job = createDuePaymentsScheduledJob(recurringService as any, queue as any);
  await job.run({ now: () => new Date() });

  assert.equal(published.length, 2);
  assert.equal(published[0]?.source, "jobs.due-payments");
  assert.equal((published[0]?.payload as any).paymentId, "p-1");
  assert.equal((published[0]?.payload as any).recipient, "R1");
  assert.equal((published[0]?.payload as any).amount, "10");
});
