import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";

import {
  DEFAULT_PAGINATION_LIMIT,
  MAX_PAGINATION_LIMIT,
  parsePaginationParams,
  validateEnum,
  validatePagination,
} from "./validateQuery.js";

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
  const body = getBody() as { success: boolean; error: { message: string } };
  assert.equal(body.success, false);
  assert.match(body.error.message, /offset/i);
});

test("validateEnum returns undefined when param omitted", () => {
  const { res } = mockResponse();
  const req = { query: {} } as unknown as Request;
  const v = validateEnum(req, res, "status", ["a", "b"] as const);
  assert.equal(v, undefined);
});

test("validateEnum returns 400 and null for invalid value", () => {
  const { res, getStatus } = mockResponse();
  const req = { query: { status: "c" } } as unknown as Request;
  const v = validateEnum(req, res, "status", ["a", "b"] as const);
  assert.equal(v, null);
  assert.equal(getStatus(), 400);
});

test("validateEnum returns value when valid", () => {
  const { res } = mockResponse();
  const req = { query: { status: "a" } } as unknown as Request;
  const v = validateEnum(req, res, "status", ["a", "b"] as const);
  assert.equal(v, "a");
});
