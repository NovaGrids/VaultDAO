/**
 * Shared-backend and lock-id tests for the Snapshot Rebuild Lock Manager (issue #1944).
 *
 * Covers:
 *   1. Two manager instances sharing one backend cannot both hold the lock
 *   2. A lock released by one instance can be acquired by the other
 *   3. Lock ids end in a random UUID (crypto.randomUUID format)
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  SnapshotRebuildLockManager,
  InMemoryLockBackend,
} from "./rebuild-lock.manager.js";

const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

const UUID_V4_SUFFIX =
  /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test("two manager instances sharing one backend cannot both rebuild the same contract", async () => {
  // Stand-in for a backend shared across instances (for example Redis).
  const sharedBackend = new InMemoryLockBackend();
  const instanceA = new SnapshotRebuildLockManager({ backend: sharedBackend });
  const instanceB = new SnapshotRebuildLockManager({ backend: sharedBackend });

  const lockA = await instanceA.acquireLock(CONTRACT_ID);
  assert.ok(lockA, "instance A should acquire the lock");

  const lockB = await instanceB.acquireLock(CONTRACT_ID);
  assert.strictEqual(lockB, null, "instance B must not acquire a held lock");

  assert.ok(
    await instanceB.isLocked(CONTRACT_ID),
    "instance B should see the lock held by instance A",
  );

  await instanceA.releaseLock(CONTRACT_ID, lockA);
});

test("a lock released by one instance can be acquired by the other", async () => {
  const sharedBackend = new InMemoryLockBackend();
  const instanceA = new SnapshotRebuildLockManager({ backend: sharedBackend });
  const instanceB = new SnapshotRebuildLockManager({ backend: sharedBackend });

  const lockA = await instanceA.acquireLock(CONTRACT_ID);
  assert.ok(lockA);
  assert.ok(await instanceA.releaseLock(CONTRACT_ID, lockA));

  const lockB = await instanceB.acquireLock(CONTRACT_ID);
  assert.ok(lockB, "instance B should acquire after instance A releases");

  await instanceB.releaseLock(CONTRACT_ID, lockB);
});

test("a non-owner instance cannot release a lock it does not hold", async () => {
  const sharedBackend = new InMemoryLockBackend();
  const instanceA = new SnapshotRebuildLockManager({ backend: sharedBackend });
  const instanceB = new SnapshotRebuildLockManager({ backend: sharedBackend });

  const lockA = await instanceA.acquireLock(CONTRACT_ID);
  assert.ok(lockA);

  const released = await instanceB.releaseLock(CONTRACT_ID, "lock:forged");
  assert.strictEqual(released, false, "a forged lock id must not release the lock");
  assert.ok(await instanceA.isLocked(CONTRACT_ID), "lock should still be held");

  await instanceA.releaseLock(CONTRACT_ID, lockA);
});

test("lock ids end in a random UUID", async () => {
  const manager = new SnapshotRebuildLockManager({
    backend: new InMemoryLockBackend(),
  });

  const lockId = await manager.acquireLock(CONTRACT_ID);
  assert.ok(lockId, "lock should be acquired");
  assert.match(lockId, UUID_V4_SUFFIX, `lock id should end in a UUID v4: ${lockId}`);

  await manager.releaseLock(CONTRACT_ID, lockId);
});

test("lock ids are unique across acquisitions", async () => {
  const manager = new SnapshotRebuildLockManager({
    backend: new InMemoryLockBackend(),
  });

  const first = await manager.acquireLock(CONTRACT_ID);
  assert.ok(first);
  await manager.releaseLock(CONTRACT_ID, first);

  const second = await manager.acquireLock(CONTRACT_ID);
  assert.ok(second);
  assert.notStrictEqual(second, first, "each acquisition must get a fresh lock id");

  await manager.releaseLock(CONTRACT_ID, second);
});
