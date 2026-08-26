import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryRecurringStorageAdapter,
  RecurringIndexerService,
  transformRawRecurringPayment,
} from "./recurring.service.js";
import { RecurringStatus, RecurringEvent } from "./types.js";
import { EventType } from "../events/types.js";
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
  retry_strategy: "1",
  retry_count: "0",
  retry_next_ledger: "0",
};

test("transformRawRecurringPayment sets ACTIVE + CREATED for new active items", () => {
  const { payment: normalized } = transformRawRecurringPayment(baseRaw, "C1", 5);

  assert.equal(normalized.status, RecurringStatus.ACTIVE);
  assert.equal(normalized.events[0], RecurringEvent.CREATED);
});

test("transformRawRecurringPayment sets DUE and BECAME_DUE when ledger threshold reached", () => {
  const { payment: normalized } = transformRawRecurringPayment(
    { ...baseRaw, next_payment_ledger: "5" },
    "C1",
    5,
  );

  assert.equal(normalized.status, RecurringStatus.DUE);
  assert(normalized.events.includes(RecurringEvent.BECAME_DUE));
});

test("transformRawRecurringPayment sets CANCELLED when is_active is false", () => {
  const { payment: normalized } = transformRawRecurringPayment(
    { ...baseRaw, is_active: false },
    "C1",
    5,
  );

  assert.equal(normalized.status, RecurringStatus.CANCELLED);
  assert(normalized.events.includes(RecurringEvent.CANCELLED));
});

// Tests for computed status fields

