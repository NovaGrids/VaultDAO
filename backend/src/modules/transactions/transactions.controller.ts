import type { RequestHandler } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import type { TransactionsService } from "./transactions.service.js";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 20;

/**
 * GET /api/v1/transactions
 *
 * Query parameters:
 * - contractId: string (optional, falls back to env default passed at construction)
 * - cursor:     string (optional) — paging token from a previous response
 * - limit:      number (optional, default: 20, max: 200)
 * - order:      "asc" | "desc" (optional, default: "desc")
 */
export function getTransactionsController(
  service: TransactionsService,
  defaultContractId: string,
): RequestHandler {
  return async (request, response) => {
    try {
      const contractId =
        typeof request.query.contractId === "string" && request.query.contractId.trim()
          ? request.query.contractId.trim()
          : defaultContractId;

      const cursor =
        typeof request.query.cursor === "string" && request.query.cursor.trim()
          ? request.query.cursor.trim()
          : undefined;

      const rawLimit = request.query.limit ? parseInt(String(request.query.limit), 10) : DEFAULT_LIMIT;
      const limit = Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, MAX_LIMIT)
        : DEFAULT_LIMIT;

      const rawOrder = String(request.query.order ?? "desc");
      const order: "asc" | "desc" = rawOrder === "asc" ? "asc" : "desc";

      const result = await service.getTransactions({ contractId, cursor, limit, order });
      success(response, result);
    } catch (err) {
      error(response, {
        message: "Failed to fetch transaction history",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
        details: err instanceof Error ? err.message : undefined,
      });
    }
  };
}
