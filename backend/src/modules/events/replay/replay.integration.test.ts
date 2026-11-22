/**
 * Integration tests for the checkpointed replay path: EventReplayService +
 * ReplayProjectionWriter + checkpoint store, fed by fixture event pages
 * served the way the Soroban RPC pages them.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createTestEnv } from "../../../config/env.js";
import { InMemoryStorageAdapter } from "../../../shared/storage/storage.adapter.js";
import type { CursorStorage, EventCursor } from "../cursor/cursor.types.js";
import { EventReplayService } from "./replay.service.js";
import { MemoryReplayCheckpointStore, encodeResumeToken } from "./replay-checkpoint.js";
import {
  ReplayProjectionWriter,
  type ProposalProjection,
  type RecurringProjection,
} from "./replay-projections.js";
import { buildReconciliationReport } from "./replay-report.js";
import type { ReplayOptions } from "./replay.types.js";
import {
  FIXTURE_CONTRACT_ID,
  FIXTURE_EVENTS,
  createPagedRpc,
  type PagedRpcOptions,
} from "./fixtures/replay-event-pages.js";

const env = createTestEnv({ contractId: FIXTURE_CONTRACT_ID });

class MemoryCursor implements CursorStorage {
  cursor: EventCursor | null = null;
  async getCursor() {
    return this.cursor;
  }
  async saveCursor(cursor: EventCursor) {
    this.cursor = cursor;
  }
  async listCursors() {
    return this.cursor ? [{ id: "singleton-cursor", cursor: this.cursor }] : [];
  }
  async deleteCursor() {
    this.cursor = null;
  }
}

interface Harness {
  proposals: InMemoryStorageAdapter<ProposalProjection>;
  recurring: InMemoryStorageAdapter<RecurringProjection>;
  checkpoints: MemoryReplayCheckpointStore;
  cursor: MemoryCursor;
}

function harness(): Harness {
  return {
    proposals: new InMemoryStorageAdapter<ProposalProjection>(),
    recurring: new InMemoryStorageAdapter<RecurringProjection>(),
    checkpoints: new MemoryReplayCheckpointStore(),
    cursor: new MemoryCursor(),
  };
}

async function runReplay(
  h: Harness,
  options: Partial<ReplayOptions>,
  rpcOptions: PagedRpcOptions = {},
) {
  const opts: ReplayOptions = {
    startLedger: 100,
    endLedger: 159,
    batchSize: 10,
    checkpointEvery: 10,
    dryRun: false,
    verbose: false,
    clear: false,
    contractId: FIXTURE_CONTRACT_ID,
    ...options,
  };
  const service = new EventReplayService(env, opts, {
    checkpointStore: h.checkpoints,
    cursorStorage: h.cursor,
  });
  const rpc = createPagedRpc(FIXTURE_EVENTS, rpcOptions);
  (service as any).rpc = rpc;

  const wouldWrite: string[] = [];
  const writer = new ReplayProjectionWriter({
    proposals: h.proposals,
    recurring: h.recurring,
    dryRun: opts.dryRun,
    onWrite: (w) => wouldWrite.push(`${w.projection}:${w.key}:${w.eventId}`),
  });
  service.registerBatchConsumer((events) => writer.applyBatch(events).then(() => undefined), {
    critical: true,
  });

  const result = await service.replay().then(
    (stats) => ({ stats, error: null as Error | null }),
    (error: Error) => ({ stats: null, error }),
  );
  return { ...result, service, writer, rpc, wouldWrite };
}

async function snapshot(h: Harness) {
  const byId = <T extends { id: string }>(rows: T[]) =>
    rows.sort((a, b) => a.id.localeCompare(b.id));
  return {
    proposals: byId(await h.proposals.getAll()),
    recurring: byId(await h.recurring.getAll()),
  };
}

test("replay of the full fixture range builds the expected projections", async () => {
  const h = harness();
  const { stats, error } = await runReplay(h, {});
  assert.equal(error, null);
  assert.ok(stats);

  const p1 = await h.proposals.getById(`${FIXTURE_CONTRACT_ID}:1`);
  assert.equal(p1?.status, "executed");
  assert.deepEqual(p1?.approvals, ["GSIGNER_A", "GSIGNER_B"]);
  assert.equal((await h.proposals.getById(`${FIXTURE_CONTRACT_ID}:2`))?.status, "cancelled");
  assert.equal((await h.proposals.getById(`${FIXTURE_CONTRACT_ID}:3`))?.status, "approved");

  const r7 = await h.recurring.getById(`${FIXTURE_CONTRACT_ID}:7`);
  assert.equal(r7?.status, "active");
  assert.equal(r7?.executions, 2);

  // Checkpoint + cursor reflect the end of the range.
  const cp = await h.checkpoints.load();
  assert.equal(cp?.lastCheckpointLedger, 159);
  assert.equal(cp?.completed, true);
  assert.equal(h.cursor.cursor?.lastLedger, 159);
  assert.equal(stats.checkpointsWritten, 6);
});

test("replay of overlapping ranges is idempotent for proposal and recurring projections", async () => {
  const reference = harness();
  await runReplay(reference, {});
  const expected = await snapshot(reference);

  const h = harness();
  const first = await runReplay(h, { startLedger: 100, endLedger: 139 });
  assert.equal(first.error, null);
  // Second range overlaps 120–139; resume is disabled so it really re-reads them.
  const second = await runReplay(h, { startLedger: 120, endLedger: 159, resume: false });
  assert.equal(second.error, null);

  const summary = second.writer.summary();
  assert.ok(summary.proposal.skipped > 0, "overlapping proposal events were skipped");
  assert.ok(summary.recurring.skipped > 0, "overlapping recurring events were skipped");

  // A third, fully-overlapping pass changes nothing at all.
  const third = await runReplay(h, { startLedger: 100, endLedger: 159, resume: false });
  assert.equal(third.writer.summary().proposal.applied, 0);
  assert.equal(third.writer.summary().recurring.applied, 0);

  assert.deepEqual(await snapshot(h), expected);
});

test("a crash mid-range resumes from the last checkpoint", async () => {
  const reference = harness();
  await runReplay(reference, {});
  const expected = await snapshot(reference);

  const h = harness();
  const crashed = await runReplay(h, {}, { failAtLedger: 130 });
  assert.match(crashed.error?.message ?? "", /simulated RPC crash/);

  const cp = await h.checkpoints.load();
  assert.equal(cp?.lastCheckpointLedger, 129, "last checkpoint before the crash");
  assert.equal(cp?.completed, false);

  const resumed = await runReplay(h, {});
  assert.equal(resumed.error, null);
  assert.equal(resumed.stats?.resumedFromLedger, 130);
  assert.equal(resumed.rpc.startLedgers[0], 130, "resumed run starts after the checkpoint");
  assert.ok(
    resumed.rpc.startLedgers.every((l) => l >= 130),
    "no ledger before the checkpoint is fetched again",
  );
  assert.equal((await h.checkpoints.load())?.replayId, cp?.replayId, "same replay id");
  assert.deepEqual(await snapshot(h), expected);
});

test("an explicit resume token resumes without a stored checkpoint", async () => {
  const h = harness();
  const crashed = await runReplay(h, {}, { failAtLedger: 140 });
  assert.ok(crashed.error);
  const token = encodeResumeToken((await h.checkpoints.load())!);
  await h.checkpoints.clear();

  const resumed = await runReplay(h, { resumeToken: token });
  assert.equal(resumed.error, null);
  assert.equal(resumed.stats?.resumedFromLedger, 140);
});

test("a resume token for another contract is rejected", async () => {
  const h = harness();
  await runReplay(h, {}, { failAtLedger: 140 });
  const token = encodeResumeToken({
    ...(await h.checkpoints.load())!,
    contractId: "CDSOMETHINGELSE",
  });
  const run = await runReplay(h, { resumeToken: token });
  assert.match(run.error?.message ?? "", /does not apply/);
});

test("dry-run reports would-be writes without mutating storage", async () => {
  const h = harness();
  const run = await runReplay(h, { dryRun: true });
  assert.equal(run.error, null);

  assert.ok(run.wouldWrite.length > 0, "would-be writes were reported");
  assert.ok(run.wouldWrite.includes(`proposal:${FIXTURE_CONTRACT_ID}:1:118-1-0`));
  assert.equal(await h.proposals.count(), 0);
  assert.equal(await h.recurring.count(), 0);
  assert.equal(h.checkpoints.saves, 0, "no checkpoint written");
  assert.equal(h.cursor.cursor, null, "no cursor written");
});

test("events in a window larger than one RPC page are all applied", async () => {
  const h = harness();
  // batchSize 3 also caps each RPC page at 3 events. Ledger 121 alone holds
  // 3 events, so the first page is full and the service must follow the
  // paging cursor to prove the window is drained.
  const run = await runReplay(h, { startLedger: 121, endLedger: 123, batchSize: 3 });
  assert.equal(run.error, null);
  assert.equal(run.stats?.totalEventsProcessed, 3);
});

test("the reconciliation report counts events by type", async () => {
  const h = harness();
  const run = await runReplay(h, {});
  const report = buildReconciliationReport({
    contractId: FIXTURE_CONTRACT_ID,
    dryRun: false,
    fromLedger: 100,
    stats: run.stats!,
    projections: run.writer.summary(),
    checkpoint: run.service.getLastCheckpoint(),
  });

  assert.equal(report.totalEvents, FIXTURE_EVENTS.length);
  assert.equal(report.countsByEventType["PROPOSAL_CREATED"], 3);
  assert.equal(report.countsByEventType["PROPOSAL_APPROVED"], 4);
  assert.equal(report.countsByEventType["RECURRING_PAYMENT_EXECUTED"], 2);
  assert.equal(report.countsByEventType["UNKNOWN"], 1);
  const total = Object.values(report.countsByEventType).reduce((a, b) => a + b, 0);
  assert.equal(total, report.totalEvents);
  assert.equal(report.projections.ignored, 1);
  assert.ok(report.resumeToken);
});
