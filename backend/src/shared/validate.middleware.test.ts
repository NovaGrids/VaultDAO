import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { validate } from "./validate.middleware.js";
import type { Request, Response } from "express";

function makeMockRes() {
  let capturedStatus: number | undefined;
  let capturedJson: unknown;
  const res = {
    status(code: number) { capturedStatus = code; return res; },
    json(body: unknown) { capturedJson = body; return res; },
    set(_key: unknown, _val?: unknown) { return res; },
    getStatus: () => capturedStatus,
    getJson: () => capturedJson,
  };
  return res as unknown as Response & { getStatus(): number | undefined; getJson(): unknown };
}

const bodySchema = z.object({
  amount: z.number().positive(),
  recipient: z.string().min(1),
});

test("validate: calls next() and normalizes req.body when the body is valid", () => {
  const mw = validate(bodySchema, "body");
  const req = { body: { amount: 100, recipient: "GABC" } } as unknown as Request;
  const res = makeMockRes();
  let nextCalled = false;

  mw(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(res.getStatus(), undefined);
  assert.deepEqual(req.body, { amount: 100, recipient: "GABC" });
});

test("validate: returns 400 with structured ValidationError issues for an invalid body", () => {
  const mw = validate(bodySchema, "body");
  const req = { body: { amount: "not-a-number", recipient: "" } } as unknown as Request;
  const res = makeMockRes();
  let nextCalled = false;

  mw(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.getStatus(), 400);
  const json = res.getJson() as { error: string; issues: Array<{ field: string; message: string }> };
  assert.equal(json.error, "ValidationError");
  assert.ok(Array.isArray(json.issues));
  assert.ok(json.issues.length >= 2);
  assert.ok(json.issues.some((i) => i.field === "amount"));
  assert.ok(json.issues.some((i) => i.field === "recipient"));
  for (const issue of json.issues) {
    assert.equal(typeof issue.field, "string");
    assert.equal(typeof issue.message, "string");
  }
});

test("validate: rejects a body missing required fields", () => {
  const mw = validate(bodySchema, "body");
  const req = { body: {} } as unknown as Request;
  const res = makeMockRes();

  mw(req, res, () => { assert.fail("next should not be called"); });

  assert.equal(res.getStatus(), 400);
  const json = res.getJson() as { error: string; issues: Array<{ field: string }> };
  assert.equal(json.error, "ValidationError");
  assert.equal(json.issues.length, 2);
});

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

test("validate: calls next() for a valid query without mutating req.query", () => {
  const mw = validate(querySchema, "query");
  const query: Record<string, unknown> = { limit: "42" };
  const req = { query } as unknown as Request;
  const res = makeMockRes();
  let nextCalled = false;

  mw(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  // req.query is left untouched — Express 5 has no setter for it, and
  // downstream controllers in this codebase parse it themselves.
  assert.equal(req.query, query);
  assert.equal((req.query as Record<string, unknown>).limit, "42");
});

test("validate: rejects a query param outside the allowed range", () => {
  const mw = validate(querySchema, "query");
  const req = { query: { limit: "1000" } } as unknown as Request;
  const res = makeMockRes();

  mw(req, res, () => { assert.fail("next should not be called"); });

  assert.equal(res.getStatus(), 400);
  const json = res.getJson() as { error: string; issues: Array<{ field: string; message: string }> };
  assert.equal(json.error, "ValidationError");
  assert.equal(json.issues[0]?.field, "limit");
});

const paramsSchema = z.object({
  index: z.coerce.number().int().min(0),
});

test("validate: replaces req.params with the coerced value on success", () => {
  const mw = validate(paramsSchema, "params");
  const req = { params: { index: "7" } } as unknown as Request;
  const res = makeMockRes();
  let nextCalled = false;

  mw(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.deepEqual(req.params, { index: 7 });
});

test("validate: rejects a non-numeric params value", () => {
  const mw = validate(paramsSchema, "params");
  const req = { params: { index: "not-a-number" } } as unknown as Request;
  const res = makeMockRes();

  mw(req, res, () => { assert.fail("next should not be called"); });

  assert.equal(res.getStatus(), 400);
  const json = res.getJson() as { error: string; issues: Array<{ field: string }> };
  assert.equal(json.error, "ValidationError");
  assert.equal(json.issues[0]?.field, "index");
});
