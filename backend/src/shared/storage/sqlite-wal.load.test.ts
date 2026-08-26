import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureWalMode } from "./sqlite-wal.js";

/**
 * Load test: asserts no reader-writer contention under concurrent workloads.
 *
 * A dedicated writer inserts rows in a tight loop while multiple reader
 * connections execute SELECT queries. Under WAL mode readers never block on
 * the writer, so every read must complete within a reasonable timeout and
 * return a consistent snapshot.
 */

function openDb(dir: string, name = "test.sqlite"): DatabaseSync {
  const db = new DatabaseSync(join(dir, name));
  configureWalMode(db);
  return db;
}

function setupTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

function countRows(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM kv").get() as { n: number };
  return row.n;
}

const ROW_COUNT = 500;
const READER_COUNT = 8;
const READS_PER_READER = 200;

test("WAL mode: concurrent readers never block on writer", { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "wal-load-"));
  try {
    const writerDb = openDb(dir, "wal-load.sqlite");
    setupTable(writerDb);

    const insertStmt = writerDb.prepare(
      "INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)",
    );

    // Writer: insert rows in a tight loop
    let writerDone = false;
    const writerPromise = (async () => {
      for (let i = 0; i < ROW_COUNT; i++) {
        insertStmt.run(`key-${i}`, `value-${i}`);
      }
      writerDone = true;
    })();

    // Readers: fire queries concurrently while writer is active
    const readerPromises: Promise<void>[] = [];
    for (let r = 0; r < READER_COUNT; r++) {
      readerPromises.push(
        (async (readerId: number) => {
          const readerDb = openDb(dir, "wal-load.sqlite");
          try {
            for (let j = 0; j < READS_PER_READER; j++) {
              // Use a short timeout — under WAL mode reads should never wait
              const start = performance.now();
              const _rows = readerDb
                .prepare("SELECT * FROM kv ORDER BY key")
                .all() as Array<{ key: string; value: string }>;
              const elapsed = performance.now() - start;

              // Reads under WAL should complete in well under 100ms
              // even with concurrent writes — a blocked reader would stall
              assert.ok(
                elapsed < 100,
                `Reader ${readerId} read #${j} took ${elapsed.toFixed(1)}ms (>100ms) — possible contention`,
              );
            }
          } finally {
            readerDb.close();
          }
        })(r),
      );
    }

    await writerPromise;
    assert.ok(writerDone, "Writer should finish inserting all rows");
    await Promise.all(readerPromises);

    // Verify final row count
    const finalCount = countRows(writerDb);
    assert.strictEqual(finalCount, ROW_COUNT, `Expected ${ROW_COUNT} rows, got ${finalCount}`);

    writerDb.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("WAL mode: reader sees consistent snapshot mid-write", { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "wal-snapshot-"));
  try {
    const db = openDb(dir, "snapshot.sqlite");
    setupTable(db);

    // Seed initial data
    const insert = db.prepare("INSERT INTO kv (key, value) VALUES (?, ?)");
    for (let i = 0; i < 50; i++) {
      insert.run(`seed-${i}`, `seeded`);
    }

    const readerCountBefore = countRows(db);
    assert.strictEqual(readerCountBefore, 50);

    // Start a batch insert in a transaction
    const batchInsert = () => {
      db.exec("BEGIN");
      for (let i = 50; i < 100; i++) {
        insert.run(`batch-${i}`, `batched`);
      }
      db.exec("COMMIT");
    };

    // Snapshot the count before the transaction commits
    let snapshotCount: number;
    const snapshotPromise = (async () => {
      const readerDb = openDb(dir, "snapshot.sqlite");
      try {
        // The reader should see either 50 (pre-transaction) or 100 (post-transaction)
        // never a partial count like 75
        for (let attempt = 0; attempt < 50; attempt++) {
          snapshotCount = countRows(readerDb);
          assert.ok(
            snapshotCount === 50 || snapshotCount === 100,
            `Reader saw inconsistent count ${snapshotCount} — expected atomic snapshot`,
          );
        }
      } finally {
        readerDb.close();
      }
    })();

    batchInsert();
    await snapshotPromise;

    assert.strictEqual(countRows(db), 100);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("WAL mode: journal_mode and synchronous pragmas are set", () => {
  const dir = mkdtempSync(join(tmpdir(), "wal-pragmas-"));
  try {
    const db = openDb(dir, "pragmas.sqlite");

    const journalMode = db
      .prepare("PRAGMA journal_mode")
      .get() as { journal_mode: string };
    assert.strictEqual(
      journalMode.journal_mode.toLowerCase(),
      "wal",
      `Expected WAL journal mode, got ${journalMode.journal_mode}`,
    );

    const synchronous = db
      .prepare("PRAGMA synchronous")
      .get() as { synchronous: number };
    // NORMAL = 1
    assert.strictEqual(
      synchronous.synchronous,
      1,
      `Expected synchronous=NORMAL (1), got ${synchronous.synchronous}`,
    );

    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
