import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryRecurringStorageAdapter,
  RecurringIndexerService,
} from "./recurring.service.js";
import { RecurringStatus } from "./types.js";
import type { NormalizedRecurringPayment } from "./types.js";
import { createTestEnv } from "../../config/env.js";

function makePayment(overrides: Partial<NormalizedRecurringPayment> = {}): NormalizedRecurringPayment {
  return {
    paymentId: "pay-1",
    proposer: "alice",
    recipient: "bob",
    token: "USDC",
    amount: "1000",
    memo: "salary",
    intervalLedgers: 17280,
    nextPaymentLedger: 1000,
    paymentCount: 0,
    status: RecurringStatus.ACTIVE,
    events: [],
    computedStatus: "active",
    ledgersUntilDue: 1000,
    missedPayments: 0,
    metadata: {
      id: "pay-1",
      contractId: "C1",
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      ledger: 0,
    },
    ...overrides,
  };
}

async function setupServiceWithPayments(
  payments: NormalizedRecurringPayment[],
): Promise<RecurringIndexerService> {
  const storage = new MemoryRecurringStorageAdapter();
  for (const p of payments) await storage.save(p);
  return new RecurringIndexerService(createTestEnv(), storage);
}

test("checkConflicts: exact duplicate detected with score 100", async () => {
  const service = await setupServiceWithPayments([makePayment()]);
  const conflicts = await service.checkConflicts({
    recipient: "bob",
    amount: "1000",
    intervalLedgers: 17280,
  });
  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0]!.similarity_score, 100);
});

test("checkConflicts: 5% tolerance on amount", async () => {
  const service = await setupServiceWithPayments([makePayment({ amount: "1000" })]);
  // 1049 is within 5% of 1000
  const conflicts = await service.checkConflicts({
    recipient: "bob",
    amount: "1049",
    intervalLedgers: 17280,
  });
  assert.strictEqual(conflicts.length, 1);
});

test("checkConflicts: amount outside 5% tolerance is not a conflict", async () => {
  const service = await setupServiceWithPayments([makePayment({ amount: "1000" })]);
  const conflicts = await service.checkConflicts({
    recipient: "bob",
    amount: "2000",
    intervalLedgers: 17280,
  });
  assert.strictEqual(conflicts.length, 0);
});

test("checkConflicts: non-overlapping interval is not a conflict", async () => {
  const service = await setupServiceWithPayments([makePayment({ intervalLedgers: 17280 })]);
  // 12345 does not divide 17280 and 17280 does not divide 12345
  const conflicts = await service.checkConflicts({
    recipient: "bob",
    amount: "1000",
    intervalLedgers: 12345,
  });
  assert.strictEqual(conflicts.length, 0);
});

test("checkConflicts: different recipient is not a conflict", async () => {
  const service = await setupServiceWithPayments([makePayment({ recipient: "charlie" })]);
  const conflicts = await service.checkConflicts({
    recipient: "bob",
    amount: "1000",
    intervalLedgers: 17280,
  });
  assert.strictEqual(conflicts.length, 0);
});

test("checkConflicts: cancelled payment is not a conflict", async () => {
  const service = await setupServiceWithPayments([
    makePayment({ status: RecurringStatus.CANCELLED }),
  ]);
  const conflicts = await service.checkConflicts({
    recipient: "bob",
    amount: "1000",
    intervalLedgers: 17280,
  });
  assert.strictEqual(conflicts.length, 0);
});

test("checkConflicts: conflicts sorted by similarity score descending", async () => {
  const service = await setupServiceWithPayments([
    makePayment({ paymentId: "p1", amount: "1000", intervalLedgers: 17280 }),
    makePayment({ paymentId: "p2", amount: "1040", intervalLedgers: 17280 }),
  ]);
  const conflicts = await service.checkConflicts({
    recipient: "bob",
    amount: "1000",
    intervalLedgers: 17280,
  });
  assert.strictEqual(conflicts[0]!.id, "p1");
  assert.ok(conflicts[0]!.similarity_score >= conflicts[1]!.similarity_score);
});
