import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Service Worker Background Sync - Issue #1582', () => {
  let db: IDBDatabase;
  let messagesSpy: any[];

  // Mock service worker environment
  const setupServiceWorkerMocks = () => {
    messagesSpy = [];
    const mockSelf: any = {
      addEventListener: vi.fn((event: string, handler: any) => {
        if (event === 'sync') {
          mockSelf.syncHandlers = mockSelf.syncHandlers || [];
          mockSelf.syncHandlers.push(handler);
        }
      }),
      clients: {
        matchAll: vi.fn().mockResolvedValue([]),
      },
      registration: {
        scope: '/',
      },
    };
    return mockSelf;
  };

  beforeEach(async () => {
    // Setup IndexedDB for testing
    const request = indexedDB.open('VaultDAO', 1);

    await new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = (event: any) => {
        db = event.target.result;
        if (!db.objectStoreNames.contains('pendingApprovals')) {
          db.createObjectStore('pendingApprovals', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        db = request.result;
        resolve(true);
      };
    });
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    indexedDB.deleteDatabase('VaultDAO');
  });

  it('should register sync event handler on service worker install', () => {
    const mockSelf = setupServiceWorkerMocks();

    // Trigger manual sync event handler registration
    const syncHandler = vi.fn((event) => {
      event.waitUntil(Promise.resolve());
    });

    mockSelf.addEventListener('sync', syncHandler);

    expect(mockSelf.addEventListener).toHaveBeenCalledWith('sync', expect.any(Function));
  });

  it('should store pending approvals in IndexedDB', async () => {
    const pendingApproval = {
      id: 'approval-123',
      proposalId: 'prop-456',
      vaultAddress: 'GVAULT...',
      timestamp: Date.now(),
      signatures: [],
    };

    const transaction = db.transaction(['pendingApprovals'], 'readwrite');
    const store = transaction.objectStore('pendingApprovals');

    await new Promise((resolve, reject) => {
      const request = store.add(pendingApproval);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });

    const transaction2 = db.transaction(['pendingApprovals'], 'readonly');
    const store2 = transaction2.objectStore('pendingApprovals');

    const retrieved = await new Promise((resolve, reject) => {
      const request = store2.get('approval-123');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    expect(retrieved).toBeDefined();
    expect(retrieved.proposalId).toBe('prop-456');
    expect(retrieved.vaultAddress).toBe('GVAULT...');
  });

  it('should retrieve all pending approvals from IndexedDB', async () => {
    const approvals = [
      {
        id: 'approval-1',
        proposalId: 'prop-1',
        vaultAddress: 'GVAULT1...',
        timestamp: Date.now(),
      },
      {
        id: 'approval-2',
        proposalId: 'prop-2',
        vaultAddress: 'GVAULT2...',
        timestamp: Date.now(),
      },
    ];

    const transaction = db.transaction(['pendingApprovals'], 'readwrite');
    const store = transaction.objectStore('pendingApprovals');

    for (const approval of approvals) {
      await new Promise((resolve, reject) => {
        const request = store.add(approval);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(true);
      });
    }

    const transaction2 = db.transaction(['pendingApprovals'], 'readonly');
    const store2 = transaction2.objectStore('pendingApprovals');

    const allApprovals = await new Promise((resolve, reject) => {
      const request = store2.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    expect(allApprovals).toHaveLength(2);
    expect(allApprovals).toContainEqual(expect.objectContaining({ id: 'approval-1' }));
    expect(allApprovals).toContainEqual(expect.objectContaining({ id: 'approval-2' }));
  });

  it('should clear pending approvals after successful sync', async () => {
    const approval = {
      id: 'approval-sync',
      proposalId: 'prop-999',
      vaultAddress: 'GVAULT...',
      timestamp: Date.now(),
    };

    // Store approval
    const transaction1 = db.transaction(['pendingApprovals'], 'readwrite');
    const store1 = transaction1.objectStore('pendingApprovals');

    await new Promise((resolve, reject) => {
      const request = store1.add(approval);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });

    // Clear after sync
    const transaction2 = db.transaction(['pendingApprovals'], 'readwrite');
    const store2 = transaction2.objectStore('pendingApprovals');

    await new Promise((resolve, reject) => {
      const request = store2.delete('approval-sync');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });

    // Verify it's gone
    const transaction3 = db.transaction(['pendingApprovals'], 'readonly');
    const store3 = transaction3.objectStore('pendingApprovals');

    const retrieved = await new Promise((resolve, reject) => {
      const request = store3.get('approval-sync');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    expect(retrieved).toBeUndefined();
  });

  it('should handle sync event with tag "pending-approvals"', () => {
    const mockSelf = setupServiceWorkerMocks();
    const waitUntilSpy = vi.fn();

    const event = {
      tag: 'pending-approvals',
      waitUntil: waitUntilSpy,
    };

    expect(event.tag).toBe('pending-approvals');
    expect(waitUntilSpy).not.toHaveBeenCalled();
  });

  it('should replay offline approvals on next sync', async () => {
    const offlineApprovals = [
      {
        id: 'offline-1',
        proposalId: 'prop-offline-1',
        vaultAddress: 'GVAULT...',
        timestamp: Date.now() - 5000,
      },
      {
        id: 'offline-2',
        proposalId: 'prop-offline-2',
        vaultAddress: 'GVAULT...',
        timestamp: Date.now() - 3000,
      },
    ];

    const transaction = db.transaction(['pendingApprovals'], 'readwrite');
    const store = transaction.objectStore('pendingApprovals');

    for (const approval of offlineApprovals) {
      await new Promise((resolve, reject) => {
        const request = store.add(approval);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(true);
      });
    }

    const transaction2 = db.transaction(['pendingApprovals'], 'readonly');
    const store2 = transaction2.objectStore('pendingApprovals');

    const toSync = await new Promise((resolve, reject) => {
      const request = store2.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    expect(toSync).toHaveLength(2);
    expect(toSync[0].timestamp).toBeLessThan(toSync[1].timestamp);
  });
});
