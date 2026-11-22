/**
 * Postgres schema migrations.
 *
 * Mirrors the SQLite migration runner (`../migrations.ts`) but is safe for
 * several replicas starting at once: the whole run holds a session-level
 * advisory lock, so exactly one process applies pending migrations while the
 * others wait and then find nothing left to do.
 */

import { createLogger } from "../../logging/logger.js";
import type { PgPool, PgPoolClient } from "./pg-pool.js";

const logger = createLogger("postgres-migrations");

/** Advisory lock key held while migrating (arbitrary, stable 64-bit value). */
export const PG_MIGRATION_LOCK_KEY = 7_202_604_401;

/** How long a replica waits for another replica's migration run. */
export const PG_MIGRATION_LOCK_TIMEOUT_MS = 120_000;

export interface PostgresMigration {
  readonly id: string;
  readonly up: string;
  readonly down: string;
}

/**
 * Key/value tables used by the storage adapters. Each row is
 * `(id TEXT PRIMARY KEY, data JSONB)`, matching the SQLite adapter's
 * `(id TEXT PRIMARY KEY, data TEXT)` shape, plus an insertion sequence so
 * `getAll()` returns rows in insertion order like SQLite's rowid order.
 */
export const PG_STORAGE_TABLES = [
  "event_cursors",
  "proposal_activity",
  "snapshots",
  "jobs",
  "replay_proposal_projections",
  "replay_recurring_projections",
] as const;

export function kvTableDdl(quotedTable: string): string {
  return `CREATE TABLE IF NOT EXISTS ${quotedTable} (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    seq BIGSERIAL NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
}

/** Ordered list of migrations. Append new ones; never edit applied ones. */
export const postgresMigrations: PostgresMigration[] = [
  {
    id: "001_initial_schema",
    up: `
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_type ON events (type);
      CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at);
    `,
    down: `
      DROP INDEX IF EXISTS idx_events_created_at;
      DROP INDEX IF EXISTS idx_events_type;
      DROP TABLE IF EXISTS events;
    `,
  },
  {
    id: "002_storage_kv_tables",
    up: PG_STORAGE_TABLES.map((t) => `${kvTableDdl(`"${t}"`)};`).join("\n"),
    down: PG_STORAGE_TABLES.map((t) => `DROP TABLE IF EXISTS "${t}";`).join("\n"),
  },
  {
    id: "003_dual_write_mismatches",
    up: `
      CREATE TABLE IF NOT EXISTS storage_dual_write_mismatches (
        id BIGSERIAL PRIMARY KEY,
        table_name TEXT NOT NULL,
        record_id TEXT NOT NULL,
        primary_hash TEXT,
        secondary_hash TEXT,
        detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_dual_write_mismatches_table
        ON storage_dual_write_mismatches (table_name, detected_at);
    `,
    down: `
      DROP INDEX IF EXISTS idx_dual_write_mismatches_table;
      DROP TABLE IF EXISTS storage_dual_write_mismatches;
    `,
  },
];

const MIGRATIONS_TABLE = "schema_migrations";

async function ensureMigrationsTable(client: PgPoolClient): Promise<void> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      applied_at BIGINT NOT NULL
    )`,
  );
}

async function withMigrationLock<R>(
  pool: PgPool,
  fn: (client: PgPoolClient) => Promise<R>,
): Promise<R> {
  const client = await pool.connect();
  try {
    // DDL and waiting for another replica's migration can outlast the pool's
    // per-statement timeout, so lift it for this session and bound the wait
    // for the lock instead. RESET restores the pool defaults before release.
    await client.query("SET statement_timeout = 0");
    await client.query(`SET lock_timeout = ${Math.floor(PG_MIGRATION_LOCK_TIMEOUT_MS)}`);
    await client.query("SELECT pg_advisory_lock($1)", [PG_MIGRATION_LOCK_KEY]);
    try {
      return await fn(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [PG_MIGRATION_LOCK_KEY]);
    }
  } finally {
    try {
      await client.query("RESET statement_timeout");
      await client.query("RESET lock_timeout");
      client.release();
    } catch (error) {
      // Never hand a connection with altered timeouts back to the pool.
      client.release(error instanceof Error ? error : true);
    }
  }
}

export interface PostgresMigrationResult {
  readonly applied: string[];
  readonly currentVersion: string | null;
}

/**
 * Applies pending migrations in order, each in its own transaction, under
 * the migration advisory lock.
 */
export async function runPostgresMigrations(
  pool: PgPool,
  migrations: readonly PostgresMigration[] = postgresMigrations,
): Promise<PostgresMigrationResult> {
  return withMigrationLock(pool, async (client) => {
    await ensureMigrationsTable(client);
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM ${MIGRATIONS_TABLE}`,
    );
    const done = new Set(rows.map((r) => r.id));
    const applied: string[] = [];

    for (const migration of migrations) {
      if (done.has(migration.id)) continue;
      await client.query("BEGIN");
      try {
        await client.query(migration.up);
        await client.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (id, applied_at) VALUES ($1, $2)`,
          [migration.id, Date.now()],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(
          `Postgres migration ${migration.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      applied.push(migration.id);
      logger.info("applied postgres migration", { id: migration.id });
    }

    const last = migrations.filter((m) => done.has(m.id) || applied.includes(m.id)).at(-1);
    return { applied, currentVersion: last?.id ?? null };
  });
}

/**
 * Rolls back the most recently applied migration (rollback path for a failed
 * cutover). Returns its id, or null when nothing is applied.
 */
export async function rollbackLastPostgresMigration(
  pool: PgPool,
  migrations: readonly PostgresMigration[] = postgresMigrations,
): Promise<string | null> {
  return withMigrationLock(pool, async (client) => {
    await ensureMigrationsTable(client);
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM ${MIGRATIONS_TABLE} ORDER BY applied_at DESC, id DESC LIMIT 1`,
    );
    const lastId = rows[0]?.id;
    if (!lastId) return null;

    const migration = migrations.find((m) => m.id === lastId);
    if (!migration) {
      throw new Error(
        `Cannot roll back unknown Postgres migration "${lastId}": no matching migration definition found`,
      );
    }

    await client.query("BEGIN");
    try {
      await client.query(migration.down);
      await client.query(`DELETE FROM ${MIGRATIONS_TABLE} WHERE id = $1`, [lastId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    logger.info("rolled back postgres migration", { id: lastId });
    return lastId;
  });
}
