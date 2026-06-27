/**
 * EventCursor
 * 
 * Represents the last successfully processed point in the blockchain.
 */
export interface EventCursor {
  readonly lastLedger: number;
  readonly lastEventId?: string;
  readonly updatedAt: string;
}

/**
 * CursorStorage
 * 
 * Interface for different persistence strategies (file, db, redis, etc.)
 */
export interface CursorStorage {
  /**
   * Retrieves the last saved cursor.
   * Returns null if no cursor exists (e.g. first run).
   */
  getCursor(): Promise<EventCursor | null>;

  /**
   * Persists a new cursor.
   */
  saveCursor(cursor: EventCursor): Promise<void>;

  /**
   * Lists all stored cursors with their IDs.
   * Used by the cleanup job to find stale cursors.
   */
  listCursors(): Promise<Array<{ id: string; cursor: EventCursor }>>;

  /**
   * Deletes a cursor by its ID.
   * Used by the cleanup job to remove stale cursors.
   */
  deleteCursor(id: string): Promise<void>;
}
