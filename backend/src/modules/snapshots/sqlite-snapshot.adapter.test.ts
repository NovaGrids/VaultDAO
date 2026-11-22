import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { SnapshotRootMismatchError } from "./errors.js";
import { SqliteSnapshotAdapter } from "./adapters/sqlite.adapter.js";
import { Role } from "./types.js";

test("SQLite snapshots survive adapter recreation and restore only committed blobs", async () => {
  const db = new DatabaseSync(":memory:");
  const adapter = new SqliteSnapshotAdapter(db);
  const snapshot = {
    contractId: "vault-sqlite",
    signers: new Map([["G1", {
      address: "G1",
      role: Role.ADMIN,
      addedAt: "2026-01-01",
      addedAtLedger: 5,
      isActive: true,
    }]]),
    roles: new Map(),
    lastProcessedLedger: 5,
    lastProcessedEventId: "event-5",
    snapshotAt: "2026-01-01",
    totalSigners: 1,
    totalRoleAssignments: 0,
  };
  await adapter.saveSnapshot(snapshot);
  const historical = (await adapter.getSnapshotHistory("vault-sqlite"))[0]!;
  const restartedAdapter = new SqliteSnapshotAdapter(db);
  assert.equal((await restartedAdapter.getSnapshot("vault-sqlite"))?.integrityRoot, historical.integrityRoot);

  db.prepare("UPDATE contract_snapshots SET blob = ? WHERE snapshot_id = ?")
    .run(JSON.stringify({
      ...JSON.parse(JSON.stringify({
        ...historical,
        signers: { G1: { ...historical.signers.get("G1"), isActive: false } },
        roles: {},
      })),
    }), historical.snapshotId!);
  await assert.rejects(
    restartedAdapter.restoreSnapshot("vault-sqlite", historical.snapshotId!),
    SnapshotRootMismatchError,
  );
  assert.equal((await restartedAdapter.getSnapshot("vault-sqlite"))?.signers.get("G1")?.isActive, true);
  db.close();
});
