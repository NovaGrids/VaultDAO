import { SqliteStorageAdapter } from "../../../shared/storage/sqlite.storage.adapter.js";
import { DatabaseCursorAdapter } from "./database-cursor.adapter.js";
import type { CursorStorage, EventCursor } from "./cursor.types.js";

/**
 * SQLite-backed events cursor (Issue #2037).
 *
 * Persists the last processed ledger / cursor in SQLite so indexer progress
 * survives process restarts. Implements the same {@link CursorStorage}
 * interface as the file cursor, replacing it for local/dev.
 */
export class SqliteCursorAdapter implements CursorStorage {
  private readonly inner: DatabaseCursorAdapter;

  constructor(dbPath: string, table = "event_cursors") {
    this.inner = new DatabaseCursorAdapter(
      new SqliteStorageAdapter<EventCursor & { id: string }>(dbPath, table),
    );
  }

  public getCursor(): Promise<EventCursor | null> {
    return this.inner.getCursor();
  }

  public saveCursor(cursor: EventCursor): Promise<void> {
    return this.inner.saveCursor(cursor);
  }

  public listCursors(): Promise<Array<{ id: string; cursor: EventCursor }>> {
    return this.inner.listCursors();
  }

  public deleteCursor(id: string): Promise<void> {
    return this.inner.deleteCursor(id);
  }
}
