/**
 * ProposalActivityAggregator — Unit Tests
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5
 *
 * Uses Node.js built-in test runner (node:test + node:assert).
 * The implementation file (aggregator.ts) is NOT modified by this file.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ProposalActivityAggregator } from "./aggregator.js";
import { ProposalActivityRecord, ProposalActivityType } from "./types.js";

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

/**
 * buildRecord — returns a minimal valid ProposalActivityRecord with sensible
 * defaults. Any field can be overridden via the `overrides` argument.
 */
function buildRecord(
  overrides: Partial<ProposalActivityRecord> & {
    proposalId: string;
    type?: ProposalActivityType;
    timestamp?: string;
  },
): ProposalActivityRecord {
  const type = overrides.type ?? ProposalActivityType.CREATED;
  const timestamp = overrides.timestamp ?? "2026-01-01T00:00:00.000Z";
  return {
    activityId: overrides.activityId ?? `${overrides.proposalId}-${timestamp}`,
    proposalId: overrides.proposalId,
    type,
    timestamp,
    metadata: overrides.metadata ?? {
      id: "meta-1",
      contractId: "CCONTRACT",
      ledger: 1,
      ledgerClosedAt: timestamp,
      transactionHash: "0xabc",
      eventIndex: 0,
    },
    data: overrides.data ?? {
      activityType: ProposalActivityType.CREATED,
      proposer: "GPROPOSER",
      recipient: "GRECIPIENT",
      token: "native",
      amount: "100",
      insuranceAmount: "0",
    },
  };
}

// ---------------------------------------------------------------------------
// addRecord suite
// ---------------------------------------------------------------------------

test("addRecord — stores record in proposal cache (Req 2.1)", () => {
  const agg = new ProposalActivityAggregator();
  const record = buildRecord({ proposalId: "p1" });

  agg.addRecord(record);

  const records = agg.getRecords("p1");
  assert.equal(records.length, 1, "cache should contain exactly one record");
  assert.deepEqual(
    records[0],
    record,
    "cached record should equal the added record",
  );
});

test("addRecord — updates latest-activity map (Req 2.1)", () => {
  const agg = new ProposalActivityAggregator();
  const record = buildRecord({
    proposalId: "p1",
    timestamp: "2026-01-01T00:00:00.000Z",
  });

  agg.addRecord(record);

  assert.deepEqual(
    agg.getLatestActivity("p1"),
    record,
    "getLatestActivity should equal the added record",
  );
});

test("addRecord — invokes onRecordAdded callback exactly once (Req 2.2)", () => {
  let callCount = 0;
  let receivedRecord: ProposalActivityRecord | undefined;

  const agg = new ProposalActivityAggregator({
    onRecordAdded: (r) => {
      callCount++;
      receivedRecord = r;
    },
  });

  const record = buildRecord({ proposalId: "p1" });
  agg.addRecord(record);

  assert.equal(callCount, 1, "callback should be invoked exactly once");
  assert.deepEqual(
    receivedRecord,
    record,
    "callback should receive the added record",
  );
});

test("addRecord — repeated records for same proposal: both stored in cache (Req 3.1)", () => {
  const agg = new ProposalActivityAggregator();
  const r1 = buildRecord({
    proposalId: "p1",
    type: ProposalActivityType.CREATED,
    timestamp: "2026-01-01T00:00:00.000Z",
  });
  const r2 = buildRecord({
    proposalId: "p1",
    type: ProposalActivityType.APPROVED,
    timestamp: "2026-01-02T00:00:00.000Z",
  });

  agg.addRecord(r1);
  agg.addRecord(r2);

  const records = agg.getRecords("p1");
  assert.equal(records.length, 2, "both records should be stored in the cache");
  assert.ok(
    records.some((r) => r.activityId === r1.activityId),
    "first record should be present",
  );
  assert.ok(
    records.some((r) => r.activityId === r2.activityId),
    "second record should be present",
  );
});

