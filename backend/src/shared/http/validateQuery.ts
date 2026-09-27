import type { Request, Response } from "express";

import { error } from "./response.js";
import { ErrorCode } from "./errorCodes.js";
import { getFirstQueryString } from "../pagination.js";

// ============================================================================
// Pagination (offset + cursor based)
// ============================================================================
// The pagination utilities used to live in this file. They now live in
// `../pagination.ts` so that they can be shared/imported without pulling in
// the rest of the query-validation helpers below. Re-exported here so
// existing call sites that import them from `validateQuery.js` keep working
// unchanged.
export {
  DEFAULT_PAGINATION_LIMIT,
  MAX_PAGINATION_LIMIT,
  type PaginationQuery,
  type CursorDirection,
  type CursorPayload,
  type CursorPaginationQuery,
  type CursorWindowResult,
  encodeCursor,
  decodeCursor,
  parseCursorPagination,
  validateCursorPagination,
  resolveIndexCursorWindow,
  buildCursorWindow,
  parsePaginationParams,
  validatePagination,
} from "../pagination.js";

/**
 * Validates an optional enum query param. Omits → `undefined`. Invalid → **400** and `null`.
 */
export function validateEnum<T extends string>(
  req: Request,
  res: Response,
  param: string,
  allowed: readonly T[]
): T | undefined | null {
  const raw = getFirstQueryString(req.query, param);
  if (raw === undefined || raw === "") {
    return undefined;
  }
  if (!allowed.includes(raw as T)) {
    error(res, {
      message: `Invalid ${param}: must be one of: ${allowed.join(", ")}`,
      status: 400,
      code: ErrorCode.BAD_REQUEST,
    });
    return null;
  }
  return raw as T;
}

/**
 * Validates a required string query param. Missing/empty → **400** and `null`.
 */
export function validateRequiredString(
  req: Request,
  res: Response,
  param: string
): string | null {
  const raw = getFirstQueryString(req.query, param);
  if (raw === undefined || raw === "") {
    error(res, {
      message: `Missing required parameter: ${param}`,
      status: 400,
      code: ErrorCode.BAD_REQUEST,
    });
    return null;
  }
  return raw;
}

/**
 * Validates an optional string query param. Omits → `undefined`.
 */
export function validateOptionalString(
  req: Request,
  param: string
): string | undefined {
  const raw = getFirstQueryString(req.query, param);
  if (raw === undefined || raw === "") {
    return undefined;
  }
  return raw;
}

/**
 * Validates an optional ISO8601 date query param.
 * Omits → `undefined`. Invalid → **400** and `null`.
 */
export function validateOptionalDate(
  req: Request,
  res: Response,
  param: string
): Date | undefined | null {
  const raw = getFirstQueryString(req.query, param);
  if (raw === undefined || raw === "") {
    return undefined;
  }
  
  const date = new Date(raw);
  if (isNaN(date.getTime())) {
    error(res, {
      message: `Invalid ${param}: expected ISO8601 date format, received "${raw}"`,
      status: 400,
      code: ErrorCode.BAD_REQUEST,
    });
    return null;
  }
  
  return date;
}

/**
 * Validates an optional numeric query param with range constraints.
 * Omits → `undefined`. Invalid → **400** and `null`.
 */
export function validateOptionalNumber(
  req: Request,
  res: Response,
  param: string,
  options: { min?: number; max?: number } = {}
): number | undefined | null {
  const raw = getFirstQueryString(req.query, param);
  if (raw === undefined || raw === "") {
    return undefined;
  }

  const n = Number(raw);
  if (!Number.isFinite(n)) {
    error(res, {
      message: `Invalid ${param}: expected a number, received "${raw}"`,
      status: 400,
      code: ErrorCode.BAD_REQUEST,
    });
    return null;
  }

  if (options.min !== undefined && n < options.min) {
    error(res, {
      message: `Invalid ${param}: must be at least ${options.min}`,
      status: 400,
      code: ErrorCode.BAD_REQUEST,
    });
    return null;
  }

  if (options.max !== undefined && n > options.max) {
    error(res, {
      message: `Invalid ${param}: must be at most ${options.max}`,
      status: 400,
      code: ErrorCode.BAD_REQUEST,
    });
    return null;
  }

  return n;
}

/**
 * Validates an optional integer query param with range constraints.
 * Omits → `undefined`. Invalid → **400** and `null`.
 */
export function validateOptionalInteger(
  req: Request,
  res: Response,
  param: string,
  options: { min?: number; max?: number } = {}
): number | undefined | null {
  const raw = getFirstQueryString(req.query, param);
  if (raw === undefined || raw === "") {
    return undefined;
  }

  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    error(res, {
      message: `Invalid ${param}: expected an integer, received "${raw}"`,
      status: 400,
      code: ErrorCode.BAD_REQUEST,
    });
    return null;
  }

  if (options.min !== undefined && n < options.min) {
    error(res, {
      message: `Invalid ${param}: must be at least ${options.min}`,
      status: 400,
      code: ErrorCode.BAD_REQUEST,
    });
    return null;
  }

  if (options.max !== undefined && n > options.max) {
    error(res, {
      message: `Invalid ${param}: must be at most ${options.max}`,
      status: 400,
      code: ErrorCode.BAD_REQUEST,
    });
    return null;
  }

  return n;
}

/**
 * Validates an optional boolean query param.
 * Accepts: "true", "false", "1", "0"
 * Omits → `undefined`. Invalid → **400** and `null`.
 */
export function validateOptionalBoolean(
  req: Request,
  res: Response,
  param: string
): boolean | undefined | null {
  const raw = getFirstQueryString(req.query, param);
  if (raw === undefined || raw === "") {
    return undefined;
  }

  if (raw === "true" || raw === "1") {
    return true;
  }
  if (raw === "false" || raw === "0") {
    return false;
  }

  error(res, {
    message: `Invalid ${param}: expected "true", "false", "1", or "0", received "${raw}"`,
    status: 400,
    code: ErrorCode.BAD_REQUEST,
  });
  return null;
}

/**
 * Validates a ledger range (from/to parameters).
 * Both optional, but if both present, from must be ≤ to.
 */
export function validateLedgerRange(
  req: Request,
  res: Response
): { from?: number; to?: number } | null {
  const from = validateOptionalInteger(req, res, "from", { min: 0 });
  if (from === null) return null;

  const to = validateOptionalInteger(req, res, "to", { min: 0 });
  if (to === null) return null;

  if (from !== undefined && to !== undefined && from > to) {
    error(res, {
      message: "Invalid ledger range: from must be less than or equal to to",
      status: 400,
      code: ErrorCode.BAD_REQUEST,
    });
    return null;
  }

  return { from, to };
}
