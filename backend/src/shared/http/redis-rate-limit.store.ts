import type { Request } from "express";
import type { RateLimitConfig } from "./rateLimit.js";
import { RateLimiter } from "./rateLimit.js";
import { createLogger } from "../../shared/logging/logger.js";

// Import ioredis dynamically to avoid requiring it when not used
const logger = createLogger("redis-rate-limit-store");

export interface RedisRateLimitStore {
  /**
   * Check if client has exceeded rate limit
   */
  isLimited(req: Request): Promise<boolean>;

  /**
   * Get remaining requests for client
   */
  getRemaining(req: Request): Promise<number>;

  /**
   * Get reset time for client (milliseconds)
   */
  getResetTime(req: Request): Promise<number>;

  /**
   * Reset all clients (useful for tests)
   */
  reset(): Promise<void>;
}

/**
 * Redis-backed rate limit store using INCR + EXPIRE pattern
 * Falls back to in-memory store when Redis is unavailable
 */
export class RedisRateLimitStore implements RedisRateLimitStore {
  private redisClient: any | null = null;
  private readonly fallback: RateLimiter;
  private usingFallback = false;
  constructor(redisUrl: string | undefined, config: RateLimitConfig) {
    this.fallback = new RateLimiter(config);

    if (redisUrl) {
      void this.connect(redisUrl);
    } else {
      this.usingFallback = true;
      logger.warn(
        "Redis URL not configured, falling back to in-memory rate limiting",
      );
    }
  }

  private async connect(url: string): Promise<void> {
    try {
      const ioredis = await import("ioredis");
      type RedisConstructor = new (
        url: string,
        options?: Record<string, unknown>,
      ) => {
        on(event: string, handler: (err: Error) => void): void;
        connect(): Promise<void>;
        incr(key: string): Promise<number>;
        expire(key: string, seconds: number): Promise<number>;
        quit(): Promise<void>;
      };
      const RedisClient = ioredis.default as unknown as RedisConstructor;
      this.redisClient = new RedisClient(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });

      this.redisClient.on("error", (err: Error) => {
        logger.warn("Redis connection error", { error: err.message });
        this.usingFallback = true;
      });

      this.redisClient.on("connect", () => {
        logger.info("Redis connection established");
        this.usingFallback = false;
      });

      await this.redisClient.connect();
      logger.info("Redis client connected successfully");
      this.usingFallback = false;
    } catch (err) {
      logger.warn("Failed to connect to Redis, falling back to in-memory", {
        error: err,
      });
      this.usingFallback = true;
    }
  }

  /**
   * Check if client has exceeded rate limit using Redis INCR + EXPIRE pattern
   */
  async isLimited(req: Request): Promise<boolean> {
    if (this.usingFallback || !this.redisClient) {
      return this.fallback.isLimited(req);
    }

    try {
      const clientId = this.getClientId(req);
      const key = `ratelimit:${clientId}:${Math.floor(Date.now() / 1000)}`;
      const windowMs = 60000; // 1 minute window

      // Use Redis INCR + EXPIRE for atomic operation
      const [count, expire] = await Promise.all([
        this.redisClient.incr(key),
        this.redisClient.expire(key, Math.floor(windowMs / 1000)),
      ]);

      // If first request, set TTL
      if (count === 1 && expire === 1) {
        await this.redisClient.expire(key, Math.floor(windowMs / 1000));
      }

      return count > this.fallback.getMaxRequests();
    } catch (err) {
      logger.warn("Redis rate limit check failed, falling back to in-memory", {
        error: err,
      });
      this.usingFallback = true;
      return this.fallback.isLimited(req);
    }
  }

  /**
   * Get remaining requests for client
   */
  async getRemaining(req: Request): Promise<number> {
    if (this.usingFallback || !this.redisClient) {
      return this.fallback.getRemaining(req);
    }

    try {
      const clientId = this.getClientId(req);
      const key = `ratelimit:${clientId}:${Math.floor(Date.now() / 1000)}`;

      const count = await this.redisClient.get(key);
      const maxRequests = this.fallback.getMaxRequests();

      return count ? Math.max(0, maxRequests - parseInt(count)) : maxRequests;
    } catch (err) {
      logger.warn("Redis getRemaining failed, falling back to in-memory", {
        error: err,
      });
      this.usingFallback = true;
      return this.fallback.getRemaining(req);
    }
  }

  /**
   * Get reset time for client (milliseconds)
   */
  async getResetTime(req: Request): Promise<number> {
    if (this.usingFallback || !this.redisClient) {
      return this.fallback.getResetTime(req);
    }

    try {
      this.getClientId(req);
      // Return current time + window duration
      return Date.now() + 60000; // 1 minute window
    } catch (err) {
      logger.warn("Redis getResetTime failed, falling back to in-memory", {
        error: err,
      });
      this.usingFallback = true;
      return this.fallback.getResetTime(req);
    }
  }

  /**
   * Reset all clients (useful for tests)
   */
  async reset(): Promise<void> {
    if (this.usingFallback || !this.redisClient) {
      this.fallback.reset();
      return;
    }

    try {
      await this.redisClient.flushdb();
      logger.info("Redis rate limit store flushed");
    } catch (err) {
      logger.warn("Redis flush failed, falling back to in-memory reset", {
        error: err,
      });
      this.usingFallback = true;
      this.fallback.reset();
    }
  }

  /**
   * Get the client identifier from request
   */
  private getClientId(req: Request): string {
    // Use the same logic as in RateLimiter
    const forwarded = req.headers["x-forwarded-for"] as string | undefined;
    if (forwarded) {
      return forwarded.split(",")[0].trim();
    }
    // For Express 5, use req.ip instead of req.socket.remoteAddress
    return req.ip ?? "unknown";
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
        logger.info("Redis connection closed");
      } catch (err) {
        logger.warn("Error closing Redis connection", { error: err });
      }
      this.redisClient = null;
    }
  }
}

/**
 * Factory function to create RedisRateLimitStore
 */
export function createRedisRateLimitStore(
  redisUrl: string | undefined,
  config: RateLimitConfig,
): RedisRateLimitStore {
  return new RedisRateLimitStore(redisUrl, config);
}
