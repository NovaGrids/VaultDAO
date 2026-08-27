import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";

import {
  DEFAULT_PAGINATION_LIMIT,
  MAX_PAGINATION_LIMIT,
  parsePaginationParams,
  validateEnum,
  validatePagination,
  validateRequiredString,
  validateOptionalString,
  validateOptionalInteger,
  validateOptionalBoolean,
  validateLedgerRange,
} from "./validateQuery.js";
import { ErrorCode } from "./errorCodes.js";

function mockResponse(): {
  res: Response;
  getStatus: () => number | undefined;
  getBody: () => unknown;
} {
  const state: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      state.status = code;
      return this;
    },
    set() {
      return this;
    },
    json(b: unknown) {
      state.body = b;
    },
  };
  return {
    res: res as unknown as Response,
    getStatus: () => state.status,
    getBody: () => state.body,
  };
}

// ============================================================================
// Pagination Tests
// ============================================================================

test("parsePaginationParams defaults offset 0 and limit 20", () => {
  const r = parsePaginationParams({});
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.offset, 0);
    assert.equal(r.value.limit, DEFAULT_PAGINATION_LIMIT);
  }
});

test("parsePaginationParams rejects non-numeric offset", () => {
  const r = parsePaginationParams({ offset: "x" });
  assert.equal(r.ok, false);
});

test("parsePaginationParams rejects negative offset", () => {
  const r = parsePaginationParams({ offset: "-1" });
  assert.equal(r.ok, false);
});

test("parsePaginationParams rejects non-numeric limit", () => {
  const r = parsePaginationParams({ limit: "bad" });
  assert.equal(r.ok, false);
});

test("parsePaginationParams rejects limit below 1", () => {
  const r = parsePaginationParams({ limit: "0" });
  assert.equal(r.ok, false);
});

test("parsePaginationParams caps limit at MAX_PAGINATION_LIMIT", () => {
  const r = parsePaginationParams({ limit: "500" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.limit, MAX_PAGINATION_LIMIT);
  }
});

test("parsePaginationParams accepts valid integers", () => {
  const r = parsePaginationParams({ offset: "10", limit: "15" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.offset, 10);
    assert.equal(r.value.limit, 15);
  }
});

test("validatePagination sends 400 on invalid offset", () => {
  const { res, getStatus, getBody } = mockResponse();
  const req = { query: { offset: "nope" } } as unknown as Request;
  const out = validatePagination(req, res);
  assert.equal(out, null);
  assert.equal(getStatus(), 400);
  const body = getBody() as { success: boolean; error: { message: string; code: string } };
  assert.equal(body.success, false);
  assert.match(body.error.message, /offset/i);
  assert.equal(body.error.code, ErrorCode.BAD_REQUEST);
});

// ============================================================================
// Enum Validation Tests
// ============================================================================

test("validateEnum returns undefined when param omitted", () => {
  const { res } = mockResponse();
  const req = { query: {} } as unknown as Request;
  const v = validateEnum(req, res, "status", ["a", "b"] as const);
  assert.equal(v, undefined);
});

test("validateEnum returns 400 and null for invalid value", () => {
  const { res, getStatus, getBody } = mockResponse();
  const req = { query: { status: "c" } } as unknown as Request;
  const v = validateEnum(req, res, "status", ["a", "b"] as const);
  assert.equal(v, null);
  assert.equal(getStatus(), 400);
  const body = getBody() as { success: boolean; error: { message: string; code: string } };
  assert.equal(body.error.code, ErrorCode.BAD_REQUEST);
  assert.match(body.error.message, /must be one of: a, b/);
});

test("validateEnum returns value when valid", () => {
  const { res } = mockResponse();
  const req = { query: { status: "a" } } as unknown as Request;
  const v = validateEnum(req, res, "status", ["a", "b"] as const);
  assert.equal(v, "a");
});

// ============================================================================
// Required String Tests
// ============================================================================

test("validateRequiredString returns null and 400 when missing", () => {
  const { res, getStatus, getBody } = mockResponse();
  const req = { query: {} } as unknown as Request;
  const v = validateRequiredString(req, res, "contractId");
  assert.equal(v, null);
  assert.equal(getStatus(), 400);
  const body = getBody() as { success: boolean; error: { message: string; code: string } };
  assert.equal(body.error.code, ErrorCode.BAD_REQUEST);
  assert.match(body.error.message, /Missing required parameter: contractId/);
});

