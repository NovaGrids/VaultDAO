import type { RequestHandler } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import { validatePagination, validateRequiredString } from "../../shared/http/validateQuery.js";
import type { ProposalActivityAggregator } from "./aggregator.js";
import type { ProposalActivityPersistence } from "./types.js";
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
      const summary = await persistence.getSummary(req.params.proposalId);
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
      const records = await persistence.getByProposalId(req.params.proposalId);
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
