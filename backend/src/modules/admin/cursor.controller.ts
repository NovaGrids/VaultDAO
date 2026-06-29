import type { RequestHandler } from "express";
import { error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import type { DatabaseCursorAdapter } from "../events/cursor/database-cursor.adapter.js";
import { FileCursorAdapter } from "../events/cursor/file-cursor.adapter.js";
import { migrateFileCursorToDatabase } from "../events/cursor/cursor-migration.js";

export function triggerCursorMigrationController(
  dbAdapter?: DatabaseCursorAdapter
): RequestHandler {
  return async (_req, res) => {
    if (!dbAdapter) {
      error(res, {
        message: "Database cursor adapter is not configured",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
      });
      return;
    }

    try {
      const fileAdapter = new FileCursorAdapter();
      await migrateFileCursorToDatabase(fileAdapter, dbAdapter);

      const cursor = await dbAdapter.getCursor();
      res.status(200).json({
        success: true,
        data: {
          migrated: true,
          cursor,
        },
      });
    } catch (err) {
      error(res, {
        message: err instanceof Error ? err.message : "Migration failed",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
      });
    }
  };
}

export function rollbackCursorMigrationController(
  dbAdapter?: DatabaseCursorAdapter
): RequestHandler {
  return async (_req, res) => {
    if (!dbAdapter) {
      error(res, {
        message: "Database cursor adapter is not configured",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
      });
      return;
    }

    try {
      await dbAdapter.deleteCursor("singleton-cursor");
      res.status(200).json({
        success: true,
        data: {
          rolledBack: true,
        },
      });
    } catch (err) {
      error(res, {
        message: err instanceof Error ? err.message : "Rollback failed",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
      });
    }
  };
}
