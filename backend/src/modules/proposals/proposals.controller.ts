import type { RequestHandler } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import { validatePagination } from "../../shared/http/validateQuery.js";
import type { ProposalActivityAggregator } from "./aggregator.js";
import type { ProposalActivityPersistence } from "./types.js";

export function getAllProposalsController(
  persistence: ProposalActivityPersistence,
): RequestHandler {
  return async (req, res) => {
    const contractId = typeof req.query.contractId === "string" ? req.query.contractId : undefined;
    if (!contractId) {
      error(res, { message: "contractId is required", status: 400, code: ErrorCode.BAD_REQUEST });
      return;
    }

    const pagination = validatePagination(req, res);
    if (!pagination) return;

    try {
      const all = await persistence.getByContractId(contractId);
      const total = all.length;
      const data = all.slice(pagination.offset, pagination.offset + pagination.limit);
      success(res, { data, total, offset: pagination.offset, limit: pagination.limit });
    } catch (err) {
      error(res, { message: "Failed to fetch proposals", status: 500, code: ErrorCode.INTERNAL_ERROR });
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
        error(res, { message: "Proposal not found", status: 404, code: ErrorCode.NOT_FOUND });
        return;
      }
      success(res, summary);
    } catch (err) {
      error(res, { message: "Failed to fetch proposal", status: 500, code: ErrorCode.INTERNAL_ERROR });
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
        error(res, { message: "Proposal not found", status: 404, code: ErrorCode.NOT_FOUND });
        return;
      }
      success(res, { data: records, total: records.length });
    } catch (err) {
      error(res, { message: "Failed to fetch proposal activity", status: 500, code: ErrorCode.INTERNAL_ERROR });
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
      error(res, { message: "Failed to fetch proposal statistics", status: 500, code: ErrorCode.INTERNAL_ERROR });
    }
  };
}
