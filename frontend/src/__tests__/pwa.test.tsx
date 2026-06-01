/**
 * PWA offline support tests
 *
 * Tests:
 * - Offline banner appears when navigator.onLine === false
 * - Action is queued when offline
 * - Queued actions are replayed on reconnect
 */

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ─── Mock IndexedDB ──────────────────────────────────────────────────────────

const mockStore: Record<string, unknown> = {};

const mockIDB = {
  open: vi.fn(),
};

// Minimal IDBDatabase mock
function createMockDB() {
  const store = new Map<string, unknown>();

  const makeRequest = <T>(result: T) => {
    const req = {
      result,
      error: null,
      onsuccess: null as ((e: Event) => void) | null,
      onerror: null as ((e: Event) => void) | null,
    };
    setTimeout(() => req.onsuccess?.({ target: req } as unknown as Event), 0);
    return req;
  };

  const objectStore = {
    put: (record: unknown) => {
      const r = record as { id: string };
      store.set(r.id, record);
      return makeRequest(r.id);
    },
    delete: (id: string) => {
      store.delete(id);
      return makeRequest(undefined);
    },
    count: () => makeRequest(store.size),
    clear: () => {
      store.clear();
      return makeRequest(undefined);
    },
    index: (_name: string) => ({
      getAll: () => makeRequest(Array.from(store.values())),
    }),
  };

  const transaction = {
    objectStore: () => objectStore,
  };

  return {
    transaction: () => transaction,
    objectStoreNames: { contains: () => true },
    createObjectStore: () => objectStore,
    _store: store,
  };
}

const mockDB = createMockDB();

// Patch global indexedDB
const openRequest = {
  result: mockDB,
  error: null,
  onsuccess: null as ((e: Event) => void) | null,
  onerror: null as ((e: Event) => void) | null,
  onupgradeneeded: null as ((e: Event) => void) | null,
};

vi.stubGlobal('indexedDB', {
  open: vi.fn(() => {
    setTimeout(() => openRequest.onsuccess?.({ target: openRequest } as unknown as Event), 0);
    return openRequest;
  }),
});

// ─── Mock navigator.onLine ───────────────────────────────────────────────────

let onlineStatus = true;

Object.defineProperty(navigator, 'onLine', {
  get: () => onlineStatus,
  configurable: true,
});

// ─── Mock pwa utils ──────────────────────────────────────────────────────────

vi.mock('../utils/pwa', () => ({
  isOnline: () => onlineStatus,
  setupNetworkListeners: (onOnline: () => void, onOffline: () => void) => {
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  },
  isInstalled: () => false,
  canInstall: () => false,
  showInstallPrompt: vi.fn(),
  requestNotificationPermission: vi.fn(),
  clearCache: vi.fn(),
  getCacheSize: vi.fn().mockResolvedValue(1024 * 512),
}));

// ─── Mock offlineQueue ───────────────────────────────────────────────────────

const queueStore: import('../utils/offlineQueue').OfflineAction[] = [];

vi.mock('../utils/offlineQueue', () => ({
  enqueueOfflineAction: vi.fn(async (walletAddress, actionType, parameters) => {
    const id = `${actionType}-${Date.now()}`;
    queueStore.push({
      id,
      walletAddress,
      actionType,
      parameters,
      timestamp: new Date().toISOString(),
      attempts: 0,
    });
    return id;
  }),
  getQueuedActions: vi.fn(async () => [...queueStore]),
  getQueuedActionCount: vi.fn(async () => queueStore.length),
  removeQueuedAction: vi.fn(async (id: string) => {
    const idx = queueStore.findIndex((a) => a.id === id);
    if (idx !== -1) queueStore.splice(idx, 1);
  }),
  updateActionAttempt: vi.fn(async (id: string, lastError?: string) => {
    const action = queueStore.find((a) => a.id === id);
    if (action) {
      action.attempts += 1;
      action.lastError = lastError;
    }
  }),
  clearOfflineQueue: vi.fn(async () => queueStore.splice(0)),
}));

// ─── Mock ToastContext ───────────────────────────────────────────────────────

const mockShowToast = vi.fn();
const mockNotify = vi.fn();

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ showToast: mockShowToast, notify: mockNotify }),
}));

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import { OfflineIndicator } from '../components/OfflineIndicator';
import { enqueueOfflineAction, getQueuedActionCount } from '../utils/offlineQueue';
import { useOfflineSync } from '../hooks/useOfflineSync';

// ─── Helper: render with ToastProvider stub ──────────────────────────────────