test("validateRequiredString returns null and 400 when empty", () => {
  const { res, getStatus } = mockResponse();
  const req = { query: { contractId: "" } } as unknown as Request;
  const v = validateRequiredString(req, res, "contractId");
  assert.equal(v, null);
  assert.equal(getStatus(), 400);
});

test("validateRequiredString returns value when present", () => {
  const { res } = mockResponse();
  const req = { query: { contractId: "CTEST123" } } as unknown as Request;
  const v = validateRequiredString(req, res, "contractId");
  assert.equal(v, "CTEST123");
});

// ============================================================================
// Optional String Tests
// ============================================================================

test("validateOptionalString returns undefined when missing", () => {
  const req = { query: {} } as unknown as Request;
  const v = validateOptionalString(req, "token");
  assert.equal(v, undefined);
});

test("validateOptionalString returns undefined when empty", () => {
  const req = { query: { token: "" } } as unknown as Request;
  const v = validateOptionalString(req, "token");
  assert.equal(v, undefined);
});

test("validateOptionalString returns value when present", () => {
  const req = { query: { token: "XLM" } } as unknown as Request;
  const v = validateOptionalString(req, "token");
  assert.equal(v, "XLM");
});

// ============================================================================
// Optional Integer Tests
// ============================================================================

test("validateOptionalInteger returns undefined when missing", () => {
  const { res } = mockResponse();
  const req = { query: {} } as unknown as Request;
  const v = validateOptionalInteger(req, res, "from");
  assert.equal(v, undefined);
});

test("validateOptionalInteger returns null and 400 for non-integer", () => {
  const { res, getStatus, getBody } = mockResponse();
  const req = { query: { from: "abc" } } as unknown as Request;
  const v = validateOptionalInteger(req, res, "from");
  assert.equal(v, null);
  assert.equal(getStatus(), 400);
  const body = getBody() as { success: boolean; error: { message: string; code: string } };
  assert.equal(body.error.code, ErrorCode.BAD_REQUEST);
  assert.match(body.error.message, /expected an integer/);
});

test("validateOptionalInteger returns null and 400 when below min", () => {
  const { res, getStatus, getBody } = mockResponse();
  const req = { query: { from: "-5" } } as unknown as Request;
  const v = validateOptionalInteger(req, res, "from", { min: 0 });
  assert.equal(v, null);
  assert.equal(getStatus(), 400);
  const body = getBody() as { success: boolean; error: { message: string } };
  assert.match(body.error.message, /must be at least 0/);
});

test("validateOptionalInteger returns null and 400 when above max", () => {
  const { res, getStatus, getBody } = mockResponse();
  const req = { query: { limit: "200" } } as unknown as Request;
  const v = validateOptionalInteger(req, res, "limit", { max: 100 });
  assert.equal(v, null);
  assert.equal(getStatus(), 400);
  const body = getBody() as { success: boolean; error: { message: string } };
  assert.match(body.error.message, /must be at most 100/);
});

test("validateOptionalInteger returns value when valid", () => {
  const { res } = mockResponse();
  const req = { query: { from: "42" } } as unknown as Request;
  const v = validateOptionalInteger(req, res, "from", { min: 0 });
  assert.equal(v, 42);
});

// ============================================================================
// Optional Boolean Tests
// ============================================================================

test("validateOptionalBoolean returns undefined when missing", () => {
  const { res } = mockResponse();
  const req = { query: {} } as unknown as Request;
  const v = validateOptionalBoolean(req, res, "active");
  assert.equal(v, undefined);
});

test("validateOptionalBoolean returns true for 'true'", () => {
  const { res } = mockResponse();
  const req = { query: { active: "true" } } as unknown as Request;
  const v = validateOptionalBoolean(req, res, "active");
  assert.equal(v, true);
});

test("validateOptionalBoolean returns true for '1'", () => {
  const { res } = mockResponse();
  const req = { query: { active: "1" } } as unknown as Request;
  const v = validateOptionalBoolean(req, res, "active");
  assert.equal(v, true);
});

test("validateOptionalBoolean returns false for 'false'", () => {
  const { res } = mockResponse();
  const req = { query: { active: "false" } } as unknown as Request;
  const v = validateOptionalBoolean(req, res, "active");
  assert.equal(v, false);
});

test("validateOptionalBoolean returns false for '0'", () => {
  const { res } = mockResponse();
  const req = { query: { active: "0" } } as unknown as Request;
  const v = validateOptionalBoolean(req, res, "active");
  assert.equal(v, false);
});

