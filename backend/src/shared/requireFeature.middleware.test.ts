import assert from "node:assert/strict";
import test from "node:test";
import { requireFeature } from "./requireFeature.middleware.js";
import { initFeatureFlags } from "./feature-flags.js";
import type { Request, Response } from "express";

function makeMockRes() {
  let capturedStatus: number | undefined;
  let capturedJson: unknown;
  const res = {
    status(code: number) { capturedStatus = code; return res; },
    json(body: unknown) { capturedJson = body; return res; },
    set(_key: unknown, _val?: unknown) { return res; },
    req: {} as Request,
    getStatus: () => capturedStatus,
    getJson: () => capturedJson,
  };
  return res as unknown as Response & { getStatus(): number | undefined; getJson(): unknown };
}

test("requireFeature middleware: passes when flag is enabled", (_t, done) => {
  initFeatureFlags("sse:true");
  const mw = requireFeature("sse");
  const res = makeMockRes();
  mw({} as Request, res, () => { done(); });
});

test("requireFeature middleware: returns 501 when flag is disabled", () => {
  initFeatureFlags("sse:false");
  const mw = requireFeature("sse");
  const res = makeMockRes();
  mw({} as Request, res, () => {
    assert.fail("next should not be called");
  });
  assert.strictEqual(res.getStatus(), 501);
});

test("requireFeature middleware: returns 501 for unknown flag", () => {
  initFeatureFlags("");
  const mw = requireFeature("nonexistent_flag");
  const res = makeMockRes();
  mw({} as Request, res, () => {
    assert.fail("next should not be called");
  });
  assert.strictEqual(res.getStatus(), 501);
});
