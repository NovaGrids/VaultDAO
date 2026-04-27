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