test("validateOptionalBoolean returns null and 400 for invalid value", () => {
  const { res, getStatus, getBody } = mockResponse();
  const req = { query: { active: "yes" } } as unknown as Request;
  const v = validateOptionalBoolean(req, res, "active");
  assert.equal(v, null);
  assert.equal(getStatus(), 400);
  const body = getBody() as { success: boolean; error: { message: string; code: string } };
  assert.equal(body.error.code, ErrorCode.BAD_REQUEST);
  assert.match(body.error.message, /expected "true", "false", "1", or "0"/);
});

// ============================================================================
// Ledger Range Tests
// ============================================================================

test("validateLedgerRange returns empty object when both missing", () => {
  const { res } = mockResponse();
  const req = { query: {} } as unknown as Request;
  const v = validateLedgerRange(req, res);
  assert.deepEqual(v, { from: undefined, to: undefined });
});

test("validateLedgerRange returns from when only from present", () => {
  const { res } = mockResponse();
  const req = { query: { from: "100" } } as unknown as Request;
  const v = validateLedgerRange(req, res);
  assert.deepEqual(v, { from: 100, to: undefined });
});

test("validateLedgerRange returns to when only to present", () => {
  const { res } = mockResponse();
  const req = { query: { to: "200" } } as unknown as Request;
  const v = validateLedgerRange(req, res);
  assert.deepEqual(v, { from: undefined, to: 200 });
});

test("validateLedgerRange returns both when valid range", () => {
  const { res } = mockResponse();
  const req = { query: { from: "100", to: "200" } } as unknown as Request;
  const v = validateLedgerRange(req, res);
  assert.deepEqual(v, { from: 100, to: 200 });
});

test("validateLedgerRange returns null and 400 when from > to", () => {
  const { res, getStatus, getBody } = mockResponse();
  const req = { query: { from: "200", to: "100" } } as unknown as Request;
  const v = validateLedgerRange(req, res);
  assert.equal(v, null);
  assert.equal(getStatus(), 400);
  const body = getBody() as { success: boolean; error: { message: string; code: string } };
  assert.equal(body.error.code, ErrorCode.BAD_REQUEST);
  assert.match(body.error.message, /from must be less than or equal to to/);
});

test("validateLedgerRange returns null when from is invalid", () => {
  const { res, getStatus } = mockResponse();
  const req = { query: { from: "abc", to: "100" } } as unknown as Request;
  const v = validateLedgerRange(req, res);
  assert.equal(v, null);
  assert.equal(getStatus(), 400);
});

test("validateLedgerRange returns null when to is invalid", () => {
  const { res, getStatus } = mockResponse();
  const req = { query: { from: "100", to: "xyz" } } as unknown as Request;
  const v = validateLedgerRange(req, res);
  assert.equal(v, null);
  assert.equal(getStatus(), 400);
});

test("validateLedgerRange rejects negative from", () => {
  const { res, getStatus } = mockResponse();
  const req = { query: { from: "-10" } } as unknown as Request;
  const v = validateLedgerRange(req, res);
  assert.equal(v, null);
  assert.equal(getStatus(), 400);
});

test("validateLedgerRange rejects negative to", () => {
  const { res, getStatus } = mockResponse();
  const req = { query: { to: "-10" } } as unknown as Request;
  const v = validateLedgerRange(req, res);
  assert.equal(v, null);
  assert.equal(getStatus(), 400);
});

// ============================================================================
// Cursor Pagination Tests
// ============================================================================

import {
  encodeCursor,
  decodeCursor,
  parseCursorPagination,
  validateCursorPagination,
  type CursorPayload,
} from "./validateQuery.js";

test("encodeCursor / decodeCursor round-trips correctly", () => {
  const payload: CursorPayload = { lastId: "activity-42", offset: 20 };
  const encoded = encodeCursor(payload);
  assert.ok(typeof encoded === "string" && encoded.length > 0, "should produce a non-empty string");
  const decoded = decodeCursor(encoded);
  assert.deepEqual(decoded, payload);
});

test("decodeCursor returns null for undefined input", () => {
  assert.equal(decodeCursor(undefined), null);
});

test("decodeCursor returns null for empty string", () => {
  assert.equal(decodeCursor(""), null);
});

test("decodeCursor returns null for whitespace-only string", () => {
  assert.equal(decodeCursor("   "), null);
});

test("decodeCursor returns null for invalid base64", () => {
  assert.equal(decodeCursor("!!!notbase64!!!"), null);
});

test("decodeCursor returns null for valid base64 that isn't a cursor object", () => {
  const bogus = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64");
  assert.equal(decodeCursor(bogus), null);
});

