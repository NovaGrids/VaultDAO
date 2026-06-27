/**
 * VaultDAO Service Worker (legacy registration path)
 * Delegates to sw.js for full functionality.
 * This file is kept for backwards compatibility with any existing registrations.
 */

// Re-export the same logic as sw.js by importing it.
// Since this is a separate file, we implement the same strategies inline.

const CACHE_VERSION = 'v2';
const STATIC_CACHE = `vaultdao-static-${CACHE_VERSION}`;
const API_CACHE = `vaultdao-api-${CACHE_VERSION}`;
const ALL_CACHES = [STATIC_CACHE, API_CACHE];

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

const CACHEABLE_API_PATTERNS = [
  /\/api\/v1\/audit/,
  /\/api\/v1\/proposals/,
  /\/api\/v1\/transactions/,
  /\/api\/v1\/vault/,
  /\/api\/v1\/recurring/,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => !ALL_CACHES.includes(n)).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  const isApiRoute = CACHEABLE_API_PATTERNS.some((p) => p.test(url.pathname));
  if (isApiRoute) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      caches
        .match('/index.html')
        .then((cached) => cached ?? fetch(request).catch(() => new Response('Offline', { status: 503 }))),
    );
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  event.respondWith(networkFirst(request, STATIC_CACHE));
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.status === 200) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached ?? (await networkPromise) ?? offlineApiResponse();
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type !== 'error') {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.status === 200) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached ?? new Response('', { status: 503 });
  }
}

function offlineApiResponse() {
  return new Response(JSON.stringify({ error: 'Offline', offline: true }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isStaticAsset(pathname) {
  return /\.(js|css|woff2?|ttf|eot|png|jpg|jpeg|svg|ico|webp|gif|avif)(\?.*)?$/.test(pathname);
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
