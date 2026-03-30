import assert from "node:assert/strict";
import test from "node:test";
import { SnapshotService } from "./snapshot.service.js";
import { MemorySnapshotAdapter } from "./adapters/index.js";
import { Role, type NormalizedEvent } from "./types.js";
import { EventType } from "../events/types.js";

const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1";

test("SnapshotService - processEvents - short-circuits on repeated errors", async () => {
  // Create an adapter that fails on saveSnapshot
  class FailingAdapter extends MemorySnapshotAdapter {
    async saveSnapshot(): Promise<void> {
      throw new Error("Storage failure");
    }
  }

  const adapter = new FailingAdapter();
  const service = new SnapshotService(adapter);

  const events: NormalizedEvent[] = [
    {
      type: EventType.INITIALIZED,
      data: { address: "G1", role: Role.ADMIN, ledger: 100, timestamp: "2026-03-25T12:00:00Z" },
      metadata: { id: "e1", contractId: CONTRACT_ID, ledger: 100, ledgerClosedAt: "2026-03-25T12:00:00Z" },
    },
    {
      type: EventType.ROLE_ASSIGNED,
      data: { address: "G2", role: Role.TREASURER },
      metadata: { id: "e2", contractId: CONTRACT_ID, ledger: 200, ledgerClosedAt: "2026-03-25T12:05:00Z" },
    },
    {
      type: EventType.ROLE_ASSIGNED,
      data: { address: "G3", role: Role.MEMBER },
      metadata: { id: "e3", contractId: CONTRACT_ID, ledger: 300, ledgerClosedAt: "2026-03-25T12:10:00Z" },
    },
    {
      type: EventType.ROLE_ASSIGNED,
      data: { address: "G4", role: Role.MEMBER },
      metadata: { id: "e4", contractId: CONTRACT_ID, ledger: 400, ledgerClosedAt: "2026-03-25T12:15:00Z" },
    },
    {
      type: EventType.ROLE_ASSIGNED,
      data: { address: "G5", role: Role.MEMBER },
      metadata: { id: "e5", contractId: CONTRACT_ID, ledger: 500, ledgerClosedAt: "2026-03-25T12:20:00Z" },
    },
  ];

  // With maxConsecutiveErrors = 2, it should stop after the second event
  const result = await service.processEvents(events, { maxConsecutiveErrors: 2 });

  assert.equal(result.success, false);
  assert.equal(result.eventsProcessed, 0);
  assert.equal(result.skippedEvents, 3); // 5 total - 2 processed (both failed) = 3 skipped
  assert.match(result.error!, /Storage failure/);
});

test("SnapshotService - processEvents - resets counter on success", async () => {
  let failCount = 0;
  class FlakyAdapter extends MemorySnapshotAdapter {
    async saveSnapshot(snapshot: any): Promise<void> {
      failCount++;
      if (failCount === 1 || failCount === 3) {
        throw new Error("Flaky failure");
      }
      return super.saveSnapshot(snapshot);
    }
  }

  const adapter = new FlakyAdapter();
  const service = new SnapshotService(adapter);

  const events: NormalizedEvent[] = [
    {
      type: EventType.INITIALIZED,
      data: { address: "G1", role: Role.ADMIN, ledger: 100, timestamp: "2026-03-25T12:00:00Z" },
      metadata: { id: "e1", contractId: CONTRACT_ID, ledger: 100, ledgerClosedAt: "2026-03-25T12:00:00Z" },
    },
    {
      type: EventType.ROLE_ASSIGNED,
      data: { address: "G2", role: Role.TREASURER },
      metadata: { id: "e2", contractId: CONTRACT_ID, ledger: 200, ledgerClosedAt: "2026-03-25T12:05:00Z" },
    },
    {
      type: EventType.ROLE_ASSIGNED,
      data: { address: "G3", role: Role.MEMBER },
      metadata: { id: "e3", contractId: CONTRACT_ID, ledger: 300, ledgerClosedAt: "2026-03-25T12:10:00Z" },
    },
  ];

  // maxConsecutiveErrors = 2. 
  // e1: fails (1 consecutive)
  // e2: succeeds (0 consecutive)
  // e3: fails (1 consecutive)
  // Should process all 3 without short-circuiting
  const result = await service.processEvents(events, { maxConsecutiveErrors: 2 });

  assert.equal(result.success, false); // still false because some events failed
  assert.equal(result.eventsProcessed, 1); // only e2 succeeded
  assert.equal(result.skippedEvents, 0);
});
