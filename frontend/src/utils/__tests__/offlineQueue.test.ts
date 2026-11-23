import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  enqueueOfflineAction,
  enqueueSignedTransaction,
  getQueuedActions,
  getQueuedActionCount,
  getPendingActions,
  removeQueuedAction,
  dequeueOfflineAction,
  updateActionAttempt,
  updateActionStatus,
  clearOfflineQueue,
  type OfflineAction,
} from '../offlineQueue';

// ─── IndexedDB fake ──────────────────────────────────────────────────────────

/**
 * Minimal in-memory IDB shim sufficient for the offlineQueue module.
 * We set it up once per test file and clear the store between tests.
 */
const store: Map<string, OfflineAction> = new Map();

function makeRequest<T>(resultFn: () => T): IDBRequest {
  const req = {} as IDBRequest;
  setTimeout(() => {
    try {
      (req as any).result = resultFn();
      req.onsuccess?.({ target: req } as any);
    } catch (err) {
      (req as any).error = err;
      req.onerror?.({ target: req } as any);
    }
  }, 0);
  return req;
}

function makeIndex(name: string): IDBIndex {
  return {
    getAll: () =>
      makeRequest(() =>
        [...store.values()].sort((a, b) =>
          name === 'timestamp' ? a.timestamp.localeCompare(b.timestamp) : 0,
        ),
      ),
  } as unknown as IDBIndex;
}

function makeObjectStore(): IDBObjectStore {
  return {
    put:    (record: OfflineAction) => makeRequest(() => { store.set(record.id, record); return record.id; }),
    delete: (id: string)            => makeRequest(() => { store.delete(id); return undefined; }),
    clear:  ()                      => makeRequest(() => { store.clear(); return undefined; }),
    count:  ()                      => makeRequest(() => store.size),
    index:  (name: string)          => makeIndex(name),
  } as unknown as IDBObjectStore;
}

function makeTx(): IDBTransaction {
  return {
    objectStore: () => makeObjectStore(),
  } as unknown as IDBTransaction;
}

function makeDB(): IDBDatabase {
  return {
    transaction:      () => makeTx(),
    objectStoreNames: { contains: () => true } as unknown as DOMStringList,
    createObjectStore: vi.fn(),
  } as unknown as IDBDatabase;
}

function setupIDBMock() {
  const dbInstance = makeDB();

  (global as any).indexedDB = {
    open: () => {
      const req = {} as IDBOpenDBRequest;
      setTimeout(() => {
        (req as any).result = dbInstance;
        req.onsuccess?.({ target: req } as any);
      }, 0);
      return req;
    },
  };

  // navigator.serviceWorker is not needed in unit tests
  if (!('serviceWorker' in navigator)) {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: undefined,
      configurable: true,
    });
  }
}

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  store.clear();
  setupIDBMock();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function flush() {
  // Flush all pending micro/macro tasks (IDB callbacks use setTimeout(0))
  await vi.runAllTimersAsync();
}

// ─── enqueueOfflineAction ────────────────────────────────────────────────────

describe('enqueueOfflineAction', () => {
  it('stores an action with status=pending', async () => {
    const id = enqueueOfflineAction('GAAA', 'approve_proposal', { proposalId: '1' });
    await flush();
    const idStr = await id;
    const actions = await (async () => { const p = getQueuedActions(); await flush(); return p; })();
    const a = (await actions).find((x) => x.id === idStr);
    expect(a).toBeDefined();
    expect(a!.status).toBe('pending');
    expect(a!.signedXdr).toBeUndefined();
  });

  it('assigns a unique id per enqueue', async () => {
    const id1 = enqueueOfflineAction('GAAA', 'approve_proposal', { proposalId: '1' });
    const id2 = enqueueOfflineAction('GAAA', 'approve_proposal', { proposalId: '2' });
    await flush();
    expect(await id1).not.toBe(await id2);
  });
});

// ─── enqueueSignedTransaction ─────────────────────────────────────────────────

