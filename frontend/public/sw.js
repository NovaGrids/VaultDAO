// VaultDAO Service Worker — stale-while-revalidate + Background Sync
// Version: 2.0.0

const CACHE_VERSION = 'v2';
const STATIC_CACHE = `vaultdao-static-${CACHE_VERSION}`;
const API_CACHE = `vaultdao-api-${CACHE_VERSION}`;
const ALL_CACHES = [STATIC_CACHE, API_CACHE];

// Assets to precache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// API routes to cache (stale-while-revalidate)
const CACHEABLE_API_PATTERNS = [
  /\/api\/v1\/audit/,
  /\/api\/v1\/proposals/,
  /\/api\/v1\/transactions/,
  /\/api\/v1\/vault/,
  /\/api\/v1\/recurring/,
];

// ─── Install ────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        cache.addAll(PRECACHE_ASSETS).catch((err) => {
          console.warn('[SW] Precache partial failure:', err);
        }),
      )
      .then(() => self.skipWaiting()),
  );
});

// ─── Activate ───────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => !ALL_CACHES.includes(n))
            .map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ─── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests (non-GET are handled by Background Sync)
  if (request.method !== 'GET') return;

  // Skip chrome-extension and non-http(s) schemes
  if (!url.protocol.startsWith('http')) return;

  // ── API routes: stale-while-revalidate ──────────────────────────────────
  const isApiRoute = CACHEABLE_API_PATTERNS.some((p) => p.test(url.pathname));
  if (isApiRoute) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE));
    return;
  }

  // ── Navigation requests: serve app shell ────────────────────────────────
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('/index.html').then(
        (cached) => cached ?? fetch(request).catch(() => new Response('Offline', { status: 503 })),
      ),
    );
    return;
  }

  // ── Static assets: cache-first, then network ────────────────────────────
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // ── Everything else: network-first ──────────────────────────────────────
  event.respondWith(networkFirst(request, STATIC_CACHE));
});

// ─── Strategies ─────────────────────────────────────────────────────────────

/** Stale-while-revalidate: return cache immediately, update in background */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached ?? (await networkPromise) ?? offlineApiResponse();
}

/** Cache-first: return from cache, fall back to network and cache result */
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

/** Network-first: try network, fall back to cache */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
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

// ─── Background Sync ─────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'vaultdao-offline-actions') {
    event.waitUntil(replayOfflineActions());
  }
});

async function replayOfflineActions() {
  let db;
  try {
    db = await openDB();
  } catch (err) {
    console.error('[SW] Failed to open IndexedDB for sync:', err);
    return;
  }

  const actions = await getAllActions(db);
  if (actions.length === 0) return;

  const results = [];
  for (const action of actions) {
    try {
      const response = await fetch(action.url, {
        method: action.method,
        headers: action.headers,
        body: action.body,
      });

      if (response.ok) {
        await deleteAction(db, action.id);
        results.push({ id: action.id, success: true, action });
      } else {
        const errText = await response.text().catch(() => `HTTP ${response.status}`);
        results.push({ id: action.id, success: false, error: errText, action });
      }
    } catch (err) {
      results.push({ id: action.id, success: false, error: String(err), action });
    }
  }

  // Notify all open clients about replay results
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage({ type: 'SYNC_RESULTS', results });
  }
}

// ─── Messages from clients ───────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (!event.data) return;

  switch (event.data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'QUEUE_ACTION':
      openDB()
        .then((db) => putAction(db, event.data.action))
        .then(() => {
          // Attempt immediate Background Sync registration
          if (self.registration.sync) {
            return self.registration.sync.register('vaultdao-offline-actions');
          }
        })
        .catch((err) => console.error('[SW] Failed to queue action:', err));
      break;

    case 'GET_QUEUE_COUNT':
      openDB()
        .then((db) => countActions(db))
        .then((count) => {
          event.source?.postMessage({ type: 'QUEUE_COUNT', count });
        })
        .catch(() => {
          event.source?.postMessage({ type: 'QUEUE_COUNT', count: 0 });
        });
      break;

    case 'CLEAR_CACHE':
      Promise.all(ALL_CACHES.map((name) => caches.delete(name)))
        .then(() => {
          event.source?.postMessage({ type: 'CACHE_CLEARED' });
        })
        .catch((err) => console.error('[SW] Failed to clear cache:', err));
      break;

    case 'GET_CACHE_SIZE':
      getCacheSize()
        .then((size) => {
          event.source?.postMessage({ type: 'CACHE_SIZE', size });
        })
        .catch(() => {
          event.source?.postMessage({ type: 'CACHE_SIZE', size: 0 });
        });
      break;
  }
});

// ─── Push Notifications ──────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'VaultDAO';
  const options = {
    body: data.body || 'New notification',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    vibrate: [200, 100, 200],
    data: data.data || {},
    actions: data.actions || [
      { action: 'view', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'view') {
    const urlToOpen = event.notification.data?.url || '/dashboard';
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if (client.url === urlToOpen && 'focus' in client) return client.focus();
        }
        if (clients.openWindow) return clients.openWindow(urlToOpen);
      }),
    );
  }
});

// ─── IndexedDB helpers ───────────────────────────────────────────────────────
const DB_NAME = 'vaultdao-offline-db';
const DB_VERSION = 2;
const STORE_ACTIONS = 'offline-actions';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_ACTIONS)) {
        const store = db.createObjectStore(STORE_ACTIONS, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

function putAction(db, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ACTIONS, 'readwrite');
    const req = tx.objectStore(STORE_ACTIONS).put(action);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

function getAllActions(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ACTIONS, 'readonly');
    const req = tx.objectStore(STORE_ACTIONS).index('timestamp').getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

function deleteAction(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ACTIONS, 'readwrite');
    const req = tx.objectStore(STORE_ACTIONS).delete(id);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

function countActions(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ACTIONS, 'readonly');
    const req = tx.objectStore(STORE_ACTIONS).count();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

async function getCacheSize() {
  if ('storage' in self && 'estimate' in self.storage) {
    const estimate = await self.storage.estimate();
    return estimate.usage || 0;
  }
  return 0;
}