test("addRecord — repeated records for same proposal: latest-activity points to highest timestamp (Req 3.1)", () => {
  const agg = new ProposalActivityAggregator();
  const r1 = buildRecord({
    proposalId: "p1",
    type: ProposalActivityType.CREATED,
    timestamp: "2026-01-01T00:00:00.000Z",
  });
  const r2 = buildRecord({
    proposalId: "p1",
    type: ProposalActivityType.APPROVED,
    timestamp: "2026-01-02T00:00:00.000Z",
  });

  agg.addRecord(r1);
  agg.addRecord(r2);

  assert.deepEqual(
    agg.getLatestActivity("p1"),
    r2,
    "getLatestActivity should point to the record with the higher timestamp",
  );
});

test("addRecord — repeated records added in reverse order: latest-activity still points to highest timestamp (Req 3.1)", () => {
  const agg = new ProposalActivityAggregator();
  const r1 = buildRecord({
    proposalId: "p1",
    type: ProposalActivityType.CREATED,
    timestamp: "2026-01-01T00:00:00.000Z",
  });
  const r2 = buildRecord({
    proposalId: "p1",
    type: ProposalActivityType.APPROVED,
    timestamp: "2026-01-02T00:00:00.000Z",
  });

  // Add later record first
  agg.addRecord(r2);
  agg.addRecord(r1);

  assert.deepEqual(
    agg.getLatestActivity("p1"),
    r2,
    "getLatestActivity should still point to the record with the higher timestamp regardless of insertion order",
  );
});

// ---------------------------------------------------------------------------
// getStats suite
// ---------------------------------------------------------------------------

test("getStats — empty aggregator returns all-zero counts (Req 3.2)", () => {
  const agg = new ProposalActivityAggregator();
  const stats = agg.getStats();

  assert.equal(stats.totalProposals, 0, "totalProposals should be 0");
  assert.equal(stats.activeProposals, 0, "activeProposals should be 0");
  assert.equal(stats.executedProposals, 0, "executedProposals should be 0");
  assert.equal(stats.rejectedProposals, 0, "rejectedProposals should be 0");
  assert.equal(stats.expiredProposals, 0, "expiredProposals should be 0");
  assert.equal(stats.cancelledProposals, 0, "cancelledProposals should be 0");
});

test("getStats — all status counters correct for one proposal per terminal/active type (Req 2.3)", () => {
  const agg = new ProposalActivityAggregator();

  agg.addRecord(
    buildRecord({
      proposalId: "p-created",
      type: ProposalActivityType.CREATED,
      timestamp: "2026-01-01T00:00:00.000Z",
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "p-executed",
      type: ProposalActivityType.EXECUTED,
      timestamp: "2026-01-02T00:00:00.000Z",
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "p-rejected",
      type: ProposalActivityType.REJECTED,
      timestamp: "2026-01-03T00:00:00.000Z",
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "p-expired",
      type: ProposalActivityType.EXPIRED,
      timestamp: "2026-01-04T00:00:00.000Z",
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "p-cancelled",
      type: ProposalActivityType.CANCELLED,
      timestamp: "2026-01-05T00:00:00.000Z",
    }),
  );

  const stats = agg.getStats();

  assert.equal(stats.totalProposals, 5, "totalProposals should be 5");
  assert.equal(
    stats.activeProposals,
    1,
    "activeProposals should be 1 (CREATED)",
  );
  assert.equal(stats.executedProposals, 1, "executedProposals should be 1");
  assert.equal(stats.rejectedProposals, 1, "rejectedProposals should be 1");
  assert.equal(stats.expiredProposals, 1, "expiredProposals should be 1");
  assert.equal(stats.cancelledProposals, 1, "cancelledProposals should be 1");
});

