import assert from "node:assert/strict";
import test from "node:test";
import {
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  InternalServerError,
} from "./AppError.js";
import { handleError } from "./handleError.js";

function makeRes() {
  const state: { statusCode: number; body: unknown } = {
    statusCode: 200,
    body: undefined,
  };
  const res = {
    status(code: number) { state.statusCode = code; return this; },
    set(_k: string, _v: string) { return this; },
    json(body: unknown) { state.body = body; return this; },
    req: { requestId: "req-abc" },
  };
  return { res, state };
}

const fakeEnv = { nodeEnv: "production" } as any;
const fakeReq = {} as any;

test("handleError: NotFoundError → 404 with code NOT_FOUND", () => {
  const { res, state } = makeRes();
  handleError(new NotFoundError("thing missing"), fakeReq, res as any, fakeEnv);

  assert.strictEqual(state.statusCode, 404);
  const body = state.body as any;
  assert.strictEqual(body.success, false);
  assert.strictEqual(body.error.code, "NOT_FOUND");
  assert.strictEqual(body.error.message, "thing missing");
});

test("handleError: ValidationError → 400 with code VALIDATION_ERROR and details", () => {
  const { res, state } = makeRes();
  const details = [{ field: "email", message: "required" }];
  handleError(new ValidationError("invalid input", details), fakeReq, res as any, fakeEnv);

  assert.strictEqual(state.statusCode, 400);
  const body = state.body as any;
  assert.strictEqual(body.error.code, "VALIDATION_ERROR");
  assert.deepEqual(body.error.details, details);
});

test("handleError: UnauthorizedError → 401 with code UNAUTHORIZED", () => {
  const { res, state } = makeRes();
  handleError(new UnauthorizedError(), fakeReq, res as any, fakeEnv);

  assert.strictEqual(state.statusCode, 401);
  assert.strictEqual((state.body as any).error.code, "UNAUTHORIZED");
});

test("handleError: ForbiddenError → 403 with code FORBIDDEN", () => {
  const { res, state } = makeRes();
  handleError(new ForbiddenError(), fakeReq, res as any, fakeEnv);

  assert.strictEqual(state.statusCode, 403);
  assert.strictEqual((state.body as any).error.code, "FORBIDDEN");
});

test("handleError: unknown error → 500 with code INTERNAL_ERROR", () => {
  const { res, state } = makeRes();
  handleError(new Error("unexpected"), fakeReq, res as any, fakeEnv);

  assert.strictEqual(state.statusCode, 500);
  assert.strictEqual((state.body as any).error.code, "INTERNAL_ERROR");
});

test("handleError: InternalServerError → 500 with code INTERNAL_ERROR", () => {
  const { res, state } = makeRes();
  handleError(new InternalServerError("boom"), fakeReq, res as any, fakeEnv);

  assert.strictEqual(state.statusCode, 500);
  assert.strictEqual((state.body as any).error.code, "INTERNAL_ERROR");
});
