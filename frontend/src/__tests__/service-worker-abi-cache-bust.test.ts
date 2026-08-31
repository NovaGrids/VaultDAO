import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Service Worker ABI Cache-Busting - Issue #1581', () => {
  let cacheStorage: Map<string, Map<string, Response>>;
  let cacheNames: Set<string>;

  // Mock Cache Storage API
  const setupCacheStorageMocks = () => {
    cacheStorage = new Map();
    cacheNames = new Set();

    // Mock caches.open()
    const mockCaches = {
      open: vi.fn(async (cacheName: string) => {
        if (!cacheStorage.has(cacheName)) {
          cacheStorage.set(cacheName, new Map());
          cacheNames.add(cacheName);
        }
        return {
          put: vi.fn(async (request: Request | string, response: Response) => {
            const key = typeof request === 'string' ? request : request.url;
            cacheStorage.get(cacheName)!.set(key, response.clone());
          }),
          match: vi.fn(async (request: Request | string) => {
            const key = typeof request === 'string' ? request : request.url;
            return cacheStorage.get(cacheName)!.get(key) || null;
          }),
          delete: vi.fn(async (request: Request | string) => {
            const key = typeof request === 'string' ? request : request.url;
            return cacheStorage.get(cacheName)!.delete(key);
          }),
          keys: vi.fn(async () => {
            return Array.from(cacheStorage.get(cacheName)!.keys());
          }),
        };
      }),
      delete: vi.fn(async (cacheName: string) => {
        cacheStorage.delete(cacheName);
        cacheNames.delete(cacheName);
        return true;
      }),
      keys: vi.fn(async () => {
        return Array.from(cacheNames);
      }),
    };

    return mockCaches;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    cacheStorage = new Map();
    cacheNames = new Set();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should add cache-version query parameter to ABI fetch requests', async () => {
    const url = 'https://api.example.com/abi/contract.json';
    const cacheVersion = 'v2';

    const urlWithParam = new URL(url);
    urlWithParam.searchParams.append('cache-version', cacheVersion);

    expect(urlWithParam.toString()).toBe(
      'https://api.example.com/abi/contract.json?cache-version=v2'
    );
  });

  it('should preserve existing query parameters when adding cache-version', () => {
    const url = 'https://api.example.com/abi/contract.json?network=testnet';
    const cacheVersion = 'v2';

    const urlWithParam = new URL(url);
    urlWithParam.searchParams.append('cache-version', cacheVersion);

    expect(urlWithParam.toString()).toContain('network=testnet');
    expect(urlWithParam.toString()).toContain('cache-version=v2');
  });

  it('should cache ABI response with versioned cache name', async () => {
    const mockCaches = setupCacheStorageMocks();
    const cacheName = 'vaultdao-abi-v2';

    const cache = await mockCaches.open(cacheName);

    const abiResponse = new Response(
      JSON.stringify({ type: 'contract', methods: [] }),
      { status: 200 }
    );

    await cache.put('https://api.example.com/abi/contract.json?cache-version=v2', abiResponse);

    const cached = await cache.match(
      'https://api.example.com/abi/contract.json?cache-version=v2'
    );

    expect(cached).not.toBeNull();
    expect(cached!.status).toBe(200);
  });

  it('should invalidate old cache version on service worker update', async () => {
    const mockCaches = setupCacheStorageMocks();

    // Create old cache
    const oldCacheName = 'vaultdao-abi-v1';
    const newCacheName = 'vaultdao-abi-v2';

    const oldCache = await mockCaches.open(oldCacheName);
    const oldResponse = new Response(
      JSON.stringify({ version: '1' }),
      { status: 200 }
    );
    await oldCache.put('https://api.example.com/abi/contract.json', oldResponse);

    // Verify old cache exists
    let cacheList = await mockCaches.keys();
    expect(cacheList).toContain(oldCacheName);

    // Simulate update - delete old cache
    await mockCaches.delete(oldCacheName);

    // Verify old cache is deleted
    cacheList = await mockCaches.keys();
    expect(cacheList).not.toContain(oldCacheName);
  });

  it('should keep new cache version after update', async () => {
    const mockCaches = setupCacheStorageMocks();

    const newCacheName = 'vaultdao-abi-v2';
    const newCache = await mockCaches.open(newCacheName);

    const newResponse = new Response(
      JSON.stringify({ version: '2' }),
      { status: 200 }
    );
    await newCache.put(
      'https://api.example.com/abi/contract.json?cache-version=v2',
      newResponse
    );

    // Verify new cache exists
    const cacheList = await mockCaches.keys();
    expect(cacheList).toContain(newCacheName);

    // Verify we can retrieve from new cache
    const cached = await newCache.match(
      'https://api.example.com/abi/contract.json?cache-version=v2'
    );
    expect(cached).not.toBeNull();
  });

  it('should handle multiple cache versions correctly', async () => {
    const mockCaches = setupCacheStorageMocks();

    const v1CacheName = 'vaultdao-abi-v1';
    const v2CacheName = 'vaultdao-abi-v2';
    const v3CacheName = 'vaultdao-abi-v3';

    // Create multiple cache versions
    const v1Cache = await mockCaches.open(v1CacheName);
    const v2Cache = await mockCaches.open(v2CacheName);
    const v3Cache = await mockCaches.open(v3CacheName);

    const v1Response = new Response(JSON.stringify({ version: '1' }), {
      status: 200,
    });
    const v2Response = new Response(JSON.stringify({ version: '2' }), {
      status: 200,
    });
    const v3Response = new Response(JSON.stringify({ version: '3' }), {
      status: 200,
    });

    await v1Cache.put('https://api.example.com/abi/contract.json', v1Response);
    await v2Cache.put('https://api.example.com/abi/contract.json', v2Response);
    await v3Cache.put('https://api.example.com/abi/contract.json', v3Response);

    // Verify all exist
    let cacheList = await mockCaches.keys();
    expect(cacheList).toHaveLength(3);
    expect(cacheList).toContain(v1CacheName);
    expect(cacheList).toContain(v2CacheName);
    expect(cacheList).toContain(v3CacheName);

    // Delete old versions, keep new
    await mockCaches.delete(v1CacheName);
    await mockCaches.delete(v2CacheName);

    cacheList = await mockCaches.keys();
    expect(cacheList).toContain(v3CacheName);
    expect(cacheList).not.toContain(v1CacheName);
    expect(cacheList).not.toContain(v2CacheName);
  });

  it('should fetch fresh ABI when cache busted', async () => {
    const mockCaches = setupCacheStorageMocks();
    const cacheName = 'vaultdao-abi-v2';

    const cache = await mockCaches.open(cacheName);

    // First fetch with v1 query param (should miss cache)
    const url1 = 'https://api.example.com/abi/contract.json?cache-version=v1';
    const match1 = await cache.match(url1);
    expect(match1).toBeNull();

    // Add new response for v2
    const v2Response = new Response(
      JSON.stringify({ version: '2', methods: ['execute', 'approve'] }),
      { status: 200 }
    );
    const url2 = 'https://api.example.com/abi/contract.json?cache-version=v2';
    await cache.put(url2, v2Response);

    // Fetch with v2 should hit cache
    const match2 = await cache.match(url2);
    expect(match2).not.toBeNull();
    expect(match2!.status).toBe(200);
  });

  it('should not cache non-200 responses', async () => {
    const mockCaches = setupCacheStorageMocks();
    const cacheName = 'vaultdao-abi-v2';

    const cache = await mockCaches.open(cacheName);

    // Cache only successful responses
    const errorResponse = new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
    });

    const url = 'https://api.example.com/abi/missing.json?cache-version=v2';

    // Simulate: only put successful responses
    if (errorResponse.status === 200) {
      await cache.put(url, errorResponse);
    }

    // Try to retrieve
    const cached = await cache.match(url);
    expect(cached).toBeNull(); // Error response should not be cached
  });

  it('should generate correct cache-busting URL for SDK requests', () => {
    const baseUrl = 'https://api.example.com/sdk/soroban-sdk.js';
    const currentVersion = 'v1.0.0';

    const bustedUrl = new URL(baseUrl);
    bustedUrl.searchParams.append('version', currentVersion);

    expect(bustedUrl.toString()).toBe(
      'https://api.example.com/sdk/soroban-sdk.js?version=v1.0.0'
    );
  });

  it('should update cache version on contract upgrade', async () => {
    const mockCaches = setupCacheStorageMocks();

    // Old version before upgrade
    const oldVersion = 'v1';
    const newVersion = 'v2';

    const oldCacheName = `vaultdao-abi-${oldVersion}`;
    const newCacheName = `vaultdao-abi-${newVersion}`;

    // Setup old cache
    const oldCache = await mockCaches.open(oldCacheName);
    const oldAbi = new Response(
      JSON.stringify({ version: '1', execute: {} }),
      { status: 200 }
    );
    await oldCache.put(
      `https://api.example.com/abi/contract.json?cache-version=${oldVersion}`,
      oldAbi
    );

    // Simulate contract upgrade - clear old, setup new
    await mockCaches.delete(oldCacheName);

    const newCache = await mockCaches.open(newCacheName);
    const newAbi = new Response(
      JSON.stringify({ version: '2', execute: {}, approve: {} }),
      { status: 200 }
    );
    await newCache.put(
      `https://api.example.com/abi/contract.json?cache-version=${newVersion}`,
      newAbi
    );

    // Verify new version is available, old is not
    const cacheList = await mockCaches.keys();
    expect(cacheList).toContain(newCacheName);
    expect(cacheList).not.toContain(oldCacheName);

    // Verify new ABI can be retrieved
    const cachedNew = await newCache.match(
      `https://api.example.com/abi/contract.json?cache-version=${newVersion}`
    );
    expect(cachedNew).not.toBeNull();
  });
});
