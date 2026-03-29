import { Router } from "express";
import type { TransactionsService } from "./transactions.service.js";
import { getTransactionsController } from "./transactions.controller.js";

/**
 * Creates the transactions router.
 *
 * @param service           TransactionsService instance
 * @param defaultContractId Fallback contract ID when none is provided in the query
 */
export function createTransactionsRouter(
  service: TransactionsService,
  defaultContractId: string,
) {
  const router = Router();

  /**
   * GET /api/v1/transactions
   * Returns paginated transaction history for the vault contract.
   *
   * Query parameters:
   * - contractId: string (optional, defaults to env CONTRACT_ID)
   * - cursor:     string (optional) — paging token for next page
   * - limit:      number (optional, default: 20, max: 200)
   * - order:      "asc" | "desc" (optional, default: "desc")
   */
  router.get("/", getTransactionsController(service, defaultContractId));

  return router;
}
