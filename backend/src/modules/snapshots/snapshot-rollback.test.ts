import test from "node:test";
import assert from "node:assert/strict";
import { SnapshotService } from "./snapshot.service.js";
import { MemorySnapshotAdapter } from "./adapters/memory.adapter.js";
import { EventType, type NormalizedEvent } from "../events/types.js";
import { Role } from "./types.js";

function createMockEvent(
  id: string,
  contractId: string,
  type: EventType,
  ledger: number,
  data: any,
): NormalizedEvent {
  return {
    metadata: {
      id,
      contractId,
      ledger,
      ledgerTimestamp: "2026-07-28T00:00:00Z",
      txHash: `hash_${id}`,
      eventIndex: 0,
      inSuccessfulContractCall: true,
    },
    type,
    data,
  };
}

test("Snapshot Rollback: stores up to 5 history snapshots", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);
  const contractId = "C_ROLLBACK_HIST_1";

  for (let i = 1; i <= 7; i++) {
    const event = createMockEvent(`evt_${i}`, contractId, EventType.ROLE_ASSIGNED, i * 10, {
      address: `G_USER_${i}`,
      role: Role.TREASURER,
    });
    await service.processEvent(event);
  }

  const history = await adapter.getSnapshotHistory(contractId);
  assert.strictEqual(history.length, 5, "Should keep at most last 5 snapshots in history");
  assert.strictEqual(history[0].lastProcessedLedger, 30, "Earliest retained snapshot ledger should be 30");
  assert.strictEqual(history[4].lastProcessedLedger, 70, "Latest snapshot ledger should be 70");
});

test("Snapshot Rollback: rollback_snapshot restores previous state and replays subsequent events", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);
  const contractId = "C_ROLLBACK_REPLAY_1";

  // Process initial sequence of events
  const ev1 = createMockEvent("e1", contractId, EventType.ROLE_ASSIGNED, 10, {
    address: "G_ALICE",
    role: Role.ADMIN,
  });
  const ev2 = createMockEvent("e2", contractId, EventType.ROLE_ASSIGNED, 20, {
    address: "G_BOB",
    role: Role.TREASURER,
  });
  const ev3 = createMockEvent("e3", contractId, EventType.ROLE_ASSIGNED, 30, {
    address: "G_CHARLIE",
    role: Role.MEMBER,
  });

  await service.processEvent(ev1);
  await service.processEvent(ev2);
  await service.processEvent(ev3);

  const snapBefore = await adapter.getSnapshot(contractId);
  assert.strictEqual(snapBefore?.lastProcessedLedger, 30);
  assert.strictEqual(snapBefore?.roles.size, 3);

  const history = await adapter.getSnapshotHistory(contractId);
  const rollbackTargetSnap = history.find((s) => s.lastProcessedLedger === 10);
  assert.ok(rollbackTargetSnap, "Should find snapshot at ledger 10");

  const rollbackTargetId = rollbackTargetSnap!.snapshotId!;

  // Event list available for replaying
  const allEvents = [ev1, ev2, ev3];

  // Perform rollback to ledger 10 snapshot + replay
  const rollbackResult = await service.rollback_snapshot(
    contractId,
    rollbackTargetId,
    "Corrupt ledger 30 snapshot detected",
    allEvents,
  );

  assert.strictEqual(rollbackResult.success, true);
  assert.strictEqual(rollbackResult.rollbackSnapshotId, rollbackTargetId);
  assert.strictEqual(rollbackResult.eventsReplayed, 2, "Should replay ev2 and ev3 (ledger > 10)");
  assert.strictEqual(rollbackResult.reason, "Corrupt ledger 30 snapshot detected");

  const snapAfter = await adapter.getSnapshot(contractId);
  assert.strictEqual(snapAfter?.lastProcessedLedger, 30);
  assert.strictEqual(snapAfter?.roles.size, 3);
  assert.strictEqual(snapAfter?.roles.get("G_ALICE")?.role, Role.ADMIN);
  assert.strictEqual(snapAfter?.roles.get("G_BOB")?.role, Role.TREASURER);
  assert.strictEqual(snapAfter?.roles.get("G_CHARLIE")?.role, Role.MEMBER);
});

test("Snapshot Rollback: rollback and replay consistency", async () => {
  const adapter = new MemorySnapshotAdapter();
  const service = new SnapshotService(adapter);
  const contractId = "C_CONSISTENCY_1";

  const events: NormalizedEvent[] = [
    createMockEvent("e1", contractId, EventType.ROLE_ASSIGNED, 100, {
      address: "G_USER1",
      role: Role.TREASURER,
    }),
    createMockEvent("e2", contractId, EventType.ROLE_ASSIGNED, 200, {
      address: "G_USER2",
      role: Role.ADMIN,
    }),
    createMockEvent("e3", contractId, EventType.SIGNER_ADDED, 300, {
      address: "G_USER3",
      role: Role.MEMBER,
      ledger: 300,
      timestamp: "2026-07-28T00:00:00Z",
    }),
  ];

  for (const e of events) {
    await service.processEvent(e);
  }

  const initialSnap = await adapter.getSnapshot(contractId);

  // Rollback to snapshot at ledger 200
  const history = await adapter.getSnapshotHistory(contractId);
  const targetSnap = history.find((s) => s.lastProcessedLedger === 200);
  assert.ok(targetSnap);

  const rollbackResult = await service.rollbackSnapshot({
    contractId,
    toSnapshotId: targetSnap!.snapshotId!,
    reason: "Verification test",
  }, undefined, undefined, events);

  assert.strictEqual(rollbackResult.success, true);
  assert.strictEqual(rollbackResult.eventsReplayed, 2); // e2 and e3 (ledger > 100)

  const replayedSnap = await adapter.getSnapshot(contractId);
  assert.strictEqual(replayedSnap?.lastProcessedLedger, initialSnap?.lastProcessedLedger);
  assert.strictEqual(replayedSnap?.totalRoleAssignments, initialSnap?.totalRoleAssignments);
});