test("getStats — active proposals include APPROVED, ABSTAINED, READY types (Req 2.3)", () => {
  const agg = new ProposalActivityAggregator();

  agg.addRecord(
    buildRecord({
      proposalId: "p-approved",
      type: ProposalActivityType.APPROVED,
      timestamp: "2026-01-01T00:00:00.000Z",
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "p-abstained",
      type: ProposalActivityType.ABSTAINED,
      timestamp: "2026-01-02T00:00:00.000Z",
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "p-ready",
      type: ProposalActivityType.READY,
      timestamp: "2026-01-03T00:00:00.000Z",
    }),
  );

  const stats = agg.getStats();

  assert.equal(stats.totalProposals, 3, "totalProposals should be 3");
  assert.equal(
    stats.activeProposals,
    3,
    "activeProposals should be 3 (APPROVED + ABSTAINED + READY)",
  );
});

test("getStats — latest activity determines status bucket (Req 2.3)", () => {
  const agg = new ProposalActivityAggregator();

  // Proposal transitions from CREATED → EXECUTED
  agg.addRecord(
    buildRecord({
      proposalId: "p1",
      type: ProposalActivityType.CREATED,
      timestamp: "2026-01-01T00:00:00.000Z",
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "p1",
      type: ProposalActivityType.EXECUTED,
      timestamp: "2026-01-02T00:00:00.000Z",
    }),
  );

  const stats = agg.getStats();

  assert.equal(stats.totalProposals, 1, "totalProposals should be 1");
  assert.equal(
    stats.executedProposals,
    1,
    "executedProposals should be 1 (latest is EXECUTED)",
  );
  assert.equal(
    stats.activeProposals,
    0,
    "activeProposals should be 0 (CREATED is no longer latest)",
  );
});

// ---------------------------------------------------------------------------
// getActivityBuckets suite
// ---------------------------------------------------------------------------

const MIN_INTERVAL = 60_000; // 1 minute — minimum valid intervalMs

test("getActivityBuckets — no records returns [] (Req 3.3)", () => {
  const agg = new ProposalActivityAggregator();
  assert.deepEqual(
    agg.getActivityBuckets(MIN_INTERVAL),
    [],
    "should return empty array when no records",
  );
});

test("getActivityBuckets — intervalMs below 60000 throws RangeError", () => {
  const agg = new ProposalActivityAggregator();
  assert.throws(
    () => agg.getActivityBuckets(59_999),
    RangeError,
    "should throw RangeError for intervalMs < 60000",
  );
});

test("getActivityBuckets — two records within same interval land in one bucket (Req 2.4)", () => {
  const agg = new ProposalActivityAggregator();

  // Both timestamps fall in the same 1-minute bucket starting at epoch 0
  agg.addRecord(
    buildRecord({
      proposalId: "b1",
      type: ProposalActivityType.CREATED,
      timestamp: new Date(0).toISOString(),
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "b2",
      type: ProposalActivityType.CREATED,
      timestamp: new Date(30_000).toISOString(), // 30s later, same bucket
    }),
  );

  const buckets = agg.getActivityBuckets(MIN_INTERVAL);

  assert.equal(buckets.length, 1, "should produce exactly one bucket");
  assert.equal(buckets[0].count, 2, "bucket count should be 2");
  assert.equal(
    buckets[0].timestamp,
    new Date(0).toISOString(),
    "bucket timestamp should be aligned to interval start",
  );
});

test("getActivityBuckets — records in different intervals create separate buckets (Req 2.4)", () => {
  const agg = new ProposalActivityAggregator();

  // epoch 0ms → bucket 0; epoch 90_000ms → bucket 60_000
  agg.addRecord(
    buildRecord({
      proposalId: "b1",
      type: ProposalActivityType.CREATED,
      timestamp: new Date(0).toISOString(),
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "b2",
      type: ProposalActivityType.EXECUTED,
      timestamp: new Date(90_000).toISOString(),
    }),
  );

  const buckets = agg.getActivityBuckets(MIN_INTERVAL);

  assert.equal(buckets.length, 2, "should produce two separate buckets");
  assert.equal(
    buckets[0].timestamp,
    new Date(0).toISOString(),
    "first bucket at t=0",
  );
  assert.equal(buckets[0].count, 1, "first bucket count should be 1");
  assert.equal(
    buckets[1].timestamp,
    new Date(60_000).toISOString(),
    "second bucket at t=60000",
  );
  assert.equal(buckets[1].count, 1, "second bucket count should be 1");
});

