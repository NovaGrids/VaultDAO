import assert from "node:assert/strict";
import test from "node:test";
import {
  createDuePaymentsScheduledJob,
  registerDuePaymentsJob,
  IdempotencySet,
} from "./due-payments-job.js";
import { RecurringStatus } from "../../recurring/types.js";
import type { BackendEnv } from "../../../config/env.js";
import type { NotificationEvent } from "../../notifications/notification.types.js";
import type { RecurringPaymentDueNotification } from "../../notifications/notification.types.js";
import { MetricsRegistry } from "../../health/metrics.registry.js";
import type { DuePaymentResult } from "../../recurring/recurring.service.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    jitterWindowMax: 10,
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
  computedStatus: "active" as const,
  ledgersUntilDue: 0,
  missedPayments: 0,
  metadata: {
    id: "p-1",
    contractId: "C1",
    createdAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    ledger: 70,
  },
};

function makeDueResult(
  payment: typeof basePayment,
  trigger_reason: DuePaymentResult["trigger_reason"],
): DuePaymentResult {
  return { payment, trigger_reason };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("registerDuePaymentsJob registers only when enabled and uses configured interval", () => {
  const registered: Array<{ name: string; intervalMs: number }> = [];
  const runner = {
    register: (job: { name: string; intervalMs: number }) => {
      registered.push({ name: job.name, intervalMs: job.intervalMs });
    },
  };
  const recurringService = {
    getStatus: () => ({ lastLedgerProcessed: 100 }),
    getDuePaymentsInWindow: async () => [],
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
    getDuePaymentsInWindow: async () => [
      makeDueResult(basePayment, "exact"),
    ],
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
    getDuePaymentsInWindow: async () => [
      makeDueResult(basePayment, "exact"),
    ],
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
    getDuePaymentsInWindow: async () =>
      payments.map((p) => makeDueResult(p, "exact")),
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

// ── Jitter Window Tests ───────────────────────────────────────────────────────

test("due-payments job: exact due payment has trigger_reason = 'exact'", async () => {
  const published: NotificationEvent[] = [];

  const exactPayment = { ...basePayment, nextPaymentLedger: 100 };
  const recurringService = {
    getStatus: () => ({ lastLedgerProcessed: 100 }),
    getDuePaymentsInWindow: async () => [makeDueResult(exactPayment, "exact")],
    getPayment: async () => exactPayment,
  };
  const queue = { publish: async (e: NotificationEvent) => { published.push(e); } };

  const job = createDuePaymentsScheduledJob(recurringService as any, queue as any);
  await job.run({ now: () => new Date() });

  assert.equal(published.length, 1);
  assert.equal((published[0]!.payload as any).trigger_reason, "exact");
});

test("due-payments job: jitter-early payment has trigger_reason = 'jitter_early'", async () => {
  const published: NotificationEvent[] = [];

  // Payment due at ledger 105, current ledger is 100 — early jitter
  const earlyPayment = { ...basePayment, paymentId: "p-early", nextPaymentLedger: 105 };
  const recurringService = {
    getStatus: () => ({ lastLedgerProcessed: 100 }),
    getDuePaymentsInWindow: async () => [makeDueResult(earlyPayment, "jitter_early")],
    getPayment: async () => earlyPayment,
  };
  const queue = { publish: async (e: NotificationEvent) => { published.push(e); } };

  const job = createDuePaymentsScheduledJob(recurringService as any, queue as any);
  await job.run({ now: () => new Date() });

  assert.equal(published.length, 1);
  assert.equal((published[0]!.payload as any).trigger_reason, "jitter_early");
});

test("due-payments job: jitter-late payment has trigger_reason = 'jitter_late'", async () => {
  const published: NotificationEvent[] = [];

  // Payment due at ledger 97, current ledger is 100 — late jitter
  const latePayment = { ...basePayment, paymentId: "p-late", nextPaymentLedger: 97 };
  const recurringService = {
    getStatus: () => ({ lastLedgerProcessed: 100 }),
    getDuePaymentsInWindow: async () => [makeDueResult(latePayment, "jitter_late")],
    getPayment: async () => latePayment,
  };
  const queue = { publish: async (e: NotificationEvent) => { published.push(e); } };

  const job = createDuePaymentsScheduledJob(recurringService as any, queue as any);
  await job.run({ now: () => new Date() });

  assert.equal(published.length, 1);
  assert.equal((published[0]!.payload as any).trigger_reason, "jitter_late");
});

// ── Idempotency Tests ─────────────────────────────────────────────────────────

test("due-payments job: double-trigger prevention — same payment not published twice", async () => {
  const published: NotificationEvent[] = [];
  const idempotencySet = new IdempotencySet();

  const recurringService = {
    getStatus: () => ({ lastLedgerProcessed: 100 }),
    getDuePaymentsInWindow: async () => [makeDueResult(basePayment, "exact")],
    getPayment: async () => basePayment,
  };
  const queue = { publish: async (e: NotificationEvent) => { published.push(e); } };

  const job = createDuePaymentsScheduledJob(
    recurringService as any,
    queue as any,
    { idempotencySet },
  );

  // First run — should publish
  await job.run({ now: () => new Date() });
  assert.equal(published.length, 1, "first run should publish");

  // Second run (same payment) — should be skipped
  await job.run({ now: () => new Date() });
  assert.equal(published.length, 1, "second run should NOT re-publish (idempotency)");
});

test("IdempotencySet: respects TTL and allows re-trigger after expiry", async () => {
  const set = new IdempotencySet(50); // 50ms TTL for testing

  set.add("payment-1");
  assert.ok(set.has("payment-1"), "should be present immediately after add");

  // Wait for TTL to expire
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.ok(!set.has("payment-1"), "should be gone after TTL expiry");
});

// ── Metrics Tests ─────────────────────────────────────────────────────────────

test("due-payments job: metrics are emitted for exact, jitter_early, and jitter_late", async () => {
  const registry = new MetricsRegistry();

  const payments = [
    makeDueResult({ ...basePayment, paymentId: "pm-exact" }, "exact"),
    makeDueResult({ ...basePayment, paymentId: "pm-early", nextPaymentLedger: 105 }, "jitter_early"),
    makeDueResult({ ...basePayment, paymentId: "pm-late", nextPaymentLedger: 97 }, "jitter_late"),
  ];

  const recurringService = {
    getStatus: () => ({ lastLedgerProcessed: 100 }),
    getDuePaymentsInWindow: async () => payments,
    getPayment: async (id: string) =>
      payments.find((p) => p.payment.paymentId === id)?.payment ?? null,
  };
  const queue = { publish: async () => {} };

  const job = createDuePaymentsScheduledJob(
    recurringService as any,
    queue as any,
    { metricsRegistry: registry },
  );
  await job.run({ now: () => new Date() });

  const snap = registry.snapshot();

  assert.equal(
    snap.values.get("due_payments_triggered_exact_total"),
    1,
    "exact counter should be 1",
  );
  assert.equal(
    snap.values.get("due_payments_triggered_jitter_early_total"),
    1,
    "jitter_early counter should be 1",
  );
  assert.equal(
    snap.values.get("due_payments_triggered_jitter_late_total"),
    1,
    "jitter_late counter should be 1",
  );
  assert.equal(
    snap.values.get("due_payments_batch_size"),
    3,
    "batch size gauge should be 3",
  );
});

test("due-payments job: batch is capped at MAX_BATCH_SIZE (10)", async () => {
  const published: NotificationEvent[] = [];

  // Create 15 payments — only 10 should be processed
  const payments = Array.from({ length: 15 }, (_, i) => ({
    ...basePayment,
    paymentId: `p-${i}`,
  }));

  const recurringService = {
    getStatus: () => ({ lastLedgerProcessed: 100 }),
    getDuePaymentsInWindow: async () =>
      payments.map((p) => makeDueResult(p, "exact")),
    getPayment: async (id: string) =>
      payments.find((p) => p.paymentId === id) ?? null,
  };
  const queue = { publish: async (e: NotificationEvent) => { published.push(e); } };

  const job = createDuePaymentsScheduledJob(recurringService as any, queue as any);
  await job.run({ now: () => new Date() });

  assert.ok(
    published.length <= 10,
    `should process at most 10 payments, got ${published.length}`,
  );
});
