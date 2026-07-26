/**
 * Token-bucket rate limiter — unit tests
 *
 * Covers:
 *   1. Fresh bucket allows requests up to capacity
 *   2. Requests beyond capacity are rejected with 429
 *   3. Retry-After header is present and ≥ 1 on rejection
 *   4. Bucket refills correctly over simulated elapsed time
 *   5. Two different clients have independent buckets
 *   6. Metrics counter is emitted on every rate-limit rejection
 *   7. API-key dimension is enforced independently from IP
 *
 * Time is controlled by monkey-patching Date.now — same pattern as the
 * existing rateLimit.test.ts so no additional test dependency is required.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { TokenBucketLimiter, createRateLimitMiddleware } from "./rateLimit.js";
import { MetricsRegistry } from "../../modules/health/metrics.registry.js";
import { createRateLimitMetricsMiddleware } from "./token-bucket-metrics.js";

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

const originalDateNow = Date.now;

function mockDate(ts: number): void {
  Date.now = () => ts;
}
function restoreDate(): void {
  Date.now = originalDateNow;
}

const T0 = 1_000_000;

// ---------------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------------

function makeIpReq(ip = "192.0.2.1"): Request {
  return { socket: { remoteAddress: ip }, headers: {} } as unknown as Request;
}

function makeKeyReq(ip: string, apiKey: string): Request {
  return {
    socket: { remoteAddress: ip },
    headers: { authorization: `Bearer ${apiKey}` },
  } as unknown as Request;
}

// ---------------------------------------------------------------------------
// Mock response builder
// ---------------------------------------------------------------------------

type ResState = {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
};

function makeRes(): { res: Response; state: ResState } {
  const state: ResState = { statusCode: 200, headers: {}, body: undefined };
  const res: any = {
    statusCode: 200, // exposed on the object so patched json can read it
    set(headerOrMap: string | Record<string, string>, value?: string) {
      if (typeof headerOrMap === "string") {
        state.headers[headerOrMap] = value!;
      } else {
        Object.assign(state.headers, headerOrMap);
      }
      return this;
    },
    status(code: number) {
      state.statusCode = code;
      this.statusCode = code; // keep in sync on the object
      return this;
    },
    json(b: unknown) {
      state.body = b;
      return this;
    },
  };
  return { res: res as unknown as Response, state };
}

// ---------------------------------------------------------------------------
// 1. Fresh bucket allows requests up to capacity
// ---------------------------------------------------------------------------

describe("1. Fresh bucket — capacity", () => {
  beforeEach(() => mockDate(T0));
  afterEach(() => restoreDate());

  it("allows exactly maxRequests requests before rejecting", () => {
    const capacity = 5;
    const limiter = new TokenBucketLimiter({ windowMs: 60_000, maxRequests: capacity });
    const req = makeIpReq("10.0.0.1");

    for (let i = 0; i < capacity; i++) {
      const { allowed } = limiter.consume(req);
      assert.equal(allowed, true, `Request ${i + 1} should be allowed`);
    }

    const { allowed } = limiter.consume(req);
    assert.equal(allowed, false, "Request beyond capacity must be rejected");
  });

  it("remaining tokens decrement with each consume", () => {
    const capacity = 4;
    const limiter = new TokenBucketLimiter({ windowMs: 60_000, maxRequests: capacity });
    const req = makeIpReq("10.0.0.2");

    for (let i = 0; i < capacity; i++) {
      limiter.consume(req);
      assert.equal(limiter.peekRemaining(req), capacity - i - 1);
    }
  });

  it("remaining floors at zero after over-consumption", () => {
    const limiter = new TokenBucketLimiter({ windowMs: 60_000, maxRequests: 3 });
    const req = makeIpReq("10.0.0.3");

    for (let i = 0; i < 10; i++) limiter.consume(req);
    assert.equal(limiter.peekRemaining(req), 0);
  });
});

// ---------------------------------------------------------------------------
// 2. Rejection returns 429 via middleware
// ---------------------------------------------------------------------------

describe("2. Middleware — 429 on exhausted bucket", () => {
  beforeEach(() => mockDate(T0));
  afterEach(() => restoreDate());

  it("returns 429 after capacity exhausted", () => {
    const capacity = 3;
    const mw = createRateLimitMiddleware({ windowMs: 60_000, maxRequests: capacity });
    const req = makeIpReq("10.0.0.10");

    for (let i = 0; i < capacity; i++) {
      const { res } = makeRes();
      mw(req, res, () => {});
    }

    const { res, state } = makeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false, "next() must NOT be called");
    assert.equal(state.statusCode, 429);
    const body = state.body as any;
    assert.equal(body.success, false);
    assert.equal(body.error.code, "RATE_LIMIT_EXCEEDED");
  });

  it("sets X-RateLimit-Remaining to 0 on 429", () => {
    const capacity = 2;
    const mw = createRateLimitMiddleware({ windowMs: 60_000, maxRequests: capacity });
    const req = makeIpReq("10.0.0.11");

    for (let i = 0; i < capacity; i++) {
      mw(req, makeRes().res, () => {});
    }

    const { res, state } = makeRes();
    mw(req, res, () => {});
    assert.equal(state.headers["X-RateLimit-Remaining"], "0");
  });
});

// ---------------------------------------------------------------------------
// 3. Retry-After header presence and validity
// ---------------------------------------------------------------------------

describe("3. Retry-After header", () => {
  beforeEach(() => mockDate(T0));
  afterEach(() => restoreDate());

  it("is present on 429 response", () => {
    const mw = createRateLimitMiddleware({ windowMs: 60_000, maxRequests: 1 });
    const req = makeIpReq("10.0.0.20");

    // exhaust
    mw(req, makeRes().res, () => {});

    const { res, state } = makeRes();
    mw(req, res, () => {});

    assert.ok(
      state.headers["Retry-After"],
      "Retry-After header must be present",
    );
  });

  it("Retry-After is ≥ 1 and a positive integer string", () => {
    const mw = createRateLimitMiddleware({ windowMs: 60_000, maxRequests: 1 });
    const req = makeIpReq("10.0.0.21");

    mw(req, makeRes().res, () => {}); // consume the one token

    const { res, state } = makeRes();
    mw(req, res, () => {});

    const retryAfter = Number(state.headers["Retry-After"]);
    assert.ok(
      Number.isInteger(retryAfter) && retryAfter >= 1,
      `Retry-After must be an integer ≥ 1, got ${retryAfter}`,
    );
  });

  it("Retry-After reflects token deficit: exactly ceil(deficit × windowMs / capacity / 1000)", () => {
    // capacity=100, windowMs=60_000 → refillRatePerMs = 100/60000
    // Consume all 100 tokens → tokensNow = 0
    // waitMs = (1 - 0) × 60_000 / 100 = 600 ms
    // retryAfterSecs = ceil(600 / 1000) = 1
    const capacity = 100;
    const windowMs = 60_000;
    const mw = createRateLimitMiddleware({ windowMs, maxRequests: capacity });
    const req = makeIpReq("10.0.0.22");

    for (let i = 0; i < capacity; i++) mw(req, makeRes().res, () => {});

    const { res, state } = makeRes();
    mw(req, res, () => {});

    assert.equal(state.headers["Retry-After"], "1");
  });

  it("Retry-After reflects larger deficit correctly", () => {
    // capacity=1, windowMs=60_000 → refillRatePerMs = 1/60000
    // After consuming the 1 token: tokensNow = 0
    // waitMs = (1 - 0) × 60_000 / 1 = 60_000 ms → 60 s
    const mw = createRateLimitMiddleware({ windowMs: 60_000, maxRequests: 1 });
    const req = makeIpReq("10.0.0.23");

    mw(req, makeRes().res, () => {}); // consume

    const { res, state } = makeRes();
    mw(req, res, () => {});

    assert.equal(state.headers["Retry-After"], "60");
  });
});

// ---------------------------------------------------------------------------
// 4. Bucket refill over simulated elapsed time
// ---------------------------------------------------------------------------

describe("4. Bucket refill over time", () => {
  afterEach(() => restoreDate());

  it("refills proportionally with elapsed time", () => {
    // capacity=100, windowMs=60_000 → refill 100 tokens in 60 s = 1 token/600 ms
    const capacity = 100;
    const windowMs = 60_000;
    const limiter = new TokenBucketLimiter({ windowMs, maxRequests: capacity });
    const req = makeIpReq("10.0.0.30");

    mockDate(T0);
    // Exhaust all tokens
    for (let i = 0; i < capacity; i++) limiter.consume(req);
    assert.equal(limiter.consume(req).allowed, false, "Should be exhausted");

    // Advance time by windowMs/2 → half the tokens should refill: 50
    mockDate(T0 + windowMs / 2);
    assert.equal(limiter.peekRemaining(req), Math.floor(capacity / 2));

    // Can consume 50 more (half refilled)
    for (let i = 0; i < capacity / 2; i++) {
      const { allowed } = limiter.consume(req);
      assert.equal(allowed, true, `Refilled request ${i + 1} should be allowed`);
    }

    // Now exhausted again
    assert.equal(limiter.consume(req).allowed, false);
  });

  it("fully refills after one complete window", () => {
    const capacity = 10;
    const windowMs = 1_000;
    const limiter = new TokenBucketLimiter({ windowMs, maxRequests: capacity });
    const req = makeIpReq("10.0.0.31");

    mockDate(T0);
    for (let i = 0; i < capacity; i++) limiter.consume(req);
    assert.equal(limiter.consume(req).allowed, false);

    // Advance exactly one full window
    mockDate(T0 + windowMs);
    assert.equal(limiter.peekRemaining(req), capacity);
    assert.equal(limiter.consume(req).allowed, true);
  });

  it("gradual refill is proportional, not bursty", () => {
    // At 25% of window → 25% of capacity available
    const capacity = 100;
    const windowMs = 4_000;
    const limiter = new TokenBucketLimiter({ windowMs, maxRequests: capacity });
    const req = makeIpReq("10.0.0.32");

    mockDate(T0);
    for (let i = 0; i < capacity; i++) limiter.consume(req);

    mockDate(T0 + windowMs * 0.25); // +25%
    assert.equal(limiter.peekRemaining(req), 25);

    mockDate(T0 + windowMs * 0.75); // +75%
    assert.equal(limiter.peekRemaining(req), 75);
  });
});

// ---------------------------------------------------------------------------
// 5. Two different clients have independent buckets
// ---------------------------------------------------------------------------

describe("5. Client isolation", () => {
  beforeEach(() => mockDate(T0));
  afterEach(() => restoreDate());

  it("IP buckets are independent", () => {
    const capacity = 3;
    const limiter = new TokenBucketLimiter({ windowMs: 60_000, maxRequests: capacity });
    const req1 = makeIpReq("192.168.1.1");
    const req2 = makeIpReq("192.168.1.2");

    // Exhaust req1's bucket
    for (let i = 0; i < capacity; i++) limiter.consume(req1);
    assert.equal(limiter.consume(req1).allowed, false, "req1 should be exhausted");

    // req2 should still have a full bucket
    assert.equal(limiter.consume(req2).allowed, true, "req2 must not be affected");
    assert.equal(limiter.peekRemaining(req2), capacity - 1);
  });

  it("API-key buckets are independent across different keys", () => {
    const capacity = 2;
    const limiter = new TokenBucketLimiter({ windowMs: 60_000, maxRequests: capacity });
    // Use different IPs so IP buckets don't interfere
    const req1 = makeKeyReq("10.0.1.1", "key-aaa");
    const req2 = makeKeyReq("10.0.1.2", "key-bbb"); // different IP AND different key

    for (let i = 0; i < capacity; i++) limiter.consume(req1);
    assert.equal(limiter.consume(req1).allowed, false, "key-aaa should be exhausted");
    assert.equal(limiter.consume(req2).allowed, true, "key-bbb must be unaffected");
  });

  it("middleware: exhausting one IP does not block another", () => {
    const capacity = 2;
    const mw = createRateLimitMiddleware({ windowMs: 60_000, maxRequests: capacity });
    const req1 = makeIpReq("172.16.0.1");
    const req2 = makeIpReq("172.16.0.2");

    // Exhaust req1 via middleware
    for (let i = 0; i < capacity; i++) mw(req1, makeRes().res, () => {});
    const { state: s1 } = (() => {
      const r = makeRes();
      mw(req1, r.res, () => {});
      return r;
    })();
    assert.equal(s1.statusCode, 429);

    // req2 must still succeed
    let req2Passed = false;
    mw(req2, makeRes().res, () => { req2Passed = true; });
    assert.equal(req2Passed, true, "req2 (different IP) must not be rate-limited");
  });
});

// ---------------------------------------------------------------------------
// 6. Metrics emitted on rate-limit rejection
// ---------------------------------------------------------------------------

describe("6. Metrics on rate-limit rejection", () => {
  beforeEach(() => mockDate(T0));
  afterEach(() => restoreDate());

  it("increments vaultdao_rate_limit_hits_total counter on rejection", () => {
    const registry = new MetricsRegistry();
    const capacity = 1;
    const mw = createRateLimitMetricsMiddleware(
      createRateLimitMiddleware({ windowMs: 60_000, maxRequests: capacity }),
      registry,
    );
    const req = makeIpReq("10.1.0.1");

    // First request allowed — no metric emitted
    mw(req, makeRes().res, () => {});
    const snapshotBefore = registry.snapshot();
    assert.equal(
      snapshotBefore.values.get('vaultdao_rate_limit_hits_total{dimension="ip"}') ?? 0,
      0,
      "Counter must be 0 before any rejection",
    );

    // Second request is rejected
    mw(req, makeRes().res, () => {});
    const snapshotAfter = registry.snapshot();
    const ipCounter =
      snapshotAfter.values.get('vaultdao_rate_limit_hits_total{dimension="ip"}') ?? 0;
    assert.equal(ipCounter, 1, "Counter must increment by 1 per rejection");
  });

  it("counter increments on each subsequent rejection", () => {
    const registry = new MetricsRegistry();
    const capacity = 2;
    const mw = createRateLimitMetricsMiddleware(
      createRateLimitMiddleware({ windowMs: 60_000, maxRequests: capacity }),
      registry,
    );
    const req = makeIpReq("10.1.0.2");

    for (let i = 0; i < capacity; i++) mw(req, makeRes().res, () => {});

    for (let rejection = 1; rejection <= 3; rejection++) {
      mw(req, makeRes().res, () => {});
      const snap = registry.snapshot();
      const count =
        snap.values.get('vaultdao_rate_limit_hits_total{dimension="ip"}') ?? 0;
      assert.equal(count, rejection, `Counter should be ${rejection} after ${rejection} rejections`);
    }
  });

  it("labels dimension=apiKey when API-key bucket is exhausted", () => {
    const registry = new MetricsRegistry();
    const capacity = 1;
    const mw = createRateLimitMetricsMiddleware(
      createRateLimitMiddleware({ windowMs: 60_000, maxRequests: capacity }),
      registry,
    );
    // Two different IPs, same API key — IP buckets each have capacity 1, key bucket has capacity 1
    const req1 = makeKeyReq("10.2.0.1", "shared-key");
    const req2 = makeKeyReq("10.2.0.2", "shared-key");

    // req1 consumes the API-key bucket's token
    mw(req1, makeRes().res, () => {});

    // req2 has a fresh IP bucket but the API-key bucket is empty → apiKey dimension exhausted
    const { res, state } = makeRes();
    mw(req2, res, () => {});

    assert.equal(state.statusCode, 429);
    const snap = registry.snapshot();
    const apiKeyCounter =
      snap.values.get('vaultdao_rate_limit_hits_total{dimension="apiKey"}') ?? 0;
    assert.ok(apiKeyCounter >= 1, "apiKey dimension counter must be ≥ 1");
  });
});

// ---------------------------------------------------------------------------
// 7. API-key dimension enforcement
// ---------------------------------------------------------------------------

describe("7. API-key dimension", () => {
  beforeEach(() => mockDate(T0));
  afterEach(() => restoreDate());

  it("same API key from two IPs shares one key bucket", () => {
    const capacity = 2;
    const limiter = new TokenBucketLimiter({ windowMs: 60_000, maxRequests: capacity });
    const req1 = makeKeyReq("10.3.0.1", "team-key");
    const req2 = makeKeyReq("10.3.0.2", "team-key");

    // req1 consumes both tokens of the key bucket
    limiter.consume(req1); // key bucket: 2→1
    limiter.consume(req1); // key bucket: 1→0

    // req2 has a fresh IP bucket but the key bucket is empty
    const result = limiter.consume(req2);
    assert.equal(result.allowed, false, "Shared API key exhaustion must block req2");
    assert.equal(result.exhaustedDimension, "apiKey");
  });

  it("requests without API key are only bound by IP bucket", () => {
    const capacity = 2;
    const limiter = new TokenBucketLimiter({ windowMs: 60_000, maxRequests: capacity });
    const reqWithKey = makeKeyReq("10.3.1.1", "my-key");
    const reqNoKey = makeIpReq("10.3.1.2");

    // Exhaust the IP bucket for reqWithKey AND consume key bucket
    limiter.consume(reqWithKey);
    limiter.consume(reqWithKey);

    // reqNoKey has its own fresh IP bucket and no key bucket — should be allowed
    const result = limiter.consume(reqNoKey);
    assert.equal(result.allowed, true, "Request without API key should only be bound by its IP bucket");
  });
});

// ---------------------------------------------------------------------------
// Middleware header tests (basic)
// ---------------------------------------------------------------------------

describe("Middleware headers on allowed responses", () => {
  beforeEach(() => mockDate(T0));
  afterEach(() => restoreDate());

  it("sets X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset on every allowed request", () => {
    const mw = createRateLimitMiddleware({ windowMs: 60_000, maxRequests: 10 });
    const req = makeIpReq("10.4.0.1");
    const { res, state } = makeRes();
    mw(req, res, () => {});

    assert.ok(state.headers["X-RateLimit-Limit"], "X-RateLimit-Limit must be set");
    assert.ok(state.headers["X-RateLimit-Remaining"], "X-RateLimit-Remaining must be set");
    assert.ok(state.headers["X-RateLimit-Reset"], "X-RateLimit-Reset must be set");
    assert.equal(state.headers["X-RateLimit-Limit"], "10");
  });

  it("X-RateLimit-Reset is a positive Unix timestamp in seconds", () => {
    const mw = createRateLimitMiddleware({ windowMs: 60_000, maxRequests: 10 });
    const req = makeIpReq("10.4.0.2");
    const { res, state } = makeRes();
    mw(req, res, () => {});

    const reset = Number(state.headers["X-RateLimit-Reset"]);
    // Should be > now/1000 (i.e. in the future, not a past timestamp)
    assert.ok(reset > T0 / 1000, "X-RateLimit-Reset should be a future Unix timestamp");
  });
});
