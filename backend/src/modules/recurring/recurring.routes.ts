import { Router } from "express";
import type { RecurringIndexerService } from "./recurring.service.js";
import {
  getAllRecurringController,
  getRecurringByIdController,
  getDueRecurringController,
} from "./recurring.controller.js";

/**
 * Creates the recurring payments router with all API endpoints
 */
export function createRecurringRouter(service: RecurringIndexerService) {
  const router = Router();

  /**
   * GET /api/v1/recurring/due
   * Returns all payments that are currently due.
   */
  router.get("/due", getDueRecurringController(service));

  /**
   * GET /api/v1/recurring
   * Returns all recurring payments with optional status filter.
   *
   * Query parameters:
   * - status: 'active' | 'due' | 'cancelled' (optional) - filter by status
   */
  router.get("/", getAllRecurringController(service));

  /**
   * GET /api/v1/recurring/:id
   * Returns a single recurring payment by ID.
   */
  router.get("/:id", getRecurringByIdController(service));

  return router;
}
