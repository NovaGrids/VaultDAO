import type { RequestHandler } from "express";
import { success, error } from "../../shared/http/response.js";
import type { ProposalActivityAggregator } from "./aggregator.js";

/**
 * Get all proposals with pagination
 */
export function getAllProposalsController(
  aggregator: ProposalActivityAggregator,
): RequestHandler {
  return (request, response) => {
    try {
      const offset = request.query.offset
        ? parseInt(String(request.query.offset), 10)
        : undefined;
      const limit = request.query.limit
        ? parseInt(String(request.query.limit), 10)
        : undefined;

      const result = aggregator.getAllProposals({ offset, limit });
      success(response, result);
    } catch (err) {
      error(response, {
        message: "Failed to fetch proposals",
        status: 500,
        details: err instanceof Error ? err.message : undefined,
      });
    }
  };
}

/**
 * Get a single proposal by ID
 */
export function getProposalByIdController(
  aggregator: ProposalActivityAggregator,
): RequestHandler {
  return (request, response) => {
    try {
      const id = String(request.params.id);

      const summary = aggregator.getSummary(id);
      if (!summary) {
        error(response, { message: "Proposal not found", status: 404 });
        return;
      }

      success(response, summary);
    } catch (err) {
      error(response, {
        message: "Failed to fetch proposal",
        status: 500,
        details: err instanceof Error ? err.message : undefined,
      });
    }
  };
}

/**
 * Get aggregated proposal statistics
 */
export function getProposalStatsController(
  aggregator: ProposalActivityAggregator,
): RequestHandler {
  return (_request, response) => {
    try {
      const stats = aggregator.getStats();
      success(response, stats);
    } catch (err) {
      error(response, {
        message: "Failed to fetch proposal statistics",
        status: 500,
        details: err instanceof Error ? err.message : undefined,
      });
    }
  };
}
