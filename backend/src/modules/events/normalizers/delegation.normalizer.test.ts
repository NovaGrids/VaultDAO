import assert from "node:assert/strict";
import { test, describe } from "node:test";

import type { ContractEvent } from "../events.types.js";
import { EventNormalizer } from "./index.js";
import { DelegationNormalizer } from "./delegation.normalizer.js";
import { EventType } from "../types.js";

describe("DelegationNormalizer", () => {
  const mockMetadata = {
    contractId: "CD123",
    id: "evt-del-001",
    ledger: 200,
    ledgerClosedAt: "2026-03-25T15:00:00Z",
  };

  test("normalizes delegation_set with delegator, delegate and expiry", () => {
    const rawEvent: ContractEvent = {
      ...mockMetadata,
      topic: ["delegation_set", "GDELEGATOR"],
      value: ["GDELEGATE", 500],
    };

    const normalized = EventNormalizer.normalize(rawEvent);

    assert.strictEqual(normalized.type, EventType.DELEGATION_SET);
    assert.deepStrictEqual(normalized.data, {
      delegator: "GDELEGATOR",
      delegate: "GDELEGATE",
      expiryLedger: 500,
    });
    assert.strictEqual(normalized.metadata.id, "evt-del-001");
    assert.strictEqual(normalized.metadata.ledger, 200);
  });

  test("keeps expiry 0 for a delegation that never expires", () => {
    const normalized = DelegationNormalizer.normalizeDelegationSet({
      ...mockMetadata,
      topic: ["delegation_set", "GDELEGATOR"],
      value: ["GDELEGATE", 0],
    });

    assert.strictEqual(normalized.data.expiryLedger, 0);
  });

  test("normalizes delegation_revoked with the removed delegate", () => {
    const rawEvent: ContractEvent = {
      ...mockMetadata,
      topic: ["delegation_revoked", "GDELEGATOR"],
      value: "GDELEGATE",
    };

    const normalized = EventNormalizer.normalize(rawEvent);

    assert.strictEqual(normalized.type, EventType.DELEGATION_REVOKED);
    assert.deepStrictEqual(normalized.data, {
      delegator: "GDELEGATOR",
      delegate: "GDELEGATE",
    });
  });

  test("accepts a single-element array payload for delegation_revoked", () => {
    const normalized = DelegationNormalizer.normalizeDelegationRevoked({
      ...mockMetadata,
      topic: ["delegation_revoked", "GDELEGATOR"],
      value: ["GDELEGATE"],
    });

    assert.strictEqual(normalized.data.delegate, "GDELEGATE");
  });

  test("delegation_set without a delegator topic is not normalized into a record", () => {
    const rawEvent: ContractEvent = {
      ...mockMetadata,
      topic: ["delegation_set"],
      value: ["GDELEGATE", 500],
    };

    const normalized = EventNormalizer.normalize(rawEvent);

    assert.strictEqual(normalized.type, EventType.UNKNOWN);
  });

  test("delegation_set with a non-numeric expiry falls back to unknown", () => {
    const rawEvent: ContractEvent = {
      ...mockMetadata,
      topic: ["delegation_set", "GDELEGATOR"],
      value: ["GDELEGATE", "not-a-number"],
    };

    const normalized = EventNormalizer.normalize(rawEvent);

    assert.strictEqual(normalized.type, EventType.UNKNOWN);
  });

  test("delegation_revoked with an empty delegate falls back to unknown", () => {
    const rawEvent: ContractEvent = {
      ...mockMetadata,
      topic: ["delegation_revoked", "GDELEGATOR"],
      value: "",
    };

    const normalized = EventNormalizer.normalize(rawEvent);

    assert.strictEqual(normalized.type, EventType.UNKNOWN);
  });

  test("direct normalizer call throws on malformed delegation_set", () => {
    assert.throws(() =>
      DelegationNormalizer.normalizeDelegationSet({
        ...mockMetadata,
        topic: ["delegation_set", "GDELEGATOR"],
        value: "GDELEGATE",
      }),
    );
  });
});