test("getActivityBuckets — types breakdown is accurate per bucket (Req 2.4)", () => {
  const agg = new ProposalActivityAggregator();

  // All three timestamps fall within the same 1-minute bucket
  agg.addRecord(
    buildRecord({
      proposalId: "b1",
      type: ProposalActivityType.CREATED,
      timestamp: new Date(0).toISOString(),
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "b2",
      type: ProposalActivityType.EXECUTED,
      timestamp: new Date(10_000).toISOString(),
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "b3",
      type: ProposalActivityType.CREATED,
      timestamp: new Date(20_000).toISOString(),
    }),
  );

  const buckets = agg.getActivityBuckets(MIN_INTERVAL);

  assert.equal(buckets.length, 1, "all three records should be in one bucket");
  assert.equal(buckets[0].count, 3, "bucket count should be 3");
  assert.equal(
    buckets[0].types[ProposalActivityType.CREATED],
    2,
    "CREATED count should be 2",
  );
  assert.equal(
    buckets[0].types[ProposalActivityType.EXECUTED],
    1,
    "EXECUTED count should be 1",
  );
});

test("getActivityBuckets — sum of all bucket counts equals total records added (Req 2.4)", () => {
  const agg = new ProposalActivityAggregator();

  // p1 & p2 in bucket 0; p3 in bucket 60_000; p4 in bucket 180_000
  agg.addRecord(
    buildRecord({ proposalId: "p1", timestamp: new Date(0).toISOString() }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "p2",
      timestamp: new Date(30_000).toISOString(),
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "p3",
      timestamp: new Date(90_000).toISOString(),
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "p4",
      timestamp: new Date(180_000).toISOString(),
    }),
  );

  const buckets = agg.getActivityBuckets(MIN_INTERVAL);
  const totalCount = buckets.reduce((sum, b) => sum + b.count, 0);

  assert.equal(
    totalCount,
    4,
    "sum of all bucket counts should equal total records added",
  );
});

test("getActivityBuckets — maxBuckets caps the number of returned buckets", () => {
  const agg = new ProposalActivityAggregator();

  // 4 records in 4 distinct 1-minute buckets
  for (let i = 0; i < 4; i++) {
    agg.addRecord(
      buildRecord({
        proposalId: `p${i}`,
        timestamp: new Date(i * MIN_INTERVAL).toISOString(),
      }),
    );
  }

  const buckets = agg.getActivityBuckets(MIN_INTERVAL, 2);

  assert.equal(buckets.length, 2, "should return at most maxBuckets buckets");
});

test("getActivityBuckets — overflow buckets are merged into the last bucket", () => {
  const agg = new ProposalActivityAggregator();

  // 3 records in 3 distinct buckets; cap at 2 → last bucket absorbs the 3rd
  for (let i = 0; i < 3; i++) {
    agg.addRecord(
      buildRecord({
        proposalId: `p${i}`,
        timestamp: new Date(i * MIN_INTERVAL).toISOString(),
      }),
    );
  }

  const buckets = agg.getActivityBuckets(MIN_INTERVAL, 2);

  assert.equal(buckets.length, 2, "should return exactly 2 buckets");
  // The last bucket should have absorbed the overflow record
  const totalCount = buckets.reduce((sum, b) => sum + b.count, 0);
  assert.equal(
    totalCount,
    3,
    "total count across capped buckets should equal total records",
  );
  assert.equal(
    buckets[1].count,
    2,
    "last bucket should contain 2 records after merge",
  );
});

