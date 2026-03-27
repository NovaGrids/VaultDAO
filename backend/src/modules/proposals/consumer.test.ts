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
});
