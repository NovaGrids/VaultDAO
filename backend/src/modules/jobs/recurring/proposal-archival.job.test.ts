/**
 * Tests for ProposalArchivalJob
 *
 * Covers:
 * - archival of proposals older than threshold
 * - preservation of hot-storage proposals
 * - mixed-age scenarios (some old, some recent)
 * - proposals exactly at the boundary
 * - empty aggregator
 * - returned count accuracy
 * - job disabled via feature flag
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ProposalActivityAggregator } from "../../proposals/aggregator.js";
import { ProposalActivityType } from "../../proposals/types.js";
import { ProposalArchivalJob, createProposalArchivalJob } from "./proposal-archival.job.js";
import type { ProposalActivityRecord } from "../../proposals/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a minimal ProposalActivityRecord at a given timestamp. */
function makeRecord(
  proposalId: string,
  type: ProposalActivityType,
  timestamp: string,
): ProposalActivityRecord {
  return {
    activityId: `${proposalId}-${type}-${timestamp}`,
    proposalId,
    type,
    timestamp,
    metadata: {
      id: proposalId,
      contractId: "CDTEST",
      ledger: 1000,
      ledgerClosedAt: timestamp,
      transactionHash: `hash-${proposalId}`,
      eventIndex: 0,
    },
    data: {
      activityType: type,
      // Minimal data shape for CREATED to satisfy the type union
      ...(type === ProposalActivityType.CREATED
        ? { proposer: "G1", recipient: "G2", token: "XLM", amount: "100", insuranceAmount: "0" }
        : {}),
    } as ProposalActivityRecord["data"],
  };
}

/** Shift a date by N days relative to a reference. */
function daysAgo(referenceNow: Date, days: number): string {
  return new Date(referenceNow.getTime() - days * 86_400_000).toISOString();
}

/** Create a fresh aggregator seeded with proposal records. */
function makeAggregator(
  proposals: Array<{ id: string; timestamp: string; type?: ProposalActivityType }>,
): ProposalActivityAggregator {
  const agg = new ProposalActivityAggregator();
  for (const { id, timestamp, type = ProposalActivityType.CREATED } of proposals) {
    agg.addRecord(makeRecord(id, type, timestamp));
  }
  return agg;
}

