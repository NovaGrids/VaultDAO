import assert from "node:assert/strict";
import test from "node:test";

import {
  parseEventSequenceKey,
  compareEventSequence,
  sortAndSequenceEvents,
  dedupeEvents,
  validateReplayIntegrity,
} from "./event-sequence.js";
import type { ContractEvent } from "../events.types.js";

function makeEvent(overrides: Partial<ContractEvent> = {}): ContractEvent {
  return {
    id: "100-0-0",
    contractId: "CDTEST",
    topic: ["proposal_created"],
    value: {},
    ledger: 100,
    ledgerClosedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("parseEventSequenceKey", async (t) => {
  await t.test("parses ledger-tx_index-event_index id format", () => {
    const key = parseEventSequenceKey(makeEvent({ id: "205-3-1", ledger: 205 }));
    assert.deepEqual(key, { ledger: 205, txIndex: 3, eventIndex: 1 });
  });

  await t.test("falls back to ledger-only key for non-conforming ids", () => {
    const key = parseEventSequenceKey(makeEvent({ id: "evt-abc", ledger: 42 }));
    assert.deepEqual(key, { ledger: 42, txIndex: 0, eventIndex: 0 });
  });

  await t.test("falls back for non-numeric components", () => {
    const key = parseEventSequenceKey(makeEvent({ id: "100-1-abc", ledger: 100 }));
    assert.deepEqual(key, { ledger: 100, txIndex: 0, eventIndex: 0 });
  });
});

test("compareEventSequence orders by ledger, then tx_index, then event_index", () => {
  const a = makeEvent({ id: "100-0-0", ledger: 100 });
  const b = makeEvent({ id: "100-0-1", ledger: 100 });
  const c = makeEvent({ id: "100-1-0", ledger: 100 });
  const d = makeEvent({ id: "101-0-0", ledger: 101 });

  assert.ok(compareEventSequence(a, b) < 0);
  assert.ok(compareEventSequence(b, c) < 0);
  assert.ok(compareEventSequence(c, d) < 0);
  assert.ok(compareEventSequence(d, a) > 0);
  assert.equal(compareEventSequence(a, a), 0);
});

test("sortAndSequenceEvents", async (t) => {
  await t.test("restores deterministic order for reordered transactions", () => {
    // Simulate RPC returning events out of order within/across ledgers.
    const shuffled = [
      makeEvent({ id: "101-2-0", ledger: 101 }),
      makeEvent({ id: "100-1-0", ledger: 100 }),
      makeEvent({ id: "100-0-1", ledger: 100 }),
      makeEvent({ id: "101-0-0", ledger: 101 }),
      makeEvent({ id: "100-0-0", ledger: 100 }),
    ];

    const result = sortAndSequenceEvents(shuffled);

    assert.deepEqual(
      result.map((e) => e.id),
      ["100-0-0", "100-0-1", "100-1-0", "101-0-0", "101-2-0"],
    );
  });

  await t.test("assigns a 0-based sequence number that resets per ledger", () => {
    const events = [
      makeEvent({ id: "100-0-0", ledger: 100 }),
      makeEvent({ id: "100-0-1", ledger: 100 }),
      makeEvent({ id: "100-1-0", ledger: 100 }),
      makeEvent({ id: "101-0-0", ledger: 101 }),
    ];

    const result = sortAndSequenceEvents(events);

    assert.deepEqual(
      result.map((e) => e.eventSequenceNumber),
      [0, 1, 2, 0],
    );
  });

  await t.test("does not mutate the input array", () => {
    const events = [
      makeEvent({ id: "100-1-0", ledger: 100 }),
      makeEvent({ id: "100-0-0", ledger: 100 }),
    ];
    const original = [...events];
    sortAndSequenceEvents(events);
    assert.deepEqual(events, original);
  });

  await t.test("handles an empty input", () => {
    assert.deepEqual(sortAndSequenceEvents([]), []);
  });
});

test("dedupeEvents keeps the first occurrence in order", () => {
  const events = [
    makeEvent({ id: "100-0-0" }),
    makeEvent({ id: "100-0-1" }),
    makeEvent({ id: "100-0-0" }), // duplicate, overlapping poll window
  ];

  const result = dedupeEvents(events);

  assert.deepEqual(
    result.map((e) => e.id),
    ["100-0-0", "100-0-1"],
  );
});

test("validateReplayIntegrity", async (t) => {
  await t.test("reports no issues for a clean, contiguous sequence", () => {
    const events = sortAndSequenceEvents([
      makeEvent({ id: "100-0-0", ledger: 100 }),
      makeEvent({ id: "100-0-1", ledger: 100 }),
      makeEvent({ id: "100-1-0", ledger: 100 }),
    ]);

    const report = validateReplayIntegrity(events);

    assert.deepEqual(report.duplicateIds, []);
    assert.deepEqual(report.possibleGaps, []);
  });

  await t.test("flags duplicate ids", () => {
    const events = [
      makeEvent({ id: "100-0-0" }),
      makeEvent({ id: "100-0-1" }),
      makeEvent({ id: "100-0-0" }),
    ];

    const report = validateReplayIntegrity(events);

    assert.deepEqual(report.duplicateIds, ["100-0-0"]);
  });

  await t.test("flags a gap in event_index within the same transaction", () => {
    const events = sortAndSequenceEvents([
      makeEvent({ id: "100-0-0", ledger: 100 }),
      makeEvent({ id: "100-0-3", ledger: 100 }), // skipped event_index 1, 2
    ]);

    const report = validateReplayIntegrity(events);

    assert.equal(report.possibleGaps.length, 1);
    assert.deepEqual(report.possibleGaps[0], {
      ledger: 100,
      txIndex: 0,
      fromEventIndex: 0,
      toEventIndex: 3,
    });
  });

  await t.test("does not flag a gap across different transactions", () => {
    const events = sortAndSequenceEvents([
      makeEvent({ id: "100-0-5", ledger: 100 }),
      makeEvent({ id: "100-1-0", ledger: 100 }),
    ]);

    const report = validateReplayIntegrity(events);
    assert.deepEqual(report.possibleGaps, []);
  });
});
