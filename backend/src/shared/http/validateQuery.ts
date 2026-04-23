import type { Request, Response } from "express";

import { error } from "./response.js";

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
    error(res, { message: parsed.message, status: 400 });
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
    });
    return null;
  }
  return raw as T;
}
