import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { MetricsRegistry } from "../health/metrics.registry.js";
import {
  QUEUE_DEPTH_METRIC,
  QUEUE_LEASE_TIMEOUTS_METRIC,
  SqliteLeasedJobQueue,
  createJobIdempotencyKey,
} from "./leased-queue.js";

test("durable queue deduplicates enqueue by job type, vault, business id, and period", () => {
  const db = new DatabaseSync(":memory:");
  const metrics = new MetricsRegistry();
  const queue = new SqliteLeasedJobQueue(db, metrics);
  const input = {
    jobType: "recurring-payment" as const,
    vault: "vault-a",
    businessId: "payment-1",
    period: 42,
    payload: { amount: 10 },
  };

  const first = queue.enqueue(input, 1_000);
  const duplicate = queue.enqueue(input, 1_001);
  assert.equal(first.inserted, true);
  assert.equal(duplicate.inserted, false);
  assert.equal(duplicate.id, first.id);
  assert.equal(queue.getDepth().queued, 1);
  assert.match(createJobIdempotencyKey("recurring-payment", "vault-a", "payment-1", 42), /^[a-f0-9]{64}$/);
  assert.equal(metrics.snapshot().values.get(QUEUE_DEPTH_METRIC), 1);
  db.close();
});

test("expired worker lease requeues the job for another worker", () => {
  const db = new DatabaseSync(":memory:");
  const metrics = new MetricsRegistry();
  const queue = new SqliteLeasedJobQueue(db, metrics);
  const { id } = queue.enqueue({
    jobType: "snapshot-rebuild",
    vault: "vault-a",
    businessId: "rebuild-9",
    period: 100,
    payload: { cursor: 100 },
    maxAttempts: 3,
  }, 1_000);

  const crashedWorkerLease = queue.claim("worker-crashed", 100, 1_000);
  assert.equal(crashedWorkerLease?.id, id);
  assert.equal(queue.claim("worker-recovered", 100, 1_050), null);
  const recoveredLease = queue.claim("worker-recovered", 100, 1_101);
  assert.equal(recoveredLease?.id, id);
  assert.equal(recoveredLease?.attempts, 2);
  assert.equal(metrics.snapshot().values.get(QUEUE_LEASE_TIMEOUTS_METRIC), 1);
  assert.equal(queue.complete(id, "worker-recovered", 1_102), true);
  db.close();
});

test("poison jobs move to DLQ and can be inspected and redriven", () => {
  const db = new DatabaseSync(":memory:");
  const queue = new SqliteLeasedJobQueue(db);
  const { id } = queue.enqueue({
    jobType: "webhook-delivery",
    vault: "vault-b",
    businessId: "event-4",
    period: "2026-11-22",
    payload: { event: "payment" },
    maxAttempts: 1,
  }, 1_000);
  const lease = queue.claim("worker-1", 1_000, 1_000)!;

  assert.equal(queue.fail(id, lease.leaseOwner, new Error("permanent failure"), { now: 1_001 }), true);
  const dlq = queue.listDeadLetters();
  assert.equal(dlq.total, 1);
  assert.equal(dlq.items[0]?.lastError, "permanent failure");
  assert.equal(queue.redrive(id, 1_002), true);
  assert.equal(queue.listDeadLetters().total, 0);
  assert.equal(queue.claim("worker-2", 1_000, 1_002)?.id, id);
  db.close();
});
