import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { SnapshotRootMismatchError } from "./errors.js";
import { InMemoryLockBackend, SnapshotRebuildLockManager } from "./rebuild-lock.manager.js";
import {
  AuditedLedgerSnapshotService,
  SnapshotRestoreLockedError,
  SqliteLedgerSnapshotArchive,
} from "./audited-ledger-snapshot.js";

test("periodic snapshot captures projections and cursors and restores verified state", async () => {
  const db = new DatabaseSync(":memory:");
  const archive = new SqliteLedgerSnapshotArchive(db);
  const service = new AuditedLedgerSnapshotService(
    archive,
    new SnapshotRebuildLockManager({ backend: new InMemoryLockBackend() }),
    10,
  );
  const state = {
    proposals: [{ id: 7, status: "pending" }],
    balances: [{ address: "G1", amount: "20" }],
    cursors: { "vault-1": 500 },
  };
  assert.equal(await service.snapshotIfDue("vault-1", 19, { readState: async () => state }), null);
  const saved = await service.snapshotIfDue("vault-1", 20, { readState: async () => state });
  assert.deepEqual(saved?.state, state);

  let restored: unknown;
  await service.restore("vault-1", saved!.snapshotId, {
    replaceState: async (_contractId, snapshotState) => { restored = snapshotState; },
  });
  assert.deepEqual(restored, state);
  db.close();
});

test("corrupted snapshot blob fails closed before active state replacement", async () => {
  const db = new DatabaseSync(":memory:");
  const archive = new SqliteLedgerSnapshotArchive(db);
  const service = new AuditedLedgerSnapshotService(
    archive,
    new SnapshotRebuildLockManager({ backend: new InMemoryLockBackend() }),
    5,
  );
  const snapshot = await service.snapshotIfDue("vault-2", 5, {
    readState: async () => ({ proposals: [], balances: [{ amount: 10 }], cursors: { a: 2 } }),
  });
  db.prepare("UPDATE ledger_snapshot_blobs SET blob = ? WHERE snapshot_id = ?")
    .run(JSON.stringify({ ...snapshot, state: { proposals: [], balances: [], cursors: {} } }), snapshot!.snapshotId);
  let swapped = false;

  await assert.rejects(
    service.restore("vault-2", snapshot!.snapshotId, {
      replaceState: async () => { swapped = true; },
    }),
    SnapshotRootMismatchError,
  );
  assert.equal(swapped, false);
  db.close();
});

test("parallel restore is excluded by a shared lock", async () => {
  const db = new DatabaseSync(":memory:");
  const archive = new SqliteLedgerSnapshotArchive(db);
  const lockBackend = new InMemoryLockBackend();
  const locks = new SnapshotRebuildLockManager({ backend: lockBackend });
  const service = new AuditedLedgerSnapshotService(archive, locks, 1);
  const snapshot = await service.snapshotIfDue("vault-3", 1, {
    readState: async () => ({ proposals: [], balances: [], cursors: {} }),
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = service.restore("vault-3", snapshot!.snapshotId, {
    replaceState: async () => gate,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(
    service.restore("vault-3", snapshot!.snapshotId, { replaceState: async () => {} }),
    SnapshotRestoreLockedError,
  );
  release();
  await first;
  db.close();
});
