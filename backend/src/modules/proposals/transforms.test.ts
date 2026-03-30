import assert from "node:assert/strict";
import test from "node:test";
import { ProposalEventTransformer, transformEventBatch } from "./transforms.js";
import type { NormalizedEvent } from "../events/types.js";
import { EventType } from "../events/types.js";
import { ProposalActivityType } from "./types.js";

/**
 * Test fixture builders for creating normalized events
 */
function createNormalizedEvent(
  type: EventType,
  data: Record<string, any> = {},
  overrides: Partial<NormalizedEvent> = {}
): NormalizedEvent {
  return {
    type,
    data: {
      proposalId: "proposal-123",
      ...data,
    },
    metadata: {
      id: `event-${Math.random()}`,
      contractId: "CDTEST",
      ledger: 1000,
      ledgerClosedAt: "2026-01-01T00:00:00Z",
      ...overrides.metadata,
    },
    ...overrides,
  };
}

function createProposalCreatedEvent(): NormalizedEvent {
  return createNormalizedEvent(EventType.PROPOSAL_CREATED, {
    proposer: "GPROPOSER",
    recipient: "GRECIPIENT",
    token: "CTOKEN",
    amount: "1000",
    insuranceAmount: "100",
    description: "Test proposal",
  });
}

function createProposalApprovedEvent(): NormalizedEvent {
  return createNormalizedEvent(EventType.PROPOSAL_APPROVED, {
    voter: "GVOTER",
    votesFor: "100",
    votesAgainst: "10",
    votesAbstain: "5",
  });
}

function createProposalAbstainedEvent(): NormalizedEvent {
  return createNormalizedEvent(EventType.PROPOSAL_ABSTAINED, {
    voter: "GVOTER",
    votesAbstain: "50",
  });
}

function createProposalReadyEvent(): NormalizedEvent {
  return createNormalizedEvent(EventType.PROPOSAL_READY, {
    finalVotesFor: "100",
    finalVotesAgainst: "10",
    finalVotesAbstain: "5",
    quorumMet: true,
  });
}

function createProposalExecutedEvent(): NormalizedEvent {
  return createNormalizedEvent(EventType.PROPOSAL_EXECUTED, {
    executor: "GEXECUTOR",
    recipient: "GRECIPIENT",
    token: "CTOKEN",
    amount: "1000",
    ledger: 1050,
  });
}

function createProposalExpiredEvent(): NormalizedEvent {
  return createNormalizedEvent(EventType.PROPOSAL_EXPIRED, {
    finalVotesFor: "50",
    finalVotesAgainst: "40",
    finalVotesAbstain: "10",
  });
}

function createProposalCancelledEvent(): NormalizedEvent {
  return createNormalizedEvent(EventType.PROPOSAL_CANCELLED, {
    cancelledBy: "GADMIN",
    reason: "Duplicate proposal",
  });
}

function createProposalRejectedEvent(): NormalizedEvent {
  return createNormalizedEvent(EventType.PROPOSAL_REJECTED, {
    finalVotesFor: "30",
    finalVotesAgainst: "70",
    finalVotesAbstain: "0",
    rejectionReason: "Insufficient votes",
  });
}

function createNonProposalEvent(): NormalizedEvent {
  return createNormalizedEvent(EventType.SNAPSHOT_CREATED, {
    snapshotId: "snapshot-123",
  });
}

