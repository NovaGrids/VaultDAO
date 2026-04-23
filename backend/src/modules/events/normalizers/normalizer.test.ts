import assert from "node:assert/strict";
import { test, describe } from "node:test";

import type { ContractEvent } from "../events.types.js";
import { EventNormalizer } from "./index.js";
import { EventType } from "../types.js";

describe("EventNormalizer", () => {
  const mockMetadata = {
    contractId: "CD123",
    id: "evt-001",
    ledger: 100,
    ledgerClosedAt: "2026-03-25T14:00:00Z",
  };

  test("should normalize proposal_created event", () => {
    const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["proposal_created", "42"],
        value: ["proposer-addr", "recipient-addr", "token-addr", "1000", "50"],
    };

    const normalized = EventNormalizer.normalize(rawEvent);

    assert.strictEqual(normalized.type, EventType.PROPOSAL_CREATED);
    assert.strictEqual(normalized.data.proposalId, "42");
    assert.strictEqual(normalized.data.proposer, "proposer-addr");
    assert.strictEqual(normalized.data.amount, "1000");
    assert.strictEqual(normalized.data.insuranceAmount, "50");
    assert.strictEqual(normalized.metadata.ledger, 100);
  });

  test("should normalize proposal_executed event", () => {
    const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["proposal_executed", "42"],
        value: ["executor-addr", "recipient-addr", "token-addr", "1000", "101"],
    };

    const normalized = EventNormalizer.normalize(rawEvent);

    assert.strictEqual(normalized.type, EventType.PROPOSAL_EXECUTED);
    assert.strictEqual(normalized.data.proposalId, "42");
    assert.strictEqual(normalized.data.executor, "executor-addr");
    assert.strictEqual(normalized.data.ledger, 101);
  });

  test("should handle unknown event topics safely", () => {
    const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["mystery_event"],
        value: ["some-data"],
    };

    const normalized = EventNormalizer.normalize(rawEvent);

    assert.strictEqual(normalized.type, EventType.UNKNOWN);
    assert.strictEqual(normalized.data.reason, "Unmapped topic");
    assert.strictEqual(normalized.data.rawTopic[0], "mystery_event");
  });

  test("should handle malformed event data gracefully", () => {
    const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["proposal_created", "42"],
        value: null, // Malformed: value should be array
    };

    const normalized = EventNormalizer.normalize(rawEvent);

    assert.strictEqual(normalized.type, EventType.UNKNOWN);
    assert.ok(normalized.data.reason.includes("Normalization error"));
  });
});
