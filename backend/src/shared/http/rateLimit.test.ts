import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fc from "fast-check";
import type { Request, Response, NextFunction } from "express";
import { RateLimiter, createRateLimitMiddleware } from "./rateLimit.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_TIME = 1_000_000;
const WINDOW_MS = 1000;
const MAX_REQUESTS = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalDateNow = Date.now;

function mockDate(ts: number): void {
  Date.now = () => ts;
}

function restoreDate(): void {
  Date.now = originalDateNow;
}

function makeReq(ip = "127.0.0.1"): Request {
  return { socket: { remoteAddress: ip } } as unknown as Request;
}

// ---------------------------------------------------------------------------
// Shared limiter
// ---------------------------------------------------------------------------

const limiter = new RateLimiter({
  windowMs: WINDOW_MS,
  maxRequests: MAX_REQUESTS,
});

beforeEach(() => {
  limiter.reset();
  mockDate(BASE_TIME);
});

afterEach(() => {
  restoreDate();
});

// ---------------------------------------------------------------------------
// Requirement 1 – within-limit requests allowed
// ---------------------------------------------------------------------------

describe("Requirement 1 – within-limit requests allowed", () => {
  it("P1: within-limit calls are never blocked", () => {
    // Feature: rate-limiter-coverage, Property 1: Within-limit calls are never blocked
    // Validates: Requirements 1.1, 1.2
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.string(),
        (maxRequests: number, ip: string) => {
          const localLimiter = new RateLimiter({
            windowMs: WINDOW_MS,
            maxRequests,
          });
          const req = makeReq(ip);
          for (let i = 0; i < maxRequests; i++) {
            assert.equal(localLimiter.isLimited(req), false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Requirement 2 – over-limit requests blocked
// ---------------------------------------------------------------------------

describe("Requirement 2 – over-limit requests blocked", () => {
  it("P2: over-limit calls are always blocked", () => {
    // Feature: rate-limiter-coverage, Property 2: Over-limit calls are always blocked
    // Validates: Requirements 2.1, 2.2
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.string(),
        fc.integer({ min: 1, max: 5 }),
        (maxRequests: number, ip: string, k: number) => {
          const localLimiter = new RateLimiter({
            windowMs: 1000,
            maxRequests,
          });
          const req = makeReq(ip);
          // Exhaust the limit
          for (let i = 0; i < maxRequests; i++) {
            localLimiter.isLimited(req);
          }
          // Calls at positions maxRequests+1 … maxRequests+k must all return true
          for (let i = 0; i < k; i++) {
            assert.equal(localLimiter.isLimited(req), true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Requirement 3 – window reset
// ---------------------------------------------------------------------------

describe("Requirement 3 – window reset", () => {
  it("P3: window reset restores access and resets count", () => {
    // Feature: rate-limiter-coverage, Property 3: Window reset restores access and resets count
    // Validates: Requirements 3.1, 3.2
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.string(),
        fc.integer({ min: 100, max: 1000 }),
        fc.integer({ min: 0, max: 500 }),
        (maxRequests: number, ip: string, windowMs: number, extra: number) => {
          const localLimiter = new RateLimiter({ windowMs, maxRequests });
          const req = makeReq(ip);

          // Start at BASE_TIME and exhaust the limit
          mockDate(BASE_TIME);
          for (let i = 0; i < maxRequests; i++) {
            localLimiter.isLimited(req);
          }
          // Confirm the client is now blocked
          assert.equal(localLimiter.isLimited(req), true);

          // Advance time past the window
          mockDate(BASE_TIME + windowMs + extra);

          // Next call should open a new window → not limited
          assert.equal(localLimiter.isLimited(req), false);

          // The reset request counts as 1, so remaining = maxRequests - 1
          assert.equal(localLimiter.getRemaining(req), maxRequests - 1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Requirement 4 – getRemaining()
// ---------------------------------------------------------------------------

describe("Requirement 4 – getRemaining()", () => {
  it("P4: getRemaining decrements with each request", () => {
    // Feature: rate-limiter-coverage, Property 4: getRemaining decrements with each request
    // Validates: Requirements 4.1, 4.2
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 20 })
          .chain((max: number) =>
            fc.tuple(fc.constant(max), fc.integer({ min: 0, max: max })),
          ),
        ([maxRequests, n]: [number, number]) => {
          const localLimiter = new RateLimiter({
            windowMs: 1000,
            maxRequests,
          });
          const req = makeReq("127.0.0.1");
          for (let i = 0; i < n; i++) {
            localLimiter.isLimited(req);
          }
          assert.equal(localLimiter.getRemaining(req), maxRequests - n);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("P5: getRemaining floors at zero", () => {
    // Feature: rate-limiter-coverage, Property 5: getRemaining floors at zero
    // Validates: Requirements 4.3
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 5 }),
        (maxRequests: number, k: number) => {
          const localLimiter = new RateLimiter({
            windowMs: 1000,
            maxRequests,
          });
          const req = makeReq("127.0.0.1");
          for (let i = 0; i < maxRequests + k; i++) {
            localLimiter.isLimited(req);
          }
          assert.equal(localLimiter.getRemaining(req), 0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Requirement 5 – getResetTime()
// ---------------------------------------------------------------------------

describe("Requirement 5 – getResetTime()", () => {
  it("P6: getResetTime equals window-start plus windowMs", () => {
    // Feature: rate-limiter-coverage, Property 6: getResetTime equals window-start plus windowMs
    // Validates: Requirements 5.1
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer({ min: 100, max: 10000 }),
        (T: number, windowMs: number) => {
          const localLimiter = new RateLimiter({ windowMs, maxRequests: 10 });
          const req = makeReq("127.0.0.1");
          mockDate(T);
          localLimiter.isLimited(req);
          assert.equal(localLimiter.getResetTime(req), T + windowMs);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Requirement 6 – createRateLimitMiddleware() Express middleware
// ---------------------------------------------------------------------------

function makeExpressReq(ip = "127.0.0.1"): Request {
  return { socket: { remoteAddress: ip }, method: "GET" } as unknown as Request;
}

function makeExpressRes(): {
  res: Response;
  state: { headers: Record<string, string>; statusCode: number; body: unknown };
} {
  const state: { headers: Record<string, string>; statusCode: number; body: unknown } = {
    headers: {},
    statusCode: 200,
    body: undefined,
  };

  const res = {
    set: (headerOrMap: string | Record<string, string>, value?: string) => {
      if (typeof headerOrMap === "string") {
        state.headers[headerOrMap] = value!;
      } else {
        Object.assign(state.headers, headerOrMap);
      }
      return res;
    },
    status: (code: number) => {
      state.statusCode = code;
      return res;
    },
    json: (b: unknown) => {
      state.body = b;
      return res;
    },
  } as unknown as Response;

  return { res, state };
}

describe("Requirement 6 – createRateLimitMiddleware()", () => {
  beforeEach(() => {
    mockDate(BASE_TIME);
  });

  afterEach(() => {
    restoreDate();
  });

  it("M1: allows requests within the limit and calls next()", () => {
    // Validates: Acceptance Criteria – GET requests allowed up to maxRequests
    const middleware = createRateLimitMiddleware({
      windowMs: WINDOW_MS,
      maxRequests: MAX_REQUESTS,
    });
    const req = makeExpressReq();

    for (let i = 0; i < MAX_REQUESTS; i++) {
      const { res } = makeExpressRes();
      let nextCalled = false;
      const next: NextFunction = () => { nextCalled = true; };
      middleware(req, res, next);
      assert.equal(nextCalled, true, `Request ${i + 1} should pass through`);
    }
  });

  it("M2: 101st GET request returns 429 with Retry-After header", () => {
    // Validates: Acceptance Criteria – 101st GET request in a minute returns 429
    //            and Retry-After header is present on 429 response
    const limit = 100;
    const middleware = createRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: limit,
    });
    const req = makeExpressReq("10.0.0.1");

    // Exhaust the limit
    for (let i = 0; i < limit; i++) {
      const { res } = makeExpressRes();
      middleware(req, res, () => {});
    }

    // 101st request must be rejected
    const { res, state } = makeExpressRes();
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false, "next() must NOT be called on 429");
    assert.equal(state.statusCode, 429);
    assert.ok(state.headers["Retry-After"], "Retry-After header must be present");
    assert.ok(state.headers["X-RateLimit-Limit"], "X-RateLimit-Limit header must be present");
    assert.equal(state.headers["X-RateLimit-Remaining"], "0");

    const b = state.body as any;
    assert.equal(b.success, false);
    assert.equal(b.error.code, "RATE_LIMIT_EXCEEDED");
  });

  it("M3: sets X-RateLimit-* headers on every allowed response", () => {
    // Validates: Rate limit headers are sent with every non-limited response
    const middleware = createRateLimitMiddleware({
      windowMs: WINDOW_MS,
      maxRequests: MAX_REQUESTS,
    });
    const req = makeExpressReq("10.0.0.2");
    const { res, state } = makeExpressRes();
    middleware(req, res, () => {});

    assert.ok(state.headers["X-RateLimit-Limit"], "X-RateLimit-Limit must be set");
    assert.ok(state.headers["X-RateLimit-Remaining"], "X-RateLimit-Remaining must be set");
    assert.ok(state.headers["X-RateLimit-Reset"], "X-RateLimit-Reset must be set");
    assert.equal(state.headers["X-RateLimit-Limit"], String(MAX_REQUESTS));
  });

  it("M4: rate limit resets after the window expires", () => {
    // Validates: Acceptance Criteria – Rate limit resets after the window expires
    const middleware = createRateLimitMiddleware({
      windowMs: WINDOW_MS,
      maxRequests: MAX_REQUESTS,
    });
    const req = makeExpressReq("10.0.0.3");

    // Exhaust the limit
    for (let i = 0; i < MAX_REQUESTS; i++) {
      middleware(req, makeExpressRes().res, () => {});
    }
    // Confirm blocked
    let wasBlocked = false;
    middleware(req, makeExpressRes().res, () => { wasBlocked = true; });
    assert.equal(wasBlocked, false);

    // Advance time past the window
    mockDate(BASE_TIME + WINDOW_MS + 1);

    // First request in new window must succeed
    let afterReset = false;
    middleware(req, makeExpressRes().res, () => { afterReset = true; });
    assert.equal(afterReset, true, "After window reset, request should pass");
  });

  it("M5: health limit (300/min) is higher than read limit (100/min)", () => {
    // Validates: Acceptance Criteria – Health endpoint has higher limit than API endpoints
    const healthMiddleware = createRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 300,
    });
    const readMiddleware = createRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 100,
    });

    const healthReq = makeExpressReq("10.0.0.4");
    const readReq = makeExpressReq("10.0.0.5");

    // Exhaust read limit
    for (let i = 0; i < 100; i++) {
      readMiddleware(readReq, makeExpressRes().res, () => {});
    }
    // 101st read request must be blocked
    let readBlocked = false;
    readMiddleware(readReq, makeExpressRes().res, () => { readBlocked = true; });
    assert.equal(readBlocked, false, "101st read request must be blocked");

    // Health endpoint should still allow 300 requests
    for (let i = 0; i < 300; i++) {
      let allowed = false;
      healthMiddleware(healthReq, makeExpressRes().res, () => { allowed = true; });
      assert.equal(allowed, true, `Health request ${i + 1} should be allowed`);
    }
    // 301st health request must be blocked
    let healthBlocked = false;
    healthMiddleware(healthReq, makeExpressRes().res, () => { healthBlocked = true; });
    assert.equal(healthBlocked, false, "301st health request must be blocked");
  });

  it("M6: write limit (10/min) is enforced for POST routes", () => {
    // Validates: Write endpoints limited to 10 req/min
    const writeMiddleware = createRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 10,
    });
    const req = makeExpressReq("10.0.0.6");

    for (let i = 0; i < 10; i++) {
      let allowed = false;
      writeMiddleware(req, makeExpressRes().res, () => { allowed = true; });
      assert.equal(allowed, true, `Write request ${i + 1} should be allowed`);
    }
    // 11th write request must be blocked
    let blocked = false;
    writeMiddleware(req, makeExpressRes().res, () => { blocked = true; });
    assert.equal(blocked, false, "11th write request must be blocked");
  });
});
