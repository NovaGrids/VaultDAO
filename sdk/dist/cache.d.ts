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
 * ContractCache — TTL-based in-memory cache for contract calls
 *
 * Features:
 * - Automatic expiration via TTL
 * - Deterministic cache keys from contract ID + function + params
 * - Cache hit/miss metrics
 * - Configurable TTL (default: 60 seconds)
 */
export declare class ContractCache {
    private cache;
    private stats;
    private defaultTtl;
    private maxEntries;
    private cleanupInterval;
    constructor(defaultTtlSeconds?: number, maxEntries?: number);
    /**
     * Generate a cache key from contract context and parameters
     */
    private getKey;
    /**
     * Get a cached value if it exists and hasn't expired
     */
    get<T>(contractId: string, functionName: string, params: unknown): T | null;
    /**
     * Set a value in the cache with optional custom TTL
     */
    set<T>(contractId: string, functionName: string, params: unknown, value: T, ttlSeconds?: number): void;
    /**
     * Clear a specific cached entry
     */
    clear(contractId: string, functionName: string, params: unknown): void;
    /**
     * Clear all entries for a specific contract function
     */
    clearFunction(contractId: string, functionName: string): void;
    /**
     * Clear all entries for a specific contract
     */
    clearContract(contractId: string): void;
    /**
     * Clear all cache entries
     */
    clearAll(): void;
    /**
     * Remove all expired entries
     */
    cleanup(): void;
    /**
     * Get current cache statistics
     */
    getStats(): CacheStats;
    /**
     * Get cache metrics including hit rate
     */
    getMetrics(): CacheMetrics;
    /**
     * Get current cache size (number of entries)
     */
    size(): number;
    /**
     * Destroy the cache and clean up intervals
     */
    destroy(): void;
    /**
     * Reset statistics
     */
    resetStats(): void;
}
/**
 * Get or create the global contract cache
 */
export declare function getGlobalCache(defaultTtlSeconds?: number): ContractCache;
/**
 * Destroy the global cache
 */
export declare function destroyGlobalCache(): void;
//# sourceMappingURL=cache.d.ts.map