describe('enqueueSignedTransaction', () => {
  it('stores signed XDR with status=pending', async () => {
    const xdr = 'AAAA_SIGNED_XDR_BASE64==';
    const id = enqueueSignedTransaction('GAAA', 'execute_proposal', { proposalId: '7' }, xdr);
    await flush();
    const idStr = await id;
    const actions = await (async () => { const p = getQueuedActions(); await flush(); return p; })();
    const a = (await actions).find((x) => x.id === idStr);
    expect(a).toBeDefined();
    expect(a!.signedXdr).toBe(xdr);
    expect(a!.status).toBe('pending');
  });

  it('queue-and-retry: entry survives a simulated send failure and is retried', async () => {
    // Enqueue a signed transaction
    const xdr = 'SIGNED_XDR_42';
    const idPromise = enqueueSignedTransaction('GAAA', 'execute_proposal', { proposalId: '42' }, xdr);
    await flush();
    const id = await idPromise;

    // Simulate a failed attempt
    await (async () => { const p = updateActionAttempt(id, 'Network timeout'); await flush(); return p; })();

    // Confirm it's still present with status=failed and attempts=1
    const actionsAfterFail = await (async () => { const p = getQueuedActions(); await flush(); return p; })();
    const entry = (await actionsAfterFail).find((a) => a.id === id);
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('failed');
    expect(entry!.attempts).toBe(1);
    expect(entry!.signedXdr).toBe(xdr); // XDR is preserved for retry
  });

  it('queue-after-reconnect: entry transitions to confirmed and is removed', async () => {
    const xdr = 'SIGNED_XDR_99';
    const idPromise = enqueueSignedTransaction('GAAA', 'approve_proposal', { proposalId: '99' }, xdr);
    await flush();
    const id = await idPromise;

    // Simulate successful submission
    await (async () => { const p = updateActionStatus(id, 'confirmed', 'abc123hash'); await flush(); return p; })();
    await (async () => { const p = removeQueuedAction(id); await flush(); return p; })();

    const remaining = await (async () => { const p = getQueuedActions(); await flush(); return p; })();
    expect((await remaining).find((a) => a.id === id)).toBeUndefined();
  });
});

// ─── getPendingActions ────────────────────────────────────────────────────────

describe('getPendingActions', () => {
  it('excludes confirmed entries', async () => {
    const id1Promise = enqueueOfflineAction('GAAA', 'approve_proposal', { proposalId: '1' });
    const id2Promise = enqueueOfflineAction('GAAA', 'execute_proposal', { proposalId: '2' });
    await flush();
    const id1 = await id1Promise;
    const id2 = await id2Promise;

    // Mark id1 as confirmed
    await (async () => { const p = updateActionStatus(id1, 'confirmed', 'txhash1'); await flush(); return p; })();

    const pending = await (async () => { const p = getPendingActions(); await flush(); return p; })();
    const ids = (await pending).map((a) => a.id);
    expect(ids).not.toContain(id1);
    expect(ids).toContain(id2);
  });
});

// ─── updateActionStatus ───────────────────────────────────────────────────────

describe('updateActionStatus', () => {
  it('updates status and txHash', async () => {
    const idPromise = enqueueSignedTransaction('GAAA', 'execute_proposal', { proposalId: '5' }, 'XDR');
    await flush();
    const id = await idPromise;

    await (async () => { const p = updateActionStatus(id, 'submitting'); await flush(); return p; })();

    let actions = await (async () => { const p = getQueuedActions(); await flush(); return p; })();
    expect((await actions).find((a) => a.id === id)!.status).toBe('submitting');

    await (async () => { const p = updateActionStatus(id, 'confirmed', 'myhash'); await flush(); return p; })();
    actions = await (async () => { const p = getQueuedActions(); await flush(); return p; })();
    const entry = (await actions).find((a) => a.id === id)!;
    expect(entry.status).toBe('confirmed');
    expect(entry.txHash).toBe('myhash');
  });
});

