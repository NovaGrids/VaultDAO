import type { Request, Response } from "express";

import { error } from "./response.js";
import { ErrorCode } from "./errorCodes.js";

/** Default `limit` when the query param is omitted. */
export const DEFAULT_PAGINATION_LIMIT = 20;

/** Maximum allowed `limit` after parsing (explicit values above this are capped). */
export const MAX_PAGINATION_LIMIT = 100;

export interface PaginationQuery {
  offset: number;
  limit: number;
}

function getFirstQueryString(
  query: Request["query"],
  key: string
): string | undefined {
  const v = query[key];
  if (v === undefined) return undefined;
  if (Array.isArray(v)) {
    const first = v[0];
    return typeof first === "string" ? first : undefined;
  }
  return typeof v === "string" ? v : undefined;
}

/**
 * Parses `offset` and `limit` from `req.query` (no side effects).
 * - `offset` defaults to 0; must be a non-negative integer when present.
 * - `limit` defaults to {@link DEFAULT_PAGINATION_LIMIT}; when present must be an integer ≥ 1, capped at {@link MAX_PAGINATION_LIMIT}.
 */
export function parsePaginationParams(
  query: Request["query"]
): { ok: true; value: PaginationQuery } | { ok: false; message: string } {
  const offsetRaw = getFirstQueryString(query, "offset");
  const limitRaw = getFirstQueryString(query, "limit");

  let offset: number;
  if (offsetRaw === undefined || offsetRaw === "") {
    offset = 0;
  } else {
    const n = Number(offsetRaw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return {
        ok: false,
        message: `Invalid offset: expected a non-negative integer, received "${offsetRaw}"`,
      };
    }
    if (n < 0) {
      return {
        ok: false,
        message: "Invalid offset: must be greater than or equal to 0",
      };
    }
    offset = n;
  }

  let limit: number;
  if (limitRaw === undefined || limitRaw === "") {
    limit = DEFAULT_PAGINATION_LIMIT;
  } else {
    const n = Number(limitRaw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return {
        ok: false,
        message: `Invalid limit: expected a positive integer, received "${limitRaw}"`,
      };
    }
    if (n < 1) {
      return {
        ok: false,
        message: "Invalid limit: must be at least 1",
      };
    }
    limit = Math.min(n, MAX_PAGINATION_LIMIT);
  }

  return { ok: true, value: { offset, limit } };
}

/**
 * Validates pagination query params and responds with **400** on failure.
 * @returns `{ offset, limit }` or `null` if a response was already sent.
 */
export function validatePagination(
  req: Request,
  res: Response
): PaginationQuery | null {
  const parsed = parsePaginationParams(req.query);
  if (!parsed.ok) {
    error(res, { message: parsed.message, status: 400, code: ErrorCode.BAD_REQUEST });
    return null;
  }
  return parsed.value;
}

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
