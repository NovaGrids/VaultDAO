import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  FileReplayCheckpointStore,
  REPLAY_CHECKPOINT_FILE,
  REPLAY_CHECKPOINT_VERSION,
  decodeResumeToken,
  encodeResumeToken,
  resolveResumeLedger,
  type ReplayCheckpoint,
} from "./replay-checkpoint.js";
import {
  ReplayProjectionWriter,
  isAlreadyApplied,
  type ProposalProjection,
  type RecurringProjection,
} from "./replay-projections.js";
import { InMemoryStorageAdapter } from "../../../shared/storage/storage.adapter.js";
import { EventType, type NormalizedEvent } from "../types.js";

function checkpoint(overrides: Partial<ReplayCheckpoint> = {}): ReplayCheckpoint {
  return {
    version: REPLAY_CHECKPOINT_VERSION,
    replayId: "replay-1",
    contractId: "CDTEST",
    fromLedger: 100,
    toLedger: 200,
    lastCheckpointLedger: 149,
    lastEventId: "149-0-0",
    eventsApplied: 12,
    completed: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("resume tokens", async (t) => {
  await t.test("round-trip a checkpoint", () => {
    const cp = checkpoint();
    const token = encodeResumeToken(cp);
    assert.match(token, /^[A-Za-z0-9_-]+$/, "token is URL-safe");
    assert.deepEqual(decodeResumeToken(token), cp);
  });

  await t.test("reject malformed tokens", () => {
    assert.throws(() => decodeResumeToken("not-a-token"), /Invalid resume token/);
    const missing = Buffer.from(JSON.stringify({ version: 1 })).toString("base64url");
    assert.throws(() => decodeResumeToken(missing), /malformed/);
  });

  await t.test("reject unsupported versions", () => {
    const token = encodeResumeToken(checkpoint({ version: 99 }));
    assert.throws(() => decodeResumeToken(token), /Unsupported resume token version/);
  });
});

test("resolveResumeLedger", async (t) => {
  await t.test("resumes after the checkpoint for the same contract and range", () => {
    assert.equal(resolveResumeLedger(checkpoint(), "CDTEST", 100, 200), 150);
  });
  await t.test("ignores a missing or completed checkpoint", () => {
    assert.equal(resolveResumeLedger(null, "CDTEST", 100, 200), null);
    assert.equal(
      resolveResumeLedger(checkpoint({ completed: true }), "CDTEST", 100, 200),
      null,
    );
  });
  await t.test("ignores a checkpoint for another contract", () => {
    assert.equal(resolveResumeLedger(checkpoint(), "CDOTHER", 100, 200), null);
  });
  await t.test("ignores a checkpoint that starts after the requested start", () => {
    assert.equal(resolveResumeLedger(checkpoint({ fromLedger: 120 }), "CDTEST", 100, 200), null);
  });
  await t.test("ignores a checkpoint beyond the requested end", () => {
    assert.equal(resolveResumeLedger(checkpoint(), "CDTEST", 100, 140), null);
  });
});

test("FileReplayCheckpointStore stores the checkpoint next to the cursor file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "replay-checkpoint-"));
  try {
    const store = new FileReplayCheckpointStore(dir);
    assert.equal(store.path, join(dir, REPLAY_CHECKPOINT_FILE));
    assert.equal(await store.load(), null);

    const cp = checkpoint();
    await store.save(cp);
    assert.deepEqual(await store.load(), cp);

    await store.clear();
    assert.equal(existsSync(store.path), false);
    assert.equal(await store.load(), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function normalized(
  type: EventType,
  id: string,
  data: Record<string, unknown>,
): NormalizedEvent {
  const ledger = Number(id.split("-")[0]);
  return {
    type,
    data,
    metadata: { id, contractId: "CDTEST", ledger, ledgerClosedAt: "2026-01-01T00:00:00Z" },
  };
}

test("ReplayProjectionWriter", async (t) => {
  const stores = () => ({
    proposals: new InMemoryStorageAdapter<ProposalProjection>(),
    recurring: new InMemoryStorageAdapter<RecurringProjection>(),
  });

  await t.test("re-applying the same events is a no-op", async () => {
    const s = stores();
    const writer = new ReplayProjectionWriter(s);
    const events = [
      normalized(EventType.PROPOSAL_CREATED, "10-0-0", { proposalId: "1", proposer: "GP", amount: "5" }),
      normalized(EventType.PROPOSAL_APPROVED, "11-0-0", { proposalId: "1", approver: "GA", threshold: 2 }),
    ];
    await writer.applyBatch(events);
    const first = await s.proposals.getById("CDTEST:1");

    const results = await writer.applyBatch(events);
    assert.deepEqual(results.map((r) => r.outcome), ["skipped", "skipped"]);
    assert.deepEqual(await s.proposals.getById("CDTEST:1"), first);
    assert.deepEqual(writer.summary().proposal, { applied: 2, skipped: 2 });
  });

  await t.test("terminal proposal states never regress", async () => {
    const s = stores();
    const writer = new ReplayProjectionWriter(s);
    await writer.apply(normalized(EventType.PROPOSAL_CREATED, "10-0-0", { proposalId: "1" }));
    await writer.apply(normalized(EventType.PROPOSAL_EXECUTED, "12-0-0", { proposalId: "1" }));
    await writer.apply(normalized(EventType.PROPOSAL_APPROVED, "13-0-0", { proposalId: "1", approver: "GL" }));
    const row = await s.proposals.getById("CDTEST:1");
    assert.equal(row?.status, "executed");
    assert.equal(row?.executedLedger, 12);
  });

  await t.test("recurring state follows pause / resume / stop", async () => {
    const s = stores();
    const writer = new ReplayProjectionWriter(s);
    const gen = (topic: string) => ({ topic, topicArgs: ["7"], value: [] });
    await writer.apply(normalized(EventType.RECURRING_PAYMENT_EXECUTED, "10-0-0", gen("recurring_payment_executed")));
    await writer.apply(normalized(EventType.RECURRING_PAUSED, "11-0-0", gen("recurring_paused")));
    assert.equal((await s.recurring.getById("CDTEST:7"))?.status, "paused");
    await writer.apply(normalized(EventType.RECURRING_STOPPED, "12-0-0", gen("recurring_stopped")));
    await writer.apply(normalized(EventType.RECURRING_RESUMED, "13-0-0", gen("recurring_resumed")));
    const row = await s.recurring.getById("CDTEST:7");
    assert.equal(row?.status, "stopped");
    assert.equal(row?.executions, 1);
  });

  await t.test("dry-run records would-be writes without touching storage", async () => {
    const s = stores();
    const printed: string[] = [];
    const writer = new ReplayProjectionWriter({
      ...s,
      dryRun: true,
      onWrite: (w) => printed.push(`${w.projection}:${w.key}:${w.eventType}`),
    });
    await writer.apply(normalized(EventType.PROPOSAL_CREATED, "10-0-0", { proposalId: "1" }));
    await writer.apply(normalized(EventType.PROPOSAL_APPROVED, "11-0-0", { proposalId: "1", approver: "GA" }));

    assert.equal(await s.proposals.count(), 0);
    assert.deepEqual(printed, [
      "proposal:CDTEST:1:PROPOSAL_CREATED",
      "proposal:CDTEST:1:PROPOSAL_APPROVED",
    ]);
    // Later would-be writes build on earlier ones via the overlay.
    const last = writer.getWrites().at(-1)!.record as ProposalProjection;
    assert.deepEqual(last.approvals, ["GA"]);
  });

  await t.test("isAlreadyApplied tie-breaks same-position ids", () => {
    const row = {
      lastPosition: { ledger: 5, txIndex: 0, eventIndex: 0 },
      lastEventIds: ["a"],
      lastEventId: "a",
      updatedLedger: 5,
    };
    assert.equal(isAlreadyApplied(row, { ledger: 5, txIndex: 0, eventIndex: 0 }, "a"), true);
    assert.equal(isAlreadyApplied(row, { ledger: 5, txIndex: 0, eventIndex: 0 }, "b"), false);
    assert.equal(isAlreadyApplied(row, { ledger: 4, txIndex: 9, eventIndex: 9 }, "c"), true);
    assert.equal(isAlreadyApplied(null, { ledger: 1, txIndex: 0, eventIndex: 0 }, "d"), false);
  });
});