// ---------------------------------------------------------------------------
// getProposalsByStatus suite
// ---------------------------------------------------------------------------

test("getProposalsByStatus — returns only proposals matching the requested status (Req 2.5)", () => {
  const agg = new ProposalActivityAggregator();

  agg.addRecord(
    buildRecord({
      proposalId: "p1",
      type: ProposalActivityType.CREATED,
      timestamp: "2026-01-01T00:00:00.000Z",
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "p2",
      type: ProposalActivityType.EXECUTED,
      timestamp: "2026-01-02T00:00:00.000Z",
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "p3",
      type: ProposalActivityType.EXECUTED,
      timestamp: "2026-01-03T00:00:00.000Z",
    }),
  );

  const results = agg.getProposalsByStatus(ProposalActivityType.EXECUTED);

  assert.equal(
    results.length,
    2,
    "should return exactly two EXECUTED proposals",
  );
  assert.ok(
    results.every(
      (r) => r.latestActivity.type === ProposalActivityType.EXECUTED,
    ),
    "all returned proposals should have EXECUTED as latest activity",
  );
  assert.ok(
    results.some((r) => r.proposalId === "p2"),
    "p2 should be in results",
  );
  assert.ok(
    results.some((r) => r.proposalId === "p3"),
    "p3 should be in results",
  );
});

test("getProposalsByStatus — excludes proposals with a different latest status (Req 2.5)", () => {
  const agg = new ProposalActivityAggregator();

  agg.addRecord(
    buildRecord({
      proposalId: "p1",
      type: ProposalActivityType.CREATED,
      timestamp: "2026-01-01T00:00:00.000Z",
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "p2",
      type: ProposalActivityType.EXECUTED,
      timestamp: "2026-01-02T00:00:00.000Z",
    }),
  );

  const results = agg.getProposalsByStatus(ProposalActivityType.EXECUTED);

  assert.equal(results.length, 1, "should return exactly one proposal");
  assert.equal(results[0].proposalId, "p2", "returned proposal should be p2");
  assert.ok(
    results.every((r) => r.proposalId !== "p1"),
    "p1 (CREATED) should not be in results",
  );
});

test("getProposalsByStatus — unmatched status returns [] (Req 3.4)", () => {
  const agg = new ProposalActivityAggregator();

  agg.addRecord(
    buildRecord({
      proposalId: "p1",
      type: ProposalActivityType.CREATED,
      timestamp: "2026-01-01T00:00:00.000Z",
    }),
  );

  const results = agg.getProposalsByStatus(ProposalActivityType.EXECUTED);

  assert.deepEqual(
    results,
    [],
    "should return empty array when no proposal holds the requested status",
  );
});

test("getProposalsByStatus — uses latest activity for filtering, not all records (Req 2.5)", () => {
  const agg = new ProposalActivityAggregator();

  // p1 transitions CREATED → EXECUTED; latest is EXECUTED
  agg.addRecord(
    buildRecord({
      proposalId: "p1",
      type: ProposalActivityType.CREATED,
      timestamp: "2026-01-01T00:00:00.000Z",
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "p1",
      type: ProposalActivityType.EXECUTED,
      timestamp: "2026-01-02T00:00:00.000Z",
    }),
  );

  const createdResults = agg.getProposalsByStatus(ProposalActivityType.CREATED);
  const executedResults = agg.getProposalsByStatus(
    ProposalActivityType.EXECUTED,
  );

  assert.deepEqual(
    createdResults,
    [],
    "p1 should NOT appear in CREATED results (latest is EXECUTED)",
  );
  assert.equal(
    executedResults.length,
    1,
    "p1 should appear in EXECUTED results",
  );
  assert.equal(executedResults[0].proposalId, "p1");
});

