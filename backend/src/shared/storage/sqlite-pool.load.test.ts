/**
 * SQLite Connection Pool — Load Test
 *
 * Compares the old behaviour (a fresh `DatabaseSync` handle per request) with
 * the pooled, WAL-mode path under 50 concurrent requests, and asserts the
 * pool improves P95 latency.
 *
 * The comparison is run against the same on-disk database and the same
 * workload, so the only variable is how the connection is obtained.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteConnectionPool } from "./sqlite-pool.js";

/** Concurrent request count the issue calls for. */
const CONCURRENCY = 50;

/** Rounds of 50 concurrent requests, so P95 is drawn from a real sample. */
const ROUNDS = 10;

/** Absolute ceiling for the pooled P95. Generous — CI machines are noisy. */
const POOLED_P95_CEILING_MS = 50;

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)]!;
}

function makeTempDbPath(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "vaultdao-pool-load-"));
  return {
    path: join(dir, "load.sqlite"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * A representative mixed request: one write and one read, the shape of the
 * per-request database work the backend actually does.
 */
function doRequestWork(db: DatabaseSync, id: number): void {
  db.prepare(
    `INSERT INTO records (id, data) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
  ).run(`record-${id}`, JSON.stringify({ id, at: Date.now() }));

  db.prepare("SELECT data FROM records WHERE id = ?").get(`record-${id}`);
}

/** The old path: open a connection, use it, close it — once per request. */
function connectionPerRequest(path: string, id: number): void {
  const db = new DatabaseSync(path);
  try {
    doRequestWork(db, id);
  } finally {
    db.close();
  }
}

async function measure(
  request: (id: number) => void | Promise<void>,
): Promise<number[]> {
  const latencies: number[] = [];

  for (let round = 0; round < ROUNDS; round++) {
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async (_unused, i) => {
        const id = round * CONCURRENCY + i;
        const start = performance.now();
        await request(id);
        latencies.push(performance.now() - start);
      }),
    );
  }

  return latencies;
}

test("SQLite pool under 50 concurrent requests", async (t) => {
  const { path, cleanup } = makeTempDbPath();

  // Seed the schema once, outside the measured section.
  const setup = new DatabaseSync(path);
  setup.exec("PRAGMA journal_mode = WAL");
  setup.exec(
    "CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, data TEXT NOT NULL)",
  );
  setup.close();

  const pool = new SqliteConnectionPool(path, { size: 4 });

  t.after(() => {
    pool.close();
    cleanup();
  });

  // Warm up both paths so neither pays first-call costs in the measurement.
  await measure((id) => connectionPerRequest(path, id));
  await measure((id) => pool.withConnection((db) => doRequestWork(db, id)));

  const perRequestLatencies = await measure((id) =>
    connectionPerRequest(path, id),
  );
  const pooledLatencies = await measure((id) =>
    pool.withConnection((db) => doRequestWork(db, id)),
  );

  const perRequestP95 = percentile(perRequestLatencies, 95);
  const pooledP95 = percentile(pooledLatencies, 95);

  t.diagnostic(
    `P95 over ${ROUNDS * CONCURRENCY} requests at concurrency ${CONCURRENCY}: ` +
      `connection-per-request ${perRequestP95.toFixed(2)}ms, ` +
      `pooled ${pooledP95.toFixed(2)}ms`,
  );

  await t.test("issues every request without error", () => {
    assert.equal(pooledLatencies.length, ROUNDS * CONCURRENCY);
    assert.equal(perRequestLatencies.length, ROUNDS * CONCURRENCY);
  });

  await t.test("caps open connections at the pool size", () => {
    const stats = pool.stats();
    assert.ok(
      stats.open <= stats.size,
      `pool opened ${stats.open} connections for a size of ${stats.size}`,
    );
    assert.equal(stats.inUse, 0, "every connection was released");
    assert.equal(stats.walEnabled, true);
  });

  await t.test("improves P95 latency versus a connection per request", () => {
    assert.ok(
      pooledP95 < perRequestP95,
      `expected pooled P95 (${pooledP95.toFixed(2)}ms) to beat ` +
        `connection-per-request P95 (${perRequestP95.toFixed(2)}ms)`,
    );
  });

  await t.test("keeps P95 under the absolute ceiling", () => {
    assert.ok(
      pooledP95 < POOLED_P95_CEILING_MS,
      `pooled P95 was ${pooledP95.toFixed(2)}ms, ceiling is ${POOLED_P95_CEILING_MS}ms`,
    );
  });
});
