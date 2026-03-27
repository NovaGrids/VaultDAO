import { Router } from "express";
import type { ProposalActivityAggregator } from "./aggregator.js";
import {
  getAllProposalsController,
  getProposalByIdController,
  getProposalStatsController,
} from "./proposals.controller.js";

/**
 * Creates the proposals router with all API endpoints
 */
export function createProposalsRouter(aggregator: ProposalActivityAggregator) {
  const router = Router();

  /**
   * GET /api/v1/proposals/stats
   * Returns aggregated statistics about all proposals.
   */
  router.get("/stats", getProposalStatsController(aggregator));

  /**
   * GET /api/v1/proposals
   * Returns a paginated list of all proposals with their latest status.
   *
   * Query parameters:
   * - offset: number (default: 0) - pagination offset
   * - limit: number (default: 100) - pagination limit
   */
  router.get("/", getAllProposalsController(aggregator));

  /**
   * GET /api/v1/proposals/:id
   * Returns the activity summary for a specific proposal.
   */
  router.get("/:id", getProposalByIdController(aggregator));

  return router;
}
