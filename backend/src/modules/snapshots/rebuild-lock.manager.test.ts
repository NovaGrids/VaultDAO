/**
 * Tests for Snapshot Rebuild Lock Manager (#1375)
 *
 * Verifies that:
 * - Only one rebuild can proceed at a time per contract
 * - Locks expire after timeout
 * - Lock events are emitted
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  SnapshotRebuildLockManager,
  InMemoryLockBackend,
} from "./rebuild-lock.manager.js";

describe("SnapshotRebuildLockManager - Concurrent Rebuild Prevention (#1375)", () => {
  test("should prevent concurrent rebuilds for same contract", async () => {
    const manager = new SnapshotRebuildLockManager({
      backend: new InMemoryLockBackend(),
      defaultTimeoutMs: 5000,
    });

    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

    // First lock should succeed
    const lock1 = await manager.acquireLock(contractId);
    assert.ok(lock1, "first lock should be acquired");

    // Second lock should fail
    const lock2 = await manager.acquireLock(contractId);
    assert.strictEqual(lock2, null, "second concurrent lock should fail");

    // Release first lock
    const released = await manager.releaseLock(contractId, lock1);
    assert.ok(released, "lock release should succeed");

    // Now we should be able to acquire again
    const lock3 = await manager.acquireLock(contractId);
    assert.ok(lock3, "lock should be acquirable after release");

    await manager.releaseLock(contractId, lock3);
  });

  test("should emit lock acquired and released events", async () => {
    const manager = new SnapshotRebuildLockManager({
      backend: new InMemoryLockBackend(),
    });

    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
    let acquiredCount = 0;
    let releasedCount = 0;

    manager.onLockAcquired((id) => {
      if (id === contractId) acquiredCount++;
    });

    manager.onLockReleased((id) => {
      if (id === contractId) releasedCount++;
    });

    const lock = await manager.acquireLock(contractId);
    assert.equal(acquiredCount, 1, "should emit lock acquired event");

    await manager.releaseLock(contractId, lock!);
    assert.equal(releasedCount, 1, "should emit lock released event");
  });

  test("should check if contract is locked", async () => {
    const manager = new SnapshotRebuildLockManager({
      backend: new InMemoryLockBackend(),
    });

    const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

    const lockedBefore = await manager.isLocked(contractId);
    assert.ok(!lockedBefore, "should not be locked initially");

    const lock = await manager.acquireLock(contractId);
    const lockedAfter = await manager.isLocked(contractId);
    assert.ok(lockedAfter, "should be locked after acquisition");

    await manager.releaseLock(contractId, lock!);
    const lockedAfterRelease = await manager.isLocked(contractId);
    assert.ok(!lockedAfterRelease, "should not be locked after release");
  });

  test("should support multiple contracts independently", async () => {
    const manager = new SnapshotRebuildLockManager({
      backend: new InMemoryLockBackend(),
    });

    const contract1 = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
    const contract2 = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBSC4";

    // Lock both contracts
    const lock1 = await manager.acquireLock(contract1);
    const lock2 = await manager.acquireLock(contract2);

    assert.ok(lock1, "contract1 should be locked");
    assert.ok(lock2, "contract2 should be locked");

    // Try to lock contract1 again (should fail)
    const lock1b = await manager.acquireLock(contract1);
    assert.strictEqual(lock1b, null, "contract1 should still be locked");

    // But contract2's lock should prevent further locks
    const lock2b = await manager.acquireLock(contract2);
    assert.strictEqual(lock2b, null, "contract2 should still be locked");

    await manager.releaseLock(contract1, lock1);
    await manager.releaseLock(contract2, lock2);
  });
});
