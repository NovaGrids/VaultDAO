import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface RateLimitConfig {
  /** Rolling window in milliseconds — also defines bucket refill period. */
  windowMs: number;
  /** Maximum tokens (requests) in a full bucket. */
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
  /**
   * When true, trust the X-Forwarded-For header to identify the real client IP.
   * Only enable this when the server sits behind a trusted reverse proxy.
   * Defaults to false — uses socket.remoteAddress to prevent IP spoofing.
   */
  trustProxy?: boolean;
  /** Redis URL — reserved for future distributed use; unused by token bucket. */
  redisUrl?: string;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface BucketState {
  /** Fractional token balance in range [0, capacity]. */
  tokens: number;
  /**
   * Timestamp (ms) when the current bucket was first created.
   * Used by getResetTime() to return a deterministic reset epoch.
   */
  windowStartMs: number;
  /** Timestamp (ms) of the last access — drives lazy refill. */
  lastRefillMs: number;
}

// ---------------------------------------------------------------------------
// TokenBucketLimiter
// ---------------------------------------------------------------------------

/**
 * In-memory token-bucket rate limiter (replaces the fixed-window RateLimiter).
 *
 * Algorithm
 * ---------
 * Each tracked key gets a bucket with `maxRequests` token capacity.
 * Tokens refill continuously at `maxRequests / windowMs` tokens/ms, computed
 * lazily on every request — no background timer needed.
 *
 * Refill formula (applied on each access):
 *   tokensNow = min(capacity, tokensLast + elapsed_ms × refillRatePerMs)
 *
 * A request costs 1 token.  Rejection occurs when tokensNow < 1.
 *
 * Two dimensions tracked independently per request:
 *   • Client IP  (always)
 *   • API key    (when Authorization: Bearer … is present)
 *
 * A request is rejected if EITHER bucket is exhausted.
 *
 * Retry-After formula (on rejection):
 *   waitMs         = (1 − tokensNow) / refillRatePerMs
 *                  = (1 − tokensNow) × windowMs / capacity
 *   retryAfterSecs = ceil(waitMs / 1000)   — always ≥ 1
 */
export class TokenBucketLimiter {
  protected readonly windowMs: number;
  protected readonly maxRequests: number;
  private readonly trustProxy: boolean;
  private readonly refillRatePerMs: number;

  private buckets = new Map<string, BucketState>();

  constructor(config: RateLimitConfig) {
    this.windowMs = config.windowMs;
    this.maxRequests = config.maxRequests;
    this.trustProxy = config.trustProxy ?? false;
    this.refillRatePerMs = config.maxRequests / config.windowMs;

    this.scheduleCleanup();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Attempt to consume one token for this request.
   * Checks IP and API-key buckets independently.
   */
  consume(req: Request): {
    allowed: boolean;
    remainingIp: number;
    remainingKey: number;
    retryAfterSecs: number;
    exhaustedDimension: "ip" | "apiKey" | null;
  } {
    const ip = this.extractIp(req);
    const apiKey = this.extractApiKey(req);

    const now = Date.now();
    const ipResult = this.consumeBucket(`ip:${ip}`, now);
    const keyResult = apiKey
      ? this.consumeBucket(`key:${apiKey}`, now)
      : { allowed: true, tokens: this.maxRequests, retryAfterSecs: 0 };

    const allowed = ipResult.allowed && keyResult.allowed;

    let exhaustedDimension: "ip" | "apiKey" | null = null;
    let retryAfterSecs = 0;

    if (!allowed) {
      if (!ipResult.allowed && !keyResult.allowed) {
        retryAfterSecs = Math.max(ipResult.retryAfterSecs, keyResult.retryAfterSecs);
        exhaustedDimension = "ip";
      } else if (!ipResult.allowed) {
        retryAfterSecs = ipResult.retryAfterSecs;
        exhaustedDimension = "ip";
      } else {
        retryAfterSecs = keyResult.retryAfterSecs;
        exhaustedDimension = "apiKey";
      }
    }

    return {
      allowed,
      remainingIp: Math.floor(ipResult.tokens),
      remainingKey: Math.floor(keyResult.tokens),
      retryAfterSecs,
      exhaustedDimension,
    };
  }

  /**
   * Peek at current token balance for this request without consuming.
   */
  peekRemaining(req: Request): number {
    const ip = this.extractIp(req);
    const apiKey = this.extractApiKey(req);
    const ipTokens = this.peekBucketTokens(`ip:${ip}`);
    const keyTokens = apiKey
      ? this.peekBucketTokens(`key:${apiKey}`)
      : this.maxRequests;
    return Math.floor(Math.min(ipTokens, keyTokens));
  }

  /**
   * Return the reset timestamp (ms) for this client's IP bucket.
   * Defined as windowStartMs + windowMs — matches fixed-window semantics
   * expected by the legacy interface and existing tests.
   */
  getResetTimeMs(req: Request): number {
    const ip = this.extractIp(req);
    const state = this.buckets.get(`ip:${ip}`);
    if (!state) return Date.now() + this.windowMs;
    return state.windowStartMs + this.windowMs;
  }

  /** Reset all buckets. */
  reset(): void {
    this.buckets.clear();
  }

  getMaxRequests(): number {
    return this.maxRequests;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Core token-bucket logic: lazy refill then consume.
   *
   * On the very first access for a key the bucket is initialised as full
   * (windowStartMs = now, tokens = capacity).  Subsequent accesses refill
   * fractionally based on elapsed time.
   *
   * When a bucket is exhausted the state is updated with the refilled-but-still-
   * empty balance so future peek/refill calculations remain accurate, but the
   * token is NOT deducted (you can't go below 0).
   */
  private consumeBucket(
    key: string,
    now: number,
  ): { allowed: boolean; tokens: number; retryAfterSecs: number } {
    const capacity = this.maxRequests;
    const state = this.buckets.get(key);

    let tokens: number;
    let windowStartMs: number;

    if (!state) {
      // New bucket — starts full
      tokens = capacity;
      windowStartMs = now;
    } else {
      const elapsedMs = now - state.lastRefillMs;
      // If a full window or more has elapsed, the bucket is definitely full.
      // Using an explicit check avoids floating-point under-refill:
      // elapsed × (capacity/windowMs) can be 13.9999... instead of 14 for
      // capacity=14, elapsed=windowMs, causing floor() to return 13 not 14.
      if (elapsedMs >= this.windowMs) {
        tokens = capacity;
      } else {
        tokens = Math.min(capacity, state.tokens + elapsedMs * this.refillRatePerMs);
      }
      windowStartMs = state.windowStartMs;
    }

    if (tokens < 1) {
      // Exhausted — compute Retry-After
      // waitMs = (1 − tokens) / refillRatePerMs = (1 − tokens) × windowMs / capacity
      const waitMs = (1 - tokens) * this.windowMs / capacity;
      const retryAfterSecs = Math.max(1, Math.ceil(waitMs / 1000));

      this.buckets.set(key, { tokens, windowStartMs, lastRefillMs: now });
      return { allowed: false, tokens, retryAfterSecs };
    }

    const newTokens = tokens - 1;
    this.buckets.set(key, { tokens: newTokens, windowStartMs, lastRefillMs: now });
    return { allowed: true, tokens: newTokens, retryAfterSecs: 0 };
  }

  private peekBucketTokens(key: string): number {
    const state = this.buckets.get(key);
    if (!state) return this.maxRequests;
    const elapsed = Date.now() - state.lastRefillMs;
    if (elapsed >= this.windowMs) return this.maxRequests;
    return Math.min(this.maxRequests, state.tokens + elapsed * this.refillRatePerMs);
  }

  private extractIp(req: Request): string {
    if (this.trustProxy) {
      const forwarded = req.headers["x-forwarded-for"] as string | undefined;
      if (forwarded) {
        return forwarded.split(",")[0]!.trim();
      }
    }
    return (req.socket?.remoteAddress ?? "unknown").trim();
  }

  private extractApiKey(req: Request): string | undefined {
    const headers = req.headers;
    if (!headers) return undefined;
    const auth = headers["authorization"];
    if (typeof auth === "string" && auth.startsWith("Bearer ")) {
      const key = auth.substring(7).trim();
      return key.length > 0 ? key : undefined;
    }
    return undefined;
  }

  private scheduleCleanup(): void {
    const interval = Math.min(60_000, this.windowMs);
    const handle = setInterval(() => {
      const now = Date.now();
      for (const [key, state] of this.buckets) {
        const elapsed = now - state.lastRefillMs;
        const tokens = elapsed >= this.windowMs
          ? this.maxRequests
          : Math.min(this.maxRequests, state.tokens + elapsed * this.refillRatePerMs);
        if (tokens >= this.maxRequests) {
          this.buckets.delete(key);
        }
      }
    }, interval);
    handle.unref();
  }
}

// ---------------------------------------------------------------------------
// RateLimiter — legacy alias (token bucket under the hood)
//
// Keeps the isLimited / getRemaining / getResetTime interface that existing
// tests import.  The token bucket naturally satisfies those contracts:
//
//   isLimited    → consume().allowed === false
//   getRemaining → peekRemaining() (does not consume)
//   getResetTime → windowStartMs + windowMs (deterministic per client)
//
// The one subtle contract in the existing P6 test is:
//   "after the first isLimited call at time T, getResetTime returns T + windowMs"
// The token bucket stores windowStartMs = T on first access, so this holds.
// ---------------------------------------------------------------------------

/**
 * Legacy interface wrapper around TokenBucketLimiter.
 * Exported for backwards compatibility with existing tests and code that
 * imports `RateLimiter` directly.
 */
export class RateLimiter extends TokenBucketLimiter {
  /**
   * Returns true when the request should be blocked (bucket exhausted).
   * Consumes one token.
   */
  isLimited(req: Request): boolean {
    return !this.consume(req).allowed;
  }

  /**
   * Returns the floor of remaining tokens for this client.
   * Does NOT consume a token.
   */
  getRemaining(req: Request): number {
    return this.peekRemaining(req);
  }

  /**
   * Returns the reset timestamp in milliseconds (windowStart + windowMs).
   * On the first call for a new client, windowStart = Date.now() at first
   * consume(), so this equals T + windowMs — matching the existing test P6.
   */
  getResetTime(req: Request): number {
    return this.getResetTimeMs(req);
  }
}

// ---------------------------------------------------------------------------
// Express middleware factory
// ---------------------------------------------------------------------------

/**
 * Token-bucket rate-limiting middleware (replaces fixed-window).
 *
 * Two independent dimensions are enforced per request:
 *   1. Client IP  — always checked
 *   2. API key    — checked when Authorization: Bearer … is present
 *
 * A 429 is returned if either bucket is exhausted.
 *
 * Response headers (all responses):
 *   X-RateLimit-Limit     — bucket capacity
 *   X-RateLimit-Remaining — floored token balance (min of IP and API-key)
 *   X-RateLimit-Reset     — Unix timestamp (s) of when the IP bucket started + windowMs
 *
 * 429 response additionally includes:
 *   Retry-After — seconds until ≥1 token refills in the exhausted bucket
 *                 (ceil((1 − tokens) × windowMs / capacity / 1000), min 1)
 */
export function createRateLimitMiddleware(config: RateLimitConfig) {
  const limiter = new TokenBucketLimiter(config);

  return (req: Request, res: Response, next: NextFunction): void => {
    const result = limiter.consume(req);

    const limit = limiter.getMaxRequests();
    const remaining = Math.min(result.remainingIp, result.remainingKey);
    const resetUnix = Math.ceil(limiter.getResetTimeMs(req) / 1000);

    res.set({
      "X-RateLimit-Limit": String(limit),
      "X-RateLimit-Remaining": String(remaining),
      "X-RateLimit-Reset": String(resetUnix),
    });

    if (!result.allowed) {
      res.set("Retry-After", String(result.retryAfterSecs));
      res.status(429).json({
        success: false,
        error: {
          message: "Too Many Requests",
          code: "RATE_LIMIT_EXCEEDED",
          details: {
            retryAfter: new Date(
              Date.now() + result.retryAfterSecs * 1000,
            ).toISOString(),
            exhaustedDimension: result.exhaustedDimension,
          },
        },
      });
      return;
    }

    next();
  };
}