test("transformRawRecurringPayment computes overdue status correctly", () => {
  const { payment: normalized } = transformRawRecurringPayment(
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
  const { payment: normalized } = transformRawRecurringPayment(
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
  const { payment: normalized } = transformRawRecurringPayment(
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
  const { payment: normalized } = transformRawRecurringPayment(
    { ...baseRaw, is_active: false },
    "C1",
    5,
  );

  assert.equal(normalized.computedStatus, "stopped");
  assert.equal(normalized.ledgersUntilDue, 0);
  assert.equal(normalized.missedPayments, 0);
});

test("transformRawRecurringPayment adds EXECUTED event when payment_count increases", () => {
  const { payment: existing } = transformRawRecurringPayment(baseRaw, "C1", 1);
  const raw = { ...baseRaw, payment_count: "1", next_payment_ledger: "1" };

  const { payment: updated } = transformRawRecurringPayment(raw, "C1", 2, existing);
  assert.equal(updated.status, RecurringStatus.DUE);
  assert(updated.events.includes(RecurringEvent.EXECUTED));
});

// ── Counter split tests ───────────────────────────────────────────────────────

test("new payment starts with retryCount=0 and totalMissedExecutions=0", () => {
  const { payment } = transformRawRecurringPayment(baseRaw, "C1", 1);
  assert.equal(payment.retryCount, 0);
  assert.equal(payment.totalMissedExecutions, 0);
});

test("successful execution resets retryCount to 0 but preserves totalMissedExecutions", () => {
  // Build a payment that has 3 accumulated failures in storage.
  const { payment: withFailures } = transformRawRecurringPayment(baseRaw, "C1", 1);
  const paymentWithHistory = {
    ...withFailures,
    retryCount: 3,
    totalMissedExecutions: 5, // 5 lifetime misses across its history
  };

  // Now simulate a successful execution (payment_count increased).
  const raw = { ...baseRaw, payment_count: "1", next_payment_ledger: "1011" };
  const { payment: afterSuccess, resetEvent } = transformRawRecurringPayment(
    raw,
    "C1",
    2,
    paymentWithHistory,
  );

  // Consecutive counter must be reset to 0.
  assert.equal(afterSuccess.retryCount, 0, "retryCount must reset on success");
  // Lifetime total must be preserved unchanged.
  assert.equal(
    afterSuccess.totalMissedExecutions,
    5,
    "totalMissedExecutions must never reset",
  );
  // Backoff fields must clear.
  assert.equal(afterSuccess.lastAttemptAt, 0);
  assert.equal(afterSuccess.nextRetryAt, 0);

  // Reset event must be emitted because priorRetryCount (3) > 0.
  assert.ok(resetEvent !== null, "resetEvent should be emitted when recovering from a streak");
  assert.equal(resetEvent!.type, EventType.CONSECUTIVE_MISS_RESET);
  assert.equal(resetEvent!.data.paymentId, "r1");
  assert.equal(resetEvent!.data.contractId, "C1");
  assert.equal(resetEvent!.data.clearedConsecutiveMisses, 3);
  assert.equal(resetEvent!.data.totalMissedExecutions, 5);
});

test("successful execution with zero prior retryCount emits no reset event", () => {
  // Payment that has never failed — retryCount is already 0.
  const { payment: clean } = transformRawRecurringPayment(baseRaw, "C1", 1);
  assert.equal(clean.retryCount, 0);

  const raw = { ...baseRaw, payment_count: "1", next_payment_ledger: "1011" };
  const { resetEvent } = transformRawRecurringPayment(raw, "C1", 2, clean);

  // No streak to clear — should NOT spam a reset event.
  assert.equal(resetEvent, null, "no reset event when retryCount was already 0");
});

test("totalMissedExecutions accumulates across multiple failures without reset on success", async () => {
  const storage = new MemoryRecurringStorageAdapter();
  const service = new RecurringIndexerService(createTestEnv(), storage);

  // Seed a payment.
  const { payment: initial } = transformRawRecurringPayment(baseRaw, "C1", 1);
  await storage.save(initial);

  // Record 3 failures — totalMissedExecutions should reach 3.
  await service.recordPaymentFailure("r1");
  await service.recordPaymentFailure("r1");
  await service.recordPaymentFailure("r1");

  const afterThreeFailures = await storage.getById("r1");
  assert.equal(afterThreeFailures!.retryCount, 3, "consecutive counter increments");
  assert.equal(afterThreeFailures!.totalMissedExecutions, 3, "lifetime total increments");

  // Simulate a successful execution: rebuild with higher payment_count.
  const succeededRaw = { ...baseRaw, payment_count: "1", next_payment_ledger: "1011" };
  const { payment: afterSuccess } = transformRawRecurringPayment(
    succeededRaw,
    "C1",
    2,
    afterThreeFailures!,
  );
  await storage.save(afterSuccess);

  // Now record 2 more failures.
  await service.recordPaymentFailure("r1");
  await service.recordPaymentFailure("r1");

  const afterMoreFailures = await storage.getById("r1");
  // Consecutive counter restarts from 0 → 2.
  assert.equal(afterMoreFailures!.retryCount, 2, "consecutive counter reset and re-increments");
  // Lifetime total: 3 + 2 = 5 — never reset.
  assert.equal(afterMoreFailures!.totalMissedExecutions, 5, "lifetime total accumulates across success");
});

// ── Storage adapter tests ─────────────────────────────────────────────────────

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
    retryStrategy: "EXPONENTIAL" as const,
    retryNextLedger: 0,
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
    retryCount: 0,
    lastAttemptAt: 0,
    nextRetryAt: 0,
    totalMissedExecutions: 0,
    jitterWindow: 0,
    jitterOffset: 0,
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

  const { payment: item } = transformRawRecurringPayment(baseRaw, "CDTEST", 1);
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
    retryStrategy: "EXPONENTIAL" as const,
    retryNextLedger: 0,
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
    retryCount: 0,
    lastAttemptAt: 0,
    nextRetryAt: 0,
    totalMissedExecutions: 0,
    jitterWindow: 0,
    jitterOffset: 0,
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
    retryStrategy: "EXPONENTIAL" as const,
    retryNextLedger: 0,
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
    retryCount: 0,
    lastAttemptAt: 0,
    nextRetryAt: 0,
    totalMissedExecutions: 0,
    jitterWindow: 0,
    jitterOffset: 0,
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
    retryStrategy: "EXPONENTIAL" as const,
    retryNextLedger: 0,
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
    retryCount: 0,
    lastAttemptAt: 0,
    nextRetryAt: 0,
    totalMissedExecutions: 0,
    jitterWindow: 0,
    jitterOffset: 0,
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
    retryStrategy: "EXPONENTIAL" as const,
    retryNextLedger: 0,
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
    retryCount: 0,
    lastAttemptAt: 0,
    nextRetryAt: 0,
    totalMissedExecutions: 0,
    jitterWindow: 0,
    jitterOffset: 0,
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
    retryStrategy: "EXPONENTIAL" as const,
    retryNextLedger: 0,
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
    retryCount: 0,
    lastAttemptAt: 0,
    nextRetryAt: 0,
    totalMissedExecutions: 0,
    jitterWindow: 0,
    jitterOffset: 0,
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
    retryStrategy: "EXPONENTIAL" as const,
    retryNextLedger: 0,
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
    retryCount: 0,
    lastAttemptAt: 0,
    nextRetryAt: 0,
    totalMissedExecutions: 0,
    jitterWindow: 0,
    jitterOffset: 0,
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
    retryStrategy: "EXPONENTIAL" as const,
    retryNextLedger: 0,
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
    retryCount: 0,
    lastAttemptAt: 0,
    nextRetryAt: 0,
    totalMissedExecutions: 0,
    jitterWindow: 0,
    jitterOffset: 0,
  });

  const due = await service.getDuePaymentsAtLedger(12);
  const ids = due.map((payment) => payment.paymentId).sort();
  assert.deepEqual(ids, ["due-now", "due-status"]);
});

