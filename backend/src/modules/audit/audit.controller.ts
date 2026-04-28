import type { RequestHandler } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import { validatePagination } from "../../shared/http/validateQuery.js";
import type { AuditService } from "./audit.service.js";
import { AuditRpcError } from "./audit.service.js";

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

export function getAuditController(service: AuditService): RequestHandler {
  return async (request, response) => {
    const contractId = getSingleQueryString(
      request.query as Record<string, unknown>,
      "contractId",
    );

    if (!contractId) {
      error(response, {
        message: "contractId is required",
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
      return;
    }

    const pagination = validatePagination(request, response);
    if (!pagination) return;

    try {
      const page = await service.getAuditTrail(
        contractId,
        pagination.offset,
        pagination.limit,
      );
      success(response, page);
    } catch (err) {
      if (err instanceof AuditRpcError) {
        error(response, {
          message: err.message,
          status: 502,
          code: ErrorCode.INTERNAL_ERROR,
        });
        return;
      }
      error(response, {
        message: "Failed to fetch audit trail",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
      });
    }
  };
}
