import { createHash } from "node:crypto";
import type { StorageAdapter } from "../storage.adapter.js";
import { kvTableDdl } from "./postgres-migrations.js";
import {
  type PgPool,
  type PgPoolStats,
  pgPoolStats,
  quoteIdent,
  withPgTransaction,
} from "./pg-pool.js";

/** Advisory lock key serialising lazy `CREATE TABLE` across replicas. */
const PG_SCHEMA_LOCK_KEY = 7_202_604_402;

/** Postgres truncates identifiers at 63 bytes. */
const PG_MAX_IDENTIFIER = 63;

/**
 * Maps a logical table name onto a valid Postgres identifier.
 *
 * Per-contract tables such as `event_cursors_<56-char contract id>` exceed
 * Postgres' 63-byte identifier limit, and silent truncation would make two
 * contracts share a table. Long names keep a readable prefix plus a hash of
 * the full name so the mapping is deterministic and collision-resistant.
 */
export function pgTableName(table: string): string {
  if (table.length <= PG_MAX_IDENTIFIER) return table;
  const digest = createHash("sha256").update(table).digest("hex").slice(0, 16);
  return `${table.slice(0, PG_MAX_IDENTIFIER - digest.length - 1)}_${digest}`;
}

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/**
 * Postgres-backed storage adapter.
 *
 * Implements the same {@link StorageAdapter} contract as the SQLite adapter
 * so cursors, proposals, snapshots and jobs can move between backends
 * without touching business logic. Schema: `(id TEXT PRIMARY KEY, data
 * JSONB, seq BIGSERIAL, updated_at TIMESTAMPTZ)`.
 *
 * Unlike SQLite, Postgres supports many concurrent writers: there is no
 * database-level write lock, and every upsert is a single atomic statement,
 * so concurrent replicas never see `SQLITE_BUSY`-style errors.
 *
 * Primitive equality filters are pushed down as JSONB containment
 * (`data @> '{"k": v}'`); object/array filter values are applied in-process
 * with the same strict-equality semantics as the SQLite adapter.
 */
export class PostgresStorageAdapter<T extends { id: string }>
  implements StorageAdapter<T>
{
  private readonly table: string;
  private readonly ready: Promise<void>;

  constructor(
    private readonly pool: PgPool,
    table: string,
    options: { ensureSchema?: boolean } = {},
  ) {
    this.table = quoteIdent(pgTableName(table));
    this.ready =
      options.ensureSchema === false ? Promise.resolve() : this.ensureSchema();
    // Surface schema errors on first use instead of as an unhandled rejection.
    this.ready.catch(() => undefined);
  }

  private async ensureSchema(): Promise<void> {
    // Concurrent `CREATE TABLE IF NOT EXISTS` from several replicas can still
    // race on Postgres' catalog; the transaction-scoped advisory lock makes
    // creation strictly one-at-a-time.
    await withPgTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [PG_SCHEMA_LOCK_KEY]);
      await client.query(kvTableDdl(this.table));
    });
  }

  /** Resolves once the backing table exists. */
  public whenReady(): Promise<void> {
    return this.ready;
  }

  private splitFilter(filter?: Record<string, unknown>): {
    pushdown: Record<string, unknown> | null;
    inProcess: Array<[string, unknown]>;
  } {
    if (!filter) return { pushdown: null, inProcess: [] };
    const pushdown: Record<string, unknown> = {};
    const inProcess: Array<[string, unknown]> = [];
    for (const [k, v] of Object.entries(filter)) {
      if (v === undefined) {
        // SQLite/in-memory adapters compare `record[k] === undefined`.
        inProcess.push([k, v]);
      } else if (isPrimitive(v)) {
        pushdown[k] = v;
      } else {
        inProcess.push([k, v]);
      }
    }
    return {
      pushdown: Object.keys(pushdown).length > 0 ? pushdown : null,
      inProcess,
    };
  }

  async getAll(filter?: Record<string, unknown>): Promise<T[]> {
    await this.ready;
    const { pushdown, inProcess } = this.splitFilter(filter);
    const { rows } = pushdown
      ? await this.pool.query<{ data: T }>(
          `SELECT data FROM ${this.table} WHERE data @> $1::jsonb ORDER BY seq`,
          [JSON.stringify(pushdown)],
        )
      : await this.pool.query<{ data: T }>(
          `SELECT data FROM ${this.table} ORDER BY seq`,
        );
    let results = rows.map((r) => r.data);
    if (inProcess.length > 0) {
      results = results.filter((record) =>
        inProcess.every(([k, v]) => (record as Record<string, unknown>)[k] === v),
      );
    }
    return results;
  }

  async getById(id: string): Promise<T | null> {
    await this.ready;
    const { rows } = await this.pool.query<{ data: T }>(
      `SELECT data FROM ${this.table} WHERE id = $1`,
      [id],
    );
    return rows[0]?.data ?? null;
  }

  async save(record: T): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO ${this.table} (id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = now()`,
      [record.id, JSON.stringify(record)],
    );
  }

  async saveMany(records: T[]): Promise<void> {
    if (records.length === 0) return;
    await this.ready;

    // Later duplicates win, matching sequential upserts in SQLite; a single
    // multi-row INSERT may not touch the same id twice.
    const latest = new Map<string, T>();
    for (const record of records) latest.set(record.id, record);
    const unique = Array.from(latest.values());

    await withPgTransaction(this.pool, async (client) => {
      const CHUNK = 500;
      for (let i = 0; i < unique.length; i += CHUNK) {
        const chunk = unique.slice(i, i + CHUNK);
        const params: unknown[] = [];
        const values = chunk.map((record, j) => {
          params.push(record.id, JSON.stringify(record));
          return `($${j * 2 + 1}, $${j * 2 + 2}::jsonb)`;
        });
        await client.query(
          `INSERT INTO ${this.table} (id, data) VALUES ${values.join(", ")}
           ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = now()`,
          params,
        );
      }
    });
  }

  async delete(id: string): Promise<void> {
    await this.ready;
    await this.pool.query(`DELETE FROM ${this.table} WHERE id = $1`, [id]);
  }

  async exists(id: string): Promise<boolean> {
    await this.ready;
    const { rows } = await this.pool.query(
      `SELECT 1 FROM ${this.table} WHERE id = $1`,
      [id],
    );
    return rows.length > 0;
  }

  async count(filter?: Record<string, unknown>): Promise<number> {
    await this.ready;
    const { pushdown, inProcess } = this.splitFilter(filter);
    if (inProcess.length > 0) {
      return (await this.getAll(filter)).length;
    }
    const { rows } = pushdown
      ? await this.pool.query<{ n: string }>(
          `SELECT COUNT(*) AS n FROM ${this.table} WHERE data @> $1::jsonb`,
          [JSON.stringify(pushdown)],
        )
      : await this.pool.query<{ n: string }>(
          `SELECT COUNT(*) AS n FROM ${this.table}`,
        );
    // COUNT(*) is BIGINT, which `pg` returns as a string.
    return Number(rows[0]?.n ?? 0);
  }

  async clear(): Promise<void> {
    await this.ready;
    await this.pool.query(`DELETE FROM ${this.table}`);
  }

  /** Lists every id in insertion order (used by verification / backfill). */
  async listIds(): Promise<string[]> {
    await this.ready;
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM ${this.table} ORDER BY seq`,
    );
    return rows.map((r) => r.id);
  }

  /** Pool utilisation, for diagnostics and the load test. */
  poolStats(): PgPoolStats {
    return pgPoolStats(this.pool);
  }
}