test("getDuePaymentsAtLedger ignores payments waiting for retry backoff", async () => {
  const storage = new MemoryRecurringStorageAdapter();
  const service = new RecurringIndexerService(createTestEnv(), storage);
  const now = new Date().toISOString();

  await storage.save({
    paymentId: "retry-wait",
    proposer: "alice",
    recipient: "bob",
    token: "USD",
    amount: "10",
    memo: "m1",
    intervalLedgers: 10,
    nextPaymentLedger: 10,
    retryStrategy: "EXPONENTIAL",
    retryCount: 1,
    retryNextLedger: 20,
    paymentCount: 1,
    status: RecurringStatus.ACTIVE,
    events: [RecurringEvent.CREATED],
    metadata: {
      id: "retry-wait",
      contractId: "C1",
      createdAt: now,
      lastUpdatedAt: now,
      ledger: 10,
    },
    computedStatus: "active",
    ledgersUntilDue: 0,
    missedPayments: 0,
    lastAttemptAt: 0,
    nextRetryAt: 0,
    totalMissedExecutions: 0,
    jitterWindow: 0,
    jitterOffset: 0,
  });

  const dueBeforeRetry = await service.getDuePaymentsAtLedger(15);
  assert.equal(dueBeforeRetry.length, 0);

  const dueAtRetry = await service.getDuePaymentsAtLedger(20);
  assert.equal(dueAtRetry.length, 1);
  assert.equal(dueAtRetry[0]?.paymentId, "retry-wait");
});

// ============================================================================
// Issue #1364: Recurring Payment Jitter — Backend Service Tests
//
// The on-chain jitter source is Soroban's sha256 — deterministic, not random.
// The backend service reflects the contract's fields directly; there is no
// separate RNG to inject.  Instead we use known raw values to assert exact
// outputs from transformRawRecurringPayment.
// ============================================================================

// ── Jitter T1: jitter disabled (window == 0) — transform output is unchanged ──

test("jitter disabled: transformRawRecurringPayment sets jitterWindow=0 and jitterOffset=0", () => {
  const raw = { ...baseRaw, jitter_window: "0", jitter_offset: "0" };
  const { payment: normalized } = transformRawRecurringPayment(raw, "C1", 5);

  assert.equal(normalized.jitterWindow, 0, "jitterWindow must be 0 when disabled");
  assert.equal(normalized.jitterOffset, 0, "jitterOffset must be 0 when disabled");
});

test("jitter disabled: omitted jitter fields default to 0 (backward compat)", () => {
  // Legacy raw payments (before jitter support) have no jitter_window/jitter_offset
  const { payment: normalized } = transformRawRecurringPayment(baseRaw, "C1", 5);

  assert.equal(normalized.jitterWindow, 0, "missing jitter_window defaults to 0");
  assert.equal(normalized.jitterOffset, 0, "missing jitter_offset defaults to 0");
});

// ── Jitter T2: jitter enabled — exact known offset is propagated correctly ───

test("jitter enabled: transformRawRecurringPayment propagates exact jitterWindow and jitterOffset", () => {
  const raw = {
    ...baseRaw,
    jitter_window: "100",   // window set to 100 ledgers
    jitter_offset: "42",    // deterministic offset from sha256 — 42 < 100 ✓
  };
  const { payment: normalized } = transformRawRecurringPayment(raw, "C1", 5);

  assert.equal(normalized.jitterWindow, 100, "jitterWindow must match raw value");
  assert.equal(normalized.jitterOffset, 42, "jitterOffset must match raw value exactly");
});

test("jitter enabled: existing payment preserves jitterOffset across re-transforms", () => {
  const raw = { ...baseRaw, jitter_window: "50", jitter_offset: "17" };
  const { payment: first } = transformRawRecurringPayment(raw, "C1", 3);

  // Re-transform (simulates a sync cycle receiving updated data)
  const updated_raw = { ...raw, next_payment_ledger: "20", payment_count: "1" };
  const { payment: second } = transformRawRecurringPayment(updated_raw, "C1", 5, first);

  assert.equal(second.jitterWindow, 50, "jitterWindow must be stable across re-transforms");
  assert.equal(second.jitterOffset, 17, "jitterOffset must be stable across re-transforms");
});

// ── Jitter T3: statistical range check ───────────────────────────────────────

