import type { RequestHandler } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import { validatePagination } from "../../shared/http/validateQuery.js";
import { validateCursorPagination } from "../../shared/pagination.js";
import { createLogger } from "../../shared/logging/logger.js";
import type { AuditService } from "./audit.service.js";
import { AuditRpcError, verifyAuditChain, streamAuditCsv } from "./audit.service.js";

const logger = createLogger("audit-controller");

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

    const verify =
      getSingleQueryString(request.query as Record<string, unknown>, "verify") === "true";

    warnIfLegacyPaginationUsed(request.query as Record<string, unknown>);

    // Use cursor pagination when `cursor` param is present or `offset` is absent
    const isCursorMode =
      typeof request.query.cursor === "string" ||
      request.query.offset === undefined;

    if (isCursorMode) {
      const cursorQuery = validateCursorPagination(request, response);
      if (!cursorQuery) return;

      try {
        const page = await service.getAuditTrail(
          contractId,
          cursorQuery.cursor?.offset ?? 0,
          cursorQuery.limit,
          verify,
          typeof request.query.cursor === "string" ? request.query.cursor : null,
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
      return;
    }

    // Legacy offset pagination path
    const pagination = validatePagination(request, response);
    if (!pagination) return;

    try {
      const page = await service.getAuditTrail(
        contractId,
        pagination.offset,
        pagination.limit,
        verify,
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

export function exportAuditCsvController(service: AuditService): RequestHandler {
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
        true,
      );
      streamAuditCsv(response, page.data, page.verification);
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
        message: "Failed to export audit trail",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
      });
    }
  };
}

export function verifyAuditController(service: AuditService): RequestHandler {
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
        false,
      );
      const result = verifyAuditChain(page.data);
      success(response, result);
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
        message: "Failed to verify audit trail",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
      });
    }
  };
}
