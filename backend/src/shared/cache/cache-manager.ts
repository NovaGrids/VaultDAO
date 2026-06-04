import { createLogger } from "../logging/logger.js";
import type {
  CacheAdapter,
  CacheStats,
  TaggedCacheAdapter,
} from "./cache.adapter.js";
import { InMemoryCacheAdapter } from "./cache.adapter.js";
import { LRUCacheManager, type LRUCacheOptions } from "./lru-cache.manager.js";

const logger = createLogger("cache-manager");

// ── Well-known cache tags ─────────────────────────────────────────────────────

export const CacheTags = {
  proposal: (id: string) => `proposal:${id}`,
  contractProposals: (contractId: string) => `contract:${contractId}:proposals`,
  config: (contractId: string) => `config:${contractId}`,
  signers: (contractId: string) => `signers:${contractId}`,
} as const;

// ── CacheManager ──────────────────────────────────────────────────────────────

/**
 * Facade over a TaggedCacheAdapter that adds:
 * - Convenience tag-keyed helpers
 * - Event-driven invalidation hooks
 * - Graceful fallback to InMemoryCacheAdapter when primary is unavailable
 */
export class CacheManager implements CacheAdapter<unknown> {
  private readonly primary: TaggedCacheAdapter;
  private readonly fallback: InMemoryCacheAdapter<unknown>;

  constructor(primary?: TaggedCacheAdapter, lruOptions?: LRUCacheOptions) {
    this.fallback = new InMemoryCacheAdapter();
    this.primary = primary ?? new LRUCacheManager(lruOptions);
  }

  get<T>(key: string): T | null {
    return this.primary.get(key) as T | null;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    (this.primary as TaggedCacheAdapter<T>).set(key, value, ttlMs);
  }

  delete(key: string): void {
    this.primary.delete(key);
  }

  has(key: string): boolean {
    return this.primary.has(key);
  }

  clear(): void {
    this.primary.clear();
  }

  countByPrefix(prefix: string): number {
    return this.primary.countByPrefix(prefix);
  }

  deleteByPrefix(prefix: string): number {
    return this.primary.deleteByPrefix(prefix);
  }

  invalidate(pattern: string): number {
    return this.invalidatePattern(pattern);
  }

  // ── Cache-aside ─────────────────────────────────────────────────────────────

  async getOrSet<T>(
    key: string,
    ttlMs: number,
    fetchFn: () => Promise<T>,
    tags: string[] = [],
  ): Promise<T> {
    try {
      return await (this.primary as TaggedCacheAdapter<T>).getOrSet(
        key,
        ttlMs,
        fetchFn,
        tags,
      );
    } catch (err) {
      logger.warn("primary cache error, using fallback", {
        key,
        error: String(err),
      });
      const cached = this.fallback.get(key) as T | null;
      if (cached !== null) return cached;
      const value = await fetchFn();
      this.fallback.set(key, value, ttlMs);
      return value;
    }
  }

  // ── Invalidation ────────────────────────────────────────────────────────────

  invalidateByTag(tag: string): void {
    try {
      this.primary.invalidateByTag(tag);
    } catch (err) {
      logger.warn("tag invalidation error", { tag, error: String(err) });
    }
    this.fallback.deleteByPrefix(tag);
  }

  invalidatePattern(pattern: string): number {
    let deleted = 0;
    try {
      deleted = this.primary.invalidatePattern(pattern);
    } catch (err) {
      logger.warn("pattern invalidation error", {
        pattern,
        error: String(err),
      });
    }
    this.fallback.deleteByPrefix(pattern.replace(/\*/g, ""));
    return deleted;
  }

  // ── Event-driven invalidation hooks ─────────────────────────────────────────

  onProposalCreated(contractId: string): void {
    this.invalidateByTag(CacheTags.contractProposals(contractId));
    logger.debug("invalidated proposals cache", { contractId });
  }

  onConfigUpdated(contractId: string): void {
    this.invalidateByTag(CacheTags.config(contractId));
    this.invalidateByTag(CacheTags.signers(contractId));
    logger.debug("invalidated config/signers cache", { contractId });
  }

  // ── Stats ────────────────────────────────────────────────────────────────────

  stats(): CacheStats & { fallback: CacheStats } {
    return {
      ...this.primary.stats(),
      fallback: this.fallback.stats(),
    };
  }

  resetMetrics(): void {
    this.primary.resetStats?.();
    this.fallback.resetStats();
  }

  destroy(): void {
    if (
      "destroy" in this.primary &&
      typeof this.primary.destroy === "function"
    ) {
      this.primary.destroy();
    }
    this.fallback.destroy();
  }
}
