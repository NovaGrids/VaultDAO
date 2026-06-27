import { Router } from "express";
import type { RequestHandler } from "express";
import type { RecurringIndexerService } from "./recurring.service.js";
import {
  getAllRecurringController,
  getRecurringByIdController,
  getDueWithLookaheadController,
  getOverdueRecurringController,
  getRecurringHistoryController,
  triggerSyncController,
  checkConflictController,
  createRecurringController,
} from "./recurring.controller.js";

/**
 * Creates the recurring payments router with all API endpoints
 */
import type { CacheAdapter } from "../../shared/cache/cache.adapter.js";

export function createRecurringRouter(
  service: RecurringIndexerService,
  authMiddleware?: RequestHandler,
  cache?: CacheAdapter<unknown>,
) {
  const router = Router();

  /**
   * GET /api/v1/recurring/due?lookaheadLedgers=1440
   * Returns payments due within the next lookaheadLedgers ledgers (1–17280, default 1440).
   * Requires authMiddleware.
   */
  if (authMiddleware) {
    router.get("/due", authMiddleware, getDueWithLookaheadController(service));
  } else {
    router.get("/due", getDueWithLookaheadController(service));
  }

  /**
   * POST /api/v1/recurring/sync
   * Triggers a manual sync cycle immediately.
   */
  router.post("/sync", triggerSyncController(service));

  /**
   * POST /api/v1/recurring/check-conflict
   * Returns conflicts for proposed payment params.
   */
  router.post("/check-conflict", checkConflictController(service));

  /**
   * POST /api/v1/recurring
   * Creates a new recurring payment; sets X-Conflict-Warning header if duplicates found.
   * Use ?force=true to bypass.
   */
  router.post("/", createRecurringController(service));

  /**
   * GET /api/v1/recurring
   */
  router.get("/", getAllRecurringController(service, cache));
  
  /**
   * GET /api/v1/recurring/overdue
   * Returns only overdue payments sorted by most-overdue first
   */
  router.get("/overdue", getOverdueRecurringController(service, cache));
  
  /**
   * GET /api/v1/recurring/:id
   */
  router.get("/:paymentId", getRecurringByIdController(service, cache));
  
  /**
   * GET /api/v1/recurring/:id/history
   * Returns execution history from indexed events
   */
  router.get("/:paymentId/history", getRecurringHistoryController(service, cache));

  return router;
}
