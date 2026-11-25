/**
 * Offline action queue backed by IndexedDB.
 *
 * When the user performs a contract action (approve, execute, vote) while
 * offline, the signed XDR envelope is stored here before submission.  On
 * reconnect the queue is replayed in insertion order with exponential
 * back-off (or a manual flush if Background Sync is unavailable).
 *
 * Two entry kinds are supported:
 *   - "signed" entries: carry a pre-signed XDR and are resubmitted directly
 *     to the Soroban RPC without re-signing on each retry.
 *   - "action" entries: carry typed parameters and are re-executed (re-signed)
 *     by the caller's executeAction callback on each replay.
 */

export type OfflineActionType =
  | 'approve_proposal'
  | 'execute_proposal'
  | 'reject_proposal'
  | 'propose_transfer';

export type QueueEntryStatus = 'pending' | 'submitting' | 'confirmed' | 'failed';

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
  /**
   * Pre-signed XDR envelope (base64).  When present the entry is resubmitted
   * directly without re-signing.  When absent the caller's executeAction
   * callback is used instead.
   */
  signedXdr?: string;
  /** Current lifecycle status of this entry */
  status: QueueEntryStatus;
  /**
   * Transaction hash returned by the Soroban RPC after a successful
   * sendTransaction call.  Set when status transitions to 'confirmed'.
   */
  txHash?: string;
}

const DB_NAME = 'vaultdao-offline-db';
const DB_VERSION = 3;
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
        store.createIndex('status', 'status', { unique: false });
      } else {
        // Migration from v2: add status index if missing
        const tx = (event.target as IDBOpenDBRequest).transaction!;
        const store = tx.objectStore(STORE);
        if (!store.indexNames.contains('status')) {
          store.createIndex('status', 'status', { unique: false });
        }
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
    status: 'pending',
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

/**
 * Queue a pre-signed XDR envelope for submission on reconnect.
 *
 * The XDR is persisted before any network call, so a connectivity loss
 * between signing and sending does not silently drop the transaction.
 * On reconnect the queue runner calls `server.sendTransaction(signedXdr)`
 * directly without re-signing.
 *
 * Returns the generated queue entry id.
 */
export async function enqueueSignedTransaction(
  walletAddress: string,
  actionType: OfflineActionType,
  parameters: Record<string, unknown>,
  signedXdr: string,
): Promise<string> {
  const action: OfflineAction = {
    id: `${actionType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    walletAddress,
    actionType,
    parameters,
    timestamp: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
    signedXdr,
  };

  const db = await openDB();
  await put(db, action);

  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'QUEUE_SIGNED_TX',
      action: { id: action.id, timestamp: action.timestamp },
    });
  }

  return action.id;
}

/** Return all queued actions in chronological order. */
export async function getQueuedActions(): Promise<OfflineAction[]> {
  const db = await openDB();
  return getAll(db);
}

/** Return all actions that are not yet confirmed (pending or failed). */
export async function getPendingActions(): Promise<OfflineAction[]> {
  const all = await getQueuedActions();
  return all.filter((a) => a.status !== 'confirmed');
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

/**
 * Alias for removeQueuedAction; kept for callers that use the dequeue name.
 */
export async function dequeueOfflineAction(id: string): Promise<void> {
  return removeQueuedAction(id);
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
  await put(db, { ...action, attempts: action.attempts + 1, lastError, status: 'failed' });
}

/**
 * Update the status of a queued action.
 * Used to transition entries through the pending → submitting → confirmed/failed
 * lifecycle so the banner can reflect current progress.
 */
export async function updateActionStatus(
  id: string,
  status: QueueEntryStatus,
  txHash?: string,
): Promise<void> {
  const db = await openDB();
  const all = await getAll(db);
  const action = all.find((a) => a.id === id);
  if (!action) return;
  await put(db, { ...action, status, ...(txHash !== undefined ? { txHash } : {}) });
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