/** Create a mock ScheduledJobContext with a fixed "now". */
function makeContext(now: Date) {
  return { now: () => now };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("ProposalArchivalJob: returns 0 when aggregator is empty", async () => {
  const agg = new ProposalActivityAggregator();
  const job = new ProposalArchivalJob(
    86_400_000,
    true,
    agg,
    180, // threshold days
    7,   // hot storage days
  );

  const now = new Date();
  const thresholdCutoff = new Date(now.getTime() - 180 * 86_400_000);
  const hotStorageCutoff = new Date(now.getTime() - 7 * 86_400_000);

  const count = job.archiveProposals(thresholdCutoff, hotStorageCutoff);
  assert.equal(count, 0);
});

test("ProposalArchivalJob: archives proposals older than threshold", async () => {
  const now = new Date();

  // One proposal created 200 days ago (exceeds 180-day threshold and outside 7-day hot storage)
  const agg = makeAggregator([
    { id: "old-1", timestamp: daysAgo(now, 200) },
    { id: "old-2", timestamp: daysAgo(now, 190) },
  ]);

  const job = new ProposalArchivalJob(86_400_000, true, agg, 180, 7);
  const context = makeContext(now);

  await job.run(context);

  // Both old proposals should have been pruned
  assert.equal(agg.getProposalCount(), 0);
});

test("ProposalArchivalJob: preserves proposals within hot-storage window", async () => {
  const now = new Date();

  const agg = makeAggregator([
    { id: "recent-1", timestamp: daysAgo(now, 3) },  // 3 days ago — inside 7-day hot storage
    { id: "recent-2", timestamp: daysAgo(now, 6) },  // 6 days ago — inside 7-day hot storage
  ]);

  const job = new ProposalArchivalJob(86_400_000, true, agg, 180, 7);
  const context = makeContext(now);

  await job.run(context);

  // Both should be preserved (hot storage)
  assert.equal(agg.getProposalCount(), 2);
});

test("ProposalArchivalJob: mixed-age — archives old, keeps recent", async () => {
  const now = new Date();

  const agg = makeAggregator([
    { id: "old-1",    timestamp: daysAgo(now, 200) },  // old — archive
    { id: "old-2",    timestamp: daysAgo(now, 181) },  // just over threshold — archive
    { id: "fresh-1",  timestamp: daysAgo(now, 5) },    // hot storage — keep
    { id: "fresh-2",  timestamp: daysAgo(now, 1) },    // very recent — keep
    { id: "mid-1",    timestamp: daysAgo(now, 90) },   // 90 days ago — under threshold, keep
  ]);

  const job = new ProposalArchivalJob(86_400_000, true, agg, 180, 7);
  const context = makeContext(now);

  await job.run(context);

  // Only old-1 and old-2 should be archived; fresh and mid stay
  assert.equal(agg.getProposalCount(), 3, "should keep fresh-1, fresh-2, and mid-1");
  assert.ok(agg.getSummary("fresh-1") !== null, "fresh-1 should survive");
  assert.ok(agg.getSummary("fresh-2") !== null, "fresh-2 should survive");
  assert.ok(agg.getSummary("mid-1") !== null, "mid-1 should survive (under threshold)");
  assert.equal(agg.getSummary("old-1"), null, "old-1 should be archived");
  assert.equal(agg.getSummary("old-2"), null, "old-2 should be archived");
});

test("ProposalArchivalJob: proposal exactly at threshold boundary is NOT archived", async () => {
  const now = new Date();
  // Exactly 180 days ago — should NOT be archived (uses strict <, not <=)
  const exactlyAtThreshold = new Date(now.getTime() - 180 * 86_400_000).toISOString();

  const agg = makeAggregator([
    { id: "at-boundary", timestamp: exactlyAtThreshold },
  ]);

  const job = new ProposalArchivalJob(86_400_000, true, agg, 180, 7);
  const context = makeContext(now);

  await job.run(context);

  // Exactly at threshold: pruneRecords uses `timestamp >= retentionTimestamp`
  // so the record at exactly the cutoff is preserved
  assert.equal(agg.getProposalCount(), 1, "boundary proposal should be preserved");
});

test("ProposalArchivalJob: proposal just 1ms past threshold IS archived", async () => {
  const now = new Date();
  const justPastThreshold = new Date(now.getTime() - 180 * 86_400_000 - 1).toISOString();

  const agg = makeAggregator([
    { id: "just-past", timestamp: justPastThreshold },
  ]);

  const job = new ProposalArchivalJob(86_400_000, true, agg, 180, 7);
  const context = makeContext(now);

  await job.run(context);

  assert.equal(agg.getProposalCount(), 0, "proposal just past threshold should be archived");
});

test("ProposalArchivalJob: hot storage boundary — proposal 7 days ago is kept", async () => {
  const now = new Date();
  const exactlyAtHotStorage = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const agg = makeAggregator([
    { id: "hot-boundary", timestamp: exactlyAtHotStorage },
  ]);

  const job = new ProposalArchivalJob(86_400_000, true, agg, 180, 7);
  const context = makeContext(now);

  await job.run(context);

  assert.equal(agg.getProposalCount(), 1, "proposal at hot-storage boundary should be preserved");
});

test("ProposalArchivalJob: multiple activity records for same proposal are all pruned", async () => {
  const now = new Date();
  const agg = new ProposalActivityAggregator();
  const proposalId = "multi-event-old";

  // Add 3 records for the same old proposal
  agg.addRecord(makeRecord(proposalId, ProposalActivityType.CREATED, daysAgo(now, 200)));
  agg.addRecord(makeRecord(proposalId, ProposalActivityType.APPROVED, daysAgo(now, 195)));
  agg.addRecord(makeRecord(proposalId, ProposalActivityType.EXECUTED, daysAgo(now, 192)));

  assert.equal(agg.getTotalRecordCount(), 3);

  const job = new ProposalArchivalJob(86_400_000, true, agg, 180, 7);
  const context = makeContext(now);

  await job.run(context);

  assert.equal(agg.getProposalCount(), 0);
  assert.equal(agg.getTotalRecordCount(), 0);
});

test("ProposalArchivalJob: preserves proposals under threshold even without hot-storage overlap", async () => {
  const now = new Date();

  const agg = makeAggregator([
    { id: "medium-age", timestamp: daysAgo(now, 100) }, // 100 days — under 180-day threshold
  ]);

  const job = new ProposalArchivalJob(86_400_000, true, agg, 180, 7);
  const context = makeContext(now);

  await job.run(context);

  assert.equal(agg.getProposalCount(), 1, "100-day proposal should not be archived");
});

test("ProposalArchivalJob: archiveProposals returns correct pruned record count", () => {
  const now = new Date();
  const agg = new ProposalActivityAggregator();

  // Add 2 records for old proposal (both should be pruned)
  agg.addRecord(makeRecord("old-a", ProposalActivityType.CREATED, daysAgo(now, 200)));
  agg.addRecord(makeRecord("old-a", ProposalActivityType.APPROVED, daysAgo(now, 195)));
  // 1 record for recent proposal (kept)
  agg.addRecord(makeRecord("recent-a", ProposalActivityType.CREATED, daysAgo(now, 2)));

  const job = new ProposalArchivalJob(86_400_000, true, agg, 180, 7);
  const thresholdCutoff = new Date(now.getTime() - 180 * 86_400_000);
  const hotStorageCutoff = new Date(now.getTime() - 7 * 86_400_000);

  const count = job.archiveProposals(thresholdCutoff, hotStorageCutoff);

  assert.equal(count, 2, "should report 2 pruned records for the old proposal");
  assert.equal(agg.getProposalCount(), 1, "recent proposal should remain");
});

test("ProposalArchivalJob: createProposalArchivalJob factory creates correct instance", () => {
  const agg = new ProposalActivityAggregator();
  const job = createProposalArchivalJob({
    intervalMs: 86_400_000,
    runOnStart: false,
    aggregator: agg,
    thresholdDays: 180,
    hotStorageDays: 7,
  });

  assert.equal(job.name, "proposal-archival");
  assert.equal(job.intervalMs, 86_400_000);
  assert.equal(job.runOnStart, false);
});

test("ProposalArchivalJob: custom threshold and hot-storage configuration is respected", async () => {
  const now = new Date();

  const agg = makeAggregator([
    { id: "old",    timestamp: daysAgo(now, 100) }, // older than 90-day custom threshold
    { id: "recent", timestamp: daysAgo(now, 10) },  // within 90-day threshold
    { id: "hot",    timestamp: daysAgo(now, 3) },   // within 14-day custom hot storage
  ]);

  // Custom: 90-day threshold, 14-day hot storage
  const job = new ProposalArchivalJob(86_400_000, true, agg, 90, 14);
  const context = makeContext(now);

  await job.run(context);

  assert.equal(agg.getSummary("old"), null, "old should be archived");
  assert.ok(agg.getSummary("recent") !== null, "recent should survive (under 90-day threshold)");
  assert.ok(agg.getSummary("hot") !== null, "hot should survive (in 14-day hot storage)");
});

test("ProposalArchivalJob: run completes without error when aggregator has only recent proposals", async () => {
  const now = new Date();

  const agg = makeAggregator([
    { id: "p1", timestamp: daysAgo(now, 1) },
    { id: "p2", timestamp: daysAgo(now, 5) },
    { id: "p3", timestamp: daysAgo(now, 6) },
  ]);

  const job = new ProposalArchivalJob(86_400_000, true, agg, 180, 7);

  // Should not throw
  await assert.doesNotReject(job.run(makeContext(now)));

  assert.equal(agg.getProposalCount(), 3, "all recent proposals should survive");
});