function renderWithProviders(ui: React.ReactElement) {
  return render(ui);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('OfflineIndicator', () => {
  beforeEach(() => {
    onlineStatus = true;
    queueStore.splice(0);
    vi.clearAllMocks();
  });

  afterEach(() => {
    onlineStatus = true;
  });

  it('renders nothing when online with no queued actions', () => {
    renderWithProviders(<OfflineIndicator />);
    expect(screen.queryByTestId('offline-indicator')).toBeNull();
  });

  it('shows offline banner when navigator.onLine is false', async () => {
    onlineStatus = false;

    renderWithProviders(<OfflineIndicator />);

    await waitFor(() => {
      expect(screen.getByTestId('offline-indicator')).toBeInTheDocument();
    });

    expect(screen.getByText(/you're offline/i)).toBeInTheDocument();
  });

  it('shows queued count badge when offline with queued actions', async () => {
    onlineStatus = false;

    // Pre-populate queue
    await enqueueOfflineAction('GTEST', 'approve_proposal', { proposalId: 1 });
    await enqueueOfflineAction('GTEST', 'execute_proposal', { proposalId: 2 });

    renderWithProviders(<OfflineIndicator />);

    await waitFor(() => {
      expect(screen.getByTestId('queued-count-badge')).toBeInTheDocument();
    });

    expect(screen.getByTestId('queued-count-badge')).toHaveTextContent('2 queued');
  });

  it('shows "Back online" banner after reconnect', async () => {
    onlineStatus = false;
    renderWithProviders(<OfflineIndicator />);

    await waitFor(() => {
      expect(screen.getByTestId('offline-indicator')).toBeInTheDocument();
    });

    // Simulate coming back online
    onlineStatus = true;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => {
      expect(screen.getByText(/back online/i)).toBeInTheDocument();
    });
  });
});

describe('enqueueOfflineAction', () => {
  beforeEach(() => {
    queueStore.splice(0);
    vi.clearAllMocks();
  });

  it('queues an action with wallet address, action type, parameters, and timestamp', async () => {
    const walletAddress = 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';
    const actionType = 'approve_proposal' as const;
    const parameters = { proposalId: 42 };

    const id = await enqueueOfflineAction(walletAddress, actionType, parameters);

    expect(id).toBeTruthy();
    expect(id).toContain('approve_proposal');

    const count = await getQueuedActionCount();
    expect(count).toBe(1);

    const actions = queueStore;
    expect(actions[0]).toMatchObject({
      walletAddress,
      actionType,
      parameters,
    });
    expect(actions[0].timestamp).toBeTruthy();
    expect(new Date(actions[0].timestamp).getTime()).toBeGreaterThan(0);
  });

  it('queues multiple actions in order', async () => {
    await enqueueOfflineAction('GTEST', 'approve_proposal', { proposalId: 1 });
    await enqueueOfflineAction('GTEST', 'execute_proposal', { proposalId: 2 });
    await enqueueOfflineAction('GTEST', 'reject_proposal', { proposalId: 3 });

    const count = await getQueuedActionCount();
    expect(count).toBe(3);
  });
});

describe('useOfflineSync — replay on reconnect', () => {
  beforeEach(() => {
    queueStore.splice(0);
    onlineStatus = true;
    vi.clearAllMocks();
  });

  afterEach(() => {
    onlineStatus = true;
  });

  it('calls executeAction for each queued action on reconnect', async () => {
    // Pre-populate queue
    queueStore.push({
      id: 'approve_proposal-1',
      walletAddress: 'GTEST',
      actionType: 'approve_proposal',
      parameters: { proposalId: 1 },
      timestamp: new Date().toISOString(),
      attempts: 0,
    });
    queueStore.push({
      id: 'execute_proposal-2',
      walletAddress: 'GTEST',
      actionType: 'execute_proposal',
      parameters: { proposalId: 2 },
      timestamp: new Date().toISOString(),
      attempts: 0,
    });

    const executeAction = vi.fn().mockResolvedValue('tx-hash');

    function TestComponent() {
      const { queuedCount, isReplaying } = useOfflineSync(executeAction);
      return (
        <div>
          <span data-testid="count">{queuedCount}</span>
          <span data-testid="replaying">{isReplaying ? 'yes' : 'no'}</span>
        </div>
      );
    }

    renderWithProviders(<TestComponent />);

    // Simulate going offline then online
    onlineStatus = false;
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });

    onlineStatus = true;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => {
      expect(executeAction).toHaveBeenCalledTimes(2);
    });

    expect(executeAction).toHaveBeenCalledWith('approve_proposal', { proposalId: 1 });
    expect(executeAction).toHaveBeenCalledWith('execute_proposal', { proposalId: 2 });
  });

  it('shows success toast for each replayed action', async () => {
    queueStore.push({
      id: 'approve_proposal-1',
      walletAddress: 'GTEST',
      actionType: 'approve_proposal',
      parameters: { proposalId: 5 },
      timestamp: new Date().toISOString(),
      attempts: 0,
    });

    const executeAction = vi.fn().mockResolvedValue('tx-hash');

    function TestComponent() {
      useOfflineSync(executeAction);
      return null;
    }

    renderWithProviders(<TestComponent />);

    onlineStatus = false;
    await act(async () => window.dispatchEvent(new Event('offline')));

    onlineStatus = true;
    await act(async () => window.dispatchEvent(new Event('online')));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining('Replayed'),
        'success',
      );
    });
  });

  it('shows error toast and keeps action in queue when replay fails', async () => {
    queueStore.push({
      id: 'execute_proposal-99',
      walletAddress: 'GTEST',
      actionType: 'execute_proposal',
      parameters: { proposalId: 99 },
      timestamp: new Date().toISOString(),
      attempts: 0,
    });

    const executeAction = vi.fn().mockRejectedValue(new Error('Network error'));

    function TestComponent() {
      useOfflineSync(executeAction);
      return null;
    }

    renderWithProviders(<TestComponent />);

    onlineStatus = false;
    await act(async () => window.dispatchEvent(new Event('offline')));

    onlineStatus = true;
    await act(async () => window.dispatchEvent(new Event('online')));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining('Failed to replay'),
        'error',
      );
    });

    // Action should remain in queue
    expect(queueStore).toHaveLength(1);
    expect(queueStore[0].lastError).toBe('Network error');
  });
});
