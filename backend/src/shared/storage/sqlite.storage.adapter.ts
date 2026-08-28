import type { DatabaseSync } from "node:sqlite";
import type { StorageAdapter } from "./storage.adapter.js";
import {
  type SqlitePoolStats,
  SqliteConnectionPool,
  getSqlitePool,
} from "./sqlite-pool.js";

/**
 * SQLite-backed storage adapter using Node.js built-in `node:sqlite`.
 *
 * Schema: a single table with `id TEXT PRIMARY KEY` and `data TEXT` (JSON).
 * Filtering is done in-process after deserialisation — sufficient for the
 * record volumes VaultDAO handles.
 *
 * Connections come from the shared, WAL-mode pool for the database path rather
 * than being opened per adapter or per request, so concurrent callers reuse a
 * bounded set of handles instead of contending on fresh ones.
 */
export class SqliteStorageAdapter<T extends { id: string }>
  implements StorageAdapter<T>
{
  private readonly pool: SqliteConnectionPool;
  private readonly table: string;
  /** Whether this adapter created the pool and is therefore free to close it. */
  private readonly ownsPool: boolean;

  constructor(
    dbPath: string,
    table: string,
    options: { poolSize?: number; pool?: SqliteConnectionPool } = {},
  ) {
    this.table = table;
    this.pool = options.pool ?? getSqlitePool(dbPath, { size: options.poolSize });
    this.ownsPool = options.pool === undefined;

    // Schema creation is synchronous and must complete before the first query,
    // so it borrows a connection directly rather than going through the async
    // withConnection path.
    this.withConnectionSync((db) => {
      db.exec(
        `CREATE TABLE IF NOT EXISTS "${table}" (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
      );
    });
  }

  /**
   * Borrow a connection for a synchronous unit of work.
   *
   * `node:sqlite` is synchronous throughout, so the borrow never spans an
   * await and the connection is always returned on the same tick — including
   * when `fn` throws.
   */
  private withConnectionSync<R>(fn: (db: DatabaseSync) => R): R {
    return this.pool.borrowSync(fn);
  }

  private get(
    sql: string,
    ...params: unknown[]
  ): { id: string; data: string } | undefined {
    return this.withConnectionSync(
      (db) =>
        db.prepare(sql).get(...(params as [])) as
          | { id: string; data: string }
          | undefined,
    );
  }

  private run(sql: string, ...params: unknown[]): void {
    this.withConnectionSync((db) => db.prepare(sql).run(...(params as [])));
  }

  async getAll(filter?: Record<string, unknown>): Promise<T[]> {
    const rows = this.withConnectionSync((db) =>
      db.prepare(`SELECT data FROM "${this.table}"`).all() as {
        id: string;
        data: string;
      }[],
    );
    let results = rows.map((r) => JSON.parse(r.data) as T);

    if (filter) {
      results = results.filter((record) =>
        Object.entries(filter).every(
          ([k, v]) => (record as Record<string, unknown>)[k] === v,
        ),
      );
    }

    return results;
  }

  async getById(id: string): Promise<T | null> {
    const row = this.get(`SELECT data FROM "${this.table}" WHERE id = ?`, id);
    return row ? (JSON.parse(row.data) as T) : null;
  }

  async save(record: T): Promise<void> {
    this.run(
      `INSERT INTO "${this.table}" (id, data) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      record.id,
      JSON.stringify(record),
    );
  }

  async saveMany(records: T[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    // One borrow and one prepared statement for the whole batch, wrapped in a
    // transaction so the batch costs a single WAL commit instead of N.
    this.withConnectionSync((db) => {
      const insert = db.prepare(
        `INSERT INTO "${this.table}" (id, data) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      );

      db.exec("BEGIN");
      try {
        for (const record of records) {
          insert.run(record.id, JSON.stringify(record));
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  async delete(id: string): Promise<void> {
    this.run(`DELETE FROM "${this.table}" WHERE id = ?`, id);
  }

  async exists(id: string): Promise<boolean> {
    const row = this.get(`SELECT 1 FROM "${this.table}" WHERE id = ?`, id);
    return row !== undefined;
  }

  async count(filter?: Record<string, unknown>): Promise<number> {
    if (!filter) {
      const row = this.get(
        `SELECT COUNT(*) as n FROM "${this.table}"`,
      ) as unknown as { n: number } | undefined;
      return row?.n ?? 0;
    }
    return (await this.getAll(filter)).length;
  }

  async clear(): Promise<void> {
    this.run(`DELETE FROM "${this.table}"`);
  }

  /** Pool utilisation, for diagnostics and the load test. */
  poolStats(): SqlitePoolStats {
    return this.pool.stats();
  }

  /**
   * Close the underlying pool.
   *
   * A no-op when the pool was injected, since its lifetime belongs to whoever
   * created it — closing a shared pool here would break every other adapter
   * using the same database.
   */
  close(): void {
    if (this.ownsPool) {
      this.pool.close();
    }
  }
}
