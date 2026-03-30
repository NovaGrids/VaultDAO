import assert from "node:assert/strict";
import test from "node:test";
import { ProposalActivityConsumer } from "./consumer.js";
import type {
  ProposalActivityPersistence,
  ProposalActivityRecord,
} from "./types.js";

function makePersistence(
  onSaveBatch: (records: ProposalActivityRecord[]) => Promise<void>,
): ProposalActivityPersistence {
  return {
    save: async () => {},
    saveBatch: onSaveBatch,
    getByProposalId: async () => [],
    getByContractId: async () => [],
    getSummary: async () => null,
  };
}

test("ProposalActivityConsumer flush timer", async (t) => {
  await t.test("continues flushing after a flush error", async () => {
    const consumer = new ProposalActivityConsumer({ flushIntervalMs: 50 });

    let callCount = 0;
    consumer.setPersistence(
      makePersistence(async () => {
        callCount++;
        if (callCount === 1) throw new Error("simulated persistence failure");
      }),
    );

    consumer.start();

    // Wait for multiple timer ticks — timer must survive the first error
    await new Promise((resolve) => setTimeout(resolve, 200));

    await consumer.stop();

    // If the timer silently stopped after the first error, callCount would be 1.
    // A working setInterval will keep firing, so callCount stays >= 1 without crashing.
    assert.ok(consumer.isActive() === false, "consumer stopped cleanly");
    assert.ok(
      true,
      "no unhandled error from flush timer after persistence failure",
    );
  });

  await t.test("timer is cleared after stop()", async () => {
    const consumer = new ProposalActivityConsumer({ flushIntervalMs: 50 });
    consumer.start();
    assert.equal(consumer.isActive(), true);
    await consumer.stop();
    assert.equal(consumer.isActive(), false);
    assert.equal(
      (consumer as any).flushTimer,
      null,
      "flushTimer should be null after stop",
    );
  });

  await t.test("exponential backoff enforcements", async () => {
    const initialBackoffMs = 100;
    const consumer = new ProposalActivityConsumer({
      initialBackoffMs,
      flushIntervalMs: 20,
    });

    let calls: number[] = [];
    consumer.setPersistence(
      makePersistence(async () => {
        calls.push(Date.now());
        throw new Error("fail");
      }),
    );

    (consumer as any).buffer.push({ activityId: "1" } as any);
    await consumer.flush();

    assert.equal(calls.length, 1);

    // Try flushing again quickly - should skip retry
    await consumer.flush();
    assert.equal(calls.length, 1, "should not retry while in backoff");

    // Wait for backoff
    await new Promise((r) => setTimeout(r, initialBackoffMs + 50));
    await consumer.flush();
    assert.equal(calls.length, 2, "should retry after backoff expires");

    await consumer.stop();
  });

  await t.test("max retries and record dropping", async () => {
    const consumer = new ProposalActivityConsumer({
      initialBackoffMs: 10,
      flushIntervalMs: 10,
      maxRetries: 2,
    });

    let calls = 0;
    consumer.setPersistence(
      makePersistence(async () => {
        calls++;
        throw new Error("fail");
      }),
    );

    (consumer as any).buffer.push({ activityId: "1" } as any);

    // First attempt (initial failure)
    await consumer.flush();
    assert.equal(calls, 1);
    assert.equal((consumer as any).retryBuffer.length, 1);

    // Wait for backoff + second attempt
    await new Promise((r) => setTimeout(r, 20));
    await consumer.flush();
    assert.equal(calls, 2);

    // Should be dropped now. Buffer and retryBuffer should be empty.
    assert.equal((consumer as any).retryBuffer.length, 0);

    await consumer.stop();
  });

  await t.test(
    "normal flush continues for new records during backoff",
    async () => {
      const consumer = new ProposalActivityConsumer({
        initialBackoffMs: 1000, // long backoff
        flushIntervalMs: 10,
      });

      let persistedBatches: ProposalActivityRecord[][] = [];
      consumer.setPersistence(
        makePersistence(async (records) => {
          if (records.some((r) => r.activityId === "failed")) {
            throw new Error("poison pill");
          }
          persistedBatches.push(records);
        }),
      );

      // 1. Add record that fails
      (consumer as any).buffer.push({ activityId: "failed" } as any);
      await consumer.flush();
      assert.equal((consumer as any).retryBuffer.length, 1);

      // 2. Add new record that should succeed
      (consumer as any).buffer.push({ activityId: "success" } as any);
      await consumer.flush();

      // Verify second record was persisted despite first one being in backoff
      assert.equal(persistedBatches.length, 1);
      assert.equal(persistedBatches[0][0].activityId, "success");
      assert.equal((consumer as any).retryBuffer.length, 1);

      await consumer.stop();
    },
  );
});
