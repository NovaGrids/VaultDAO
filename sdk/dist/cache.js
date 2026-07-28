"use strict";
/**
 * cache.ts — Contract Function Caching Layer
 *
 * Implements a TTL-based cache for read-only contract calls to reduce RPC load.
 * Cache keys are deterministic: contract_id + function_name + params_hash
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContractCache = void 0;
exports.getGlobalCache = getGlobalCache;
exports.destroyGlobalCache = destroyGlobalCache;
/**
 * Simple deterministic hash function for cache key generation
 * Works in both Node.js and browser environments
 */
function hashParams(contractId, functionName, params) {
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
class ContractCache {
    constructor(defaultTtlSeconds = 60, maxEntries = 1000) {
        this.cache = new Map();
        this.stats = { hits: 0, misses: 0, evictions: 0 };
        this.cleanupInterval = null;
        this.defaultTtl = defaultTtlSeconds * 1000;
        this.maxEntries = maxEntries;
        // Clean up expired entries every 10 seconds
        this.cleanupInterval = setInterval(() => this.cleanup(), 10000);
    }
    /**
     * Generate a cache key from contract context and parameters
     */
    getKey(contractId, functionName, params) {
        return hashParams(contractId, functionName, params);
    }
    /**
     * Get a cached value if it exists and hasn't expired
     */
    get(contractId, functionName, params) {
        const key = this.getKey(contractId, functionName, params);
        const entry = this.cache.get(key);
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
    set(contractId, functionName, params, value, ttlSeconds) {
        const key = this.getKey(contractId, functionName, params);
        const ttlMs = (ttlSeconds ?? this.defaultTtl / 1000) * 1000;
        // Evict oldest entry if cache is full
        if (this.cache.size >= this.maxEntries) {
            let oldestKey = null;
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
    clear(contractId, functionName, params) {
        const key = this.getKey(contractId, functionName, params);
        this.cache.delete(key);
    }
    /**
     * Clear all entries for a specific contract function
     */
    clearFunction(contractId, functionName) {
        const prefix = contractId + ':' + functionName + ':';
        const keysToDelete = [];
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
    clearContract(contractId) {
        const prefix = contractId + ':';
        const keysToDelete = [];
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
    clearAll() {
        this.cache.clear();
    }
    /**
     * Remove all expired entries
     */
    cleanup() {
        const now = Date.now();
        const expiredKeys = [];
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
    getStats() {
        return { ...this.stats };
    }
    /**
     * Get cache metrics including hit rate
     */
    getMetrics() {
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
    size() {
        return this.cache.size;
    }
    /**
     * Destroy the cache and clean up intervals
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.clearAll();
    }
    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = { hits: 0, misses: 0, evictions: 0 };
    }
}
exports.ContractCache = ContractCache;
// Global cache instance
let globalCache = null;
/**
 * Get or create the global contract cache
 */
function getGlobalCache(defaultTtlSeconds) {
    if (!globalCache) {
        globalCache = new ContractCache(defaultTtlSeconds ?? 60);
    }
    return globalCache;
}
/**
 * Destroy the global cache
 */
function destroyGlobalCache() {
    if (globalCache) {
        globalCache.destroy();
        globalCache = null;
    }
}
//# sourceMappingURL=cache.js.map