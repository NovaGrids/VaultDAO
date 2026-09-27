import assert from "node:assert/strict";
import { test, describe } from "node:test";

import { UnknownEventNormalizer } from "./unknown.normalizer.js";
import type { ContractEvent } from "../events.types.js";
import { EventType } from "../types.js";

describe("UnknownEventNormalizer", () => {
  const rawEvent: ContractEvent = {
    id: "evt-999",
    contractId: "CD123",
    ledger: 100,
    ledgerClosedAt: "2026-03-25T14:00:00Z",
    topic: ["mystery_event"],
    value: ["some-data"],
  };

  test("normalizes to an UNKNOWN event", () => {
    const normalized = UnknownEventNormalizer.normalize(rawEvent, "Unmapped topic");
    assert.strictEqual(normalized.type, EventType.UNKNOWN);
    assert.strictEqual(normalized.data.reason, "Unmapped topic");
  });

  test("logs via the structured logger instead of an ad-hoc console string", () => {
    const original = console.warn;
    const calls: any[][] = [];
    console.warn = (...args: any[]) => {
      calls.push(args);
    };

    try {
      UnknownEventNormalizer.normalize(rawEvent, "Unmapped topic");
    } finally {
      console.warn = original;
    }

    assert.strictEqual(calls.length, 1);
    const [line] = calls[0]!;
    // The structured logger prefixes every line with the module tag and
    // carries topic/reason as structured fields, not a hand-built
    // `[event-normalizer] unknown event topic "x" - y` string.
    assert.match(line, /\[event-normalizer\]/);
    assert.match(line, /"topic":"mystery_event"/);
    assert.match(line, /"reason":"Unmapped topic"/);
  });
});
