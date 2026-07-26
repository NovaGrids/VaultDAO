/**
 * Unit tests for the request-draining middleware (createDrainMiddleware).
 *
 * All tests use a minimal in-process mock — no real HTTP server is started.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createDrainMiddleware, type DrainController } from "./drain.js";
import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a controllable DrainController stub.
 */
function makeController(shuttingDown = false): DrainController & {
  count: number;
  setShuttingDown(v: boolean): void;
} {
  const ctrl = {
    count: 0,
    _shuttingDown: shuttingDown,
    isShuttingDown() {
      return this._shuttingDown;
    },
    incrementInFlight() {
      this.count++;
    },
    decrementInFlight() {
      this.count = Math.max(0, this.count - 1);
    },
    setShuttingDown(v: boolean) {
      this._shuttingDown = v;
    },
  };
  return ctrl;
}

/**
 * Creates a minimal mock Express Response that emits 'finish' / 'close'
 * events like a real response, and records status + JSON body.
 */
function makeRes(): {
  res: Response;
  emitFinish(): void;
  emitClose(): void;
  getStatus(): number;
  getBody(): unknown;
  getHeader(name: string): string | undefined;
} {
  const emitter = new EventEmitter();
  const state: { status: number; body: unknown; headers: Record<string, string> } = {
    status: 200,
    body: undefined,
    headers: {},
  };

  const res = Object.assign(emitter, {
    status(code: number) {
      state.status = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
    set(key: string, value: string) {
      state.headers[key.toLowerCase()] = value;
      return this;
    },
    // expose recorded state
    __state: state,
  }) as unknown as Response;

  return {
    res,
    emitFinish: () => emitter.emit("finish"),
    emitClose: () => emitter.emit("close"),
    getStatus: () => state.status,
    getBody: () => state.body,
    getHeader: (name: string) => state.headers[name.toLowerCase()],
  };
}

const dummyReq = {} as Request;

// ---------------------------------------------------------------------------
// Tests: Normal (non-shutdown) path
// ---------------------------------------------------------------------------

test("drainMiddleware: passes request to next() when not shutting down", () => {
  const controller = makeController(false);
  const middleware = createDrainMiddleware(controller);
  const { res } = makeRes();

  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };

  middleware(dummyReq, res, next);

  assert.ok(nextCalled, "next() must be called when not shutting down");
});

test("drainMiddleware: increments in-flight counter on entry", () => {
  const controller = makeController(false);
  const middleware = createDrainMiddleware(controller);
  const { res } = makeRes();

  middleware(dummyReq, res, () => {});

  assert.equal(controller.count, 1, "counter should be 1 after one request enters");
});

test("drainMiddleware: decrements in-flight counter when response finishes", () => {
  const controller = makeController(false);
  const middleware = createDrainMiddleware(controller);
  const { res, emitFinish } = makeRes();

  middleware(dummyReq, res, () => {});
  assert.equal(controller.count, 1);

  emitFinish();
  assert.equal(controller.count, 0, "counter should be 0 after response finishes");
});

test("drainMiddleware: decrements in-flight counter when connection closes before finish", () => {
  const controller = makeController(false);
  const middleware = createDrainMiddleware(controller);
  const { res, emitClose } = makeRes();

  middleware(dummyReq, res, () => {});
  assert.equal(controller.count, 1);

  emitClose();
  assert.equal(controller.count, 0, "counter should be 0 after close without finish");
});

test("drainMiddleware: does NOT double-decrement when both finish and close fire", () => {
  const controller = makeController(false);
  const middleware = createDrainMiddleware(controller);
  const { res, emitFinish, emitClose } = makeRes();

  middleware(dummyReq, res, () => {});
  assert.equal(controller.count, 1);

  emitFinish(); // first decrement
  emitClose();  // should be a no-op (already decremented)
  assert.equal(controller.count, 0, "counter must not go below 0");
});

test("drainMiddleware: counter tracks multiple concurrent requests correctly", () => {
  const controller = makeController(false);
  const middleware = createDrainMiddleware(controller);

  const mock1 = makeRes();
  const mock2 = makeRes();
  const mock3 = makeRes();

  middleware(dummyReq, mock1.res, () => {});
  middleware(dummyReq, mock2.res, () => {});
  middleware(dummyReq, mock3.res, () => {});
  assert.equal(controller.count, 3, "three concurrent requests");

  mock2.emitFinish();
  assert.equal(controller.count, 2);

  mock1.emitFinish();
  assert.equal(controller.count, 1);

  mock3.emitFinish();
  assert.equal(controller.count, 0);
});

test("drainMiddleware: sets Connection: close header on normal requests", () => {
  const controller = makeController(false);
  const middleware = createDrainMiddleware(controller);
  const { res, getHeader } = makeRes();

  middleware(dummyReq, res, () => {});

  assert.equal(
    getHeader("connection"),
    "close",
    "Connection: close must be set so load-balancers drain the instance",
  );
});

// ---------------------------------------------------------------------------
// Tests: Shutdown (draining) path
// ---------------------------------------------------------------------------

test("drainMiddleware: returns 503 when server is shutting down", () => {
  const controller = makeController(true); // already shutting down
  const middleware = createDrainMiddleware(controller);
  const { res, getStatus } = makeRes();

  let nextCalled = false;
  middleware(dummyReq, res, () => {
    nextCalled = true;
  });

  assert.equal(getStatus(), 503, "status must be 503 during shutdown");
  assert.ok(!nextCalled, "next() must NOT be called during shutdown");
});

test("drainMiddleware: 503 response body has correct shape", () => {
  const controller = makeController(true);
  const middleware = createDrainMiddleware(controller);
  const { res, getBody } = makeRes();

  middleware(dummyReq, res, () => {});

  const body = getBody() as any;
  assert.equal(body.success, false);
  assert.ok(body.error?.message, "error.message must be present");
  assert.ok(body.error?.code, "error.code must be present");
});

test("drainMiddleware: 503 response sets Connection: close", () => {
  const controller = makeController(true);
  const middleware = createDrainMiddleware(controller);
  const { res, getHeader } = makeRes();

  middleware(dummyReq, res, () => {});

  assert.equal(
    getHeader("connection"),
    "close",
    "Connection: close must be set on 503 responses",
  );
});

test("drainMiddleware: does NOT increment counter when returning 503", () => {
  const controller = makeController(true);
  const middleware = createDrainMiddleware(controller);
  const { res } = makeRes();

  middleware(dummyReq, res, () => {});

  assert.equal(controller.count, 0, "counter must not increment for rejected requests");
});

test("drainMiddleware: transitions from accepting to rejecting when shutdown begins mid-stream", () => {
  const controller = makeController(false);
  const middleware = createDrainMiddleware(controller);

  // First request arrives before shutdown
  const mock1 = makeRes();
  middleware(dummyReq, mock1.res, () => {});
  assert.equal(controller.count, 1, "first request should be counted");

  // Shutdown begins
  controller.setShuttingDown(true);

  // Second request arrives after shutdown signal
  const mock2 = makeRes();
  let next2Called = false;
  middleware(dummyReq, mock2.res, () => {
    next2Called = true;
  });

  assert.equal(mock2.getStatus(), 503, "second request must be rejected with 503");
  assert.ok(!next2Called, "next() must not fire for post-shutdown request");
  assert.equal(controller.count, 1, "only the first request should remain in-flight");

  // First request finishes — counter drains to zero
  mock1.emitFinish();
  assert.equal(controller.count, 0, "counter must reach 0 after in-flight request finishes");
});
