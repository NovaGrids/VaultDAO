/**
 * Issue #2225: dual-keeper fencing tests. Two keepers observing the same due
 * payment must not both publish a trigger; only the lease holder succeeds.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createDuePaymentsScheduledJob } from "./due-payments-job.js";
import { KeeperFence } from "./keeper-fence.js";

const payment = {
  paymentId: "pay-fenced-1",
  recipient: "GRECIPIENT",
  token: "USDC",
  amount: "1000",
  intervalLedgers: 100,
  nextPaymentLedger: 1_000,
  status: "ACTIVE",
};

function makeService() {
  return {
    getStatus: () => ({ lastLedgerProcessed: 1_000 }),
    getDuePaymentsInWindow: async () => [
      { payment, trigger_reason: "exact" as const },
    ],
    getPayment: async () => payment,
  };
}

function makeQueue() {
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    publish: async (event: Record<string, unknown>) => {
      events.push(event);
    },
  };
}

const context = { now: () => new Date() };

test("KeeperFence: only one keeper acquires a lease; tokens are monotonic", () => {
  const fence = new KeeperFence();
  const first = fence.tryAcquire("k", "keeper-a", 1_000, 0);
  const second = fence.tryAcquire("k", "keeper-b", 1_000, 0);

  assert.ok(first);
  assert.equal(second, null);
  assert.equal(fence.validate("k", first.token, 500), true);
  assert.equal(fence.validate("k", first.token, 1_001), false);

  const renewed = fence.tryAcquire("k", "keeper-b", 1_000, 1_001);
  assert.ok(renewed);
  assert.ok(renewed.token > first.token);
  assert.equal(fence.validate("k", first.token, 1_002), false);
  assert.equal(fence.release("k", first.token), false);
  assert.equal(fence.release("k", renewed.token), true);
});

test("dual keeper attempt: only one due-payment trigger is published", async () => {
  const fence = new KeeperFence();
  const queueA = makeQueue();
  const queueB = makeQueue();

  const jobA = createDuePaymentsScheduledJob(
    makeService() as never,
    queueA as never,
    { fence, keeperId: "keeper-a", vaultId: "vault-1" },
  );
  const jobB = createDuePaymentsScheduledJob(
    makeService() as never,
    queueB as never,
    { fence, keeperId: "keeper-b", vaultId: "vault-1" },
  );

  await Promise.all([jobA.run(context), jobB.run(context)]);

  const total = queueA.events.length + queueB.events.length;
  assert.equal(total, 1, "exactly one keeper must publish the trigger");
  const winner = queueA.events.length === 1 ? queueA.events[0] : queueB.events[0];
  assert.equal((winner.payload as { fenceToken: number }).fenceToken, 1);
});

test("fenced keeper cannot publish after losing its lease", async () => {
  const fence = new KeeperFence();
  const key = "vault-1:pay-fenced-1:1000";
  const now = Date.now();
  const lease = fence.tryAcquire(key, "keeper-a", 1_000, now - 5_000)!;
  fence.tryAcquire(key, "keeper-b", 60_000, now); // takes over with a newer token

  const queue = makeQueue();
  const job = createDuePaymentsScheduledJob(
    makeService() as never,
    queue as never,
    { fence, keeperId: "keeper-a", vaultId: "vault-1" },
  );
  // A fresh fence state means job A cannot acquire; nothing is published.
  await job.run(context);
  assert.equal(queue.events.length, 0);
  assert.equal(fence.validate(key, lease.token, now + 1), false);
});