test("jitter enabled: offset is always within [0, jitterWindow) — range check", () => {
  // Simulate N distinct raw payments with varying offsets; all must be valid
  const window = 200;
  const testCases = [
    { id: "r-0",  jitter_offset: "0"   },
    { id: "r-1",  jitter_offset: "1"   },
    { id: "r-99", jitter_offset: "99"  },
    { id: "r-199",jitter_offset: "199" },
  ];

  for (const tc of testCases) {
    const raw = { ...baseRaw, id: tc.id, jitter_window: String(window), jitter_offset: tc.jitter_offset };
    const { payment: normalized } = transformRawRecurringPayment(raw, "C1", 5);

    assert.ok(
      normalized.jitterOffset >= 0 && normalized.jitterOffset < window,
      `paymentId=${tc.id}: jitterOffset ${normalized.jitterOffset} must be in [0, ${window})`,
    );
  }
});

// ── Jitter T4: JITTERED event appended when payment_count > 1 and window > 0 ─

test("jitter enabled: JITTERED event added when payment_count > 1 and jitter_window > 0", () => {
  const firstRaw = { ...baseRaw, jitter_window: "100", jitter_offset: "30" };
  const { payment: existing } = transformRawRecurringPayment(firstRaw, "C1", 5);

  // Simulate second execution: payment_count increases from 0 to 2
  const updatedRaw = { ...firstRaw, payment_count: "2", next_payment_ledger: "2030" };
  const { payment: updated } = transformRawRecurringPayment(updatedRaw, "C1", 10, existing);

  assert.ok(
    updated.events.includes(RecurringEvent.EXECUTED),
    "EXECUTED event must be present",
  );
  assert.ok(
    updated.events.includes(RecurringEvent.JITTERED),
    "JITTERED event must be present after second cycle with jitter enabled",
  );
});

test("jitter enabled: JITTERED event NOT added when jitter_window == 0", () => {
  const firstRaw = { ...baseRaw, jitter_window: "0", jitter_offset: "0" };
  const { payment: existing } = transformRawRecurringPayment(firstRaw, "C1", 5);

  const updatedRaw = { ...firstRaw, payment_count: "2", next_payment_ledger: "2000" };
  const { payment: updated } = transformRawRecurringPayment(updatedRaw, "C1", 10, existing);

  assert.ok(
    updated.events.includes(RecurringEvent.EXECUTED),
    "EXECUTED event must be present",
  );
  assert.ok(
    !updated.events.includes(RecurringEvent.JITTERED),
    "JITTERED event must NOT be present when jitter_window == 0",
  );
});

test("jitter enabled: JITTERED event NOT added on first cycle (payment_count == 1)", () => {
  // First execution: payment_count goes from 0 to 1 — jitter not applied to first cycle
  const firstRaw = { ...baseRaw, jitter_window: "100", jitter_offset: "30" };
  const { payment: existing } = transformRawRecurringPayment(firstRaw, "C1", 5);

  const updatedRaw = { ...firstRaw, payment_count: "1", next_payment_ledger: "1030" };
  const { payment: updated } = transformRawRecurringPayment(updatedRaw, "C1", 10, existing);

  assert.ok(
    !updated.events.includes(RecurringEvent.JITTERED),
    "JITTERED event must NOT be present on the first cycle (payment_count == 1)",
  );
});

// ── Jitter T5: edge case — jitter_window = 0 is identical to no jitter ───────

test("jitter edge case: jitter_window=0 and jitter_window absent produce identical output", () => {
  const withExplicitZero = { ...baseRaw, jitter_window: "0", jitter_offset: "0" };
  const withoutFields = { ...baseRaw };

  const { payment: n1 } = transformRawRecurringPayment(withExplicitZero, "C1", 5);
  const { payment: n2 } = transformRawRecurringPayment(withoutFields, "C1", 5);

  assert.equal(n1.jitterWindow, n2.jitterWindow, "jitterWindow must be 0 in both cases");
  assert.equal(n1.jitterOffset, n2.jitterOffset, "jitterOffset must be 0 in both cases");
  assert.equal(n1.nextPaymentLedger, n2.nextPaymentLedger, "nextPaymentLedger must be identical");
  assert.equal(n1.status, n2.status, "status must be identical");
});

// ── Jitter T6: CONTRACT_RECURRING_EVENT_MAP is correctly wired ───────────────

test("CONTRACT_RECURRING_EVENT_MAP maps recurring_payment_executed and recurring_pay_jittered", async () => {
  const { CONTRACT_RECURRING_EVENT_MAP, RecurringEvent: RE } = await import("./types.js");

  assert.equal(
    CONTRACT_RECURRING_EVENT_MAP["recurring_payment_executed"],
    RE.EXECUTED,
    "recurring_payment_executed must map to EXECUTED",
  );
  assert.equal(
    CONTRACT_RECURRING_EVENT_MAP["recurring_pay_jittered"],
    RE.JITTERED,
    "recurring_pay_jittered must map to JITTERED",
  );
});
