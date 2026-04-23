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
}