test("decodeCursor returns null when offset is not a number", () => {
  const bogus = Buffer.from(JSON.stringify({ lastId: "x", offset: "nope" })).toString("base64");
  assert.equal(decodeCursor(bogus), null);
});

test("decodeCursor returns null when offset is negative", () => {
  const bogus = Buffer.from(JSON.stringify({ lastId: "x", offset: -1 })).toString("base64");
  assert.equal(decodeCursor(bogus), null);
});

test("parseCursorPagination returns null cursor and default limit when no params", () => {
  const r = parseCursorPagination({});
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.cursor, null);
    assert.equal(r.value.limit, DEFAULT_PAGINATION_LIMIT);
  }
});

test("parseCursorPagination parses a valid cursor param", () => {
  const payload: CursorPayload = { lastId: "entry-5", offset: 10 };
  const encoded = encodeCursor(payload);
  const r = parseCursorPagination({ cursor: encoded });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.value.cursor, payload);
    assert.equal(r.value.limit, DEFAULT_PAGINATION_LIMIT);
  }
});

test("parseCursorPagination rejects a cursor that was supplied but can't be decoded", () => {
  // A missing cursor (see next test) degrades gracefully to page one; a
  // cursor that IS supplied but is malformed is an error, not a silent
  // fallback — the client asked to resume a specific position.
  const r = parseCursorPagination({ cursor: "this-is-garbage" });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.message, /cursor/i);
  }
});

test("parseCursorPagination treats an absent cursor as page one (no error)", () => {
  const r = parseCursorPagination({});
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.cursor, null);
  }
});

test("parseCursorPagination caps limit at MAX_PAGINATION_LIMIT", () => {
  const r = parseCursorPagination({ limit: "999" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.limit, MAX_PAGINATION_LIMIT);
  }
});

test("parseCursorPagination rejects non-integer limit", () => {
  const r = parseCursorPagination({ limit: "abc" });
  assert.equal(r.ok, false);
});

test("parseCursorPagination rejects limit < 1", () => {
  const r = parseCursorPagination({ limit: "0" });
  assert.equal(r.ok, false);
});

test("validateCursorPagination sends 400 on invalid limit", () => {
  const { res, getStatus, getBody } = mockResponse();
  const req = { query: { limit: "bad" } } as unknown as Request;
  const out = validateCursorPagination(req, res);
  assert.equal(out, null);
  assert.equal(getStatus(), 400);
  const body = getBody() as { success: boolean; error: { message: string; code: string } };
  assert.equal(body.success, false);
  assert.match(body.error.message, /limit/i);
  assert.equal(body.error.code, ErrorCode.BAD_REQUEST);
});

test("validateCursorPagination sends 400 on a malformed cursor that was explicitly supplied", () => {
  const { res, getStatus, getBody } = mockResponse();
  const req = { query: { cursor: "garbage-not-a-cursor" } } as unknown as Request;
  const out = validateCursorPagination(req, res);
  assert.equal(out, null);
  assert.equal(getStatus(), 400);
  const body = getBody() as { success: boolean; error: { message: string; code: string } };
  assert.equal(body.success, false);
  assert.match(body.error.message, /cursor/i);
  assert.equal(body.error.code, ErrorCode.BAD_REQUEST);
});

test("validateCursorPagination returns cursor null and default limit for empty query", () => {
  const { res } = mockResponse();
  const req = { query: {} } as unknown as Request;
  const out = validateCursorPagination(req, res);
  assert.ok(out !== null);
  assert.equal(out!.cursor, null);
  assert.equal(out!.limit, DEFAULT_PAGINATION_LIMIT);
});

test("encodeCursor produces URL-safe base64 (no +, /, =)", () => {
  // Test with a payload that would normally trigger + or / in standard base64
  for (let i = 0; i < 50; i++) {
    const encoded = encodeCursor({ lastId: `id-${i}-some-longer-string`, offset: i * 17 });
    assert.ok(!/[+/=]/.test(encoded), `cursor should be URL-safe, got: ${encoded}`);
  }
});

test("cursor pagination across page boundaries: second page uses nextCursor from first", () => {
  // Encode a cursor that points to after item at index 2
  const firstPageCursor: CursorPayload = { lastId: "item-2", offset: 3 };
  const encoded = encodeCursor(firstPageCursor);
  const decoded = decodeCursor(encoded);
  assert.deepEqual(decoded, firstPageCursor);
  // Simulated second page: startIndex should be 3 (offset from cursor)
  assert.equal(decoded!.offset, 3);
});
