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

// ============================================================================
// Cursor Pagination
// ============================================================================

/**
 * The decoded payload stored inside a base64 cursor token.
 * `lastId`  – opaque string ID of the last item on the previous page.
 * `offset`  – the absolute offset that produced `lastId` (used as fallback
 *             when the ID can no longer be found in the dataset).
 */
export interface CursorPayload {
  lastId: string;
  offset: number;
}

/**
 * Parsed result of a cursor-paginated request.
 * When `cursor` is present the caller should seek by `lastId` first;
 * `offset` is the fallback when the ID lookup fails.
 */
export interface CursorPaginationQuery {
  cursor: CursorPayload | null;
  limit: number;
}

/**
 * Encodes a {@link CursorPayload} to a URL-safe base64 string.
 */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/**
 * Decodes a base64 cursor string.
 * Returns `null` when the token is missing, empty, or malformed – callers
 * should fall back to offset-0 pagination in that case.
 */
export function decodeCursor(raw: string | undefined): CursorPayload | null {
  if (!raw || raw.trim() === "") return null;
  try {
    // Accept both base64url and standard base64
    const json = Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "lastId" in parsed &&
      "offset" in parsed &&
      typeof (parsed as CursorPayload).lastId === "string" &&
      typeof (parsed as CursorPayload).offset === "number" &&
      Number.isFinite((parsed as CursorPayload).offset) &&
      (parsed as CursorPayload).offset >= 0
    ) {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parses `cursor` and `limit` from `req.query`.
 * - `cursor` is optional; invalid cursors are silently treated as absent
 *   (graceful degradation to offset-0).
 * - `limit` follows the same rules as {@link parsePaginationParams}.
 */
export function parseCursorPagination(
  query: Request["query"],
): { ok: true; value: CursorPaginationQuery } | { ok: false; message: string } {
  const limitRaw = getFirstQueryString(query, "limit");
  const cursorRaw = getFirstQueryString(query, "cursor");

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

  // Invalid cursors degrade gracefully to null (offset 0)
  const cursor = decodeCursor(cursorRaw);

  return { ok: true, value: { cursor, limit } };
}

/**
 * Validates cursor pagination query params and responds with **400** on failure.
 * An invalid or missing cursor is NOT an error – it returns `cursor: null`.
 * @returns `{ cursor, limit }` or `null` if a 400 was already sent.
 */
export function validateCursorPagination(
  req: Request,
  res: Response,
): CursorPaginationQuery | null {
  const parsed = parseCursorPagination(req.query);
  if (!parsed.ok) {
    error(res, { message: parsed.message, status: 400, code: ErrorCode.BAD_REQUEST });
    return null;
  }
  return parsed.value;
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
