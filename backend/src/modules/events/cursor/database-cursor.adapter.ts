import type { StorageAdapter } from "../../../shared/storage/storage.adapter.js";
import type { CursorStorage, EventCursor } from "./cursor.types.js";
import { createLogger } from "../../../shared/logging/logger.js";

const logger = createLogger("database-cursor");

/**
 * DatabaseCursorAdapter
 *
 * Stores event polling cursors in a database for robust persistence across
 * container restarts. Uses a generic StorageAdapter to decouple cursor logic
 * from the specific database implementation (SQLite, etc).
 *
 * Supports multi-key cursors (one per contract / poller instance) as well as
 * the legacy singleton-cursor pattern used by the original file adapter.
 *
 * The underlying storage record shape is:
 *   { id: string; lastLedger: number; lastEventId?: string; updatedAt: string }
 *
 * WAL mode is enabled at the SqliteStorageAdapter level when the adapter is
 * constructed with a WAL-enabled DatabaseSync instance.
 */
export class DatabaseCursorAdapter implements CursorStorage {
  private static readonly SINGLETON_ID = "singleton-cursor";

  constructor(
    private readonly adapter: StorageAdapter<EventCursor & { id: string }>,
  ) {}

  // ── CursorStorage interface (singleton / legacy) ──────────────────────────

  /**
   * Retrieves the singleton cursor from the database.
   */
  public async getCursor(): Promise<EventCursor | null> {
    return this.get(DatabaseCursorAdapter.SINGLETON_ID);
  }

  /**
   * Saves the singleton cursor to the database.
   */
  public async saveCursor(cursor: EventCursor): Promise<void> {
    return this.set(DatabaseCursorAdapter.SINGLETON_ID, cursor);
  }

  /**
   * Lists all stored cursors with their IDs and last-updated timestamps.
   */
  public async listCursors(): Promise<Array<{ id: string; cursor: EventCursor }>> {
    return this.list();
  }

  /**
   * Deletes a cursor by its ID.
   */
  public async deleteCursor(id: string): Promise<void> {
    return this.delete(id);
  }

  // ── Multi-key API ─────────────────────────────────────────────────────────

  /**
   * Retrieve a cursor by key. Returns null if not found.
   */
  public async get(key: string): Promise<EventCursor | null> {
    try {
      const record = await this.adapter.getById(key);
      if (!record) return null;
      const { id: _id, ...cursor } = record;
      return cursor as EventCursor;
    } catch (err) {
      logger.error("failed to retrieve cursor", {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Persist a cursor under the given key.
   */
  public async set(key: string, cursor: EventCursor): Promise<void> {
    try {
      await this.adapter.save({ ...cursor, id: key });
    } catch (err) {
      logger.error("failed to save cursor", {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Delete a cursor by key.
   */
  public async delete(key: string): Promise<void> {
    try {
      await this.adapter.delete(key);
    } catch (err) {
      logger.error("failed to delete cursor", {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * List all stored cursors with their IDs and last-updated timestamps.
   */
  public async list(): Promise<Array<{ id: string; cursor: EventCursor }>> {
    try {
      const records = await this.adapter.getAll();
      return records.map(({ id, ...cursor }) => ({
        id,
        cursor: cursor as EventCursor,
      }));
    } catch (err) {
      logger.error("failed to list cursors", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }
}
