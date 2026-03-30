import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryRecurringStorageAdapter,
  transformRawRecurringPayment,
} from "./recurring.service.js";
import { RecurringStatus, RecurringEvent } from "./types.js";

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
  const normalized = transformRawRecurringPayment({...baseRaw, next_payment_ledger: "5"}, "C1", 5);

  assert.equal(normalized.status, RecurringStatus.DUE);
  assert(normalized.events.includes(RecurringEvent.BECAME_DUE));
});

test("transformRawRecurringPayment sets CANCELLED when is_active is false", () => {
  const normalized = transformRawRecurringPayment({...baseRaw, is_active: false}, "C1", 5);

  assert.equal(normalized.status, RecurringStatus.CANCELLED);
  assert(normalized.events.includes(RecurringEvent.CANCELLED));
});

test("transformRawRecurringPayment adds EXECUTED event when payment_count increases", () => {
  const existing = transformRawRecurringPayment(baseRaw, "C1", 1);
  const raw = {...baseRaw, payment_count: "1", next_payment_ledger: "1"};

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
  };

  await adapter.save(item);
  const all = await adapter.getAll();
  assert.equal(all.length, 1);

  const byStatus = await adapter.getAll({status: RecurringStatus.DUE});
  assert.equal(byStatus.length, 1);

  const byProposer = await adapter.getAll({proposer: "alice"});
  assert.equal(byProposer.length, 1);

  const byRecipient = await adapter.getAll({recipient: "bob"});
  assert.equal(byRecipient.length, 1);

  const byToken = await adapter.getAll({token: "USD"});
  assert.equal(byToken.length, 1);

  const withMinLedger = await adapter.getAll({minPaymentLedger: 40});
  assert.equal(withMinLedger.length, 1);

  const withMaxLedger = await adapter.getAll({maxPaymentLedger: 60});
  assert.equal(withMaxLedger.length, 1);
});
