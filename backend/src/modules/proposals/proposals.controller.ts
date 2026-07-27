import type { RequestHandler } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import {
  validatePagination,
  validateRequiredString,
  validateCursorPagination,
  encodeCursor,
} from "../../shared/http/validateQuery.js";
import type { ProposalActivityAggregator } from "./aggregator.js";
import type { ProposalActivityPersistence } from "./types.js";
import type { ProposalActivityRecord } from "./types.js";
import type { CacheAdapter } from "../../shared/cache/cache.adapter.js";

/** TTL for proposal list cache: 30 seconds */
const PROPOSALS_CACHE_TTL_MS = 30_000;

export function getAllProposalsController(
  persistence: ProposalActivityPersistence,
  cache?: CacheAdapter<unknown>,
): RequestHandler {
  return async (req, res) => {
    const contractId = validateRequiredString(req, res, "contractId");
    if (!contractId) return;

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

        let startIndex = 0;
        if (cursorQuery.cursor) {
          const { lastId, offset: fallbackOffset } = cursorQuery.cursor;
          // Seek by lastId first; fall back to offset if not found
          const foundIdx = all.findIndex(
            (r: ProposalActivityRecord) => r.activityId === lastId,
          );
          startIndex = foundIdx !== -1 ? foundIdx + 1 : fallbackOffset;
        }

        const endIndex = Math.min(startIndex + cursorQuery.limit, total);
        const data = all.slice(startIndex, endIndex);

        // Build next_cursor if there are more items after this page
        let nextCursor: string | null = null;
        if (endIndex < total) {
          const lastItem = data[data.length - 1];
          if (lastItem) {
            nextCursor = encodeCursor({ lastId: lastItem.activityId, offset: endIndex });
          }
        }

        const payload = {
          data,
          total,
          limit: cursorQuery.limit,
          nextCursor,
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
