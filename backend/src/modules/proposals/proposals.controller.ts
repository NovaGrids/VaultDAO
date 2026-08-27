import type { RequestHandler } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import {
  validatePagination,
  validateRequiredString,
} from "../../shared/http/validateQuery.js";
import {
  validateCursorPagination,
  resolveIndexCursorWindow,
  buildCursorWindow,
} from "../../shared/pagination.js";
import { createLogger } from "../../shared/logging/logger.js";
import type { ProposalActivityAggregator } from "./aggregator.js";
import type { ProposalActivityPersistence } from "./types.js";
import type { ProposalActivityRecord } from "./types.js";
import type { CacheAdapter } from "../../shared/cache/cache.adapter.js";

/** TTL for proposal list cache: 30 seconds */
const PROPOSALS_CACHE_TTL_MS = 30_000;

const logger = createLogger("proposals-controller");

/**
 * Warns when a request uses the legacy `offset`/`page` pagination params so
 * clients can be nudged toward cursor-based pagination (`?cursor=`), which is
 * stable across concurrent inserts/deletes. The legacy request is still
 * served — this is a deprecation notice, not a breaking change.
 */
function warnIfLegacyPaginationUsed(req: { query: Record<string, unknown> }): void {
  const legacyPageUsed = req.query.page !== undefined;
  const legacyOffsetUsed = req.query.offset !== undefined;
  if (legacyPageUsed || legacyOffsetUsed) {
    logger.warn(
      `Deprecated pagination parameter "${legacyPageUsed ? "page" : "offset"}" used. ` +
        `Offset-based pagination can skip/duplicate items when the underlying list changes ` +
        `between requests — migrate to cursor-based pagination via the "cursor" query parameter.`,
    );
  }
}

export function getAllProposalsController(
  persistence: ProposalActivityPersistence,
  cache?: CacheAdapter<unknown>,
): RequestHandler {
  return async (req, res) => {
    const contractId = validateRequiredString(req, res, "contractId");
    if (!contractId) return;

    warnIfLegacyPaginationUsed(req as unknown as { query: Record<string, unknown> });

    // Support cursor-based pagination when `cursor` param is present (or `limit`
    // alone is provided without `offset`), and fall back to offset pagination.
    const isCursorMode =
      typeof req.query.cursor === "string" || req.query.offset === undefined;

    if (isCursorMode) {
      const cursorQuery = validateCursorPagination(req, res);
      if (!cursorQuery) return;

      const cacheKey = `proposals:cursor:${contractId}:${req.query.cursor ?? ""}:${cursorQuery.limit}`;

      try {
        if (cache) {
          const cached = cache.get(cacheKey);
          if (cached !== null) {
            res.json(cached);
            return;
          }
        }

        const all = await persistence.getByContractId(contractId);
        const total = all.length;

        const { startIndex, endIndex, direction } = resolveIndexCursorWindow({
          items: all,
          cursor: cursorQuery.cursor,
          limit: cursorQuery.limit,
          getId: (r: ProposalActivityRecord) => r.activityId,
        });
        const data = all.slice(startIndex, endIndex);

        const { nextCursor, prevCursor, hasMore } = buildCursorWindow({
          startIndex,
          endIndex,
          total,
          direction,
          firstId: data[0]?.activityId,
          lastId: data[data.length - 1]?.activityId,
        });

        const payload = {
          data,
          total,
          limit: cursorQuery.limit,
          nextCursor,
          prevCursor,
          hasMore,
        };

        if (cache) {
          cache.set(cacheKey, { ok: true, data: payload }, PROPOSALS_CACHE_TTL_MS);
        }

        success(res, payload);
      } catch (err) {
        error(res, {
          message: "Failed to fetch proposals",
          status: 500,
          code: ErrorCode.INTERNAL_ERROR,
        });
      }
      return;
    }

    // Legacy offset pagination path (backward compatible)
    const pagination = validatePagination(req, res);
    if (!pagination) return;

    const cacheKey = `proposals:${contractId}:${pagination.offset}:${pagination.limit}`;

    try {
      if (cache) {
        const cached = cache.get(cacheKey);
        if (cached !== null) {
          res.json(cached);
          return;
        }
      }

      const all = await persistence.getByContractId(contractId);
      const total = all.length;
      const data = all.slice(
        pagination.offset,
        pagination.offset + pagination.limit,
      );
      const payload = {
        data,
        total,
        offset: pagination.offset,
        limit: pagination.limit,
      };

      if (cache) {
        cache.set(
          cacheKey,
          { ok: true, data: payload },
          PROPOSALS_CACHE_TTL_MS,
        );
      }

      success(res, payload);
    } catch (err) {
      error(res, {
        message: "Failed to fetch proposals",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
      });
    }
  };
}

export function getProposalByIdController(
  persistence: ProposalActivityPersistence,
): RequestHandler {
  return async (req, res) => {
    try {
      const proposalId = String(req.params.proposalId ?? "");
      const summary = await persistence.getSummary(proposalId);
      if (!summary) {
        error(res, {
          message: "Proposal not found",
          status: 404,
          code: ErrorCode.NOT_FOUND,
        });
        return;
      }
      success(res, summary);
    } catch (err) {
      error(res, {
        message: "Failed to fetch proposal",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
      });
    }
  };
}

export function getProposalActivityController(
  persistence: ProposalActivityPersistence,
): RequestHandler {
  return async (req, res) => {
    try {
      const proposalId = String(req.params.proposalId ?? "");
      const records = await persistence.getByProposalId(proposalId);
      if (records.length === 0) {
        error(res, {
          message: "Proposal not found",
          status: 404,
          code: ErrorCode.NOT_FOUND,
        });
        return;
      }
      success(res, { data: records, total: records.length });
    } catch (err) {
      error(res, {
        message: "Failed to fetch proposal activity",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
      });
    }
  };
}

export function getProposalStatsController(
  aggregator: ProposalActivityAggregator,
): RequestHandler {
  return (_req, res) => {
    try {
      success(res, aggregator.getStats());
    } catch (err) {
      error(res, {
        message: "Failed to fetch proposal statistics",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
      });
    }
  };
}

/**
 * Invalidates all proposal cache entries for a given contractId.
 * Call this when new proposal events are processed.
 */
export function invalidateProposalCache(
  cache: CacheAdapter<unknown>,
  contractId: string,
): void {
  cache.deleteByPrefix(`proposals:${contractId}:`);
}
