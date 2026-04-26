import type { RequestHandler } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import { validatePagination } from "../../shared/http/validateQuery.js";
import type { TransactionsService } from "./transactions.service.js";
import type { CacheAdapter } from "../../shared/cache/cache.adapter.js";

/** TTL for paginated transaction cache: 30 seconds */
const TRANSACTIONS_CACHE_TTL_MS = 30_000;

function getSingleQueryString(
  query: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = query[key];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? first : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

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

    const token = getSingleQueryString(
      request.query as Record<string, unknown>,
      "token",
    );
    const recipient = getSingleQueryString(
      request.query as Record<string, unknown>,
      "recipient",
    );
    const fromRaw = getSingleQueryString(
      request.query as Record<string, unknown>,
      "from",
    );
    const toRaw = getSingleQueryString(
      request.query as Record<string, unknown>,
      "to",
    );

    let from: number | undefined;
    if (fromRaw !== undefined && fromRaw !== "") {
      const parsed = Number(fromRaw);
      if (!Number.isInteger(parsed) || parsed < 0) {
        error(response, {
          message: `Invalid from: expected a non-negative integer, received "${fromRaw}"`,
          status: 400,
          code: ErrorCode.BAD_REQUEST,
        });
        return;
      }
      from = parsed;
    }

    let to: number | undefined;
    if (toRaw !== undefined && toRaw !== "") {
      const parsed = Number(toRaw);
      if (!Number.isInteger(parsed) || parsed < 0) {
        error(response, {
          message: `Invalid to: expected a non-negative integer, received "${toRaw}"`,
          status: 400,
          code: ErrorCode.BAD_REQUEST,
        });
        return;
      }
      to = parsed;
    }

    if (from !== undefined && to !== undefined && from > to) {
      error(response, {
        message: "Invalid ledger range: from must be less than or equal to to",
        status: 400,
        code: ErrorCode.BAD_REQUEST,
      });
      return;
    }

    try {
      const contractId =
        typeof request.query.contractId === "string" &&
        request.query.contractId.trim()
          ? request.query.contractId.trim()
          : defaultContractId;

      const cacheKey = `txns:${contractId}:${token ?? ""}:${recipient ?? ""}:${from ?? ""}:${to ?? ""}:${pagination.offset}:${pagination.limit}`;

      if (cache) {
        const cached = cache.get(cacheKey);
        if (cached !== null) {
          response.json(cached);
          return;
        }
      }

      const result = await service.getTransactions({
        contractId,
        token,
        recipient,
        from,
        to,
        limit: pagination.limit,
        offset: pagination.offset,
      });

      if (cache) {
        cache.set(
          cacheKey,
          { ok: true, data: result },
          TRANSACTIONS_CACHE_TTL_MS,
        );
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
