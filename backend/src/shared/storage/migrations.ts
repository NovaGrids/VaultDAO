import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  id: string;
  up: (db: DatabaseSync) => void;
  down: (db: DatabaseSync) => void;
}

/**
 * Ordered list of migrations. Append new migrations to the end.
 * Each migration must have a unique, stable `id`.
 */
export const migrations: Migration[] = [
  {
    id: '001_initial_schema',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_events_type ON events (type);
        CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at);
      `);
    },
    down: (db: DatabaseSync) => {
      db.exec(`
        DROP INDEX IF EXISTS idx_events_created_at;
        DROP INDEX IF EXISTS idx_events_type;
        DROP TABLE IF EXISTS events;
      `);
    },
  },
];

const MIGRATIONS_TABLE = 'schema_migrations';

function ensureMigrationsTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
}

function getAppliedMigrationIds(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare(`SELECT id FROM ${MIGRATIONS_TABLE} ORDER BY id ASC`)
    .all() as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

/**
 * Runs all pending migrations in order. Each migration is applied within a
 * transaction and recorded in the `schema_migrations` table. Already-applied
 * migrations are skipped.
 */
export interface MigrationResult {
  applied: string[];
  currentVersion: string | null;
}

export function runMigrations(db: DatabaseSync): MigrationResult {
  ensureMigrationsTable(db);

  const applied = getAppliedMigrationIds(db);
  const recordMigration = db.prepare(
    `INSERT INTO ${MIGRATIONS_TABLE} (id, applied_at) VALUES (?, ?)`,
  );

  const appliedNow: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }

    // node:sqlite has no transaction helper; wrap the migration body in an
    // explicit transaction so a failed `up` cannot leave a half-applied
    // schema with its record still unwritten.
    db.exec("BEGIN");
    try {
      migration.up(db);
      recordMigration.run(migration.id, Date.now());
      db.exec("COMMIT");
      appliedNow.push(migration.id);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    applied: appliedNow,
    currentVersion: appliedNow.at(-1) ?? [...applied].at(-1) ?? null,
  };
}

/**
 * Rolls back the most recently applied migration. Returns the id of the
 * rolled-back migration, or `null` if there are no applied migrations.
 */
export function rollbackLastMigration(db: DatabaseSync): string | null {
  ensureMigrationsTable(db);

  const last = db
    .prepare(
      `SELECT id FROM ${MIGRATIONS_TABLE} ORDER BY applied_at DESC, id DESC LIMIT 1`,
    )
    .get() as { id: string } | undefined;

  if (!last) {
    return null;
  }

  const migration = migrations.find((m) => m.id === last.id);
  if (!migration) {
    throw new Error(
      `Cannot roll back unknown migration "${last.id}": no matching migration definition found`,
    );
  }

  db.exec("BEGIN");
  try {
    migration.down(db);
    db.prepare(`DELETE FROM ${MIGRATIONS_TABLE} WHERE id = ?`).run(last.id);
    db.exec("COMMIT");
  } catch (rollbackError) {
    db.exec("ROLLBACK");
    throw rollbackError;
  }
  return last.id;
}