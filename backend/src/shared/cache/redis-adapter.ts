import { createLogger } from "../logging/logger.js";
import type { CacheStats, TaggedCacheAdapter } from "./cache.adapter.js";

const logger = createLogger("redis-cache");

/**
 * Minimal Redis client interface — compatible with `ioredis` and `redis` npm packages.
 * Injected so the adapter has no hard dependency on a specific Redis client.
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expiryMode: "PX", time: number): Promise<unknown>;
  set(key: string, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  srem(key: string, ...members: string[]): Promise<number>;
  ping(): Promise<string>;
}

interface StoredEntry<T> {
  value: T;
  tags: string[];
  expiresAt: number | null;
}

/**
 * Redis-backed cache adapter with tag-based invalidation.
 *
 * Keys are stored as JSON blobs. Tags are stored as Redis Sets:
 *   tag:{tagName} → Set<cacheKey>
 *
 * Gracefully degrades to a no-op when Redis is unavailable.
 */
export class RedisCacheAdapter<T = unknown> implements TaggedCacheAdapter<T> {
  private hits = 0;
  private misses = 0;
  private available = true;

  constructor(private readonly redis: RedisClient) {
    this.checkConnection();
  }

  private async checkConnection(): Promise<void> {
    try {
      await this.redis.ping();
      this.available = true;
    } catch (err) {
      this.available = false;
      logger.warn("Redis unavailable, cache degraded", { error: String(err) });
    }
  }

  get(_key: string): T | null {
    // Synchronous get not supported for Redis — use getOrSet for async access.
    // Returns null to satisfy the CacheAdapter interface.
    return null;
  }

  async getAsync(key: string): Promise<T | null> {
    if (!this.available) { this.misses++; return null; }
    try {
      const raw = await this.redis.get(key);
      if (!raw) { this.misses++; return null; }
      const entry: StoredEntry<T> = JSON.parse(raw);
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        await this.redis.del(key);
        this.misses++;
        return null;
      }
      this.hits++;
      return entry.value;
    } catch (err) {
      logger.warn("Redis get error", { key, error: String(err) });
      this.misses++;
      return null;
    }
  }

  set(_key: string, _value: T, _ttlMs?: number, _tags: string[] = []): void {
    void this.setAsync(_key, _value, _ttlMs, _tags);
  }

  async setAsync(key: string, value: T, ttlMs?: number, tags: string[] = []): Promise<void> {
    if (!this.available) return;
    try {
      const entry: StoredEntry<T> = {
        value,
        tags,
        expiresAt: ttlMs ? Date.now() + ttlMs : null,
      };
      const serialized = JSON.stringify(entry);
      if (ttlMs) {
        await this.redis.set(key, serialized, "PX", ttlMs);
      } else {
        await this.redis.set(key, serialized);
      }
      // Register key under each tag set
      for (const tag of tags) {
        await this.redis.sadd(`tag:${tag}`, key);
      }
    } catch (err) {
      logger.warn("Redis set error", { key, error: String(err) });
    }
  }

  delete(key: string): void {
    void this.redis.del(key).catch((err) => logger.warn("Redis del error", { key, error: String(err) }));
  }

  has(_key: string): boolean {
    // Async-only; return false for sync interface
    return false;
  }

  clear(): void {
    logger.warn("RedisCacheAdapter.clear() is a no-op — use invalidatePattern('*') instead");
  }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: -1, // unknown without DBSIZE call
      hits: this.hits,
      misses: this.misses,
      hitRatio: total === 0 ? 0 : this.hits / total,
    };
  }

  countByPrefix(_prefix: string): number {
    // Async-only; not supported synchronously
    return 0;
  }

  deleteByPrefix(_prefix: string): number {
    void this.invalidatePatternAsync(_prefix + "*");
    return 0;
  }

  // ── TaggedCacheAdapter ──────────────────────────────────────────────────────

  async getOrSet(key: string, ttlMs: number, fetchFn: () => Promise<T>, tags: string[] = []): Promise<T> {
    const cached = await this.getAsync(key);
    if (cached !== null) return cached;
    const value = await fetchFn();
    await this.setAsync(key, value, ttlMs, tags);
    return value;
  }

  invalidateByTag(tag: string): number {
    void this.invalidateByTagAsync(tag);
    return 0; // actual count resolved async
  }

  private async invalidateByTagAsync(tag: string): Promise<number> {
    if (!this.available) return 0;
    try {
      const keys = await this.redis.smembers(`tag:${tag}`);
      if (keys.length === 0) return 0;
      await this.redis.del(...keys);
      await this.redis.del(`tag:${tag}`);
      logger.info("tag invalidated", { tag, keys: keys.length });
      return keys.length;
    } catch (err) {
      logger.warn("Redis tag invalidation error", { tag, error: String(err) });
      return 0;
    }
  }

  invalidatePattern(pattern: string): number {
    void this.invalidatePatternAsync(pattern);
    return 0;
  }

  private async invalidatePatternAsync(pattern: string): Promise<number> {
    if (!this.available) return 0;
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length === 0) return 0;
      await this.redis.del(...keys);
      logger.info("pattern invalidated", { pattern, keys: keys.length });
      return keys.length;
    } catch (err) {
      logger.warn("Redis pattern invalidation error", { pattern, error: String(err) });
      return 0;
    }
  }

  /** Check if Redis is reachable. */
  async isAvailable(): Promise<boolean> {
    try {
      await this.redis.ping();
      this.available = true;
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }
}
