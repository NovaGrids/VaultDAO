import { Router } from "express";
import { z } from "zod";
import { validate } from "../../shared/validate.middleware.js";
import type { ProposalActivityAggregator } from "./aggregator.js";
import type { ProposalActivityPersistence } from "./types.js";
import {
  getAllProposalsController,
  getProposalByIdController,
  getProposalActivityController,
  getProposalStatsController,
} from "./proposals.controller.js";

// Issue #1165: this module exposes no POST/PUT/PATCH endpoints (it is a
// read-only activity/aggregation API), so there are no request-body schemas
// to add here — only the `:proposalId` path param is validated.
const proposalIdParamsSchema = z.object({
  proposalId: z.string().min(1, "proposalId is required"),
});

export function createProposalsRouter(
  aggregator: ProposalActivityAggregator,
  persistence: ProposalActivityPersistence,
) {
  const router = Router();

  // WARNING: /stats must be registered before /:proposalId
  router.get("/stats", getProposalStatsController(aggregator));
  router.get("/", getAllProposalsController(persistence));
  router.get(
    "/:proposalId",
    validate(proposalIdParamsSchema, "params"),
    getProposalByIdController(persistence),
  );
  router.get(
    "/:proposalId/activity",
    validate(proposalIdParamsSchema, "params"),
    getProposalActivityController(persistence),
  );

  return router;
}
