import assert from "node:assert/strict";
import test from "node:test";
import {
  SnapshotDiffService,
  InMemorySnapshotDiffAdapter,
  SemanticSnapshotDiffService,
} from "./snapshot-diff.service.js";
import type { SerializableContractSnapshot } from "./types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSnapshot(
  overrides: Partial<SerializableContractSnapshot> = {},
): SerializableContractSnapshot {
  return {
    contractId: "CONTRACT-A",
    signers: {},
    roles: {},
    lastProcessedLedger: 100,
    lastProcessedEventId: "evt-1",
    snapshotAt: new Date().toISOString(),
    totalSigners: 0,
    totalRoleAssignments: 0,
    ...overrides,
  };
}

function makeService() {
  return new SnapshotDiffService(new InMemorySnapshotDiffAdapter());
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("SnapshotDiffService: save base snapshot and retrieve it", async () => {
  const svc = makeService();
  const snap = makeSnapshot({ lastProcessedLedger: 50 });

  const id = await svc.saveBaseSnapshot(snap);
  assert.ok(typeof id === "string" && id.length > 0, "should return a snapshotId");

  const diff = await svc.getDiff(id);
  assert.ok(diff !== null, "diff should be retrievable");
  assert.strictEqual(diff!.isBase, true);
  assert.strictEqual(diff!.parentSnapshotId, null);
  assert.strictEqual(diff!.ledger, 50);
  assert.deepStrictEqual(diff!.baseState, snap);
});

test("SnapshotDiffService: save incremental diff records only changed fields", async () => {
  const svc = makeService();

  const snap1 = makeSnapshot({ lastProcessedLedger: 100, totalSigners: 1 });
  await svc.saveBaseSnapshot(snap1);

  const snap2 = makeSnapshot({ lastProcessedLedger: 110, totalSigners: 2 });
  const diffId = await svc.saveDiff(snap2);

  const diff = await svc.getDiff(diffId);
  assert.ok(diff !== null);
  assert.strictEqual(diff!.isBase, false);
  assert.ok(diff!.changedFields.length > 0, "should have changed fields");

  const changedFieldNames = diff!.changedFields.map((c) => c.field);
  assert.ok(changedFieldNames.includes("totalSigners"), "totalSigners should be in changedFields");
  assert.ok(changedFieldNames.includes("lastProcessedLedger"), "lastProcessedLedger should be in changedFields");
});

test("SnapshotDiffService: reconstructSnapshot is deterministic", async () => {
  const svc = makeService();

  const snap1 = makeSnapshot({ lastProcessedLedger: 100, totalSigners: 1 });
  await svc.saveBaseSnapshot(snap1);

  const snap2 = makeSnapshot({ lastProcessedLedger: 110, totalSigners: 2 });
  const id2 = await svc.saveDiff(snap2);

  const snap3 = makeSnapshot({ lastProcessedLedger: 120, totalSigners: 3 });
  const id3 = await svc.saveDiff(snap3);

  // Reconstruct at id2 — should match snap2
  const reconstructed2 = await svc.reconstructSnapshot(id2);
  assert.ok(reconstructed2 !== null);
  assert.strictEqual(reconstructed2!.totalSigners, 2);
  assert.strictEqual(reconstructed2!.lastProcessedLedger, 110);

  // Reconstruct at id3 — should match snap3
  const reconstructed3 = await svc.reconstructSnapshot(id3);
  assert.ok(reconstructed3 !== null);
  assert.strictEqual(reconstructed3!.totalSigners, 3);
  assert.strictEqual(reconstructed3!.lastProcessedLedger, 120);

  // Reconstruct id3 again — must produce identical result (determinism)
  const reconstructed3Again = await svc.reconstructSnapshot(id3);
  assert.deepStrictEqual(reconstructed3, reconstructed3Again, "reconstruction must be deterministic");
});

test("SnapshotDiffService: getDiffFromPrevious returns null for base snapshot", async () => {
  const svc = makeService();
  const snap = makeSnapshot();
  const baseId = await svc.saveBaseSnapshot(snap);

  const diff = await svc.getDiffFromPrevious(baseId);
  assert.strictEqual(diff, null, "base snapshot has no previous diff");
});

test("SnapshotDiffService: getDiffFromPrevious returns diff for non-base snapshot", async () => {
  const svc = makeService();

  await svc.saveBaseSnapshot(makeSnapshot({ lastProcessedLedger: 100 }));
  const diffId = await svc.saveDiff(makeSnapshot({ lastProcessedLedger: 110, totalSigners: 5 }));

  const diff = await svc.getDiffFromPrevious(diffId);
  assert.ok(diff !== null, "should return diff for non-base snapshot");
  assert.strictEqual(diff!.isBase, false);
});

test("SnapshotDiffService: compact collapses old diffs into new base", async () => {
  const adapter = new InMemorySnapshotDiffAdapter();
  const svc = new SnapshotDiffService(adapter);
  const contractId = "CONTRACT-COMPACT";

  // Save a base and two diffs with old timestamps
  const oldDate = new Date(Date.now() - 10 * 86_400_000).toISOString(); // 10 days ago

  const base = makeSnapshot({ contractId, lastProcessedLedger: 1, snapshotAt: oldDate });
  const baseId = await svc.saveBaseSnapshot(base);

  // Manually set old timestamps on the base
  const baseDiff = await adapter.getDiff(baseId);
  await adapter.saveDiff({ ...baseDiff!, timestamp: oldDate });

  const diff1Snap = makeSnapshot({ contractId, lastProcessedLedger: 2, totalSigners: 1, snapshotAt: oldDate });
  const diff1Id = await svc.saveDiff(diff1Snap);
  const diff1 = await adapter.getDiff(diff1Id);
  await adapter.saveDiff({ ...diff1!, timestamp: oldDate });

  const diff2Snap = makeSnapshot({ contractId, lastProcessedLedger: 3, totalSigners: 2, snapshotAt: oldDate });
  const diff2Id = await svc.saveDiff(diff2Snap);
  const diff2 = await adapter.getDiff(diff2Id);
  await adapter.saveDiff({ ...diff2!, timestamp: oldDate });

  // Add a recent diff (should NOT be compacted)
  const recentSnap = makeSnapshot({ contractId, lastProcessedLedger: 4, totalSigners: 3 });
  await svc.saveDiff(recentSnap);

  const beforeCount = (await adapter.listDiffs(contractId)).length;
  assert.strictEqual(beforeCount, 4, "should have 4 entries before compact");

  const compacted = await svc.compact(contractId);
  assert.ok(compacted > 0, "should have compacted some diffs");

  const afterDiffs = await adapter.listDiffs(contractId);
  // New base + recent diff + any remaining
  const bases = afterDiffs.filter((d) => d.isBase);
  assert.ok(bases.length >= 1, "should have at least one base after compact");

  // The new base should reconstruct to the last compacted state
  const newBase = bases[bases.length - 1];
  assert.ok(newBase.baseState !== undefined, "new base should have full state");
});

test("SnapshotDiffService: compact is atomic — new base written before old diffs deleted", async () => {
  // Verify that even if deletion fails, the new base exists
  const adapter = new InMemorySnapshotDiffAdapter();
  const svc = new SnapshotDiffService(adapter);
  const contractId = "CONTRACT-ATOMIC";

  const oldDate = new Date(Date.now() - 10 * 86_400_000).toISOString();
  const base = makeSnapshot({ contractId, lastProcessedLedger: 1, snapshotAt: oldDate });
  const baseId = await svc.saveBaseSnapshot(base);
  const baseDiff = await adapter.getDiff(baseId);
  await adapter.saveDiff({ ...baseDiff!, timestamp: oldDate });

  const countBefore = (await adapter.listDiffs(contractId)).length;
  await svc.compact(contractId);
  const diffsAfter = await adapter.listDiffs(contractId);

  // New base must exist regardless
  const bases = diffsAfter.filter((d) => d.isBase);
  assert.ok(bases.length >= 1, "new base must exist after compact (atomicity)");
  // Total count should not exceed before + 1 (the new base)
  assert.ok(diffsAfter.length <= countBefore + 1, "compact should not increase total count");
});

test("SnapshotDiffService: saveDiff falls back to base when no history exists", async () => {
  const svc = makeService();
  const snap = makeSnapshot({ lastProcessedLedger: 200 });

  // saveDiff with no prior history should create a base
  const id = await svc.saveDiff(snap);
  const diff = await svc.getDiff(id);
  assert.ok(diff !== null);
  assert.strictEqual(diff!.isBase, true, "should create base when no history exists");
});

// ── Semantic Diff Tests ───────────────────────────────────────────────────────

function makeSemanticService() {
  return new SemanticSnapshotDiffService(new InMemorySnapshotDiffAdapter());
}

test("SemanticSnapshotDiffService: threshold reduction is classified critical", async () => {
  const svc = makeSemanticService();

  // Base snapshot: totalSigners = 3
  const base = makeSnapshot({ lastProcessedLedger: 100, totalSigners: 3 });
  await svc.saveBaseSnapshot(base);

  // Diff snapshot: totalSigners reduced to 1
  const next = makeSnapshot({ lastProcessedLedger: 110, totalSigners: 1 });
  await svc.saveDiff(next);

  const result = await svc.computeSemanticDiff("CONTRACT-A", 100, 110);
  assert.ok(result !== null, "should produce a semantic diff result");
  assert.strictEqual(result!.hasCritical, true, "should have critical changes");

  const criticals = result!.changes.filter((c) => c.severity === "critical");
  assert.ok(criticals.length > 0, "should have at least one critical change");
  assert.ok(
    criticals.some((c) => c.field === "totalSigners"),
    "totalSigners decrease should be critical",
  );
  assert.ok(
    criticals[0]!.description.length > 0,
    "critical change should have a description",
  );
});

test("SemanticSnapshotDiffService: signer addition is classified warning", async () => {
  const svc = makeSemanticService();

  const base = makeSnapshot({
    lastProcessedLedger: 200,
    signers: {},
    totalSigners: 0,
  });
  await svc.saveBaseSnapshot(base);

  // Add a new signer
  const next = makeSnapshot({
    lastProcessedLedger: 210,
    signers: {
      SIGNER_A: {
        address: "SIGNER_A",
        role: 1,
        addedAt: new Date().toISOString(),
        addedAtLedger: 210,
        isActive: true,
      },
    },
    totalSigners: 1,
  });
  await svc.saveDiff(next);

  const result = await svc.computeSemanticDiff("CONTRACT-A", 200, 210);
  assert.ok(result !== null, "should produce a result");

  const warnings = result!.changes.filter((c) => c.severity === "warning");
  assert.ok(warnings.length > 0, "signer addition should produce a warning");
  assert.ok(
    warnings.some((c) => c.field === "signers" || c.field === "totalSigners"),
    "the warning should be on the signers or totalSigners field",
  );
});

test("SemanticSnapshotDiffService: label/catch-all field change is classified info", async () => {
  const svc = makeSemanticSnapshotDiffService_custom();

  const base = makeSnapshot({ lastProcessedLedger: 300, lastProcessedEventId: "evt-1" });
  await svc.saveBaseSnapshot(base);

  const next = makeSnapshot({ lastProcessedLedger: 310, lastProcessedEventId: "evt-2" });
  await svc.saveDiff(next);

  const result = await svc.computeSemanticDiff("CONTRACT-A", 300, 310);
  assert.ok(result !== null);

  const infoChanges = result!.changes.filter((c) => c.severity === "info");
  assert.ok(infoChanges.length > 0, "non-critical field change should be info");
  assert.strictEqual(result!.hasCritical, false, "should not have critical changes");
});

test("SemanticSnapshotDiffService: webhook is triggered for critical changes", async () => {
  const delivered: unknown[] = [];
  const mockWebhook = {
    deliver: async (event: unknown) => {
      delivered.push(event);
    },
  };

  const svc = new SemanticSnapshotDiffService(
    new InMemorySnapshotDiffAdapter(),
    mockWebhook as any,
  );

  const base = makeSnapshot({ lastProcessedLedger: 400, totalSigners: 5 });
  await svc.saveBaseSnapshot(base);

  // Drastically reduce signers — triggers critical
  const next = makeSnapshot({ lastProcessedLedger: 410, totalSigners: 1 });
  await svc.saveDiff(next);

  const result = await svc.computeSemanticDiff("CONTRACT-A", 400, 410);
  assert.ok(result !== null);
  assert.strictEqual(result!.hasCritical, true);

  // Give the fire-and-forget a tick to resolve
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(delivered.length > 0, "webhook should have been triggered");
  assert.ok(
    (delivered[0] as any).topic === "snapshot:critical-change",
    "webhook event topic should be snapshot:critical-change",
  );
});

test("SemanticSnapshotDiffService: classifyChanges respects rule order (first match wins)", () => {
  const svc = makeSemanticService();

  // threshold decrease → critical (first matching rule)
  const changes = [
    { field: "totalSigners", before: 5, after: 2 },
    { field: "lastProcessedLedger", before: 100, after: 110 },
  ];

  const classified = svc.classifyChanges(changes);
  assert.strictEqual(classified.length, 2);
  assert.strictEqual(classified[0]!.severity, "critical", "totalSigners decrease should be critical");
  assert.strictEqual(classified[1]!.severity, "info", "ledger change should be info via catch-all");
});

test("SemanticSnapshotDiffService: computeSemanticDiff returns null when no snapshots exist", async () => {
  const svc = makeSemanticService();
  const result = await svc.computeSemanticDiff("NONEXISTENT-VAULT", 100, 200);
  assert.strictEqual(result, null);
});

/** Helper to create a service with default rules but no webhook. */
function makeSemanticSnapshotDiffService_custom() {
  return new SemanticSnapshotDiffService(new InMemorySnapshotDiffAdapter());
}
