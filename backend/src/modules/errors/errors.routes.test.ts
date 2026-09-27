import assert from "node:assert/strict";
import test from "node:test";
import { createErrorsRouter } from "./errors.routes.js";
import { ErrorsService } from "./errors.service.js";

function makeRes() {
  const state: { statusCode: number; body: unknown } = {
    statusCode: 200,
    body: undefined,
  };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    set(_k: string, _v: string) {
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  };
  return { res, state };
}

function getPostHandler(service: ErrorsService) {
  const router = createErrorsRouter(service);
  const layer = (router.stack as any[]).find(
    (l) => l.route?.path === "/" && l.route?.methods?.post,
  );
  return layer.route.stack[0].handle;
}

test("POST /errors: rejects payloads without a message", async () => {
  const service = new ErrorsService();
  const handler = getPostHandler(service);
  const { res, state } = makeRes();

  await handler({ body: {} } as any, res as any, (() => {}) as any);

  assert.strictEqual(state.statusCode, 400);
});

test("POST /errors: records a valid payload and returns an id", async () => {
  const service = new ErrorsService();
  const handler = getPostHandler(service);
  const { res, state } = makeRes();

  await handler(
    { body: { code: "REACT_ERROR_BOUNDARY", message: "boom", user: "GABC", page: "/dashboard" } } as any,
    res as any,
    (() => {}) as any,
  );

  assert.strictEqual(state.statusCode, 201);
  const body = state.body as any;
  assert.strictEqual(body.success, true);
  assert.ok(body.data.id);
  assert.strictEqual(body.data.deduped, false);
  assert.strictEqual(service.count(), 1);
});

test("POST /errors: deduplicates repeated errors across requests", async () => {
  const service = new ErrorsService();
  const handler = getPostHandler(service);

  const first = makeRes();
  await handler({ body: { code: "X", message: "boom" } } as any, first.res as any, (() => {}) as any);
  const second = makeRes();
  await handler({ body: { code: "X", message: "boom" } } as any, second.res as any, (() => {}) as any);

  const secondBody = second.state.body as any;
  assert.strictEqual(secondBody.data.deduped, true);
  assert.strictEqual(service.count(), 1);
});
