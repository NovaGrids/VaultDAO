import type { CacheStats, TaggedCacheAdapter } from "./cache.adapter.js";

const DEFAULT_MAX_SIZE = 1_000;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_VALUE_BYTES = 1024 * 1024;

interface LRUCacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number | null;
  readonly createdAt: number;
  readonly tags: readonly string[];
}

export interface LRUCacheStats extends CacheStats {
  readonly maxSize: number;
  readonly hitRate: number;
  readonly missRate: number;
  readonly oldestEntry: string | null;
}

export interface LRUCacheOptions {
  readonly maxSize?: number;
  readonly defaultTtlMs?: number;
}

export class LRUCacheManager<T = unknown> implements TaggedCacheAdapter<T> {
  private readonly maxSize: number;
  private readonly defaultTtlMs: number;
  private readonly entries = new Map<string, LRUCacheEntry<T>>();
  private readonly tagIndex = new Map<string, Set<string>>();
  private hits = 0;
  private misses = 0;

  constructor(options: LRUCacheOptions = {}) {
    this.maxSize = Math.max(1, options.maxSize ?? DEFAULT_MAX_SIZE);
    this.defaultTtlMs = Math.max(0, options.defaultTtlMs ?? DEFAULT_TTL_MS);
  }

  get(key: string): T | null {
    const entry = this.entries.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    if (this.isExpired(entry)) {
      this.delete(key);
      this.misses++;
      return null;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number, tags: readonly string[] = []): void {
    this.assertValueSize(value);

    if (this.entries.has(key)) {
      this.delete(key);
    }

    while (this.entries.size >= this.maxSize) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.delete(oldestKey);
    }

    const effectiveTtlMs = ttlMs ?? this.defaultTtlMs;
    const entry: LRUCacheEntry<T> = {
      value,
      expiresAt: effectiveTtlMs > 0 ? Date.now() + effectiveTtlMs : null,
      createdAt: Date.now(),
      tags,
    };

    this.entries.set(key, entry);
    for (const tag of tags) {
      let keys = this.tagIndex.get(tag);
      if (!keys) {
        keys = new Set();
        this.tagIndex.set(tag, keys);
      }
      keys.add(key);
    }
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;

    this.entries.delete(key);
    for (const tag of entry.tags) {
      const keys = this.tagIndex.get(tag);
      keys?.delete(key);
      if (keys?.size === 0) {
        this.tagIndex.delete(tag);
      }
    }
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  clear(): void {
    this.entries.clear();
    this.tagIndex.clear();
    this.resetStats();
  }

  countByPrefix(prefix: string): number {
    this.pruneExpired();
    let count = 0;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) count++;
    }
    return count;
  }

  deleteByPrefix(prefix: string): number {
    let deleted = 0;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) {
        this.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  async getOrSet(
    key: string,
    ttlMs: number,
    fetchFn: () => Promise<T>,
    tags: readonly string[] = [],
  ): Promise<T> {
    const cached = this.get(key);
    if (cached !== null) return cached;

    const value = await fetchFn();
    this.set(key, value, ttlMs, tags);
    return value;
  }

  invalidateByTag(tag: string): number {
    const keys = this.tagIndex.get(tag);
    if (!keys) return 0;

    let deleted = 0;
    for (const key of [...keys]) {
      this.delete(key);
      deleted++;
    }
    return deleted;
  }

  invalidatePattern(pattern: string): number {
    const matcher = globToRegExp(pattern);
    let deleted = 0;
    for (const key of [...this.entries.keys()]) {
      if (matcher.test(key)) {
        this.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  stats(): LRUCacheStats {
    this.pruneExpired();
    const total = this.hits + this.misses;
    const hitRate = total === 0 ? 0 : this.hits / total;
    return {
      size: this.entries.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRatio: hitRate,
      hitRate,
      missRate: total === 0 ? 0 : this.misses / total,
      oldestEntry: this.oldestEntry(),
    };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  destroy(): void {
    this.clear();
  }

  private oldestEntry(): string | null {
    const first = this.entries.keys().next().value as string | undefined;
    return first ?? null;
  }

  private pruneExpired(): void {
    for (const [key, entry] of [...this.entries.entries()]) {
      if (this.isExpired(entry)) {
        this.delete(key);
      }
    }
  }

  private isExpired(entry: LRUCacheEntry<T>): boolean {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt;
  }

  private assertValueSize(value: T): void {
    const bytes = Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");
    if (bytes > MAX_VALUE_BYTES) {
      throw new Error(`Cache value exceeds 1MB limit (${bytes} bytes)`);
    }
  }
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
