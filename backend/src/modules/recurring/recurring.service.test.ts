import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryRecurringStorageAdapter,
  RecurringIndexerService,
  transformRawRecurringPayment,
} from "./recurring.service.js";
import { RecurringStatus, RecurringEvent } from "./types.js";
import { createTestEnv } from "../../config/env.js";

const baseRaw = {
  id: "r1",
  proposer: "alice",
  recipient: "bob",
  token: "USD",
  amount: "100",
  memo: "metering",
  interval: "1000",
  next_payment_ledger: "10",
  payment_count: "0",
  is_active: true,
};

test("transformRawRecurringPayment sets ACTIVE + CREATED for new active items", () => {
  const normalized = transformRawRecurringPayment(baseRaw, "C1", 5);

  assert.equal(normalized.status, RecurringStatus.ACTIVE);
  assert.equal(normalized.events[0], RecurringEvent.CREATED);
});

test("transformRawRecurringPayment sets DUE and BECAME_DUE when ledger threshold reached", () => {
  const normalized = transformRawRecurringPayment(
    { ...baseRaw, next_payment_ledger: "5" },
    "C1",
    5,
  );

  assert.equal(normalized.status, RecurringStatus.DUE);
  assert(normalized.events.includes(RecurringEvent.BECAME_DUE));
});

test("transformRawRecurringPayment sets CANCELLED when is_active is false", () => {
  const normalized = transformRawRecurringPayment(
    { ...baseRaw, is_active: false },
    "C1",
    5,
  );

  assert.equal(normalized.status, RecurringStatus.CANCELLED);
  assert(normalized.events.includes(RecurringEvent.CANCELLED));
});

// Tests for computed status fields

test("transformRawRecurringPayment computes overdue status correctly", () => {
  const normalized = transformRawRecurringPayment(
    { ...baseRaw, next_payment_ledger: "3" },
    "C1",
    5, // current ledger is 5, so 3 < 5 means overdue
  );

  assert.equal(normalized.computedStatus, "overdue");
  assert.equal(normalized.ledgersUntilDue, -2); // 3 - 5 = -2
  assert.equal(normalized.missedPayments, 0); // (5-3) / 1000 = 0.002 -> floor = 0
});

// Test with larger interval and more missed payments
test("transformRawRecurringPayment computes missed payments correctly", () => {
  const normalized = transformRawRecurringPayment(
    { ...baseRaw, next_payment_ledger: "1", interval: "2" },
    "C1",
    7, // current ledger is 7, next is 1, interval is 2
  );

  assert.equal(normalized.computedStatus, "overdue");
  assert.equal(normalized.ledgersUntilDue, -6); // 1 - 7 = -6
  assert.equal(normalized.missedPayments, 3); // (7-1) / 2 = 3
});

// Test active status
test("transformRawRecurringPayment computes active status correctly", () => {
  const normalized = transformRawRecurringPayment(
    { ...baseRaw, next_payment_ledger: "10" },
    "C1",
    5, // current ledger is 5, next is 10, so active
  );

  assert.equal(normalized.computedStatus, "active");
  assert.equal(normalized.ledgersUntilDue, 5); // 10 - 5 = 5
  assert.equal(normalized.missedPayments, 0);
});

// Test stopped status
test("transformRawRecurringPayment computes stopped status correctly", () => {
  const normalized = transformRawRecurringPayment(
    { ...baseRaw, is_active: false },
    "C1",
    5,
  );

  assert.equal(normalized.computedStatus, "stopped");
  assert.equal(normalized.ledgersUntilDue, 0);
  assert.equal(normalized.missedPayments, 0);
});

test("transformRawRecurringPayment adds EXECUTED event when payment_count increases", () => {
  const existing = transformRawRecurringPayment(baseRaw, "C1", 1);
  const raw = { ...baseRaw, payment_count: "1", next_payment_ledger: "1" };

  const updated = transformRawRecurringPayment(raw, "C1", 2, existing);
  assert.equal(updated.status, RecurringStatus.DUE);
  assert(updated.events.includes(RecurringEvent.EXECUTED));
});

