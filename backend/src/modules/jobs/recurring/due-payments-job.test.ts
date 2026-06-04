import assert from "node:assert/strict";
import test from "node:test";
import {
  createDuePaymentsScheduledJob,
  registerDuePaymentsJob,
} from "./due-payments-job.js";
import { RecurringStatus } from "../../recurring/types.js";
import type { BackendEnv } from "../../../config/env.js";
import type { NotificationEvent } from "../../notifications/notification.types.js";
import type { RecurringPaymentDueNotification } from "../../notifications/notification.types.js";

function makeEnv(overrides?: Partial<BackendEnv>): BackendEnv {
  return {
    port: 8787,
    host: "0.0.0.0",
    nodeEnv: "test",
    stellarNetwork: "testnet",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    contractId: "CDTEST",
    contractIds: [],
    indexingParallelism: 1,
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
  } as BackendEnv;
}

const basePayment = {
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
};

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
    getPayment: async () => null,
  };
  const queue = { publish: async (_event: NotificationEvent) => {} };

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

test("due-payments job publishes enriched notification with full payment details", async () => {
  const published: NotificationEvent[] = [];

  const recurringService = {
    getStatus: () => ({ lastLedgerProcessed: 77 }),
    getDuePaymentsAtLedger: async () => [basePayment],
    getPayment: async (id: string) => {
      if (id === "p-1") return basePayment;
      return null;
    },
  };
  const queue = {
    publish: async (event: NotificationEvent) => {
      published.push(event);
    },
  };

  const job = createDuePaymentsScheduledJob(
    recurringService as any,
    queue as any,
  );
  await job.run({ now: () => new Date() });

  assert.equal(published.length, 1);
  const payload = published[0]!
    .payload as unknown as RecurringPaymentDueNotification;
  assert.equal(published[0]!.source, "jobs.due-payments");
  assert.equal(payload.notificationType, "RECURRING_PAYMENT_DUE");
  assert.equal(payload.paymentId, "p-1");
  assert.equal(payload.recipientAddress, "R1");
  assert.equal(payload.tokenAddress, "TOKEN");
  assert.equal(payload.amount, "10");
  assert.equal(payload.intervalLedgers, 10);
  assert.equal(payload.nextPaymentLedger, 70);
  assert.equal(typeof payload.missedCount, "number");
  assert.equal(payload.enrichmentFailed, undefined);
});

test("due-payments job publishes degraded notification when enrichment fails", async () => {
  const published: NotificationEvent[] = [];

  const recurringService = {
    getStatus: () => ({ lastLedgerProcessed: 77 }),
    getDuePaymentsAtLedger: async () => [basePayment],
    getPayment: async (_id: string) => {
      throw new Error("RPC unavailable");
    },
  };
  const queue = {
    publish: async (event: NotificationEvent) => {
      published.push(event);
    },
  };

  const job = createDuePaymentsScheduledJob(
    recurringService as any,
    queue as any,
  );
  await job.run({ now: () => new Date() });

  assert.equal(published.length, 1);
  const payload = published[0]!
    .payload as unknown as RecurringPaymentDueNotification;
  assert.equal(payload.enrichmentFailed, true);
  assert.equal(payload.paymentId, "p-1");
  assert.equal(published[0]!.source, "jobs.due-payments");
});

test("due-payments job publishes one notification per due payment", async () => {
  const published: NotificationEvent[] = [];
  const payments = [
    { ...basePayment, paymentId: "p-1" },
    { ...basePayment, paymentId: "p-2", recipient: "R2", amount: "20" },
  ];

  const recurringService = {
    getStatus: () => ({ lastLedgerProcessed: 77 }),
    getDuePaymentsAtLedger: async () => payments,
    getPayment: async (id: string) =>
      payments.find((p) => p.paymentId === id) ?? null,
  };
  const queue = {
    publish: async (event: NotificationEvent) => {
      published.push(event);
    },
  };

  const job = createDuePaymentsScheduledJob(
    recurringService as any,
    queue as any,
  );
  await job.run({ now: () => new Date() });

  assert.equal(published.length, 2);
  assert.equal((published[0]!.payload as any).paymentId, "p-1");
  assert.equal((published[1]!.payload as any).paymentId, "p-2");
});
