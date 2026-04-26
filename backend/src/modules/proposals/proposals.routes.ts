import { Router } from "express";
import type { ProposalActivityAggregator } from "./aggregator.js";
import type { ProposalActivityPersistence } from "./types.js";
import {
  getAllProposalsController,
  getProposalByIdController,
  getProposalActivityController,
  getProposalStatsController,
} from "./proposals.controller.js";

export function createProposalsRouter(
  aggregator: ProposalActivityAggregator,
  persistence: ProposalActivityPersistence,
) {
  const router = Router();

  // WARNING: /stats must be registered before /:proposalId
  router.get("/stats", getProposalStatsController(aggregator));
  router.get("/", getAllProposalsController(persistence));
  router.get("/:proposalId", getProposalByIdController(persistence));
  router.get("/:proposalId/activity", getProposalActivityController(persistence));

  return router;
}
