/**
 * Validation for user-supplied event filters (subscribe params).
 *
 * Subscribe requests arrive as untrusted JSON over the WebSocket connection.
 * Before this validator existed, a malformed filter (wrong field types,
 * oversized arrays, non-string array entries) could throw deep inside the
 * subscribe/normalize path instead of failing with a clear client-facing
 * error. `validateEventFilter` checks field types, value ranges, and array
 * sizes up front and rejects suspicious patterns (e.g. SQL-like syntax)
 * before a filter is ever used.
 */

import type { EventFilter, EventFilterValidationResult } from "./event-filter.types.js";

/** Maximum number of entries allowed in any filter array field. */
export const MAX_FILTER_ARRAY_SIZE = 50;

/** Maximum length of any single filter string entry. */
export const MAX_FILTER_STRING_LENGTH = 128;

/**
 * Whitelisted charset for filter string entries: alphanumerics, underscore,
 * colon (topic namespacing), asterisk (wildcard), and hyphen.
 */
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9_:*-]+$/;

/**
 * Blacklist of SQL-like syntax: statement separators, comment markers, and
 * common SQL keywords. Defense-in-depth alongside the charset whitelist, and
 * gives a clearer error message than a generic "invalid characters" one.
 */
const SQL_LIKE_PATTERN =
  /(--|;|\/\*|\*\/)|(\b(select|insert|update|delete|drop|union|exec|alter|create|where|from)\b)/i;

const KNOWN_FILTER_FIELDS = new Set([
  "eventTypes",
  "contractIds",
  "minLedger",
  "maxLedger",
]);

function validateStringArray(
  value: unknown,
  fieldName: string,
  errors: string[],
): string[] | undefined {
  if (value === undefined) return undefined;

  if (!Array.isArray(value)) {
    errors.push(`${fieldName} must be an array`);
    return undefined;
  }
  if (value.length === 0) {
    errors.push(`${fieldName} must not be empty`);
    return undefined;
  }
  if (value.length > MAX_FILTER_ARRAY_SIZE) {
    errors.push(
      `${fieldName} must contain at most ${MAX_FILTER_ARRAY_SIZE} entries (got ${value.length})`,
    );
    return undefined;
  }

  const result: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];

    if (typeof entry !== "string") {
      errors.push(`${fieldName}[${i}] must be a string`);
      continue;
    }
    if (entry.length === 0 || entry.length > MAX_FILTER_STRING_LENGTH) {
      errors.push(
        `${fieldName}[${i}] must be between 1 and ${MAX_FILTER_STRING_LENGTH} characters`,
      );
      continue;
    }
    if (SQL_LIKE_PATTERN.test(entry)) {
      errors.push(
        `${fieldName}[${i}] contains disallowed SQL-like syntax: "${entry}"`,
      );
      continue;
    }
    if (!SAFE_TOKEN_PATTERN.test(entry)) {
      errors.push(`${fieldName}[${i}] contains invalid characters: "${entry}"`);
      continue;
    }
    result.push(entry);
  }

  return result;
}

function validateLedgerBound(
  value: unknown,
  fieldName: string,
  errors: string[],
): number | undefined {
  if (value === undefined) return undefined;

  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    errors.push(`${fieldName} must be an integer`);
    return undefined;
  }
  if (value < 0 || value > Number.MAX_SAFE_INTEGER) {
    errors.push(`${fieldName} must be within [0, ${Number.MAX_SAFE_INTEGER}]`);
    return undefined;
  }
  return value;
}

/**
 * Validates a user-supplied event filter (subscribe params).
 *
 * Accepts `unknown` so it can sit directly in front of untrusted JSON —
 * callers never need to assume the shape is even an object before calling
 * this. Returns either the parsed, safe {@link EventFilter} or a list of
 * human-readable error messages describing every problem found.
 */
export function validateEventFilter(filter: unknown): EventFilterValidationResult {
  if (filter === null || typeof filter !== "object" || Array.isArray(filter)) {
    return { ok: false, errors: ["filter must be a non-null object"] };
  }

  const f = filter as Record<string, unknown>;
  const errors: string[] = [];

  const eventTypes = validateStringArray(f["eventTypes"], "eventTypes", errors);
  const contractIds = validateStringArray(f["contractIds"], "contractIds", errors);
  const minLedger = validateLedgerBound(f["minLedger"], "minLedger", errors);
  const maxLedger = validateLedgerBound(f["maxLedger"], "maxLedger", errors);

  if (f["eventTypes"] === undefined && f["contractIds"] === undefined) {
    errors.push("filter must specify at least one of eventTypes or contractIds");
  }

  if (minLedger !== undefined && maxLedger !== undefined && minLedger > maxLedger) {
    errors.push(`minLedger (${minLedger}) must be <= maxLedger (${maxLedger})`);
  }

  for (const key of Object.keys(f)) {
    if (!KNOWN_FILTER_FIELDS.has(key)) {
      errors.push(`unknown filter field: "${key}"`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const result: EventFilter = {
    eventTypes: eventTypes ?? [],
    ...(contractIds !== undefined ? { contractIds } : {}),
    ...(minLedger !== undefined ? { minLedger } : {}),
    ...(maxLedger !== undefined ? { maxLedger } : {}),
  };

  return { ok: true, filter: result };
}
