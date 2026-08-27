import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SQLITE_POOL_SIZE,
  MAX_SQLITE_POOL_SIZE,
  SqliteConnectionPool,
  closeAllSqlitePools,
  getSqlitePool,
} from "./sqlite-pool.js";

function makeTempDbPath(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "vaultdao-pool-"));
  return {
    path: join(dir, "test.sqlite"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("SqliteConnectionPool", async (t) => {
  await t.test("opens file-backed connections in WAL mode", async () => {
    const { path, cleanup } = makeTempDbPath();
    const pool = new SqliteConnectionPool(path, { size: 2 });

    try {
      const mode = await pool.withConnection(
        (db) =>
          db.prepare("PRAGMA journal_mode").get() as unknown as {
            journal_mode: string;
          },
      );

      assert.equal(mode.journal_mode.toLowerCase(), "wal");
      assert.equal(pool.stats().walEnabled, true);
    } finally {
      pool.close();
      cleanup();
    }
  });

  await t.test("reuses connections instead of opening one per borrow", async () => {
    const { path, cleanup } = makeTempDbPath();
    const pool = new SqliteConnectionPool(path, { size: 4 });

    try {
      for (let i = 0; i < 20; i++) {
        await pool.withConnection((db) => db.prepare("SELECT 1").get());
      }

      const stats = pool.stats();
      assert.equal(stats.open, 1, "sequential borrows reuse a single handle");
      assert.equal(stats.inUse, 0, "every borrow was released");
    } finally {
      pool.close();
      cleanup();
    }
  });

  await t.test("never opens more connections than the configured size", async () => {
    const { path, cleanup } = makeTempDbPath();
    const pool = new SqliteConnectionPool(path, { size: 3 });

    try {
      const held = await Promise.all([
        pool.acquire(),
        pool.acquire(),
        pool.acquire(),
      ]);

      assert.equal(pool.stats().open, 3);
      assert.equal(pool.stats().inUse, 3);

      // A fourth caller must queue rather than open a fourth handle.
      let fourthResolved = false;
      const fourth = pool.acquire().then((db) => {
        fourthResolved = true;
        return db;
      });

      await Promise.resolve();
      assert.equal(fourthResolved, false, "fourth caller is queued");
      assert.equal(pool.stats().waiting, 1);
      assert.equal(pool.stats().open, 3, "no extra handle was opened");

      pool.release(held[0]!);
      const handedOver = await fourth;
      assert.equal(handedOver, held[0], "queued caller got the released handle");
      assert.equal(pool.stats().open, 3);

      pool.release(handedOver);
      pool.release(held[1]!);
      pool.release(held[2]!);
    } finally {
      pool.close();
      cleanup();
    }
  });

  await t.test("hands connections to waiters in FIFO order", async () => {
    const { path, cleanup } = makeTempDbPath();
    const pool = new SqliteConnectionPool(path, { size: 1 });

    try {
      const held = await pool.acquire();
      const order: number[] = [];

      const first = pool.acquire().then((db) => {
        order.push(1);
        return db;
      });
      const second = pool.acquire().then((db) => {
        order.push(2);
        return db;
      });

      pool.release(held);
      pool.release(await first);
      pool.release(await second);

      assert.deepEqual(order, [1, 2]);
    } finally {
      pool.close();
      cleanup();
    }
  });

  await t.test("releases the connection when the caller throws", async () => {
    const { path, cleanup } = makeTempDbPath();
    const pool = new SqliteConnectionPool(path, { size: 1 });

    try {
      await assert.rejects(
        pool.withConnection(() => {
          throw new Error("boom");
        }),
        /boom/,
      );

      assert.equal(pool.stats().inUse, 0, "connection was returned");
      // The pool must still be usable after a failed borrow.
      const value = await pool.withConnection(
        (db) => db.prepare("SELECT 1 as n").get() as unknown as { n: number },
      );
      assert.equal(value.n, 1);
    } finally {
      pool.close();
      cleanup();
    }
  });

  await t.test("borrowSync falls back when the pool is exhausted", async () => {
    const { path, cleanup } = makeTempDbPath();
    const pool = new SqliteConnectionPool(path, { size: 1 });

    try {
      const held = await pool.acquire();
      assert.equal(pool.acquireSync(), undefined, "pool is exhausted");

      // Rather than failing the caller, borrowSync opens a short-lived handle.
      const result = pool.borrowSync(
        (db) => db.prepare("SELECT 1 as n").get() as unknown as { n: number },
      );
      assert.equal(result.n, 1);
      assert.equal(pool.stats().inUse, 1, "the fallback handle was not pooled");

      pool.release(held);
    } finally {
      pool.close();
      cleanup();
    }
  });

  await t.test("ignores a double release", async () => {
    const { path, cleanup } = makeTempDbPath();
    const pool = new SqliteConnectionPool(path, { size: 2 });

    try {
      const connection = await pool.acquire();
      pool.release(connection);
      pool.release(connection);

      assert.equal(
        pool.stats().available,
        1,
        "the connection is listed once, not twice",
      );
    } finally {
      pool.close();
      cleanup();
    }
  });

  await t.test("pins in-memory databases to a single connection", () => {
    // Every handle to :memory: is a separate database, so pooling more than
    // one would hand callers diverging datasets.
    const pool = new SqliteConnectionPool(":memory:", { size: 8 });

    try {
      assert.equal(pool.getSize(), 1);
      assert.equal(pool.stats().walEnabled, false);
    } finally {
      pool.close();
    }
  });

  await t.test("clamps and defaults the configured size", () => {
    const { path, cleanup } = makeTempDbPath();

    try {
      assert.equal(new SqliteConnectionPool(path).getSize(), DEFAULT_SQLITE_POOL_SIZE);
      assert.equal(
        new SqliteConnectionPool(path, { size: 1000 }).getSize(),
        MAX_SQLITE_POOL_SIZE,
      );
      assert.equal(
        new SqliteConnectionPool(path, { size: 0 }).getSize(),
        DEFAULT_SQLITE_POOL_SIZE,
      );
      assert.equal(
        new SqliteConnectionPool(path, { size: -3 }).getSize(),
        DEFAULT_SQLITE_POOL_SIZE,
      );
    } finally {
      cleanup();
    }
  });

  await t.test("rejects borrows after close", async () => {
    const { path, cleanup } = makeTempDbPath();
    const pool = new SqliteConnectionPool(path, { size: 1 });
    pool.close();

    try {
      await assert.rejects(pool.acquire(), /closed/);
      assert.throws(() => pool.acquireSync(), /closed/);
    } finally {
      cleanup();
    }
  });

  await t.test("shares one pool per database path", () => {
    const { path, cleanup } = makeTempDbPath();

    try {
      const first = getSqlitePool(path, { size: 2 });
      const second = getSqlitePool(path);

      assert.equal(first, second, "same path resolves to the same pool");
      assert.equal(second.getSize(), 2, "later callers join the existing pool");
    } finally {
      closeAllSqlitePools();
      cleanup();
    }
  });
});
