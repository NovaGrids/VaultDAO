const CACHE_NAME = 'vaultdao-v1';
const RUNTIME_CACHE = 'vaultdao-runtime-v1';
const OFFLINE_PAGE = '/offline.html';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/vite.svg',
  '/manifest.json',
];

// Install event - cache assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) => {
        return cache.addAll(ASSETS_TO_CACHE).catch((error) => {
          console.warn('Failed to cache assets:', error);
        });
      }),
      // Pre-cache offline page
      caches.open(RUNTIME_CACHE).then((cache) => {
        return fetch(OFFLINE_PAGE)
          .then((response) => cache.put(OFFLINE_PAGE, response))
          .catch(() => console.warn('Offline page not available'));
      }),
    ])
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network-first for API, cache-first for assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Network-first strategy for API calls
  if (url.pathname.includes('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful API responses
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // Return cached API response if network fails
          return caches.match(request).then((response) => {
            return response || new Response(
              JSON.stringify({ error: 'Offline' }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            );
          });
        })
    );
    return;
  }

  // Cache-first strategy for static assets
  event.respondWith(
    caches.match(request).then((response) => {
      if (response) {
        return response;
      }

      return fetch(request)
        .then((response) => {
          // Don't cache non-successful responses
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }

          // Clone the response
          const responseToCache = response.clone();

          // Cache successful responses for static assets
          const isStaticAsset =
            url.pathname.includes('.js') ||
            url.pathname.includes('.css') ||
            url.pathname.includes('.woff') ||
            url.pathname.includes('.png') ||
            url.pathname.includes('.svg') ||
            url.pathname.includes('.jpg') ||
            url.pathname.includes('.jpeg');

          if (isStaticAsset) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }

          return response;
        })
        .catch(() => {
          // Return offline page for navigation requests
          if (request.mode === 'navigate') {
            return caches.match(OFFLINE_PAGE);
          }
          // Return cached response if available
          return caches.match(request);
        });
    })
  );
});

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
