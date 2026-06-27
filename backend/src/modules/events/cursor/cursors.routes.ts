import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { DatabaseCursorAdapter } from "./database-cursor.adapter.js";
import { success } from "../../../shared/http/response.js";

/**
 * GET /api/v1/cursors
 *
 * Admin-only endpoint that lists all stored cursors with their last-updated
 * timestamps. Requires the admin auth middleware to be applied by the caller.
 */
export function createCursorsRouter(
  adapter: DatabaseCursorAdapter,
  adminAuthMiddleware: (req: Request, res: Response, next: NextFunction) => void,
) {
  const router = Router();

  router.get("/", adminAuthMiddleware, async (_req: Request, res: Response) => {
    const cursors = await adapter.list();
    success(res, {
      cursors: cursors.map(({ id, cursor }) => ({
        id,
        lastLedger: cursor.lastLedger,
        lastEventId: cursor.lastEventId ?? null,
        updatedAt: cursor.updatedAt,
      })),
      total: cursors.length,
    });
  });

  return router;
}
