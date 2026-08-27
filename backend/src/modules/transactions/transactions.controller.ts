import type { RequestHandler } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import {
  validatePagination,
  validateOptionalString,
  validateOptionalDate,
  validateOptionalNumber,
} from "../../shared/http/validateQuery.js";
import { validateCursorPagination, type CursorPayload } from "../../shared/pagination.js";
import { createLogger } from "../../shared/logging/logger.js";
import type { TransactionsService } from "./transactions.service.js";
import type { CacheAdapter } from "../../shared/cache/cache.adapter.js";

/** TTL for paginated transaction cache: 30 seconds */
const TRANSACTIONS_CACHE_TTL_MS = 30_000;

const logger = createLogger("transactions-controller");

/**
 * Warns when a request uses the legacy `offset`/`page` pagination params so
 * clients can be nudged toward cursor-based pagination (`?cursor=`), which is
 * stable across concurrent inserts/deletes. The legacy request is still
 * served — this is a deprecation notice, not a breaking change.
 */
function warnIfLegacyPaginationUsed(query: Record<string, unknown>): void {
  const legacyPageUsed = query.page !== undefined;
  const legacyOffsetUsed = query.offset !== undefined;
  if (legacyPageUsed || legacyOffsetUsed) {
    logger.warn(
      `Deprecated pagination parameter "${legacyPageUsed ? "page" : "offset"}" used. ` +
        `Offset-based pagination can skip/duplicate items when the underlying list changes ` +
        `between requests — migrate to cursor-based pagination via the "cursor" query parameter.`,
    );
  }
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
    warnIfLegacyPaginationUsed(request.query as Record<string, unknown>);

    // Cursor mode when `cursor` param is present (or `offset` is absent),
    // mirroring the proposals/audit controllers. The service's underlying
    // cursoring mechanism keys off `transactionHash` (its natural keyset id)
    // rather than a raw array index, so we decode the opaque client-facing
    // cursor into a `CursorPayload` and let the service resolve it against
    // its own index — see transactions.service.ts#getTransactions.
    const isCursorMode =
      typeof request.query.cursor === "string" || request.query.offset === undefined;

    let limit: number;
    let cursorPayload: CursorPayload | null = null;

    if (isCursorMode) {
      const cursorQuery = validateCursorPagination(request, response);
      if (!cursorQuery) return;
      limit = cursorQuery.limit;
      cursorPayload = cursorQuery.cursor;
    } else {
      const pagination = validatePagination(request, response);
      if (!pagination) return;
      limit = pagination.limit;
      // Legacy offset requests have no `lastId` to seek by; encode the
      // offset alone so the service's fallback-by-offset path (shared with
      // cursor mode) serves the same page contents an offset-based client
      // expects, without a bespoke offset code path in the service.
      if (pagination.offset > 0) {
        cursorPayload = { lastId: "", offset: pagination.offset, direction: "next" };
      }
    }

    const token = validateOptionalString(request, "token");
    const recipient = validateOptionalString(request, "recipient");
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

      const cursorCacheKey =
        typeof request.query.cursor === "string" ? request.query.cursor : "";
      const cacheKey = `txns:${contractId}:${token ?? ""}:${recipient ?? ""}:${cursorCacheKey}:${from ?? ""}:${to ?? ""}:${minAmount ?? ""}:${maxAmount ?? ""}:${limit}`;

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
        cursor: cursorPayload,
        token,
        recipient,
        from,
        to,
        minAmount,
        maxAmount,
        limit,
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
