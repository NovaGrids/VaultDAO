/**
 * Tests for predictRecurringDues (#1454) — prediction accuracy with various intervals.
 *
 * Covers:
 *   - Basic projection with a single active payment.
 *   - Multiple occurrences within a wide window.
 *   - Multiple payments sorted by ledger.
 *   - Window exclusion (payment due after the window).
 *   - Confidence scoring (high / medium / low).
 *   - Overdue payments still appear with low confidence.
 *   - Cancelled payments are excluded.
 *   - Edge: windowLedgers = 0 throws.
 *   - Custom currentLedger override.
 *   - Mixed intervals (weekly, monthly cadences).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryRecurringStorageAdapter,
  RecurringIndexerService,
} from "./recurring.service.js";
import { RecurringStatus } from "./types.js";
import { createTestEnv } from "../../config/env.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeService() {
  const storage = new MemoryRecurringStorageAdapter();
  const env = createTestEnv();
  const service = new RecurringIndexerService(env, storage);
  return { service, storage };
}

/** Minimal valid NormalizedRecurringPayment for test seeding. */
function makePayment(
  overrides: Partial<{
    paymentId: string;
    nextPaymentLedger: number;
    intervalLedgers: number;
    status: RecurringStatus;
    retryCount: number;
    lastAttemptAt: number;
    nextRetryAt: number;
    missedPayments: number;
  }> = {},
) {
  return {
    paymentId: overrides.paymentId ?? "p1",
    proposer: "alice",
    recipient: "bob",
    token: "USDC",
    amount: "100",
    memo: "payroll",
    intervalLedgers: overrides.intervalLedgers ?? 1000,
    nextPaymentLedger: overrides.nextPaymentLedger ?? 1000,
    retryStrategy: "LINEAR" as const,
    retryCount: overrides.retryCount ?? 0,
    retryNextLedger: 0,
    paymentCount: 1,
    status: overrides.status ?? RecurringStatus.ACTIVE,
    events: [],
    metadata: {
      id: overrides.paymentId ?? "p1",
      contractId: "C1",
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      ledger: 1,
    },
    computedStatus: "active" as const,
    ledgersUntilDue: 0,
    missedPayments: overrides.missedPayments ?? 0,
    lastAttemptAt: overrides.lastAttemptAt ?? 0,
    nextRetryAt: overrides.nextRetryAt ?? 0,
    totalMissedExecutions: 0,
    jitterWindow: 0,
    jitterOffset: 0,
  };
}

// ── Basic projection tests ────────────────────────────────────────────────────

test("predictRecurringDues returns single occurrence within exact window", async () => {
  const { service, storage } = makeService();
  await storage.save(makePayment({ nextPaymentLedger: 1050, intervalLedgers: 1000 }));

  const results = await service.predictRecurringDues(100, 1000);
  assert.equal(results.length, 1);
  assert.equal(results[0]!.ledger, 1050);
  assert.equal(results[0]!.occurrenceIndex, 1);
  assert.equal(results[0]!.paymentId, "p1");
});

test("predictRecurringDues returns multiple occurrences for wide window", async () => {
  const { service, storage } = makeService();
  // interval = 500 ledgers, first due at 1000, window = 2000 ledgers
  await storage.save(makePayment({ nextPaymentLedger: 1000, intervalLedgers: 500 }));

  // currentLedger = 800 -> window end = 2800
  // Expected occurrences: 1000, 1500, 2000, 2500 (all <= 2800)
  const results = await service.predictRecurringDues(2000, 800);
  assert.equal(results.length, 4);
  assert.equal(results[0]!.ledger, 1000);
  assert.equal(results[0]!.occurrenceIndex, 1);
  assert.equal(results[1]!.ledger, 1500);
  assert.equal(results[1]!.occurrenceIndex, 2);
  assert.equal(results[2]!.ledger, 2000);
  assert.equal(results[3]!.ledger, 2500);
});

test("predictRecurringDues excludes payment due after the window", async () => {
  const { service, storage } = makeService();
  await storage.save(makePayment({ nextPaymentLedger: 5000, intervalLedgers: 1000 }));

  // window end = 1000 + 100 = 1100 -- far before 5000
  const results = await service.predictRecurringDues(100, 1000);
  assert.equal(results.length, 0);
});

test("predictRecurringDues sorts multiple payments by ascending ledger", async () => {
  const { service, storage } = makeService();
  await storage.save(makePayment({ paymentId: "pA", nextPaymentLedger: 1500, intervalLedgers: 2000 }));
  await storage.save(makePayment({ paymentId: "pB", nextPaymentLedger: 1100, intervalLedgers: 2000 }));
  await storage.save(makePayment({ paymentId: "pC", nextPaymentLedger: 1300, intervalLedgers: 2000 }));

  const results = await service.predictRecurringDues(1000, 1000);
  assert.equal(results.length, 3);
  assert.equal(results[0]!.paymentId, "pB"); // 1100
  assert.equal(results[1]!.paymentId, "pC"); // 1300
  assert.equal(results[2]!.paymentId, "pA"); // 1500
});

// ── Confidence scoring tests ──────────────────────────────────────────────────

test("predictRecurringDues assigns high confidence for clean payment", async () => {
  const { service, storage } = makeService();
  await storage.save(makePayment({
    nextPaymentLedger: 1050,
    retryCount: 0,
    missedPayments: 0,
    lastAttemptAt: 0,
    nextRetryAt: 0,
  }));

  const results = await service.predictRecurringDues(200, 1000);
  assert.equal(results.length, 1);
  assert.equal(results[0]!.confidence, "high");
});

