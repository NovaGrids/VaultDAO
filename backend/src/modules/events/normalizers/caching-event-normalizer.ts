/**
 * CachingEventNormalizer
 *
 * A transparent caching layer in front of {@link EventNormalizer.normalize}.
 *
 * On every call to {@link CachingEventNormalizer.normalize}:
 *   1. The cache is checked with the event's `id` as key.
 *   2. On a **hit** the cached {@link NormalizedEvent} is returned immediately
 *      — no parsing work is done.
 *   3. On a **miss** the underlying {@link EventNormalizer.normalize} is
 *      called, the result is stored in the cache, and then returned.
 *
 * The actual parsing logic inside {@link EventNormalizer} is unchanged.
 *
 * ## Cache key
 * `event.id` is the Soroban paging token (`<ledger>-<tx_index>-<event_index>`).
 * It is globally unique per emitted event and immutable once the ledger closes,
 * making it a collision-resistant, stable cache key without any additional
 * hashing over XDR bytes.
 *
 * ## Usage
 * ```ts
 * // Construct once and inject wherever EventNormalizer.normalize was called:
 * const cachingNormalizer = new CachingEventNormalizer(
 *   env.normalizerCacheMaxSize,
 *   metrics,
 * );
 *
 * // Drop-in replacement for EventNormalizer.normalize(event):
 * const normalized = cachingNormalizer.normalize(event);
 * ```
 */

import type { ContractEvent } from "../events.types.js";
import type { NormalizedEvent } from "../types.js";
import type { MetricsRegistry } from "../../health/metrics.registry.js";
import { EventNormalizer } from "./index.js";
import {
  NormalizerCache,
  DEFAULT_NORMALIZER_CACHE_MAX_SIZE,
  registerNormalizerCacheMetrics,
} from "./normalizer-cache.js";

export class CachingEventNormalizer {
  private readonly cache: NormalizerCache;

  /**
   * @param maxSize  Maximum cache entries before LRU eviction kicks in.
   *                 Defaults to {@link DEFAULT_NORMALIZER_CACHE_MAX_SIZE} (10,000).
   *                 Configure via `NORMALIZER_CACHE_MAX_SIZE` env var.
   * @param metrics  Optional metrics registry. When provided, hit/miss counters
   *                 are emitted as Prometheus-compatible counters.
   */
  constructor(
    maxSize: number = DEFAULT_NORMALIZER_CACHE_MAX_SIZE,
    metrics?: MetricsRegistry,
  ) {
    if (metrics) {
      registerNormalizerCacheMetrics(metrics);
    }
    this.cache = new NormalizerCache(maxSize, metrics);
  }

  /**
   * Normalize a contract event, returning a cached result when available.
   *
   * Semantics are identical to {@link EventNormalizer.normalize} — this method
   * is a drop-in replacement.
   */
  public normalize(event: ContractEvent): NormalizedEvent {
    const key = event.id;

    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const result = EventNormalizer.normalize(event);
    this.cache.set(key, result);
    return result;
  }

  /**
   * Returns the number of entries currently held in the cache.
   * Useful for health checks and tests.
   */
  public get cacheSize(): number {
    return this.cache.size;
  }

  /**
   * Clears all cache entries.
   * Intended for test teardown or hot-reload scenarios.
   */
  public clearCache(): void {
    this.cache.clear();
  }
}
