/**
 * Offline action queue backed by IndexedDB.
 *
 * When the user performs a contract action (approve, execute, vote) while
 * offline, the action is serialised and stored here. On reconnect the queue
 * is replayed in insertion order via the Background Sync API (or a manual
 * flush if Background Sync is unavailable).
 */

export type OfflineActionType =
  | 'approve_proposal'
  | 'execute_proposal'
  | 'reject_proposal'
  | 'propose_transfer';

export interface OfflineAction {
  /** Unique id for this queued item */
  id: string;
  /** Wallet address that initiated the action */
  walletAddress: string;
  /** Action type */
  actionType: OfflineActionType;
  /** Action-specific parameters */
  parameters: Record<string, unknown>;
  /** ISO timestamp when the action was queued */
  timestamp: string;
  /** Number of replay attempts */
  attempts: number;
  /** Last error message if replay failed */
  lastError?: string;
}

const DB_NAME = 'vaultdao-offline-db';
const DB_VERSION = 2;
const STORE = 'offline-actions';

// ─── DB lifecycle ────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result as IDBDatabase);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Add an action to the offline queue. Returns the generated id. */
export async function enqueueOfflineAction(
  walletAddress: string,
  actionType: OfflineActionType,
  parameters: Record<string, unknown>,
): Promise<string> {
  const action: OfflineAction = {
    id: `${actionType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    walletAddress,
    actionType,
    parameters,
    timestamp: new Date().toISOString(),
    attempts: 0,
  };

  const db = await openDB();
  await put(db, action);

  // Ask the service worker to register a Background Sync tag
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'QUEUE_ACTION',
      action: {
        id: action.id,
        url: '/api/v1/offline-sync', // placeholder — actual replay is done in-app
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
        timestamp: action.timestamp,
      },
    });
  }

  return action.id;
}

/** Return all queued actions in chronological order. */
export async function getQueuedActions(): Promise<OfflineAction[]> {
  const db = await openDB();
  return getAll(db);
}

/** Return the number of queued actions. */
export async function getQueuedActionCount(): Promise<number> {
  const db = await openDB();
  return count(db);
}

/** Remove a specific action from the queue (after successful replay). */
export async function removeQueuedAction(id: string): Promise<void> {
  const db = await openDB();
  await remove(db, id);
}

/** Update an action's attempt count and last error. */
export async function updateActionAttempt(
  id: string,
  lastError?: string,
): Promise<void> {
  const db = await openDB();
  const all = await getAll(db);
  const action = all.find((a) => a.id === id);
  if (!action) return;
  await put(db, { ...action, attempts: action.attempts + 1, lastError });
}

/** Clear the entire queue. */
export async function clearOfflineQueue(): Promise<void> {
  const db = await openDB();
  await clear(db);
}

// ─── IDB helpers ─────────────────────────────────────────────────────────────

function put(db: IDBDatabase, record: OfflineAction): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).put(record);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

function getAll(db: IDBDatabase): Promise<OfflineAction[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).index('timestamp').getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result as OfflineAction[]);
  });
}

function remove(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}

function count(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).count();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result as number);
  });
}

function clear(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).clear();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
  });
}
