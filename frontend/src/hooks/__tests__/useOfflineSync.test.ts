/**
 * Tests for useOfflineSync
 *
 * Covers:
 *  - queue-and-retry: entries survive a failed attempt and are retried with
 *    exponential back-off
 *  - queue-after-reconnect: the online event triggers replay and confirmed
 *    entries are removed
 *  - XDR path: signedXdr entries are submitted via submitXdr, not executeAction
 *  - fallback path: entries without signedXdr use executeAction
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOfflineSync } from '../useOfflineSync';
import * as queueModule from '../../utils/offlineQueue';
import type { OfflineAction } from '../../utils/offlineQueue';

// ─── Shared mocks ─────────────────────────────────────────────────────────────

vi.mock('../../utils/offlineQueue', async (importOriginal) => {
  const actual = await importOriginal<typeof queueModule>();
  return {
    ...actual,
    getQueuedActions: vi.fn(),
    getQueuedActionCount: vi.fn(),
    removeQueuedAction: vi.fn(),
    updateActionAttempt: vi.fn(),
    updateActionStatus: vi.fn(),
  };
});

vi.mock('../useToast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

// Keep navigator.onLine controllable
let mockOnline = true;
Object.defineProperty(navigator, 'onLine', {
  get: () => mockOnline,
  configurable: true,
});

function makeAction(overrides: Partial<OfflineAction> = {}): OfflineAction {
  return {
    id: `action-${Math.random().toString(36).slice(2)}`,
    walletAddress: 'GAAA',
    actionType: 'approve_proposal',
    parameters: { proposalId: '1' },
    timestamp: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
    ...overrides,
  };
}

beforeEach(() => {
  mockOnline = true;
  vi.clearAllMocks();
  vi.mocked(queueModule.getQueuedActions).mockResolvedValue([]);
  vi.mocked(queueModule.getQueuedActionCount).mockResolvedValue(0);
  vi.mocked(queueModule.removeQueuedAction).mockResolvedValue();
  vi.mocked(queueModule.updateActionAttempt).mockResolvedValue();
  vi.mocked(queueModule.updateActionStatus).mockResolvedValue();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Basic state ──────────────────────────────────────────────────────────────

describe('initial state', () => {
  it('initialises with an empty queue', async () => {
    const { result } = renderHook(() => useOfflineSync());
    await waitFor(() => expect(result.current.isReplaying).toBe(false));
    expect(result.current.queuedCount).toBe(0);
    expect(result.current.queuedActions).toHaveLength(0);
  });
});

// ─── replayQueue – action path ────────────────────────────────────────────────

describe('replayQueue – action (re-sign) path', () => {
  it('calls executeAction for entries without signedXdr', async () => {
    const action = makeAction();
    vi.mocked(queueModule.getQueuedActions).mockResolvedValue([action]);

    const executeAction = vi.fn().mockResolvedValue('txhash1');

    const { result } = renderHook(() => useOfflineSync({ executeAction }));

    await act(async () => {
      await result.current.replayQueue();
    });

    expect(executeAction).toHaveBeenCalledWith(action.actionType, action.parameters);
    expect(queueModule.removeQueuedAction).toHaveBeenCalledWith(action.id);
  });

  it('records failure and does not remove entry when executeAction throws', async () => {
    const action = makeAction();
    vi.mocked(queueModule.getQueuedActions).mockResolvedValue([action]);

    const executeAction = vi.fn().mockRejectedValue(new Error('RPC error'));

    const { result } = renderHook(() => useOfflineSync({ executeAction }));

    await act(async () => {
      await result.current.replayQueue();
    });

    expect(queueModule.updateActionAttempt).toHaveBeenCalledWith(action.id, 'RPC error');
    expect(queueModule.removeQueuedAction).not.toHaveBeenCalled();
  });
});

// ─── replayQueue – XDR path ────────────────────────────────────────────────────

describe('replayQueue – XDR (pre-signed) path', () => {
  it('calls submitXdr with the stored XDR', async () => {
    const xdr = 'AAAA_SIGNED_XDR==';
    const action = makeAction({ signedXdr: xdr });
    vi.mocked(queueModule.getQueuedActions).mockResolvedValue([action]);

    const submitXdr = vi.fn().mockResolvedValue('txhash42');

    const { result } = renderHook(() => useOfflineSync({ submitXdr }));

    await act(async () => {
      await result.current.replayQueue();
    });

    expect(submitXdr).toHaveBeenCalledWith(xdr);
    expect(queueModule.updateActionStatus).toHaveBeenCalledWith(action.id, 'confirmed', 'txhash42');
    expect(queueModule.removeQueuedAction).toHaveBeenCalledWith(action.id);
  });

  it('queue-and-retry: failed XDR entry stays in queue with incremented attempts', async () => {
    const xdr = 'SIGNED_XDR';
    const action = makeAction({ signedXdr: xdr });
    vi.mocked(queueModule.getQueuedActions).mockResolvedValue([action]);

    const submitXdr = vi.fn().mockRejectedValue(new Error('timeout'));

    const { result } = renderHook(() => useOfflineSync({ submitXdr }));

    await act(async () => {
      await result.current.replayQueue();
    });

    expect(queueModule.updateActionAttempt).toHaveBeenCalledWith(action.id, 'timeout');
    // Entry is NOT removed — it stays for the next replay
    expect(queueModule.removeQueuedAction).not.toHaveBeenCalled();
  });
});

// ─── Back-off ─────────────────────────────────────────────────────────────────

describe('exponential back-off', () => {
  it('skips the back-off delay for first-attempt entries (attempts=0)', async () => {
    vi.useFakeTimers();

    const action = makeAction({ attempts: 0 });
    vi.mocked(queueModule.getQueuedActions).mockResolvedValue([action]);

    const submitXdr = vi.fn().mockResolvedValue('hash');

    const { result } = renderHook(() => useOfflineSync({ submitXdr }));

    // Fire replay without advancing time — should resolve immediately
    const replayPromise = act(async () => { await result.current.replayQueue(); });
    await vi.runAllTimersAsync();
    await replayPromise;

    expect(submitXdr).toHaveBeenCalled();
  });

  it('applies a 2 s delay for a first-retry entry (attempts=1)', async () => {
    vi.useFakeTimers();

    const xdr = 'XDR_RETRY';
    const action = makeAction({ signedXdr: xdr, attempts: 1, status: 'failed' });
    vi.mocked(queueModule.getQueuedActions).mockResolvedValue([action]);

    const submitXdr = vi.fn().mockResolvedValue('hash');

    const { result } = renderHook(() => useOfflineSync({ submitXdr }));

    let resolved = false;
    const replayPromise = act(async () => {
      await result.current.replayQueue();
      resolved = true;
    });

    // Before the 2 s back-off elapses, submitXdr should not have been called
    await vi.advanceTimersByTimeAsync(500);
    expect(submitXdr).not.toHaveBeenCalled();

    // After 2 s, replay should proceed
    await vi.advanceTimersByTimeAsync(2000);
    await replayPromise;
    expect(submitXdr).toHaveBeenCalled();
    expect(resolved).toBe(true);
  });
});

// ─── queue-after-reconnect ────────────────────────────────────────────────────

describe('queue-after-reconnect', () => {
  it('triggers replayQueue when navigator goes online after being offline', async () => {
    // Start offline
    mockOnline = false;

    const action = makeAction({ signedXdr: 'XDR' });
    vi.mocked(queueModule.getQueuedActions).mockResolvedValue([action]);

    const submitXdr = vi.fn().mockResolvedValue('hash');

    renderHook(() => useOfflineSync({ submitXdr }));

    // Simulate coming back online
    mockOnline = true;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      // Let all microtasks + the replay settle
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(submitXdr).toHaveBeenCalledWith('XDR');
  });

  it('does not replay if already online at mount (wasOffline is false)', async () => {
    mockOnline = true;

    const action = makeAction({ signedXdr: 'XDR' });
    vi.mocked(queueModule.getQueuedActions).mockResolvedValue([action]);

    const submitXdr = vi.fn().mockResolvedValue('hash');

    renderHook(() => useOfflineSync({ submitXdr }));

    // Dispatch online without having been offline first — should not replay
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(submitXdr).not.toHaveBeenCalled();
  });
});

// ─── refreshQueue ─────────────────────────────────────────────────────────────

describe('refreshQueue', () => {
  it('filters out confirmed entries from queuedActions', async () => {
    const confirmed = makeAction({ status: 'confirmed' });
    const pending   = makeAction({ status: 'pending' });
    vi.mocked(queueModule.getQueuedActions).mockResolvedValue([confirmed, pending]);

    const { result } = renderHook(() => useOfflineSync());

    await act(async () => {
      await result.current.refreshQueue();
    });

    expect(result.current.queuedActions).toHaveLength(1);
    expect(result.current.queuedActions[0].id).toBe(pending.id);
  });
});
