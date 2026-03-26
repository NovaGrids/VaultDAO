import type { Request, Response, NextFunction } from "express";

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  skipSuccessfulRequests?: boolean; // Don't count successful responses
}

interface ClientState {
  count: number;
  resetTime: number;
}

/**
 * In-memory rate limiter for lightweight abuse protection
 * Suitable for MVP and light public backends
 */
export class RateLimiter {
  private clients = new Map<string, ClientState>();
  private readonly config: Required<RateLimitConfig>;

  constructor(config: RateLimitConfig) {
    this.config = {
      windowMs: config.windowMs,
      maxRequests: config.maxRequests,
      skipSuccessfulRequests: config.skipSuccessfulRequests ?? false,
    };

    // Cleanup expired entries periodically
    this.startCleanup();
  }

  /**
   * Get the client identifier from request
   * Uses IP address for client identification
   */
  private getClientId(req: Request): string {
    return (
      (req.headers["x-forwarded-for"] as string)?.split(",")[0] ||
      req.socket.remoteAddress ||
      "unknown"
    ).trim();
  }

  /**
   * Check if client has exceeded rate limit
   */
  isLimited(req: Request): boolean {
    const clientId = this.getClientId(req);
    const now = Date.now();

    const state = this.clients.get(clientId);

    if (!state || now >= state.resetTime) {
      // New window
      this.clients.set(clientId, {
        count: 1,
        resetTime: now + this.config.windowMs,
      });
      return false;
    }

    state.count += 1;
    return state.count > this.config.maxRequests;
  }

  /**
   * Get remaining requests for client
   */
  getRemaining(req: Request): number {
    const clientId = this.getClientId(req);
    const state = this.clients.get(clientId);

    if (!state || Date.now() >= state.resetTime) {
      return this.config.maxRequests;
    }

    return Math.max(0, this.config.maxRequests - state.count);
  }

  /**
   * Get reset time for client (milliseconds)
   */
  getResetTime(req: Request): number {
    const clientId = this.getClientId(req);
    const state = this.clients.get(clientId);
    return state?.resetTime ?? Date.now();
  }

  /**
   * Cleanup expired entries periodically
   */
  private startCleanup(): void {
    const cleanupInterval = Math.min(60000, this.config.windowMs); // At least every minute
    setInterval(() => {
      const now = Date.now();
      for (const [clientId, state] of this.clients.entries()) {
        if (now >= state.resetTime) {
          this.clients.delete(clientId);
        }
      }
    }, cleanupInterval);
  }

  /**
   * Reset all clients (useful for tests)
   */
  reset(): void {
    this.clients.clear();
  }

  /**
   * Get max requests config
   */
  getMaxRequests(): number {
    return this.config.maxRequests;
  }
}

/**
 * Express middleware factory for rate limiting
 * Returns 429 Too Many Requests when limit exceeded
 */
export function createRateLimitMiddleware(config: RateLimitConfig) {
  const limiter = new RateLimiter(config);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (limiter.isLimited(req)) {
      const resetTime = new Date(limiter.getResetTime(req));
      res.set({
        "Retry-After": Math.ceil(
          (limiter.getResetTime(req) - Date.now()) / 1000
        ).toString(),
        "X-RateLimit-Limit": limiter.getMaxRequests().toString(),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": resetTime.toISOString(),
      });

      res.status(429).json({
        success: false,
        error: {
          message: "Too Many Requests",
          code: "RATE_LIMIT_EXCEEDED",
          details: {
            retryAfter: resetTime.toISOString(),
          },
        },
      });
      return;
    }

    // Set rate limit headers
    res.set({
      "X-RateLimit-Limit": limiter.getMaxRequests().toString(),
      "X-RateLimit-Remaining": limiter.getRemaining(req).toString(),
      "X-RateLimit-Reset": new Date(limiter.getResetTime(req)).toISOString(),
    });

    next();
  };
}
