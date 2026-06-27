import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { createRedisRateLimitStore } from "./redis-rate-limit.store.js";

describe("RedisRateLimitStore", () => {
  it("should create store without Redis URL", () => {
    const store = createRedisRateLimitStore(undefined, {
      windowMs: 60000,
      maxRequests: 100,
    });
    assert.ok(store);
  });

  it("should fall back to in-memory when Redis is unavailable", async () => {
    const fallbackStore = createRedisRateLimitStore(undefined, {
      windowMs: 60000,
      maxRequests: 100,
    });

    const req = {
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as Request;

    const isLimited = await fallbackStore.isLimited(req);
    assert.strictEqual(isLimited, false);
  });
});
