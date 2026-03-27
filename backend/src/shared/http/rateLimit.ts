import type { Request, Response, NextFunction } from "express";

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  skipSuccessfulRequests?: boolean; // Don't count successful responses
  /**
   * When true, trust the X-Forwarded-For header to identify the real client IP.
   * Only enable this when the server sits behind a trusted reverse proxy.
   * Defaults to false — uses socket.remoteAddress to prevent IP spoofing.
   */
  trustProxy?: boolean;
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
      trustProxy: config.trustProxy ?? false,
    };

    // Cleanup expired entries periodically
    this.startCleanup();
  }

  /**
   * Get the client identifier from request.
   * Uses socket.remoteAddress by default to prevent IP spoofing.
   * Only reads X-Forwarded-For when trustProxy is explicitly enabled.
   */
  private getClientId(req: Request): string {
    if (this.config.trustProxy) {
      const forwarded = req.headers["x-forwarded-for"] as string | undefined;
      if (forwarded) {
        return forwarded.split(",")[0].trim();
      }
    }
    return (req.socket.remoteAddress ?? "unknown").trim();
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
    const handle = setInterval(() => {
      const now = Date.now();
      for (const [clientId, state] of this.clients.entries()) {
        if (now >= state.resetTime) {
          this.clients.delete(clientId);
        }
      }
    }, cleanupInterval);
    handle.unref();
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
          (limiter.getResetTime(req) - Date.now()) / 1000,
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
