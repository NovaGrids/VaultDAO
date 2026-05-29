import { createLogger } from "../../../shared/logging/logger.js";
import type { FileCursorAdapter } from "./file-cursor.adapter.js";
import type { DatabaseCursorAdapter } from "./database-cursor.adapter.js";

const logger = createLogger("cursor-migration");

/**
 * Migrates existing file-based cursors to the database on first startup.
 *
 * The migration is one-time and idempotent:
 * - If the database already has a cursor for the given key, the file cursor
 *   is NOT overwritten (database wins).
 * - The source file is NOT deleted after migration — it is kept as a backup.
 *
 * @param fileAdapter  Source: file-based cursor adapter.
 * @param dbAdapter    Destination: database cursor adapter.
 * @param key          Cursor key to use in the database (defaults to "singleton-cursor").
 */
export async function migrateFileCursorToDatabase(
  fileAdapter: FileCursorAdapter,
  dbAdapter: DatabaseCursorAdapter,
  key = "singleton-cursor",
): Promise<void> {
  try {
    // Check if database already has a cursor for this key — if so, skip.
    const existing = await dbAdapter.get(key);
    if (existing !== null) {
      logger.info("cursor already exists in database, skipping migration", { key });
      return;
    }

    // Read from file.
    const fileCursor = await fileAdapter.getCursor();
    if (fileCursor === null) {
      logger.info("no file cursor found, nothing to migrate", { key });
      return;
    }

    // Write to database.
    await dbAdapter.set(key, fileCursor);
    logger.info("cursor migrated from file to database", {
      key,
      lastLedger: fileCursor.lastLedger,
      updatedAt: fileCursor.updatedAt,
    });
    // NOTE: The source file is intentionally kept as a backup.
  } catch (err) {
    logger.error("cursor migration failed", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    // Non-fatal: the service can still start without a migrated cursor.
  }
}
