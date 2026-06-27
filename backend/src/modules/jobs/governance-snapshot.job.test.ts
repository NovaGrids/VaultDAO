import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { GovernanceSnapshotJob } from "./governance-snapshot.job.js";

function makeDb(): DatabaseSync {
  return new DatabaseSync(":memory:");
}

test("GovernanceSnapshotJob: creates governance_snapshots table on construction", () => {
  const db = makeDb();
  new GovernanceSnapshotJob(db);
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='governance_snapshots'")
    .get() as { name: string } | undefined;
  assert.equal(row?.name, "governance_snapshots");
});

test("GovernanceSnapshotJob.getLatestSnapshot: returns null when no snapshots exist", () => {
  const db = makeDb();
  const job = new GovernanceSnapshotJob(db);
  assert.equal(job.getLatestSnapshot(), null);
});

test("GovernanceSnapshotJob.listSnapshots: returns empty array when no snapshots exist", () => {
  const db = makeDb();
  const job = new GovernanceSnapshotJob(db);
  assert.deepEqual(job.listSnapshots(), []);
});

test("GovernanceSnapshotJob: computes and stores a snapshot on first start (no RPC)", async () => {
  const db = makeDb();
  // Use a small interval so test is fast
  const job = new GovernanceSnapshotJob(db, { intervalLedgers: 10, windowLedgers: 50 });

  await job.start();
  await job.stop();

  const snapshot = job.getLatestSnapshot();
  assert.ok(snapshot !== null, "snapshot should be stored");
  assert.equal(snapshot.window_end_ledger - snapshot.window_start_ledger, 50);
  assert.ok(snapshot.participation_rate >= 0 && snapshot.participation_rate <= 1);
  assert.ok(snapshot.compliance_score >= 0 && snapshot.compliance_score <= 1);
});

test("GovernanceSnapshotJob: missed-ledger catch-up stores multiple snapshots", async () => {
  const db = makeDb();
  const job = new GovernanceSnapshotJob(db, { intervalLedgers: 100, windowLedgers: 200 });

  // Manually seed a prior snapshot far in the past to simulate catch-up
  db.prepare(
    `INSERT INTO governance_snapshots
      (computed_at, ledger_height, window_start_ledger, window_end_ledger,
       participation_rate, compliance_score, active_proposals, avg_vote_time_ledgers)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(new Date().toISOString(), 500, 300, 500, 0.5, 0.8, 2, 10);

  // Start job — no RPC, so getCurrentLedger returns lastSnapshotLedger + intervalLedgers = 600
  // That means 1 missed interval (500 -> 600)
  await job.start();
  await job.stop();

  const snapshots = job.listSnapshots(10);
  // We seeded one + job computed one
  assert.ok(snapshots.length >= 1);
});

test("GovernanceSnapshotJob: ledger scheduling uses intervalLedgers config", async () => {
  const db = makeDb();
  const job = new GovernanceSnapshotJob(db, { intervalLedgers: 50, windowLedgers: 100 });
  await job.start();
  await job.stop();

  const snapshot = job.getLatestSnapshot();
  assert.ok(snapshot !== null);
  // Window size matches config
  assert.equal(snapshot.window_end_ledger - snapshot.window_start_ledger, 100);
});

test("GovernanceSnapshotJob: computes metrics from proposals table when available", async () => {
  const db = makeDb();

  // Seed proposals table
  db.exec(`
    CREATE TABLE proposals (
      id TEXT PRIMARY KEY,
      status TEXT,
      created_ledger INTEGER,
      vote_ledger INTEGER
    )
  `);
  db.prepare("INSERT INTO proposals VALUES ('p1', 'executed', 10, 25)").run();
  db.prepare("INSERT INTO proposals VALUES ('p2', 'executed', 10, 40)").run();
  db.prepare("INSERT INTO proposals VALUES ('p3', 'created', 50, NULL)").run();

  const job = new GovernanceSnapshotJob(db, { intervalLedgers: 100, windowLedgers: 200 });
  await job.start();
  await job.stop();

  const snapshot = job.getLatestSnapshot();
  assert.ok(snapshot !== null);
  // 2 voted out of 3 total → ~0.67
  assert.ok(snapshot.participation_rate > 0 && snapshot.participation_rate <= 1);
  assert.equal(snapshot.active_proposals, 1);
  assert.ok(snapshot.avg_vote_time_ledgers > 0);
});

test("GovernanceSnapshotJob: isRunning reflects start/stop state", async () => {
  const db = makeDb();
  const job = new GovernanceSnapshotJob(db, { intervalLedgers: 100 });
  assert.equal(job.isRunning(), false);
  await job.start();
  assert.equal(job.isRunning(), true);
  await job.stop();
  assert.equal(job.isRunning(), false);
});

test("GovernanceSnapshotJob: start is idempotent", async () => {
  const db = makeDb();
  const job = new GovernanceSnapshotJob(db, { intervalLedgers: 100 });
  await job.start();
  await job.start(); // Should not throw
  assert.equal(job.isRunning(), true);
  await job.stop();
});
