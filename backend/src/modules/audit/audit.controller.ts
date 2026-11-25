import type { RequestHandler } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import { validatePagination } from "../../shared/http/validateQuery.js";
import { createLogger } from "../../shared/logging/logger.js";
import type { AuditService } from "./audit.service.js";
import { AuditRpcError, verifyAuditChain, streamAuditCsv } from "./audit.service.js";

const logger = createLogger("audit-controller");

/** Maximum number of audit records a single page may return. */
export const MAX_AUDIT_PAGE_LIMIT = 500;

const DEFAULT_AUDIT_PAGE_LIMIT = 50;

interface AuditCursorQuery {
  after: string | null;
  limit: number;
}

/**
 * Parses and validates the `after`/`limit` query params for the paginated
 * `GET /audit` endpoint. Returns `null` after writing a 400 response when the
 * params are invalid.
 */
function parseAuditCursorQuery(
  request: Parameters<RequestHandler>[0],
  response: Parameters<RequestHandler>[1],
): AuditCursorQuery | null {
  const rawAfter = request.query.after;
  const rawLimit = request.query.limit;

  let after: string | null = null;
  if (rawAfter !== undefined) {
    if (typeof rawAfter !== "string" || rawAfter.length === 0) {
      error(response, {
        message: "after must be a non-empty string cursor",
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
      return null;
    }
    after = rawAfter;
  }

  let limit = DEFAULT_AUDIT_PAGE_LIMIT;
  if (rawLimit !== undefined) {
    if (typeof rawLimit !== "string" || !/^\d+$/.test(rawLimit)) {
      error(response, {
        message: "limit must be a positive integer",
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
      return null;
    }
    const parsed = Number.parseInt(rawLimit, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      error(response, {
        message: "limit must be a positive integer",
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
      return null;
    }
    limit = Math.min(parsed, MAX_AUDIT_PAGE_LIMIT);
  }

  return { after, limit };
}

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
      const cursorQuery = parseAuditCursorQuery(request, response);
      if (!cursorQuery) return;

      // Fetch one extra record to determine whether a next page exists.
      const fetchLimit = cursorQuery.limit + 1;

      try {
        const page = await service.getAuditTrail(
          contractId,
          0,
          fetchLimit,
          verify,
          cursorQuery.after,
        );

        const records = page.data ?? [];
        const hasNextPage = records.length > cursorQuery.limit;
        const items = hasNextPage ? records.slice(0, cursorQuery.limit) : records;
        const nextCursor = hasNextPage
          ? (items[items.length - 1] as { id?: string } | undefined)?.id ?? null
          : null;

        success(response, { items, nextCursor });
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
