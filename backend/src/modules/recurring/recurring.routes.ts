import { Router } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { validate } from "../../shared/validate.middleware.js";
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
  predictRecurringDuesController,
} from "./recurring.controller.js";

/**
 * Creates the recurring payments router with all API endpoints
 */
import type { CacheAdapter } from "../../shared/cache/cache.adapter.js";

// ============================================================================
// Issue #1165: Zod request validation schemas, co-located with the routes
// that use them.
// ============================================================================

/** GET /api/v1/recurring/due?lookaheadLedgers=1440 */
const dueQuerySchema = z.object({
  lookaheadLedgers: z.coerce.number().int().min(1).max(17280).optional(),
});

/** GET /api/v1/recurring/predict?windowLedgers=<n>[&currentLedger=<n>] */
const predictQuerySchema = z.object({
  windowLedgers: z.coerce.number().int().min(1).max(1_048_576),
  currentLedger: z.coerce.number().int().min(0).optional(),
});

/** POST /api/v1/recurring/check-conflict body: { recipient, amount, intervalLedgers } */
const checkConflictBodySchema = z.object({
  recipient: z.string().min(1, "recipient is required"),
  amount: z.union([z.string(), z.number()]),
  intervalLedgers: z.number().int().positive(),
});

/** POST /api/v1/recurring body: { recipient, amount?, intervalLedgers? } */
const createRecurringBodySchema = z.object({
  recipient: z.string().min(1, "recipient is required"),
  amount: z.union([z.string(), z.number()]).optional(),
  intervalLedgers: z.number().int().positive().optional(),
});

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
    router.get("/due", authMiddleware, validate(dueQuerySchema, "query"), getDueWithLookaheadController(service));
  } else {
    router.get("/due", validate(dueQuerySchema, "query"), getDueWithLookaheadController(service));
  }

  /**
   * POST /api/v1/recurring/sync
   * Triggers a manual sync cycle immediately.
   */
  router.post("/sync", triggerSyncController(service));

  /**
   * GET /api/v1/recurring/predict?windowLedgers=<n>[&currentLedger=<n>]
   * Projects the next due dates for active/due payments within windowLedgers.
   * Emits a RECURRING_PREDICTION_QUERIED audit event at query time.
   */
  router.get("/predict", validate(predictQuerySchema, "query"), predictRecurringDuesController(service));

  /**
   * POST /api/v1/recurring/check-conflict
   * Returns conflicts for proposed payment params.
   */
  router.post("/check-conflict", validate(checkConflictBodySchema), checkConflictController(service));

  /**
   * POST /api/v1/recurring
   * Creates a new recurring payment; sets X-Conflict-Warning header if duplicates found.
   * Use ?force=true to bypass.
   */
  router.post("/", validate(createRecurringBodySchema), createRecurringController(service));

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
