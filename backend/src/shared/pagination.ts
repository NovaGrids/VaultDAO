import type { Request, Response } from "express";

import { error } from "./http/response.js";
import { ErrorCode } from "./http/errorCodes.js";

/** Default `limit` when the query param is omitted. */
export const DEFAULT_PAGINATION_LIMIT = 20;

/** Maximum allowed `limit` after parsing (explicit values above this are capped). */
export const MAX_PAGINATION_LIMIT = 100;

export interface PaginationQuery {
  offset: number;
  limit: number;
}

export function getFirstQueryString(
  query: Request["query"],
  key: string,
): string | undefined {
  const v = query[key];
  if (v === undefined) return undefined;
  if (Array.isArray(v)) {
    const first = v[0];
    return typeof first === "string" ? first : undefined;
  }
  return typeof v === "string" ? v : undefined;
}

// ============================================================================
// Cursor Pagination
// ============================================================================

/** Direction a cursor pages in. Defaults to `"next"` when omitted. */
export type CursorDirection = "next" | "prev";

/**
 * The decoded payload stored inside a base64 cursor token.
 * `lastId`    – opaque string ID of the boundary item (last item of the
 *               previous page for `"next"`, first item of the previous page
 *               for `"prev"`).
 * `offset`    – the absolute index that produced `lastId` (used as fallback
 *               when the ID can no longer be found in the dataset — e.g. it
 *               was deleted).
 * `direction` – which way to page from `lastId`/`offset`. Optional and
 *               defaults to `"next"` so cursors encoded before this field
 *               existed keep working unchanged.
 */
export interface CursorPayload {
  lastId: string;
  offset: number;
  direction?: CursorDirection;
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
 * Returns `null` when the token is missing, empty, or malformed. Callers
 * that receive an *absent* cursor should treat that as page one; callers
 * that receive a *non-empty but undecodable* cursor should surface a 400 —
 * see {@link parseCursorPagination}, which draws that distinction.
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
      const candidate = parsed as CursorPayload;
      if (
        candidate.direction !== undefined &&
        candidate.direction !== "next" &&
        candidate.direction !== "prev"
      ) {
        return null;
      }
      return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parses `cursor` and `limit` from `req.query`.
 * - `cursor` absent (or empty) → `cursor: null`, treated as page one.
 * - `cursor` present but undecodable → `{ ok: false }` (the caller should
 *   respond 400 — a client that sent an explicit cursor asked to resume a
 *   specific position, so silently restarting at page one would be
 *   surprising and can look like a duplicate/skip bug).
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

  let cursor: CursorPayload | null = null;
  if (cursorRaw !== undefined && cursorRaw.trim() !== "") {
    const decoded = decodeCursor(cursorRaw);
    if (decoded === null) {
      return {
        ok: false,
        message:
          "Invalid cursor: the cursor token is malformed or could not be decoded. " +
          "Omit the cursor parameter to start from the first page, or use the exact " +
          "cursor value returned by a previous response.",
      };
    }
    cursor = decoded;
  }

  return { ok: true, value: { cursor, limit } };
}

/**
 * Validates cursor pagination query params and responds with **400** on failure.
 * A missing cursor is NOT an error – it returns `cursor: null`. A cursor that
 * *was* supplied but can't be decoded IS an error and short-circuits with 400.
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

/**
 * Resolves the `[startIndex, endIndex)` window into an in-memory, index-addressable
 * list for a given cursor + limit, honoring `direction`.
 *
 * - `"next"` (default): items starting immediately after `lastId` (or `offset`
 *   as a fallback when `lastId` is no longer present in `items`).
 * - `"prev"`: the `limit` items immediately *before* `lastId`/`offset`.
 */
export function resolveIndexCursorWindow<T>(params: {
  items: readonly T[];
  cursor: CursorPayload | null;
  limit: number;
  getId: (item: T) => string;
}): { startIndex: number; endIndex: number; direction: CursorDirection } {
  const { items, cursor, limit, getId } = params;
  const total = items.length;
  const direction: CursorDirection = cursor?.direction ?? "next";

  if (cursor && direction === "prev") {
    const foundIdx = items.findIndex((item) => getId(item) === cursor.lastId);
    const anchorIdx = foundIdx !== -1 ? foundIdx : cursor.offset;
    const endIndex = Math.max(0, Math.min(anchorIdx, total));
    const startIndex = Math.max(0, endIndex - limit);
    return { startIndex, endIndex, direction };
  }

  let startIndex = 0;
  if (cursor) {
    const foundIdx = items.findIndex((item) => getId(item) === cursor.lastId);
    startIndex = foundIdx !== -1 ? foundIdx + 1 : cursor.offset;
  }
  const endIndex = Math.min(startIndex + limit, total);
  return { startIndex, endIndex, direction };
}

export interface CursorWindowResult {
  /** Opaque cursor for the next page in the `"next"` direction, or `null` if there isn't one. */
  nextCursor: string | null;
  /** Opaque cursor for the previous page in the `"prev"` direction, or `null` if there isn't one. */
  prevCursor: string | null;
  /** Whether there are more items beyond the current page, in the direction that produced it. */
  hasMore: boolean;
}

/**
 * Builds `nextCursor`/`prevCursor`/`hasMore` for a page given its
 * `[startIndex, endIndex)` window against a dataset of size `total`.
 *
 * `nextCursor`/`prevCursor` are populated whenever there is room to page in
 * that direction, regardless of which direction produced the current page —
 * this is what lets a client page both forward and backward from any page.
 */
export function buildCursorWindow(params: {
  startIndex: number;
  endIndex: number;
  total: number;
  direction: CursorDirection;
  firstId?: string;
  lastId?: string;
}): CursorWindowResult {
  const { startIndex, endIndex, total, direction, firstId, lastId } = params;

  const nextCursor =
    endIndex < total && lastId !== undefined
      ? encodeCursor({ lastId, offset: endIndex, direction: "next" })
      : null;

  const prevCursor =
    startIndex > 0 && firstId !== undefined
      ? encodeCursor({ lastId: firstId, offset: startIndex, direction: "prev" })
      : null;

  const hasMore = direction === "prev" ? startIndex > 0 : endIndex < total;

  return { nextCursor, prevCursor, hasMore };
}

// ============================================================================
// Legacy offset pagination
// ============================================================================

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