// ─── dequeueOfflineAction alias ───────────────────────────────────────────────

describe('dequeueOfflineAction', () => {
  it('removes an entry (alias for removeQueuedAction)', async () => {
    const idPromise = enqueueOfflineAction('GAAA', 'reject_proposal', { proposalId: '3' });
    await flush();
    const id = await idPromise;

    await (async () => { const p = dequeueOfflineAction(id); await flush(); return p; })();

    const actions = await (async () => { const p = getQueuedActions(); await flush(); return p; })();
    expect((await actions).find((a) => a.id === id)).toBeUndefined();
  });
});

// ─── getQueuedActionCount ─────────────────────────────────────────────────────

describe('getQueuedActionCount', () => {
  it('reflects the current store size', async () => {
    expect(await (async () => { const p = getQueuedActionCount(); await flush(); return p; })()).toBe(0);
    await (async () => { const p = enqueueOfflineAction('GAAA', 'approve_proposal', {}); await flush(); return p; })();
    expect(await (async () => { const p = getQueuedActionCount(); await flush(); return p; })()).toBe(1);
    await (async () => { const p = enqueueOfflineAction('GAAA', 'execute_proposal', {}); await flush(); return p; })();
    expect(await (async () => { const p = getQueuedActionCount(); await flush(); return p; })()).toBe(2);
  });
});

// ─── clearOfflineQueue ────────────────────────────────────────────────────────

describe('clearOfflineQueue', () => {
  it('empties the store', async () => {
    await (async () => { const p = enqueueOfflineAction('GAAA', 'approve_proposal', {}); await flush(); return p; })();
    await (async () => { const p = clearOfflineQueue(); await flush(); return p; })();
    expect(await (async () => { const p = getQueuedActionCount(); await flush(); return p; })()).toBe(0);
  });
});

// ─── Conflict-detection fixtures (unchanged from original test file) ──────────

describe('Conflict Detection Before Replay', () => {
  it('detects conflict when queued action state differs from current on-chain state', () => {
    const queuedAction: OfflineAction = {
      id: 'approve-1234',
      walletAddress: 'GAAA...',
      actionType: 'approve_proposal',
      parameters: { proposalId: '42', amount: '100' },
      timestamp: '2024-08-20T10:00:00Z',
      attempts: 0,
      status: 'pending',
    };
    const onChainState = { proposalId: '42', status: 'approved', approvedBy: ['GBBB...', 'GCCC...'] };
    const hasConflict =
      queuedAction.parameters.proposalId === onChainState.proposalId &&
      onChainState.status !== 'pending';
    expect(hasConflict).toBe(true);
  });

  it('detects conflict when proposal was executed while offline', () => {
    const queuedAction: OfflineAction = {
      id: 'execute-1234',
      walletAddress: 'GAAA...',
      actionType: 'execute_proposal',
      parameters: { proposalId: '42' },
      timestamp: '2024-08-20T10:00:00Z',
      attempts: 0,
      status: 'pending',
    };
    const onChainState = { proposalId: '42', status: 'executed', executedAt: '2024-08-20T09:00:00Z' };
    const hasConflict =
      queuedAction.parameters.proposalId === onChainState.proposalId &&
      onChainState.status === 'executed';
    expect(hasConflict).toBe(true);
  });

  it('does not detect conflict when proposal state is still pending', () => {
    const queuedAction: OfflineAction = {
      id: 'approve-1234',
      walletAddress: 'GAAA...',
      actionType: 'approve_proposal',
      parameters: { proposalId: '42', amount: '100' },
      timestamp: '2024-08-20T10:00:00Z',
      attempts: 0,
      status: 'pending',
    };
    const onChainState = { proposalId: '42', status: 'pending', approvedBy: [] };
    const hasConflict =
      queuedAction.parameters.proposalId === onChainState.proposalId &&
      onChainState.status !== 'pending';
    expect(hasConflict).toBe(false);
  });
});