test("MemoryRecurringStorageAdapter filter by status/proposer/recipient/token/ledger", async () => {
  const adapter = new MemoryRecurringStorageAdapter();

  const item = {
    paymentId: "r1",
    proposer: "alice",
    recipient: "bob",
    token: "USD",
    amount: "100",
    memo: "freq",
    intervalLedgers: 1000,
    nextPaymentLedger: 50,
    paymentCount: 0,
    status: RecurringStatus.DUE,
    events: [RecurringEvent.CREATED],
    metadata: {
      id: "r1",
      contractId: "C1",
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      ledger: 50,
    },
    computedStatus: "active" as const,
    ledgersUntilDue: 0,
    missedPayments: 0,
  };

  await adapter.save(item);
  const all = await adapter.getAll();
  assert.equal(all.length, 1);

  const byStatus = await adapter.getAll({ status: RecurringStatus.DUE });
  assert.equal(byStatus.length, 1);

  const byProposer = await adapter.getAll({ proposer: "alice" });
  assert.equal(byProposer.length, 1);

  const byRecipient = await adapter.getAll({ recipient: "bob" });
  assert.equal(byRecipient.length, 1);

  const byToken = await adapter.getAll({ token: "USD" });
  assert.equal(byToken.length, 1);

  const withMinLedger = await adapter.getAll({ minPaymentLedger: 40 });
  assert.equal(withMinLedger.length, 1);

  const withMaxLedger = await adapter.getAll({ maxPaymentLedger: 60 });
  assert.equal(withMaxLedger.length, 1);
});

// --- syncPayment tests ---

test("syncPayment returns stored payment when found in storage", async () => {
  const storage = new MemoryRecurringStorageAdapter();
  const service = new RecurringIndexerService(createTestEnv(), storage);

  const item = transformRawRecurringPayment(baseRaw, "CDTEST", 1);
  await storage.save(item);

  const result = await service.syncPayment("r1");
  assert.deepEqual(result, item);
});

test("syncPayment throws when payment not in storage (RPC unavailable)", async () => {
  const storage = new MemoryRecurringStorageAdapter();
  const service = new RecurringIndexerService(createTestEnv(), storage);

  await assert.rejects(
    () => service.syncPayment("unknown-id"),
    /syncPayment: RPC client not yet available/,
  );
});

test("getPayments supports combined filters and returns pagination metadata", async () => {
  const storage = new MemoryRecurringStorageAdapter();
  const service = new RecurringIndexerService(createTestEnv(), storage);

  const now = new Date().toISOString();
  await storage.save({
    paymentId: "p-1",
    proposer: "alice",
    recipient: "bob",
    token: "USD",
    amount: "10",
    memo: "m1",
    intervalLedgers: 10,
    nextPaymentLedger: 50,
    paymentCount: 0,
    status: RecurringStatus.DUE,
    events: [RecurringEvent.CREATED],
    metadata: {
      id: "p-1",
      contractId: "C1",
      createdAt: now,
      lastUpdatedAt: now,
      ledger: 50,
    },
    computedStatus: "active",
    ledgersUntilDue: 0,
    missedPayments: 0,
  });
  await storage.save({
    paymentId: "p-2",
    proposer: "alice",
    recipient: "carol",
    token: "USD",
    amount: "15",
    memo: "m2",
    intervalLedgers: 10,
    nextPaymentLedger: 51,
    paymentCount: 0,
    status: RecurringStatus.ACTIVE,
    events: [RecurringEvent.CREATED],
    metadata: {
      id: "p-2",
      contractId: "C1",
      createdAt: now,
      lastUpdatedAt: now,
      ledger: 51,
    },
    computedStatus: "active",
    ledgersUntilDue: 0,
    missedPayments: 0,
  });
  await storage.save({
    paymentId: "p-3",
    proposer: "dan",
    recipient: "bob",
    token: "EUR",
    amount: "20",
    memo: "m3",
    intervalLedgers: 10,
    nextPaymentLedger: 52,
    paymentCount: 0,
    status: RecurringStatus.DUE,
    events: [RecurringEvent.CREATED],
    metadata: {
      id: "p-3",
      contractId: "C2",
      createdAt: now,
      lastUpdatedAt: now,
      ledger: 52,
    },
    computedStatus: "active",
    ledgersUntilDue: 0,
    missedPayments: 0,
  });

  const filtered = await service.getPayments(
    {
      contractId: "C1",
      status: RecurringStatus.DUE,
      proposer: "alice",
      recipient: "bob",
    },
    { offset: 0, limit: 10 },
  );
  assert.equal(filtered.total, 1);
  assert.equal(filtered.offset, 0);
  assert.equal(filtered.limit, 10);
  assert.equal(filtered.items.length, 1);
  assert.equal(filtered.items[0]?.paymentId, "p-1");
});

