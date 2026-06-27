/**
 * Redis-backed rate limiter using a sliding window algorithm.
 *
 * Algorithm: sorted set per (userId, endpoint) key.
 *   - Score = request timestamp (ms)
 *   - On each request: atomically remove expired entries, count remaining,
 *     add new entry, and set TTL — all in a single Lua script.
 *
 * Falls back to the existing in-memory RateLimiter when Redis is unavailable
 * or when RATE_LIMIT_ENABLED=false.
 */

import type { Request, Response, NextFunction } from "express";
import { RateLimiter, type RateLimitConfig } from "./rateLimit.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Unix timestamp (seconds)
  limit: number;
}

// ---------------------------------------------------------------------------
// Lua script — atomic sliding window check + increment
// ---------------------------------------------------------------------------

/**
 * KEYS[1] = sorted-set key
 * ARGV[1] = now (ms, as string)
 * ARGV[2] = window size (ms, as string)
 * ARGV[3] = limit (max requests)
 * ARGV[4] = unique member id for this request
 *
 * Returns: [count_in_window_after_op, window_start_ms]
 * count_in_window_after_op > limit means the request was rejected (not added).
 */
const SLIDING_WINDOW_LUA = `
local key      = KEYS[1]
local now      = tonumber(ARGV[1])
local window   = tonumber(ARGV[2])
local limit    = tonumber(ARGV[3])
local member   = ARGV[4]
local cutoff   = now - window

-- Remove entries outside the window
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)

-- Count current entries
local count = redis.call('ZCARD', key)

if count < limit then
  -- Add this request
  redis.call('ZADD', key, now, member)
  count = count + 1
else
  -- Signal rejection: return limit+1
  count = limit + 1
end

-- Set TTL so the key auto-expires (window in seconds, rounded up)
redis.call('PEXPIRE', key, window)

return { count, now - window }
`;

// ---------------------------------------------------------------------------
// RedisRateLimiter
// ---------------------------------------------------------------------------

export class RedisRateLimiter {
  private redis: any | null = null;
  private readonly fallback: RateLimiter;
  private usingFallback = false;

  constructor(redisUrl: string | undefined, fallbackConfig: RateLimitConfig) {
    this.fallback = new RateLimiter(fallbackConfig);
    if (redisUrl) {
      this.connect(redisUrl);
    } else {
      this.usingFallback = true;
    }
  }

  private connect(url: string): void {
    // Dynamic import so the module can be loaded without ioredis installed
    // (falls back gracefully if the package is absent)
    import("ioredis")
      .then((mod) => {
        // ioredis exports the class as default; handle both CJS and ESM shapes
        const Redis: any = (mod as any).default ?? mod;
        const client = new Redis(url, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });

        client.on("error", () => {
          if (!this.usingFallback) {
            this.usingFallback = true;
          }
        });

        client.on("connect", () => {
          this.usingFallback = false;
        });

        this.redis = client;
        client.connect().catch(() => {
          this.usingFallback = true;
        });
      })
      .catch(() => {
        this.usingFallback = true;
      });
  }

  /**
   * Check and increment the rate limit for a given user + endpoint.
   */
  async isRateLimited(
    userId: string,
    endpoint: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    if (this.usingFallback || !this.redis) {
      return this.fallbackCheck(userId, limit, windowMs);
    }

    try {
      const key = `rl:${endpoint}:${userId}`;
      const now = Date.now();
      const member = `${now}-${Math.random().toString(36).slice(2)}`;

      const [countAfter, windowStart] = (await this.redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        key,
        String(now),
        String(windowMs),
        String(limit),
        member,
      )) as [number, number];

      const allowed = countAfter <= limit;
      const resetAt = Math.ceil((windowStart + windowMs) / 1000);

      return {
        allowed,
        remaining: allowed ? Math.max(0, limit - countAfter) : 0,
        resetAt,
        limit,
      };
    } catch {
      this.usingFallback = true;
      return this.fallbackCheck(userId, limit, windowMs);
    }
  }

  private fallbackCheck(
    userId: string,
    limit: number,
    _windowMs: number,
  ): RateLimitResult {
    // Reuse the in-memory limiter with a synthetic request object
    const req = { socket: { remoteAddress: userId } } as unknown as Request;
    const allowed = !this.fallback.isLimited(req);
    const remaining = this.fallback.getRemaining(req);
    const resetAt = Math.ceil(this.fallback.getResetTime(req) / 1000);
    return { allowed, remaining, resetAt, limit };
  }

  async quit(): Promise<void> {
    await this.redis?.quit().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export interface RedisRateLimitOptions {
  /** Redis URL — omit to use in-memory only */
  redisUrl?: string;
  /** Whether rate limiting is active at all */
  enabled?: boolean;
  limit: number;
  windowMs: number;
  /** Derive a user/client identifier from the request (defaults to IP) */
  keyBy?: (req: Request) => string;
}

export function createRedisRateLimitMiddleware(options: RedisRateLimitOptions) {
  const { enabled = true, limit, windowMs, redisUrl, keyBy } = options;

  if (!enabled) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  const limiter = new RedisRateLimiter(redisUrl, {
    windowMs,
    maxRequests: limit,
  });

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const userId = keyBy ? keyBy(req) : (req.socket.remoteAddress ?? "unknown");
    const endpoint = req.path ?? "/";

    const result = await limiter.isRateLimited(
      userId,
      endpoint,
      limit,
      windowMs,
    );

    res.set({
      "X-RateLimit-Limit": String(result.limit),
      "X-RateLimit-Remaining": String(result.remaining),
      "X-RateLimit-Reset": String(result.resetAt),
    });

    if (!result.allowed) {
      res.set(
        "Retry-After",
        String(result.resetAt - Math.floor(Date.now() / 1000)),
      );
      res.status(429).json({
        success: false,
        error: {
          message: "Too Many Requests",
          code: "RATE_LIMIT_EXCEEDED",
          details: {
            retryAfter: new Date(result.resetAt * 1000).toISOString(),
          },
        },
      });
      return;
    }

    next();
  };
}
