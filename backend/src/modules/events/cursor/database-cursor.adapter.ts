import type { StorageAdapter } from "../../../shared/storage/storage.adapter.js";
import type { CursorStorage, EventCursor } from "./cursor.types.js";

/**
 * DatabaseCursorAdapter
 * 
 * Stores event polling cursor in a database for robust persistence.
 * Uses a generic StorageAdapter to decouple the cursor logic from the
 * specific database implementation (SQLite, etc).
 */
export class DatabaseCursorAdapter implements CursorStorage {
  private readonly adapter: StorageAdapter<EventCursor & { id: string }>;
  private static readonly CURSOR_ID = "singleton-cursor";

  constructor(adapter: StorageAdapter<EventCursor & { id: string }>) {
    this.adapter = adapter;
  }

  /**
   * Retrieves the cursor from the database.
   */
  public async getCursor(): Promise<EventCursor | null> {
    try {
      const record = await this.adapter.getById(DatabaseCursorAdapter.CURSOR_ID);
      if (!record) return null;

      // Map back to EventCursor by removing internal ID
      const { id, ...cursor } = record;
      return cursor as EventCursor;
    } catch (error) {
      console.error("[database-cursor] failed to retrieve cursor from database:", error);
      return null;
    }
  }

  /**
   * Saves the cursor to the database.
   */
  public async saveCursor(cursor: EventCursor): Promise<void> {
    try {
      await this.adapter.save({
        ...cursor,
        id: DatabaseCursorAdapter.CURSOR_ID,
      });
    } catch (error) {
      console.error("[database-cursor] failed to save cursor to database:", error);
      throw error;
    }
  }
}
