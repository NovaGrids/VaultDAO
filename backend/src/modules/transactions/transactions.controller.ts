import type { RequestHandler } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import {
  validatePagination,
  validateOptionalString,
  validateLedgerRange,
  validateOptionalDate,
  validateOptionalNumber,
} from "../../shared/http/validateQuery.js";
import type { TransactionsService } from "./transactions.service.js";
import type { CacheAdapter } from "../../shared/cache/cache.adapter.js";

/** TTL for paginated transaction cache: 30 seconds */
const TRANSACTIONS_CACHE_TTL_MS = 30_000;

/**
 * GET /api/v1/transactions
 */
export function getTransactionsController(
  service: TransactionsService,
  defaultContractId: string,
  cache?: CacheAdapter<unknown>,
): RequestHandler {
  return async (request, response) => {
    const pagination = validatePagination(request, response);
    if (!pagination) return;

    const token = validateOptionalString(request, "token");
    const recipient = validateOptionalString(request, "recipient");
    const cursor = validateOptionalString(request, "cursor");
    const from = validateOptionalDate(request, response, "from");
    if (from === null) return;
    const to = validateOptionalDate(request, response, "to");
    if (to === null) return;
    const minAmount = validateOptionalNumber(request, response, "minAmount");
    if (minAmount === null) return;
    const maxAmount = validateOptionalNumber(request, response, "maxAmount");
    if (maxAmount === null) return;

    try {
      const contractId =
        typeof request.query.contractId === "string" &&
        request.query.contractId.trim()
          ? request.query.contractId.trim()
          : defaultContractId;

      const cacheKey = `txns:${contractId}:${token ?? ""}:${recipient ?? ""}:${cursor ?? ""}:${from ?? ""}:${to ?? ""}:${minAmount ?? ""}:${maxAmount ?? ""}:${pagination.limit}`;

      if (cache) {
        const cached = cache.get(cacheKey) as any;
        if (cached !== null) {
          // set cache headers when we stored timestamped entries
          if (cached && cached.cachedAt) {
            response.set("X-Cache", "HIT");
            response.set(
              "X-Cache-Age",
              String(Math.floor((Date.now() - cached.cachedAt) / 1000)),
            );
            response.json(cached.value);
            return;
          }
          response.set("X-Cache", "HIT");
          response.json(cached);
          return;
        }
      }

      const result = await service.getTransactions({
        contractId,
        cursor,
        token,
        recipient,
        from,
        to,
        minAmount,
        maxAmount,
        limit: pagination.limit,
      });

      if (cache) {
        cache.set(
          cacheKey,
          { value: result, cachedAt: Date.now() },
          TRANSACTIONS_CACHE_TTL_MS,
        );
        response.set("X-Cache", "MISS");
      }

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

/**
 * GET /api/v1/transactions/by-proposal/:proposalId
 */
export function getTransactionsByProposalController(
  service: TransactionsService,
  defaultContractId: string,
  cache?: CacheAdapter<unknown>,
): RequestHandler {
  return async (request, response) => {
    try {
      const contractId =
        typeof request.query.contractId === "string" &&
        request.query.contractId.trim()
          ? request.query.contractId.trim()
          : defaultContractId;

      const proposalId = String(request.params.proposalId ?? "");
      if (!proposalId) {
        error(response, {
          message: "proposalId required",
          status: 400,
          code: ErrorCode.VALIDATION_ERROR,
        });
        return;
      }

      const cacheKey = `proposal_txns:${contractId}:${proposalId}`;
      if (cache) {
        const cached = cache.get(cacheKey) as any;
        if (cached) {
          if (cached.cachedAt) {
            response.set("X-Cache", "HIT");
            response.set(
              "X-Cache-Age",
              String(Math.floor((Date.now() - cached.cachedAt) / 1000)),
            );
            response.json(cached.value);
            return;
          }
          response.set("X-Cache", "HIT");
          response.json(cached);
          return;
        }
      }

      const result = await service.getTransactionsByProposal(
        proposalId,
        contractId,
        cache as any,
      );

      if (cache) {
        cache.set(
          cacheKey,
          { value: result, cachedAt: Date.now() },
          5 * 60 * 1000,
        );
        response.set("X-Cache", "MISS");
      }

      success(response, { data: result, total: result.length });
    } catch (err) {
      error(response, {
        message: "Failed to fetch transactions by proposal",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
        details: err instanceof Error ? err.message : undefined,
      });
    }
  };
}

/**
 * GET /api/v1/transactions/:txHash
 */
export function getTransactionByHashController(
  service: TransactionsService,
  defaultContractId: string,
): RequestHandler {
  return async (request, response) => {
    try {
      const contractId =
        typeof request.query.contractId === "string" &&
        request.query.contractId.trim()
          ? request.query.contractId.trim()
          : defaultContractId;
      const txHash = String(request.params.txHash);
      const transaction = await service.getTransactionByHash(
        contractId,
        txHash,
      );

      if (!transaction) {
        error(response, {
          message: "Transaction not found",
          status: 404,
          code: ErrorCode.NOT_FOUND,
        });
        return;
      }

      success(response, transaction);
    } catch (err) {
      error(response, {
        message: "Failed to fetch transaction",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
        details: err instanceof Error ? err.message : undefined,
      });
    }
  };
}

/**
 * Invalidates transaction cache entries for a given contractId.
 * Call this when new transaction events are processed.
 */
export function invalidateTransactionCache(
  cache: CacheAdapter<unknown>,
  contractId: string,
): void {
  cache.deleteByPrefix(`txns:${contractId}:`);
}