test("predictRecurringDues assigns medium confidence when retryCount > 0 but not overdue", async () => {
  const { service, storage } = makeService();
  await storage.save(makePayment({
    nextPaymentLedger: 1100,
    retryCount: 2,
    lastAttemptAt: 0,
    nextRetryAt: 0,
  }));

  const results = await service.predictRecurringDues(200, 1000);
  assert.equal(results.length, 1);
  assert.equal(results[0]!.confidence, "medium");
});

test("predictRecurringDues assigns low confidence when payment is overdue", async () => {
  const { service, storage } = makeService();
  // nextPaymentLedger < currentLedger -> overdue
  await storage.save(makePayment({
    nextPaymentLedger: 900,
    status: RecurringStatus.DUE,
    retryCount: 0,
  }));

  const results = await service.predictRecurringDues(500, 1000);
  assert.ok(results.length >= 1);
  // First occurrence is at ledger 900 which is < currentLedger 1000 = overdue
  assert.equal(results[0]!.confidence, "low");
});

test("predictRecurringDues assigns low confidence when in active backoff", async () => {
  const { service, storage } = makeService();
  const nowSeconds = Math.floor(Date.now() / 1000);
  await storage.save(makePayment({
    nextPaymentLedger: 1050,
    retryCount: 1,
    lastAttemptAt: nowSeconds - 10,
    nextRetryAt: nowSeconds + 3600, // still in backoff
  }));

  const results = await service.predictRecurringDues(200, 1000);
  assert.equal(results.length, 1);
  assert.equal(results[0]!.confidence, "low");
});

// ── Cancelled payment exclusion ───────────────────────────────────────────────

test("predictRecurringDues excludes cancelled payments", async () => {
  const { service, storage } = makeService();
  await storage.save(makePayment({
    paymentId: "active",
    nextPaymentLedger: 1050,
    status: RecurringStatus.ACTIVE,
  }));
  await storage.save(makePayment({
    paymentId: "cancelled",
    nextPaymentLedger: 1050,
    status: RecurringStatus.CANCELLED,
  }));

  const results = await service.predictRecurringDues(200, 1000);
  assert.equal(results.length, 1);
  assert.equal(results[0]!.paymentId, "active");
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test("predictRecurringDues throws for windowLedgers = 0", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.predictRecurringDues(0, 1000),
    /windowLedgers must be a positive integer/,
  );
});

test("predictRecurringDues returns empty array when no payments exist", async () => {
  const { service } = makeService();
  const results = await service.predictRecurringDues(1000, 1000);
  assert.equal(results.length, 0);
});

test("predictRecurringDues uses currentLedger override correctly", async () => {
  const { service, storage } = makeService();
  // Payment at 2000, window of 100 from ledger 1950 -> 2000 is inside [1950, 2050]
  await storage.save(makePayment({ nextPaymentLedger: 2000, intervalLedgers: 1000 }));

  const inside = await service.predictRecurringDues(100, 1950);
  assert.equal(inside.length, 1);
  assert.equal(inside[0]!.ledger, 2000);

  // Same payment from ledger 2100 -> 2000 < 2100 (overdue but still returned)
  const overdue = await service.predictRecurringDues(100, 2100);
  assert.ok(overdue.length >= 1);
  assert.equal(overdue[0]!.ledger, 2000); // first occurrence is overdue
});

// ── Mixed interval tests ──────────────────────────────────────────────────────

test("predictRecurringDues handles weekly (17280) and monthly (72000) intervals", async () => {
  const { service, storage } = makeService();
  // "weekly" ~= 17280 ledgers (5 sec/ledger x 604800 s)
  await storage.save(makePayment({ paymentId: "weekly", nextPaymentLedger: 17_280, intervalLedgers: 17_280 }));
  // "monthly" ~= 72000 ledgers
  await storage.save(makePayment({ paymentId: "monthly", nextPaymentLedger: 72_000, intervalLedgers: 72_000 }));

  // From ledger 0, window = 100000 ledgers
  const results = await service.predictRecurringDues(100_000, 0);

  // weekly: 17280, 34560, 51840, 69120, 86400 -> 5 occurrences <= 100000
  const weekly = results.filter((r) => r.paymentId === "weekly");
  assert.equal(weekly.length, 5);
  assert.equal(weekly[0]!.ledger, 17_280);
  assert.equal(weekly[4]!.ledger, 86_400);

  // monthly: 72000 -> 1 occurrence <= 100000
  const monthly = results.filter((r) => r.paymentId === "monthly");
  assert.equal(monthly.length, 1);
  assert.equal(monthly[0]!.ledger, 72_000);
});

test("predictRecurringDues calculates ledgersFromNow correctly", async () => {
  const { service, storage } = makeService();
  await storage.save(makePayment({ nextPaymentLedger: 1200, intervalLedgers: 500 }));

  const results = await service.predictRecurringDues(1000, 1000);
  assert.ok(results.length >= 1);
  // First occurrence: ledger 1200, currentLedger 1000 -> ledgersFromNow = 200
  assert.equal(results[0]!.ledgersFromNow, 200);
  // Second occurrence: ledger 1700, ledgersFromNow = 700
  assert.equal(results[1]!.ledgersFromNow, 700);
});
