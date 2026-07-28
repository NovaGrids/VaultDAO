/**
 * cache.test.ts — Tests for ContractCache
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContractCache, getGlobalCache, destroyGlobalCache } from './cache';

describe('ContractCache', () => {
  let cache: ContractCache;

  beforeEach(() => {
    cache = new ContractCache(1, 100); // 1 second TTL, max 100 entries
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('basic get/set', () => {
    it('should cache and retrieve values', () => {
      const contractId = 'CA123ABC';
      const functionName = 'getProposal';
      const params = { id: 1 };
      const value = { proposalId: 1, amount: 100 };

      cache.set(contractId, functionName, params, value);
      const cached = cache.get(contractId, functionName, params);

      expect(cached).toEqual(value);
    });

    it('should return null for uncached entries', () => {
      const result = cache.get('CA123ABC', 'getProposal', { id: 999 });
      expect(result).toBeNull();
    });

    it('should distinguish different params', () => {
      const contractId = 'CA123ABC';
      const functionName = 'getProposal';
      const value1 = { id: 1, amount: 100 };
      const value2 = { id: 2, amount: 200 };

      cache.set(contractId, functionName, { id: 1 }, value1);
      cache.set(contractId, functionName, { id: 2 }, value2);

      expect(cache.get(contractId, functionName, { id: 1 })).toEqual(value1);
      expect(cache.get(contractId, functionName, { id: 2 })).toEqual(value2);
    });
  });

  describe('TTL expiration', () => {
    it('should expire cached values after TTL', async () => {
      vi.useFakeTimers();
      const cache = new ContractCache(1); // 1 second TTL

      cache.set('CA123ABC', 'getProposal', { id: 1 }, { data: 'test' });
      expect(cache.get('CA123ABC', 'getProposal', { id: 1 })).not.toBeNull();

      // Advance time past TTL
      vi.advanceTimersByTime(1500);

      expect(cache.get('CA123ABC', 'getProposal', { id: 1 })).toBeNull();

      cache.destroy();
      vi.useRealTimers();
    });

    it('should support custom TTL per entry', async () => {
      vi.useFakeTimers();
      const cache = new ContractCache(1); // Default 1 second

      cache.set('CA123ABC', 'func1', { id: 1 }, { data: 'short' }, 0.5); // 0.5 seconds
      cache.set('CA123ABC', 'func2', { id: 2 }, { data: 'long' }, 2); // 2 seconds

      vi.advanceTimersByTime(1000); // 1 second later

      expect(cache.get('CA123ABC', 'func1', { id: 1 })).toBeNull(); // Expired
      expect(cache.get('CA123ABC', 'func2', { id: 2 })).not.toBeNull(); // Still valid

      cache.destroy();
      vi.useRealTimers();
    });
  });

  describe('clearing', () => {
    it('should clear a specific entry', () => {
      cache.set('CA123ABC', 'getProposal', { id: 1 }, { data: 'test' });
      cache.clear('CA123ABC', 'getProposal', { id: 1 });

      expect(cache.get('CA123ABC', 'getProposal', { id: 1 })).toBeNull();
    });

    it('should clear all entries for a function', () => {
      const contractId = 'CA123ABC';
      const funcName = 'getProposal';

      cache.set(contractId, funcName, { id: 1 }, { data: '1' });
      cache.set(contractId, funcName, { id: 2 }, { data: '2' });
      cache.set(contractId, 'getRole', { address: 'GXYZ' }, { role: 'admin' });

      cache.clearFunction(contractId, funcName);

      expect(cache.get(contractId, funcName, { id: 1 })).toBeNull();
      expect(cache.get(contractId, funcName, { id: 2 })).toBeNull();
      expect(cache.get(contractId, 'getRole', { address: 'GXYZ' })).not.toBeNull();
    });

    it('should clear all entries for a contract', () => {
      cache.set('CA123ABC', 'getProposal', { id: 1 }, { data: '1' });
      cache.set('CA123ABC', 'getRole', { address: 'GXYZ' }, { role: 'admin' });
      cache.set('CA999XYZ', 'getProposal', { id: 1 }, { data: 'other' });

      cache.clearContract('CA123ABC');

      expect(cache.get('CA123ABC', 'getProposal', { id: 1 })).toBeNull();
      expect(cache.get('CA123ABC', 'getRole', { address: 'GXYZ' })).toBeNull();
      expect(cache.get('CA999XYZ', 'getProposal', { id: 1 })).not.toBeNull();
    });

    it('should clear all entries', () => {
      cache.set('CA123ABC', 'getProposal', { id: 1 }, { data: '1' });
      cache.set('CA999XYZ', 'getRole', { address: 'GXYZ' }, { role: 'admin' });

      cache.clearAll();

      expect(cache.get('CA123ABC', 'getProposal', { id: 1 })).toBeNull();
      expect(cache.get('CA999XYZ', 'getRole', { address: 'GXYZ' })).toBeNull();
      expect(cache.size()).toBe(0);
    });
  });

  describe('eviction policy', () => {
    it('should evict oldest entry when max entries is reached', () => {
      const smallCache = new ContractCache(10, 2); // Max 2 entries

      smallCache.set('CA1', 'func1', { a: 1 }, { data: 'first' });
      smallCache.set('CA1', 'func2', { a: 2 }, { data: 'second' });
      smallCache.set('CA1', 'func3', { a: 3 }, { data: 'third' }); // Should evict oldest

      // First entry should be evicted (oldest by expiration time)
      expect(smallCache.get('CA1', 'func1', { a: 1 })).toBeNull();
      expect(smallCache.get('CA1', 'func2', { a: 2 })).not.toBeNull();
      expect(smallCache.get('CA1', 'func3', { a: 3 })).not.toBeNull();

      smallCache.destroy();
    });
  });

  describe('statistics', () => {
    it('should track cache hits and misses', () => {
      cache.set('CA123ABC', 'getProposal', { id: 1 }, { data: 'test' });

      // Hits
      cache.get('CA123ABC', 'getProposal', { id: 1 });
      cache.get('CA123ABC', 'getProposal', { id: 1 });

      // Misses
      cache.get('CA123ABC', 'getProposal', { id: 999 });
      cache.get('CA999XYZ', 'getRole', { id: 1 });

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
    });

    it('should calculate hit rate metrics', () => {
      cache.set('CA123ABC', 'func1', { id: 1 }, { data: 'test' });

      // 3 hits, 1 miss = 75% hit rate
      cache.get('CA123ABC', 'func1', { id: 1 });
      cache.get('CA123ABC', 'func1', { id: 1 });
      cache.get('CA123ABC', 'func1', { id: 1 });
      cache.get('CA123ABC', 'func1', { id: 999 });

      const metrics = cache.getMetrics();
      expect(metrics.hitRate).toBe(0.75);
      expect(metrics.totalRequests).toBe(4);
    });

    it('should reset statistics', () => {
      cache.set('CA123ABC', 'func1', { id: 1 }, { data: 'test' });
      cache.get('CA123ABC', 'func1', { id: 1 });

      let stats = cache.getStats();
      expect(stats.hits).toBe(1);

      cache.resetStats();
      stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      vi.useFakeTimers();
      const cache = new ContractCache(0.5); // 0.5 second TTL

      cache.set('CA123ABC', 'func1', { id: 1 }, { data: '1' });
      cache.set('CA123ABC', 'func2', { id: 2 }, { data: '2' });

      vi.advanceTimersByTime(1000); // Past TTL

      cache.cleanup();

      expect(cache.size()).toBe(0);
      cache.destroy();
      vi.useRealTimers();
    });
  });

  describe('size tracking', () => {
    it('should track cache size', () => {
      expect(cache.size()).toBe(0);

      cache.set('CA123ABC', 'func1', { id: 1 }, { data: '1' });
      expect(cache.size()).toBe(1);

      cache.set('CA123ABC', 'func2', { id: 2 }, { data: '2' });
      expect(cache.size()).toBe(2);

      cache.clear('CA123ABC', 'func1', { id: 1 });
      expect(cache.size()).toBe(1);

      cache.clearAll();
      expect(cache.size()).toBe(0);
    });
  });
});

describe('Global Cache', () => {
  afterEach(() => {
    destroyGlobalCache();
  });

  it('should provide a global cache instance', () => {
    const cache1 = getGlobalCache();
    const cache2 = getGlobalCache();

    expect(cache1).toBe(cache2);
  });

  it('should initialize with custom TTL', () => {
    const cache = getGlobalCache(30); // 30 seconds
    cache.set('CA123ABC', 'func1', { id: 1 }, { data: 'test' });

    expect(cache.get('CA123ABC', 'func1', { id: 1 })).not.toBeNull();
    cache.destroy();
  });

  it('should destroy global cache instance', () => {
    const cache1 = getGlobalCache();
    cache1.set('CA123ABC', 'func1', { id: 1 }, { data: 'test' });
    expect(cache1.size()).toBe(1);

    destroyGlobalCache();
    const cache2 = getGlobalCache();
    expect(cache2.size()).toBe(0); // New instance
  });
});
