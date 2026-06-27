/**
 * Tests for RedisRateLimiter — sliding window accuracy and Redis fallback.
 *
 * We test the sliding window logic by injecting a mock Redis client that
 * executes the Lua script in-process using a simple sorted-set simulation.
 * The fallback path is tested by simulating Redis connection errors.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import {
  RedisRateLimiter,
  createRedisRateLimitMiddleware,
} from "./redisRateLimit.js";

// ---------------------------------------------------------------------------
// In-process sorted-set simulation (mirrors the Lua script logic)
// ---------------------------------------------------------------------------

interface SortedSetStore {
  [key: string]: Array<{ score: number; member: string }>;
}

function makeMockRedis(store: SortedSetStore = {}) {
  return {
    _store: store,
    async eval(
      _script: string,
      _numKeys: number,
      key: string,
      nowStr: string,
      windowStr: string,
      limitStr: string,
      member: string,
    ): Promise<[number, number]> {
      const now = Number(nowStr);
      const window = Number(windowStr);
      const limit = Number(limitStr);
      const cutoff = now - window;

      if (!store[key]) store[key] = [];

      // ZREMRANGEBYSCORE: remove entries with score <= cutoff
      store[key] = store[key].filter((e) => e.score > cutoff);

      let count = store[key].length;

      if (count < limit) {
        store[key].push({ score: now, member });
        count += 1;
      } else {
        // Signal rejection: return limit+1
        count = limit + 1;
      }

      return [count, now - window];
    },
    async quit() {},
    on() {
      return this;
    },
    connect() {
      return Promise.resolve();
    },
  };
}

// ---------------------------------------------------------------------------
// Patch RedisRateLimiter to accept an injected redis client for testing
// ---------------------------------------------------------------------------

function makeTestLimiter(
  mockRedis: ReturnType<typeof makeMockRedis>,
  limit: number,
  windowMs: number,
): RedisRateLimiter {
  const limiter = new RedisRateLimiter(undefined, {
    windowMs,
    maxRequests: limit,
  });
  // Inject mock redis and mark as not using fallback
  (limiter as any).redis = mockRedis;
  (limiter as any).usingFallback = false;
  return limiter;
}

// ---------------------------------------------------------------------------
// Sliding window accuracy
// ---------------------------------------------------------------------------

test("RedisRateLimiter sliding window accuracy", async (t) => {
  await t.test("allows requests up to the limit", async () => {
    const store: SortedSetStore = {};
    const redis = makeMockRedis(store);
    const limiter = makeTestLimiter(redis, 3, 60_000);

    for (let i = 0; i < 3; i++) {
      const result = await limiter.isRateLimited(
        "user1",
        "/api/proposals",
        3,
        60_000,
      );
      assert.equal(result.allowed, true, `request ${i + 1} should be allowed`);
    }
  });

  await t.test("blocks the (limit+1)th request", async () => {
    const store: SortedSetStore = {};
    const redis = makeMockRedis(store);
    const limiter = makeTestLimiter(redis, 3, 60_000);

    for (let i = 0; i < 3; i++) {
      await limiter.isRateLimited("user2", "/api/proposals", 3, 60_000);
    }

    const result = await limiter.isRateLimited(
      "user2",
      "/api/proposals",
      3,
      60_000,
    );
    assert.equal(result.allowed, false);
    assert.equal(result.remaining, 0);
  });

  await t.test(
    "sliding window expires old entries and allows new requests",
    async () => {
      const store: SortedSetStore = {};
      const redis = makeMockRedis(store);
      const limiter = makeTestLimiter(redis, 3, 1_000); // 1 second window

      const now = Date.now();

      // Manually pre-populate the store with 3 old entries (outside the window)
      const key = "rl:/api/proposals:user3";
      store[key] = [
        { score: now - 2000, member: "old-1" },
        { score: now - 1500, member: "old-2" },
        { score: now - 1100, member: "old-3" },
      ];

      // All old entries are outside the 1s window — new request should be allowed
      const result = await limiter.isRateLimited(
        "user3",
        "/api/proposals",
        3,
        1_000,
      );
      assert.equal(result.allowed, true);
    },
  );

  await t.test("remaining count decrements correctly", async () => {
    const store: SortedSetStore = {};
    const redis = makeMockRedis(store);
    const limiter = makeTestLimiter(redis, 5, 60_000);

    const r1 = await limiter.isRateLimited(
      "user4",
      "/api/proposals",
      5,
      60_000,
    );
    assert.equal(r1.remaining, 4);

    const r2 = await limiter.isRateLimited(
      "user4",
      "/api/proposals",
      5,
      60_000,
    );
    assert.equal(r2.remaining, 3);
  });

  await t.test("different users have independent counters", async () => {
    const store: SortedSetStore = {};
    const redis = makeMockRedis(store);
    const limiter = makeTestLimiter(redis, 2, 60_000);

    // Exhaust user-a
    await limiter.isRateLimited("user-a", "/api/proposals", 2, 60_000);
    await limiter.isRateLimited("user-a", "/api/proposals", 2, 60_000);
    const blockedA = await limiter.isRateLimited(
      "user-a",
      "/api/proposals",
      2,
      60_000,
    );
    assert.equal(blockedA.allowed, false);

    // user-b should still be allowed
    const allowedB = await limiter.isRateLimited(
      "user-b",
      "/api/proposals",
      2,
      60_000,
    );
    assert.equal(allowedB.allowed, true);
  });

  await t.test("different endpoints have independent counters", async () => {
    const store: SortedSetStore = {};
    const redis = makeMockRedis(store);
    const limiter = makeTestLimiter(redis, 1, 60_000);

    await limiter.isRateLimited("user5", "/api/proposals", 1, 60_000);
    const blockedProposals = await limiter.isRateLimited(
      "user5",
      "/api/proposals",
      1,
      60_000,
    );
    assert.equal(blockedProposals.allowed, false);

    // Different endpoint — independent counter
    const allowedExecute = await limiter.isRateLimited(
      "user5",
      "/api/execute",
      1,
      60_000,
    );
    assert.equal(allowedExecute.allowed, true);
  });

  await t.test("resetAt is set to end of current window", async () => {
    const store: SortedSetStore = {};
    const redis = makeMockRedis(store);
    const limiter = makeTestLimiter(redis, 10, 60_000);

    const before = Math.floor(Date.now() / 1000);
    const result = await limiter.isRateLimited(
      "user6",
      "/api/proposals",
      10,
      60_000,
    );
    const after = Math.ceil(Date.now() / 1000);

    // resetAt should be within [before, after + 60]
    assert.ok(result.resetAt >= before);
    assert.ok(result.resetAt <= after + 60);
  });
});

// ---------------------------------------------------------------------------
// Redis fallback
// ---------------------------------------------------------------------------

test("RedisRateLimiter Redis fallback", async (t) => {
  await t.test("falls back to in-memory when redis is null", async () => {
    const limiter = new RedisRateLimiter(undefined, {
      windowMs: 60_000,
      maxRequests: 3,
    });
    // No redis URL → usingFallback=true from the start

    for (let i = 0; i < 3; i++) {
      const r = await limiter.isRateLimited(
        "fb-user",
        "/api/proposals",
        3,
        60_000,
      );
      assert.equal(r.allowed, true);
    }

    const blocked = await limiter.isRateLimited(
      "fb-user",
      "/api/proposals",
      3,
      60_000,
    );
    assert.equal(blocked.allowed, false);
  });

  await t.test("falls back to in-memory when redis.eval throws", async () => {
    const limiter = new RedisRateLimiter(undefined, {
      windowMs: 60_000,
      maxRequests: 5,
    });
    const brokenRedis = {
      async eval() {
        throw new Error("ECONNREFUSED");
      },
      async quit() {},
      on() {
        return this;
      },
      connect() {
        return Promise.resolve();
      },
    };
    (limiter as any).redis = brokenRedis;
    (limiter as any).usingFallback = false;

    // First call triggers the error → switches to fallback → still returns a valid result
    const result = await limiter.isRateLimited(
      "err-user",
      "/api/proposals",
      5,
      60_000,
    );
    assert.equal(result.allowed, true);
    assert.equal((limiter as any).usingFallback, true);
  });

  await t.test(
    "in-memory fallback enforces limits correctly after Redis failure",
    async () => {
      const limiter = new RedisRateLimiter(undefined, {
        windowMs: 60_000,
        maxRequests: 2,
      });
      const brokenRedis = {
        async eval() {
          throw new Error("timeout");
        },
        async quit() {},
        on() {
          return this;
        },
        connect() {
          return Promise.resolve();
        },
      };
      (limiter as any).redis = brokenRedis;
      (limiter as any).usingFallback = false;

      // First call: Redis fails → fallback, count=1
      const r1 = await limiter.isRateLimited(
        "fallback-ip",
        "/api/proposals",
        2,
        60_000,
      );
      assert.equal(r1.allowed, true);

      // Subsequent calls use in-memory fallback
      const r2 = await limiter.isRateLimited(
        "fallback-ip",
        "/api/proposals",
        2,
        60_000,
      );
      assert.equal(r2.allowed, true);

      const r3 = await limiter.isRateLimited(
        "fallback-ip",
        "/api/proposals",
        2,
        60_000,
      );
      assert.equal(r3.allowed, false);
    },
  );
});

// ---------------------------------------------------------------------------
// createRedisRateLimitMiddleware
// ---------------------------------------------------------------------------

function makeRes(): {
  res: Response;
  state: { status: number; headers: Record<string, string>; body: any };
} {
  const state = {
    status: 200,
    headers: {} as Record<string, string>,
    body: undefined as any,
  };
  const res = {
    set: (h: string | Record<string, string>, v?: string) => {
      if (typeof h === "string") state.headers[h] = v!;
      else Object.assign(state.headers, h);
      return res;
    },
    status: (code: number) => {
      state.status = code;
      return res;
    },
    json: (b: any) => {
      state.body = b;
      return res;
    },
  } as unknown as Response;
  return { res, state };
}

function makeReq(ip = "127.0.0.1", path = "/api/proposals"): Request {
  return { socket: { remoteAddress: ip }, path } as unknown as Request;
}

test("createRedisRateLimitMiddleware", async (t) => {
  await t.test("disabled middleware always calls next()", async () => {
    const mw = createRedisRateLimitMiddleware({
      enabled: false,
      limit: 1,
      windowMs: 60_000,
    });
    let called = false;
    await (mw as any)(makeReq(), makeRes().res, () => {
      called = true;
    });
    assert.equal(called, true);
  });

  await t.test("sets X-RateLimit-* headers on allowed requests", async () => {
    const mw = createRedisRateLimitMiddleware({ limit: 10, windowMs: 60_000 });
    const { res, state } = makeRes();
    let nextCalled = false;
    await (mw as any)(makeReq("10.0.0.1"), res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.ok(state.headers["X-RateLimit-Limit"]);
    assert.ok(state.headers["X-RateLimit-Remaining"]);
    assert.ok(state.headers["X-RateLimit-Reset"]);
  });

  await t.test("returns 429 when limit exceeded", async () => {
    const mw = createRedisRateLimitMiddleware({ limit: 2, windowMs: 60_000 });
    const ip = "10.0.0.99";

    for (let i = 0; i < 2; i++) {
      await (mw as any)(makeReq(ip), makeRes().res, () => {});
    }

    const { res, state } = makeRes();
    let nextCalled = false;
    await (mw as any)(makeReq(ip), res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(state.status, 429);
    assert.equal(state.body?.error?.code, "RATE_LIMIT_EXCEEDED");
    assert.ok(state.headers["Retry-After"]);
  });
});