test("ProposalEventTransformer", async (t) => {
  await t.test("returns null for non-proposal events", () => {
    const event = createNonProposalEvent();
    const result = ProposalEventTransformer.transform(event);
    assert.equal(result, null);
  });

  await t.test("returns null for unknown event types", () => {
    const event = createNormalizedEvent(EventType.UNKNOWN);
    const result = ProposalEventTransformer.transform(event);
    assert.equal(result, null);
  });

  await t.test("transforms PROPOSAL_CREATED event", () => {
    const event = createProposalCreatedEvent();
    const result = ProposalEventTransformer.transform(event);

    assert.ok(result !== null);
    assert.equal(result.type, ProposalActivityType.CREATED);
    assert.equal(result.proposalId, "proposal-123");
    assert.ok(result.activityId);
    assert.ok(result.metadata);
    assert.equal(result.data.activityType, ProposalActivityType.CREATED);
    assert.equal(result.data.proposer, "GPROPOSER");
    assert.equal(result.data.recipient, "GRECIPIENT");
  });

  await t.test("transforms PROPOSAL_APPROVED event", () => {
    const event = createProposalApprovedEvent();
    const result = ProposalEventTransformer.transform(event);

    assert.ok(result !== null);
    assert.equal(result.type, ProposalActivityType.APPROVED);
    assert.equal(result.data.activityType, ProposalActivityType.APPROVED);
    assert.equal(result.data.voter, "GVOTER");
    assert.equal(result.data.votesFor, "100");
  });

  await t.test("transforms PROPOSAL_ABSTAINED event", () => {
    const event = createProposalAbstainedEvent();
    const result = ProposalEventTransformer.transform(event);

    assert.ok(result !== null);
    assert.equal(result.type, ProposalActivityType.ABSTAINED);
    assert.equal(result.data.activityType, ProposalActivityType.ABSTAINED);
    assert.equal(result.data.voter, "GVOTER");
  });

  await t.test("transforms PROPOSAL_READY event", () => {
    const event = createProposalReadyEvent();
    const result = ProposalEventTransformer.transform(event);

    assert.ok(result !== null);
    assert.equal(result.type, ProposalActivityType.READY);
    assert.equal(result.data.activityType, ProposalActivityType.READY);
    assert.equal(result.data.quorumMet, true);
  });

  await t.test("transforms PROPOSAL_EXECUTED event", () => {
    const event = createProposalExecutedEvent();
    const result = ProposalEventTransformer.transform(event);

    assert.ok(result !== null);
    assert.equal(result.type, ProposalActivityType.EXECUTED);
    assert.equal(result.data.activityType, ProposalActivityType.EXECUTED);
    assert.equal(result.data.executor, "GEXECUTOR");
    assert.equal(result.data.amount, "1000");
  });

  await t.test("transforms PROPOSAL_EXPIRED event", () => {
    const event = createProposalExpiredEvent();
    const result = ProposalEventTransformer.transform(event);

    assert.ok(result !== null);
    assert.equal(result.type, ProposalActivityType.EXPIRED);
    assert.equal(result.data.activityType, ProposalActivityType.EXPIRED);
  });

  await t.test("transforms PROPOSAL_CANCELLED event", () => {
    const event = createProposalCancelledEvent();
    const result = ProposalEventTransformer.transform(event);

    assert.ok(result !== null);
    assert.equal(result.type, ProposalActivityType.CANCELLED);
    assert.equal(result.data.activityType, ProposalActivityType.CANCELLED);
    assert.equal(result.data.cancelledBy, "GADMIN");
  });

  await t.test("transforms PROPOSAL_REJECTED event", () => {
    const event = createProposalRejectedEvent();
    const result = ProposalEventTransformer.transform(event);

    assert.ok(result !== null);
    assert.equal(result.type, ProposalActivityType.REJECTED);
    assert.equal(result.data.activityType, ProposalActivityType.REJECTED);
    assert.equal(result.data.finalVotesAgainst, "70");
  });

  await t.test("record includes valid activityId", () => {
    const event = createProposalCreatedEvent();
    const result = ProposalEventTransformer.transform(event);

    assert.ok(result !== null);
    assert.ok(result.activityId);
    assert.ok(typeof result.activityId === "string");
    assert.ok(result.activityId.length > 0);
  });

  await t.test("record includes proposalId", () => {
    const event = createProposalCreatedEvent();
    const result = ProposalEventTransformer.transform(event);

    assert.ok(result !== null);
    assert.equal(result.proposalId, "proposal-123");
  });

  await t.test("record includes correct activity type", () => {
    const event = createProposalCreatedEvent();
    const result = ProposalEventTransformer.transform(event);

    assert.ok(result !== null);
    assert.equal(result.type, ProposalActivityType.CREATED);
    assert.equal(result.data.activityType, ProposalActivityType.CREATED);
  });

  await t.test("record includes metadata", () => {
    const event = createProposalCreatedEvent();
    const result = ProposalEventTransformer.transform(event);

    assert.ok(result !== null);
    assert.ok(result.metadata);
    assert.ok(result.metadata.id);
    assert.equal(result.metadata.contractId, "CDTEST");
    assert.equal(result.metadata.ledger, 1000);
    assert.ok(result.metadata.ledgerClosedAt);
  });

  await t.test("record data matches event data", () => {
    const event = createProposalCreatedEvent();
    const result = ProposalEventTransformer.transform(event);

    assert.ok(result !== null);
    assert.equal(result.data.proposer, event.data.proposer);
    assert.equal(result.data.recipient, event.data.recipient);
    assert.equal(result.data.token, event.data.token);
    assert.equal(result.data.amount, event.data.amount);
  });
});