// ---------------------------------------------------------------------------
// clear suite
// ---------------------------------------------------------------------------

test("clear — post-clear getStats() returns all-zero counts (Req 3.5)", () => {
  const agg = new ProposalActivityAggregator();

  agg.addRecord(
    buildRecord({
      proposalId: "p1",
      type: ProposalActivityType.CREATED,
      timestamp: "2026-01-01T00:00:00.000Z",
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "p2",
      type: ProposalActivityType.EXECUTED,
      timestamp: "2026-01-02T00:00:00.000Z",
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "p3",
      type: ProposalActivityType.REJECTED,
      timestamp: "2026-01-03T00:00:00.000Z",
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "p4",
      type: ProposalActivityType.EXPIRED,
      timestamp: "2026-01-04T00:00:00.000Z",
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "p5",
      type: ProposalActivityType.CANCELLED,
      timestamp: "2026-01-05T00:00:00.000Z",
    }),
  );

  agg.clear();

  const stats = agg.getStats();
  assert.equal(
    stats.totalProposals,
    0,
    "totalProposals should be 0 after clear",
  );
  assert.equal(
    stats.activeProposals,
    0,
    "activeProposals should be 0 after clear",
  );
  assert.equal(
    stats.executedProposals,
    0,
    "executedProposals should be 0 after clear",
  );
  assert.equal(
    stats.rejectedProposals,
    0,
    "rejectedProposals should be 0 after clear",
  );
  assert.equal(
    stats.expiredProposals,
    0,
    "expiredProposals should be 0 after clear",
  );
  assert.equal(
    stats.cancelledProposals,
    0,
    "cancelledProposals should be 0 after clear",
  );
});

test("clear — post-clear getActivityBuckets() returns [] (Req 3.5)", () => {
  const agg = new ProposalActivityAggregator();

  agg.addRecord(
    buildRecord({ proposalId: "p1", timestamp: "2026-01-01T00:00:00.000Z" }),
  );
  agg.clear();

  assert.deepEqual(
    agg.getActivityBuckets(),
    [],
    "getActivityBuckets should return [] after clear",
  );
});

test("clear — post-clear getProposalsByStatus returns [] for any type (Req 3.5)", () => {
  const agg = new ProposalActivityAggregator();

  agg.addRecord(
    buildRecord({
      proposalId: "p1",
      type: ProposalActivityType.CREATED,
      timestamp: "2026-01-01T00:00:00.000Z",
    }),
  );
  agg.addRecord(
    buildRecord({
      proposalId: "p2",
      type: ProposalActivityType.EXECUTED,
      timestamp: "2026-01-02T00:00:00.000Z",
    }),
  );
  agg.clear();

  assert.deepEqual(
    agg.getProposalsByStatus(ProposalActivityType.CREATED),
    [],
    "CREATED should return [] after clear",
  );
  assert.deepEqual(
    agg.getProposalsByStatus(ProposalActivityType.EXECUTED),
    [],
    "EXECUTED should return [] after clear",
  );
});

test("clear — post-clear getRecords returns [] for previously tracked proposal (Req 3.5)", () => {
  const agg = new ProposalActivityAggregator();

  agg.addRecord(
    buildRecord({ proposalId: "p1", timestamp: "2026-01-01T00:00:00.000Z" }),
  );
  agg.clear();

  assert.deepEqual(
    agg.getRecords("p1"),
    [],
    "getRecords should return [] after clear",
  );
});

test("clear — post-clear getLatestActivity returns null for previously tracked proposal (Req 3.5)", () => {
  const agg = new ProposalActivityAggregator();

  agg.addRecord(
    buildRecord({ proposalId: "p1", timestamp: "2026-01-01T00:00:00.000Z" }),
  );
  agg.clear();

  assert.equal(
    agg.getLatestActivity("p1"),
    null,
    "getLatestActivity should return null after clear",
  );
});
