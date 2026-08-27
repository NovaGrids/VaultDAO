/**
 * cache.ts — Contract Function Caching Layer
 *
 * Implements a TTL-based cache for read-only contract calls to reduce RPC load.
 * Cache keys are deterministic: contract_id + function_name + params_hash
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  hitCount: number;
  missCount: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
}

export interface CacheMetrics {
  hitRate: number;
  totalRequests: number;
  avgTimeToLive: number;
}

/**
 * Simple deterministic hash function for cache key generation
 * Works in both Node.js and browser environments
 */
function hashParams(contractId: string, functionName: string, params: unknown): string {
  const combined = contractId + ':' + functionName + ':' + JSON.stringify(params);
  
  // Simple string hash function that works in all environments
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  return 'cache_' + Math.abs(hash).toString(36);
}

/**
 * ContractCache — TTL-based in-memory cache for contract calls
 *
 * Features:
 * - Automatic expiration via TTL
 * - Deterministic cache keys from contract ID + function + params
 * - Cache hit/miss metrics
 * - Configurable TTL (default: 60 seconds)
 */
export class ContractCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private stats: CacheStats = { hits: 0, misses: 0, evictions: 0 };
  private defaultTtl: number; // milliseconds
  private maxEntries: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(defaultTtlSeconds: number = 60, maxEntries: number = 1000) {
    this.defaultTtl = defaultTtlSeconds * 1000;
    this.maxEntries = maxEntries;
    // Clean up expired entries every 10 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 10000);
  }

  /**
   * Generate a cache key from contract context and parameters
   */
  private getKey(contractId: string, functionName: string, params: unknown): string {
    // Keep the contractId:functionName prefix in clear text (not just hashed
    // in) so clearFunction()/clearContract() can find matching keys via
    // startsWith() below.
    return contractId + ':' + functionName + ':' + hashParams(contractId, functionName, params);
  }

  /**
   * Get a cached value if it exists and hasn't expired
   */
  get<T>(
    contractId: string,
    functionName: string,
    params: unknown
  ): T | null {
    const key = this.getKey(contractId, functionName, params);
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.evictions++;
      return null;
    }

    this.stats.hits++;
    entry.hitCount++;
    return entry.value;
  }

  /**
   * Set a value in the cache with optional custom TTL
   */
  set<T>(
    contractId: string,
    functionName: string,
    params: unknown,
    value: T,
    ttlSeconds?: number
  ): void {
    const key = this.getKey(contractId, functionName, params);
    const ttlMs = (ttlSeconds ?? this.defaultTtl / 1000) * 1000;

    // Evict oldest entry if cache is full
    if (this.cache.size >= this.maxEntries) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [k, v] of this.cache.entries()) {
        if (v.expiresAt < oldestTime) {
          oldestTime = v.expiresAt;
          oldestKey = k;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
        this.stats.evictions++;
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      hitCount: 0,
      missCount: 0,
    });
  }

  /**
   * Clear a specific cached entry
   */
  clear(contractId: string, functionName: string, params: unknown): void {
    const key = this.getKey(contractId, functionName, params);
    this.cache.delete(key);
  }

  /**
   * Clear all entries for a specific contract function
   */
  clearFunction(contractId: string, functionName: string): void {
    const prefix = contractId + ':' + functionName + ':';
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));
  }

  /**
   * Clear all entries for a specific contract
   */
  clearContract(contractId: string): void {
    const prefix = contractId + ':';
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));
  }

  /**
   * Clear all cache entries
   */
  clearAll(): void {
    this.cache.clear();
  }

  /**
   * Remove all expired entries
   */
  cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach(key => {
      this.cache.delete(key);
      this.stats.evictions++;
    });
  }

  /**
   * Get current cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get cache metrics including hit rate
   */
  getMetrics(): CacheMetrics {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;

    // Calculate average time-to-live for entries
    let totalTtl = 0;
    let entryCount = 0;
    const now = Date.now();

    for (const entry of this.cache.values()) {
      const ttl = Math.max(0, entry.expiresAt - now);
      totalTtl += ttl;
      entryCount++;
    }

    const avgTimeToLive = entryCount > 0 ? totalTtl / entryCount : 0;

    return {
      hitRate,
      totalRequests,
      avgTimeToLive: Math.round(avgTimeToLive) / 1000, // Convert back to seconds
    };
  }

  /**
   * Get current cache size (number of entries)
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Destroy the cache and clean up intervals
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clearAll();
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }
}

// Global cache instance
let globalCache: ContractCache | null = null;

/**
 * Get or create the global contract cache
 */
export function getGlobalCache(defaultTtlSeconds?: number): ContractCache {
  if (!globalCache) {
    globalCache = new ContractCache(defaultTtlSeconds ?? 60);
  }
  return globalCache;
}

/**
 * Destroy the global cache
 */
export function destroyGlobalCache(): void {
  if (globalCache) {
    globalCache.destroy();
    globalCache = null;
  }
}
