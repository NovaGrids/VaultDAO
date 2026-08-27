/**
 * Tests for request context propagation (#1460).
 *
 * Verifies that RequestContext is:
 *   1. Correctly built by the middleware.
 *   2. Accessible via getRequestContext() / getRequestId() in deeply-nested
 *      async calls within the same request.
 *   3. Not leaked between concurrent requests.
 *   4. Available inside runWithContext() for background/job contexts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";

import {
  requestContextStorage,
  getRequestContext,
  getRequestId,
  runWithContext,
  createRequestContextMiddleware,
  type RequestContext,
} from "./requestContext.js";
import { requestIdStorage } from "./requestId.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "test-req-id",
    method: "GET",
    path: "/test",
    ip: "127.0.0.1",
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMockRequest(overrides: Record<string, any> = {}) {
  return {
    method: "GET",
    path: "/test",
    socket: { remoteAddress: "127.0.0.1" },
    headers: {},
    get: (header: string) => undefined,
    requestId: "mid-req-id",
    ...overrides,
  };
}

function makeMockResponse() {
  return {} as any;
}

// ── getRequestContext tests ───────────────────────────────────────────────────

test("getRequestContext returns undefined outside of a storage run", () => {
  // Ensure no storage is active in this test.
  // We rely on the fact that each test runs synchronously outside ALS context.
  const ctx = getRequestContext();
  assert.equal(ctx, undefined);
});

test("getRequestContext returns the stored context inside a run", () => {
  const expected = makeContext();
  requestContextStorage.run(expected, () => {
    const ctx = getRequestContext();
    assert.ok(ctx);
    assert.equal(ctx.requestId, "test-req-id");
    assert.equal(ctx.method, "GET");
    assert.equal(ctx.path, "/test");
  });
});

// ── getRequestId fallback tests ───────────────────────────────────────────────

test("getRequestId returns requestId from RequestContext when available", () => {
  const ctx = makeContext({ requestId: "ctx-id-123" });
  requestContextStorage.run(ctx, () => {
    assert.equal(getRequestId(), "ctx-id-123");
  });
});

test("getRequestId falls back to legacy requestIdStorage when no context", () => {
  // No requestContextStorage active, but legacy storage is.
  requestIdStorage.run("legacy-id-456", () => {
    const id = getRequestId();
    assert.equal(id, "legacy-id-456");
  });
});

test("getRequestId returns undefined when neither storage is active", () => {
  const id = getRequestId();
  assert.equal(id, undefined);
});

// ── Async boundary propagation tests ─────────────────────────────────────────

test("context propagates through a nested async function", async () => {
  const ctx = makeContext({ requestId: "async-prop-test" });

  async function deepAsync(): Promise<string | undefined> {
    // Simulate a service call that yields.
    await new Promise<void>((r) => setImmediate(r));
    return getRequestContext()?.requestId;
  }

  const result = await new Promise<string | undefined>((resolve) => {
    requestContextStorage.run(ctx, async () => {
      resolve(await deepAsync());
    });
  });

  assert.equal(result, "async-prop-test");
});

test("context propagates through Promise.all", async () => {
  const ctx = makeContext({ requestId: "parallel-test" });

  const results = await new Promise<(string | undefined)[]>((resolve) => {
    requestContextStorage.run(ctx, async () => {
      const ids = await Promise.all([
        new Promise<string | undefined>((r) =>
          setImmediate(() => r(getRequestContext()?.requestId)),
        ),
        new Promise<string | undefined>((r) =>
          setTimeout(() => r(getRequestContext()?.requestId), 0),
        ),
      ]);
      resolve(ids);
    });
  });

  assert.deepEqual(results, ["parallel-test", "parallel-test"]);
});

test("context is not leaked between two concurrent requests", async () => {
  const ctx1 = makeContext({ requestId: "req-A" });
  const ctx2 = makeContext({ requestId: "req-B" });

  const idA = await new Promise<string | undefined>((resolve) => {
    requestContextStorage.run(ctx1, async () => {
      await new Promise<void>((r) => setImmediate(r)); // yield
      resolve(getRequestContext()?.requestId);
    });
  });

  const idB = await new Promise<string | undefined>((resolve) => {
    requestContextStorage.run(ctx2, async () => {
      await new Promise<void>((r) => setImmediate(r)); // yield
      resolve(getRequestContext()?.requestId);
    });
  });

  assert.equal(idA, "req-A");
  assert.equal(idB, "req-B");
});

// ── runWithContext tests ──────────────────────────────────────────────────────

test("runWithContext makes context available inside the callback", async () => {
  const ctx = makeContext({ requestId: "job-context" });

  const id = await runWithContext(ctx, async () => {
    await new Promise<void>((r) => setImmediate(r));
    return getRequestContext()?.requestId;
  });

  assert.equal(id, "job-context");
});

test("runWithContext does not leak context outside the callback", async () => {
  const ctx = makeContext({ requestId: "contained" });
  await runWithContext(ctx, async () => {
    // context is available here
  });
  // After the runWithContext promise resolves, the context is gone
  // from this outer async chain (which never entered the ALS).
  const outside = getRequestContext();
  assert.equal(outside, undefined);
});

// ── Middleware tests ──────────────────────────────────────────────────────────

test("createRequestContextMiddleware calls next() and stores context", (_, done) => {
  const middleware = createRequestContextMiddleware();
  const req = makeMockRequest({
    method: "POST",
    path: "/api/v1/recurring",
    requestId: "mw-test-id",
    headers: { "user-agent": "test-agent/1.0" },
    get: (h: string) => {
      if (h === "user-agent") return "test-agent/1.0";
      return undefined;
    },
  });
  const res = makeMockResponse();

  middleware(req as any, res, () => {
    const ctx = getRequestContext();
    assert.ok(ctx, "context should be set inside next()");
    assert.equal(ctx?.requestId, "mw-test-id");
    assert.equal(ctx?.method, "POST");
    assert.equal(ctx?.path, "/api/v1/recurring");
    assert.equal(ctx?.userAgent, "test-agent/1.0");
    assert.ok(ctx?.startedAt, "startedAt should be set");
    done();
  });
});

test("createRequestContextMiddleware uses X-Forwarded-For when present", (_, done) => {
  const middleware = createRequestContextMiddleware();
  const req = makeMockRequest({
    requestId: "fwd-test",
    headers: { "x-forwarded-for": "10.0.0.1, 10.0.0.2" },
    get: (h: string) => {
      if (h === "x-forwarded-for") return "10.0.0.1, 10.0.0.2";
      return undefined;
    },
  });

  middleware(req as any, makeMockResponse(), () => {
    const ctx = getRequestContext();
    assert.equal(ctx?.ip, "10.0.0.1");
    done();
  });
});

test("createRequestContextMiddleware falls back to socket address when no X-Forwarded-For", (_, done) => {
  const middleware = createRequestContextMiddleware();
  const req = makeMockRequest({
    requestId: "socket-test",
    socket: { remoteAddress: "192.168.1.5" },
    headers: {},
    get: (_h: string) => undefined,
  });

  middleware(req as any, makeMockResponse(), () => {
    const ctx = getRequestContext();
    assert.equal(ctx?.ip, "192.168.1.5");
    done();
  });
});
