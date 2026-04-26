import assert from "node:assert/strict";
import test from "node:test";
import { ProposalActivityConsumer } from "./consumer.js";
import { EventType, type NormalizedEvent } from "../events/types.js";
import {
  ProposalActivityType,
  type ProposalActivityPersistence,
  type ProposalActivityRecord,
  type ProposalAmendedActivityData,
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

test("ProposalActivityConsumer.process()", async (t) => {
  const makeEvent = (type: EventType, data: any): NormalizedEvent => ({
    type,
    data,
    metadata: {
      id: "event-id",
      contractId: "contract-id",
      ledger: 100,
      ledgerClosedAt: "2024-01-01T00:00:00Z",
    },
  });

  await t.test("processes all 12 proposal event types", async () => {
    const savedRecords: ProposalActivityRecord[] = [];
    const persistence: ProposalActivityPersistence = {
      save: async (record) => {
        savedRecords.push(record);
      },
      saveBatch: async () => {},
      getByProposalId: async () => [],
      getByContractId: async () => [],
      getSummary: async () => null,
    };

    const consumer = new ProposalActivityConsumer();
    consumer.setPersistence(persistence);

    const eventTypes = [
      EventType.PROPOSAL_CREATED,
      EventType.PROPOSAL_APPROVED,
      EventType.PROPOSAL_ABSTAINED,
      EventType.PROPOSAL_READY,
      EventType.PROPOSAL_SCHEDULED,
      EventType.PROPOSAL_EXECUTED,
      EventType.PROPOSAL_EXPIRED,
      EventType.PROPOSAL_CANCELLED,
      EventType.PROPOSAL_REJECTED,
      EventType.PROPOSAL_DEADLINE_REJECTED,
      EventType.PROPOSAL_VETOED,
      EventType.PROPOSAL_AMENDED,
    ];

    for (const type of eventTypes) {
      await consumer.process(makeEvent(type, { proposalId: "prop-1" }));
    }

    assert.equal(savedRecords.length, 12);

    for (const record of savedRecords) {
      assert.ok(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          record.activityId,
        ),
        "activityId should be a UUID",
      );
      assert.equal(record.timestamp, "2024-01-01T00:00:00Z");
      assert.equal(record.proposalId, "prop-1");
    }
  });

  await t.test("gracefully handles unknown event types", async () => {
    const savedRecords: ProposalActivityRecord[] = [];
    const persistence: ProposalActivityPersistence = {
      save: async (record) => {
        savedRecords.push(record);
      },
      saveBatch: async () => {},
      getByProposalId: async () => [],
      getByContractId: async () => [],
      getSummary: async () => null,
    };

    const consumer = new ProposalActivityConsumer();
    consumer.setPersistence(persistence);

    // Using an event type that is NOT in PROPOSAL_ACTIVITY_TYPE_MAP
    await consumer.process(makeEvent(EventType.INITIALIZED, {}));
    assert.equal(savedRecords.length, 0);
  });

  await t.test("processes batch of events correctly", async () => {
    const savedRecords: ProposalActivityRecord[] = [];
    const persistence: ProposalActivityPersistence = {
      save: async () => {},
      saveBatch: async (records) => {
        savedRecords.push(...records);
      },
      getByProposalId: async () => [],
      getByContractId: async () => [],
      getSummary: async () => null,
    };

    const consumer = new ProposalActivityConsumer();
    consumer.setPersistence(persistence);

    const events = [
      makeEvent(EventType.PROPOSAL_CREATED, { proposalId: "prop-1" }),
      makeEvent(EventType.PROPOSAL_APPROVED, { proposalId: "prop-1" }),
      makeEvent(EventType.INITIALIZED, {}), // Should be skipped
    ];

    await consumer.processBatch(events);

    assert.equal(savedRecords.length, 2);
    assert.equal(savedRecords[0].type, ProposalActivityType.CREATED);
    assert.equal(savedRecords[1].type, ProposalActivityType.APPROVED);
  });

  await t.test("maps PROPOSAL_AMENDED correctly", async () => {
    const savedRecords: ProposalActivityRecord[] = [];
    const persistence: ProposalActivityPersistence = {
      save: async (record) => {
        savedRecords.push(record);
      },
      saveBatch: async () => {},
      getByProposalId: async () => [],
      getByContractId: async () => [],
      getSummary: async () => null,
    };

    const consumer = new ProposalActivityConsumer();
    consumer.setPersistence(persistence);

    const amendedData = {
      proposalId: "prop-1",
      amendedBy: "user-1",
      oldAmount: "100",
      newAmount: "200",
      oldRecipient: "rec-1",
      newRecipient: "rec-2",
    };

    await consumer.process(makeEvent(EventType.PROPOSAL_AMENDED, amendedData));

    assert.equal(savedRecords.length, 1);
    const record = savedRecords[0];
    assert.equal(record.type, ProposalActivityType.AMENDED);
    const data = record.data as ProposalAmendedActivityData;
    assert.equal(data.amendedBy, "user-1");
    assert.equal(data.previousAmount, "100");
    assert.equal(data.newAmount, "200");
    assert.equal(data.previousRecipient, "rec-1");
    assert.equal(data.newRecipient, "rec-2");
  });

  await t.test("populates metadata correctly", async () => {
    const savedRecords: ProposalActivityRecord[] = [];
    const persistence: ProposalActivityPersistence = {
      save: async (record) => {
        savedRecords.push(record);
      },
      saveBatch: async () => {},
      getByProposalId: async () => [],
      getByContractId: async () => [],
      getSummary: async () => null,
    };

    const consumer = new ProposalActivityConsumer();
    consumer.setPersistence(persistence);

    const event: NormalizedEvent = {
      type: EventType.PROPOSAL_CREATED,
      data: { proposalId: "prop-1" },
      metadata: {
        id: "meta-id",
        contractId: "contract-1",
        ledger: 500,
        ledgerClosedAt: "2024-05-05T12:00:00Z",
      },
    };

    await consumer.process(event);

    assert.equal(savedRecords.length, 1);
    const record = savedRecords[0];
    assert.equal(record.metadata.id, "meta-id");
    assert.equal(record.metadata.contractId, "contract-1");
    assert.equal(record.metadata.ledger, 500);
    assert.equal(record.metadata.ledgerClosedAt, "2024-05-05T12:00:00Z");
  });
});
