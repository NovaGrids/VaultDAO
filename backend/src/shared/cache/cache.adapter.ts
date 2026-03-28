import { createLogger } from "../logging/logger.js";

/**
 * Cache entry with TTL support.
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number | null; // null = never expires
}

/**
 * Cache adapter interface.
 *
 * Provides a lightweight abstraction for caching frequently accessed data.
 * Simple get/set/delete operations with optional TTL support.
 *
 * Design principles:
 * - Explicit TTL (no silent staleness)
 * - Simple interface
 * - Supports cache invalidation hooks
 * - Suitable for public status, metrics, read models
 *
 * @template T The type of values being cached
 */
export interface CacheAdapter<T> {
  /**
   * Get a value from the cache.
   * Returns null if not found or expired.
   */
  get(key: string): T | null;

  /**
   * Set a value in the cache with optional TTL.
   * If ttlMs is not provided, the entry never expires.
   */
  set(key: string, value: T, ttlMs?: number): void;

  /**
   * Delete a value from the cache.
   */
  delete(key: string): void;

  /**
   * Check if a key exists and is not expired.
   */
  has(key: string): boolean;

  /**
   * Clear all entries from the cache.
   */
  clear(): void;

  /**
   * Get cache statistics.
   */
  stats(): CacheStats;

  /**
   * Reset cache statistics without clearing entries.
   */
  resetStats?(): void;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
}

/**
 * In-memory cache adapter with TTL support.
 *
 * Suitable for:
 * - Caching public status responses
 * - Storing frequently computed read models
 * - Temporary results (metrics, aggregations)
 * - Development and testing
 *
 * Limitations:
 * - Data is lost on shutdown (use persistent cache for critical data)
 * - Not suitable for shared state across multiple processes
 * - Memory usage grows unbounded (consider setting maintenance intervals)
 */
export class InMemoryCacheAdapter<T> implements CacheAdapter<T> {
  private readonly logger = createLogger("cache");
  private cache = new Map<string, CacheEntry<T>>();
  private hits = 0;
  private misses = 0;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    private cleanupIntervalMs: number = 5 * 60 * 1000, // 5 minutes
  ) {
    this.startCleanupInterval();
  }

  /**
   * Get a value from the cache.
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check if expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.value;
  }

  /**
   * Set a value in the cache.
   */
  set(key: string, value: T, ttlMs?: number): void {
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    this.cache.set(key, { value, expiresAt });
  }

  /**
   * Delete a value from the cache.
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Check if a key exists and is not expired.
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Reset cache statistics without clearing entries.
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.resetStats();
    this.logger.info("cache cleared", { entries: size });
  }

  /**
   * Get cache statistics.
   */
  stats(): CacheStats {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
    };
  }

  /**
   * Stop the cleanup interval (call during shutdown).
   */
  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Start automatic cleanup of expired entries.
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      let removed = 0;
      const now = Date.now();

      for (const [key, entry] of this.cache.entries()) {
        if (entry.expiresAt && now > entry.expiresAt) {
          this.cache.delete(key);
          removed++;
        }
      }

      if (removed > 0) {
        this.logger.info("cache cleanup", {
          removed,
          remaining: this.cache.size,
        });
      }
    }, this.cleanupIntervalMs);

    // Don't keep the process alive solely for cleanup
    this.cleanupInterval.unref();
  }
}