test("getDuePaymentsAtLedger returns only payments ready for execution", async () => {
  const storage = new MemoryRecurringStorageAdapter();
  const service = new RecurringIndexerService(createTestEnv(), storage);
  const now = new Date().toISOString();

  await storage.save({
    paymentId: "due-now",
    proposer: "alice",
    recipient: "bob",
    token: "USD",
    amount: "10",
    memo: "m1",
    intervalLedgers: 10,
    nextPaymentLedger: 10,
    paymentCount: 1,
    status: RecurringStatus.ACTIVE,
    events: [RecurringEvent.CREATED],
    metadata: {
      id: "due-now",
      contractId: "C1",
      createdAt: now,
      lastUpdatedAt: now,
      ledger: 10,
    },
    computedStatus: "active",
    ledgersUntilDue: 0,
    missedPayments: 0,
  });
  await storage.save({
    paymentId: "due-status",
    proposer: "alice",
    recipient: "bob",
    token: "USD",
    amount: "15",
    memo: "m2",
    intervalLedgers: 10,
    nextPaymentLedger: 11,
    paymentCount: 1,
    status: RecurringStatus.DUE,
    events: [RecurringEvent.CREATED, RecurringEvent.BECAME_DUE],
    metadata: {
      id: "due-status",
      contractId: "C1",
      createdAt: now,
      lastUpdatedAt: now,
      ledger: 11,
    },
    computedStatus: "active",
    ledgersUntilDue: 0,
    missedPayments: 0,
  });
  await storage.save({
    paymentId: "not-due",
    proposer: "alice",
    recipient: "bob",
    token: "USD",
    amount: "20",
    memo: "m3",
    intervalLedgers: 10,
    nextPaymentLedger: 30,
    paymentCount: 1,
    status: RecurringStatus.ACTIVE,
    events: [RecurringEvent.CREATED],
    metadata: {
      id: "not-due",
      contractId: "C1",
      createdAt: now,
      lastUpdatedAt: now,
      ledger: 30,
    },
    computedStatus: "active",
    ledgersUntilDue: 0,
    missedPayments: 0,
  });
  await storage.save({
    paymentId: "cancelled",
    proposer: "alice",
    recipient: "bob",
    token: "USD",
    amount: "25",
    memo: "m4",
    intervalLedgers: 10,
    nextPaymentLedger: 5,
    paymentCount: 1,
    status: RecurringStatus.CANCELLED,
    events: [RecurringEvent.CREATED, RecurringEvent.CANCELLED],
    metadata: {
      id: "cancelled",
      contractId: "C1",
      createdAt: now,
      lastUpdatedAt: now,
      ledger: 5,
    },
    computedStatus: "stopped",
    ledgersUntilDue: 0,
    missedPayments: 0,
  });

  const due = await service.getDuePaymentsAtLedger(12);
  const ids = due.map((payment) => payment.paymentId).sort();
  assert.deepEqual(ids, ["due-now", "due-status"]);
});
