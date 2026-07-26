/**
 * NormalizerCache
 *
 * An LRU cache with TTL eviction that sits in front of EventNormalizer.normalize().
 * Avoids reparsing identical Soroban contract events across poll cycles.
 *
 * ## Key derivation
 * The cache key is `event.id` — the Soroban paging token, formatted as
 * `<ledger>-<tx_index>-<event_index>`. This is globally unique per emitted
 * event (immutable once the ledger closes) and stable across poll restarts,
 * so no additional hashing over XDR bytes is required.
 *
 * ## Eviction policy
 * - **LRU**: when the cache reaches `maxSize`, the least-recently-used entry
 *   is evicted before inserting a new one.
 * - **TTL**: entries older than `ttlMs` (default 7 days) are treated as stale
 *   on read and evicted lazily.  This matches the event cleanup window so
 *   nothing meaningful is lost at expiry.
 *
 * ## Size config
 * `maxSize` defaults to {@link DEFAULT_NORMALIZER_CACHE_MAX_SIZE} (10,000) and
 * is configurable via the `NORMALIZER_CACHE_MAX_SIZE` env var (see env.ts /
 * `.env.example`).
 *
 * ## Metrics
 * Pass a {@link MetricsRegistry} to emit Prometheus-compatible counters:
 *   - `vaultdao_normalizer_cache_hits_total`   — cache hit, parse skipped
 *   - `vaultdao_normalizer_cache_misses_total` — cache miss, event reparsed
 */

import type { NormalizedEvent } from "../types.js";
import type { MetricsRegistry } from "../../health/metrics.registry.js";

/** Default maximum number of entries kept in the normalizer cache. */
export const DEFAULT_NORMALIZER_CACHE_MAX_SIZE = 10_000;

/**
 * 7-day TTL in milliseconds.
 * Matches the event-data retention window so no useful entries are dropped
 * prematurely; stale entries past this age are evicted lazily on next read.
 */
export const NORMALIZER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 604_800_000 ms

// ── Metric name constants ─────────────────────────────────────────────────────

/** Counter: normalizer cache hits (parse skipped, cached result returned). */
export const NORMALIZER_CACHE_HIT_COUNTER =
  "vaultdao_normalizer_cache_hits_total";

/** Counter: normalizer cache misses (event parsed and result stored). */
export const NORMALIZER_CACHE_MISS_COUNTER =
  "vaultdao_normalizer_cache_misses_total";

/**
 * Register the normalizer-cache counters on the given registry.
 * Safe to call multiple times — re-registration only overwrites metadata.
 */
export function registerNormalizerCacheMetrics(
  registry: MetricsRegistry,
): void {
  registry.register(
    NORMALIZER_CACHE_HIT_COUNTER,
    "Total event normalizations served from the LRU+TTL cache (parse skipped)",
    "counter",
  );
  registry.register(
    NORMALIZER_CACHE_MISS_COUNTER,
    "Total event normalizations that required a full parse (cache miss or TTL expiry)",
    "counter",
  );
}

// ── Internal entry type ───────────────────────────────────────────────────────

interface CacheEntry {
  readonly value: NormalizedEvent;
  readonly insertedAt: number; // Date.now() at insertion
}

// ── NormalizerCache ───────────────────────────────────────────────────────────

/**
 * LRU cache with TTL for normalized Soroban contract events.
 *
 * Implemented over a native `Map` whose insertion-order property provides the
 * LRU order: on every read the entry is deleted and re-inserted at the tail
 * (most-recently-used position); the head of the map is always the
 * least-recently-used candidate for eviction.
 */
export class NormalizerCache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly metrics?: MetricsRegistry;

  constructor(
    maxSize: number = DEFAULT_NORMALIZER_CACHE_MAX_SIZE,
    metrics?: MetricsRegistry,
    ttlMs: number = NORMALIZER_CACHE_TTL_MS,
  ) {
    if (maxSize < 1) {
      throw new RangeError(
        `NormalizerCache maxSize must be at least 1, received ${maxSize}`,
      );
    }
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.metrics = metrics;
  }

  /**
   * Look up a cached normalized event by its Soroban event ID.
   *
   * Returns the cached value when present and within TTL (cache hit).
   * Returns `undefined` and emits a miss counter otherwise.
   * Expired entries are evicted lazily on access.
   */
  public get(key: string): NormalizedEvent | undefined {
    const entry = this.store.get(key);
    if (entry === undefined) {
      this.metrics?.incrementCounter(NORMALIZER_CACHE_MISS_COUNTER);
      return undefined;
    }

    // TTL check — treat stale entries as misses and evict immediately
    if (Date.now() - entry.insertedAt > this.ttlMs) {
      this.store.delete(key);
      this.metrics?.incrementCounter(NORMALIZER_CACHE_MISS_COUNTER);
      return undefined;
    }

    // Promote to most-recently-used (move to tail of Map)
    this.store.delete(key);
    this.store.set(key, entry);

    this.metrics?.incrementCounter(NORMALIZER_CACHE_HIT_COUNTER);
    return entry.value;
  }

  /**
   * Store a normalized event result.
   *
   * When the cache is at capacity the least-recently-used entry (Map head) is
   * evicted before inserting the new one, keeping memory bounded at `maxSize`.
   */
  public set(key: string, value: NormalizedEvent): void {
    // Remove existing entry first so it re-inserts at the tail (MRU position)
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxSize) {
      // Evict least-recently-used (head of Map)
      const lruKey = this.store.keys().next().value;
      if (lruKey !== undefined) {
        this.store.delete(lruKey);
      }
    }

    this.store.set(key, { value, insertedAt: Date.now() });
  }

  /** Returns the number of entries currently in the cache. */
  public get size(): number {
    return this.store.size;
  }

  /** Removes all entries. Useful for test teardown. */
  public clear(): void {
    this.store.clear();
  }
}