test("transformEventBatch", async (t) => {
  await t.test("filters out null results for non-proposal events", () => {
    const events = [
      createProposalCreatedEvent(),
      createNonProposalEvent(),
      createProposalApprovedEvent(),
      createNonProposalEvent(),
    ];

    const results = transformEventBatch(events);

    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r !== null));
  });

  await t.test("returns empty array for batch with only non-proposal events", () => {
    const events = [
      createNonProposalEvent(),
      createNonProposalEvent(),
      createNormalizedEvent(EventType.UNKNOWN),
    ];

    const results = transformEventBatch(events);

    assert.equal(results.length, 0);
  });

  await t.test("returns all events for batch with only proposal events", () => {
    const events = [
      createProposalCreatedEvent(),
      createProposalApprovedEvent(),
      createProposalReadyEvent(),
    ];

    const results = transformEventBatch(events);

    assert.equal(results.length, 3);
  });

  await t.test("preserves order of records", () => {
    const events = [
      createProposalCreatedEvent(),
      createNonProposalEvent(),
      createProposalApprovedEvent(),
      createNonProposalEvent(),
      createProposalReadyEvent(),
    ];

    const results = transformEventBatch(events);

    assert.equal(results.length, 3);
    assert.equal(results[0].type, ProposalActivityType.CREATED);
    assert.equal(results[1].type, ProposalActivityType.APPROVED);
    assert.equal(results[2].type, ProposalActivityType.READY);
  });

  await t.test("returned array length equals proposal event count", () => {
    for (let i = 0; i < 10; i++) {
      const proposalCount = Math.floor(Math.random() * 10);
      const nonProposalCount = Math.floor(Math.random() * 10);

      const proposalEvents = Array.from({ length: proposalCount }, () =>
        createProposalCreatedEvent()
      );
      const nonProposalEvents = Array.from({ length: nonProposalCount }, () =>
        createNonProposalEvent()
      );

      const events = [...proposalEvents, ...nonProposalEvents].sort(
        () => Math.random() - 0.5
      );
      const results = transformEventBatch(events);

      assert.equal(results.length, proposalCount);
    }
  });
});

// Property-based tests
test("ProposalEventTransformer Properties", async (t) => {
  await t.test("Property 1: Null Return for Non-Proposal Events", () => {
    const nonProposalTypes = [
      EventType.SNAPSHOT_CREATED,
      EventType.UNKNOWN,
      EventType.INITIALIZED,
      EventType.ROLE_ASSIGNED,
      EventType.STREAM_CREATED,
    ];

    for (const eventType of nonProposalTypes) {
      const event = createNormalizedEvent(eventType);
      const result = ProposalEventTransformer.transform(event);
      assert.equal(result, null, `${eventType} should return null`);
    }
  });

  await t.test("Property 2: Valid Transformation for Each Proposal Type", () => {
    const testCases = [
      { event: createProposalCreatedEvent(), expectedType: ProposalActivityType.CREATED },
      { event: createProposalApprovedEvent(), expectedType: ProposalActivityType.APPROVED },
      { event: createProposalAbstainedEvent(), expectedType: ProposalActivityType.ABSTAINED },
      { event: createProposalReadyEvent(), expectedType: ProposalActivityType.READY },
      { event: createProposalExecutedEvent(), expectedType: ProposalActivityType.EXECUTED },
      { event: createProposalExpiredEvent(), expectedType: ProposalActivityType.EXPIRED },
      { event: createProposalCancelledEvent(), expectedType: ProposalActivityType.CANCELLED },
      { event: createProposalRejectedEvent(), expectedType: ProposalActivityType.REJECTED },
    ];

    for (const { event, expectedType } of testCases) {
      const result = ProposalEventTransformer.transform(event);
      assert.ok(result !== null, `${expectedType} should not be null`);
      assert.equal(result.type, expectedType);
    }
  });

  await t.test("Property 3: Batch Filtering Removes Nulls", () => {
    for (let iteration = 0; iteration < 10; iteration++) {
      const proposalCount = Math.floor(Math.random() * 20) + 1;
      const nonProposalCount = Math.floor(Math.random() * 20) + 1;

      const proposalEvents = Array.from({ length: proposalCount }, () =>
        createProposalCreatedEvent()
      );
      const nonProposalEvents = Array.from({ length: nonProposalCount }, () =>
        createNonProposalEvent()
      );

      const events = [...proposalEvents, ...nonProposalEvents].sort(
        () => Math.random() - 0.5
      );
      const results = transformEventBatch(events);

      // All results should be non-null
      assert.ok(results.every((r) => r !== null));
      // Result count should equal proposal count
      assert.equal(results.length, proposalCount);
    }
  });

  await t.test("Property 4: Data Integrity Preserved", () => {
    const testCases = [
      createProposalCreatedEvent(),
      createProposalApprovedEvent(),
      createProposalReadyEvent(),
      createProposalExecutedEvent(),
    ];

    for (const event of testCases) {
      const result = ProposalEventTransformer.transform(event);
      assert.ok(result !== null);

      // Verify all required fields are present
      assert.ok(result.activityId);
      assert.ok(result.proposalId);
      assert.ok(result.type);
      assert.ok(result.metadata);
      assert.ok(result.data);

      // Verify metadata matches event
      assert.equal(result.metadata.contractId, event.metadata.contractId);
      assert.equal(result.metadata.ledger, event.metadata.ledger);
      assert.equal(result.metadata.ledgerClosedAt, event.metadata.ledgerClosedAt);
    }
  });
});
