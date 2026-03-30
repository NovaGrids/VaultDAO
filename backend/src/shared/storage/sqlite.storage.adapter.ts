import { DatabaseSync } from "node:sqlite";
import type { StorageAdapter } from "./storage.adapter.js";

/**
 * SQLite-backed storage adapter using Node.js built-in `node:sqlite`.
 *
 * Schema: a single table with `id TEXT PRIMARY KEY` and `data TEXT` (JSON).
 * Filtering is done in-process after deserialisation — sufficient for the
 * record volumes VaultDAO handles.
 */
export class SqliteStorageAdapter<T extends { id: string }>
  implements StorageAdapter<T>
{
  private readonly db: DatabaseSync;

  constructor(dbPath: string, table: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS "${table}" (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
    );

    // Bind all methods to the table name via a closure so we don't repeat it.
    const run = (sql: string, ...params: unknown[]) =>
      this.db.prepare(sql).run(...(params as []));
    const all = (sql: string, ...params: unknown[]) =>
      this.db.prepare(sql).all(...(params as [])) as { id: string; data: string }[];
    const get = (sql: string, ...params: unknown[]) =>
      this.db.prepare(sql).get(...(params as [])) as
        | { id: string; data: string }
        | undefined;

    this._run = run;
    this._all = all;
    this._get = get;
    this._table = table;
  }

  private readonly _run: (sql: string, ...p: unknown[]) => unknown;
  private readonly _all: (sql: string, ...p: unknown[]) => { id: string; data: string }[];
  private readonly _get: (sql: string, ...p: unknown[]) => { id: string; data: string } | undefined;
  private readonly _table: string;

  async getAll(filter?: Record<string, unknown>): Promise<T[]> {
    const rows = this._all(`SELECT data FROM "${this._table}"`);
    let results = rows.map((r) => JSON.parse(r.data) as T);

    if (filter) {
      results = results.filter((record) =>
        Object.entries(filter).every(([k, v]) => (record as Record<string, unknown>)[k] === v),
      );
    }

    return results;
  }

  async getById(id: string): Promise<T | null> {
    const row = this._get(`SELECT data FROM "${this._table}" WHERE id = ?`, id);
    return row ? (JSON.parse(row.data) as T) : null;
  }

  async save(record: T): Promise<void> {
    this._run(
      `INSERT INTO "${this._table}" (id, data) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      record.id,
      JSON.stringify(record),
    );
  }

  async saveMany(records: T[]): Promise<void> {
    const insert = this.db.prepare(
      `INSERT INTO "${this._table}" (id, data) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    );
    for (const record of records) {
      insert.run(record.id, JSON.stringify(record));
    }
  }

  async delete(id: string): Promise<void> {
    this._run(`DELETE FROM "${this._table}" WHERE id = ?`, id);
  }

  async exists(id: string): Promise<boolean> {
    const row = this._get(`SELECT 1 FROM "${this._table}" WHERE id = ?`, id);
    return row !== undefined;
  }

  async count(filter?: Record<string, unknown>): Promise<number> {
    if (!filter) {
      const row = this._get(`SELECT COUNT(*) as n FROM "${this._table}"`) as unknown as { n: number };
      return row?.n ?? 0;
    }
    return (await this.getAll(filter)).length;
  }

  async clear(): Promise<void> {
    this._run(`DELETE FROM "${this._table}"`);
  }

  /** Close the underlying database connection. */
  close(): void {
    this.db.close();
  }
}
