import { useState, useCallback, useEffect } from 'react';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl?: number; // Time to live in milliseconds
}

interface ProposalCache {
  [key: string]: CacheEntry<any>;
}

const DEFAULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * useProposalCache provides client-side caching for proposal data
 * to reduce API calls and improve performance
 */
export const useProposalCache = <T,>(cacheName: string = 'proposals', ttl = DEFAULT_CACHE_TTL) => {
  const [cache, setCache] = useState<ProposalCache>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const cached = sessionStorage.getItem(`proposal_cache_${cacheName}`);
      return cached ? JSON.parse(cached) : {};
    } catch (e) {
      console.warn('Failed to read cache:', e);
      return {};
    }
  });

  // Save cache to sessionStorage when it changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      sessionStorage.setItem(`proposal_cache_${cacheName}`, JSON.stringify(cache));
    } catch (e) {
      console.warn('Failed to save cache:', e);
    }
  }, [cache, cacheName]);

  const get = useCallback(
    (key: string): T | null => {
      const entry = cache[key] as CacheEntry<T> | undefined;
      if (!entry) return null;

      // Check if entry has expired
      if (entry.ttl) {
        const age = Date.now() - entry.timestamp;
        if (age > entry.ttl) {
          setCache((prev) => {
            const updated = { ...prev };
            delete updated[key];
            return updated;
          });
          return null;
        }
      }

      return entry.data;
    },
    [cache]
  );

  const set = useCallback((key: string, data: T, customTtl?: number) => {
    setCache((prev) => ({
      ...prev,
      [key]: {
        data,
        timestamp: Date.now(),
        ttl: customTtl ?? ttl,
      },
    }));
  }, [ttl]);

  const clear = useCallback((key?: string) => {
    if (key) {
      setCache((prev) => {
        const updated = { ...prev };
        delete updated[key];
        return updated;
      });
    } else {
      setCache({});
    }
  }, []);

  const has = useCallback((key: string): boolean => {
    return get(key) !== null;
  }, [get]);

  return { get, set, clear, has };
};

/**
 * Progressive loading helper for loading initial batch of items
 * and then progressively loading more
 */
export const useProgressiveLoading = <T,>(items: T[], pageSize: number = 20) => {
  const [displayCount, setDisplayCount] = useState(pageSize);

  const displayedItems = items.slice(0, displayCount);
  const hasMore = displayCount < items.length;

  const loadMore = useCallback(() => {
    setDisplayCount((prev) => Math.min(prev + pageSize, items.length));
  }, [items.length, pageSize]);

  const reset = useCallback(() => {
    setDisplayCount(pageSize);
  }, [pageSize]);

  return { displayedItems, hasMore, loadMore, reset };
};

/**
 * Batch loading helper for fetching data in batches
 */
export const useBatchLoading = <T,>(
  items: T[],
  batchSize: number = 50,
  onBatchLoad?: (items: T[], batchIndex: number) => void
) => {
  const [loadedBatches, setLoadedBatches] = useState<Set<number>>(new Set([0]));

  const totalBatches = Math.ceil(items.length / batchSize);

  const loadBatch = useCallback(
    (batchIndex: number) => {
      if (batchIndex >= totalBatches || loadedBatches.has(batchIndex)) return;

      const start = batchIndex * batchSize;
      const end = Math.min(start + batchSize, items.length);
      const batchItems = items.slice(start, end);

      onBatchLoad?.(batchItems, batchIndex);

      setLoadedBatches((prev) => new Set(prev).add(batchIndex));
    },
    [batchSize, items, loadedBatches, totalBatches, onBatchLoad]
  );

  return { loadedBatches, totalBatches, loadBatch };
};
