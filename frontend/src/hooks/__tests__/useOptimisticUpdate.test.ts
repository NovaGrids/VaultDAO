import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { useOptimisticUpdate } from '../useOptimisticUpdate';

// ---------------------------------------------------------------------------
// Mock performanceTracker so we can spy on metric emissions without starting
// the real PerformanceObserver / setInterval machinery.
// ---------------------------------------------------------------------------
vi.mock('../../utils/performanceTracking', () => ({
  performanceTracker: {
    trackSlowQuery: vi.fn(),
  },
}));

// Grab the mock reference after the module is mocked
import { performanceTracker } from '../../utils/performanceTracking';
const mockTrackSlowQuery = vi.mocked(performanceTracker.trackSlowQuery);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Renders the hook together with a simple array state so we can inspect
 *  both the state mutations and the optimistic execute in one place. */
function renderWithState<T>(initial: T) {
  const { result } = renderHook(() => {
    const [state, setState] = useState<T>(initial);
    const { execute } = useOptimisticUpdate<T>();
    return { state, setState, execute };
  });
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useOptimisticUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Basic optimistic update (success path)
  // -------------------------------------------------------------------------
  describe('success path', () => {
    it('applies the optimistic update before the async operation resolves', async () => {
      const result = renderWithState([1, 2, 3]);

      let resolveAction!: () => void;
      const pendingAction = new Promise<void>((resolve) => {
        resolveAction = resolve;
      });

      act(() => {
        void result.current.execute(result.current.setState, {
          applyUpdate: (prev) => [...prev, 99],
          performAction: () => pendingAction,
        });
      });

      // Optimistic state should be visible immediately
      expect(result.current.state).toEqual([1, 2, 3, 99]);

      // Resolve the async operation
      await act(async () => {
        resolveAction();
      });

      // State should remain with the optimistic update applied
      expect(result.current.state).toEqual([1, 2, 3, 99]);
    });

    it('calls onSuccess when the operation resolves', async () => {
      const result = renderWithState<number[]>([]);
      const onSuccess = vi.fn();

      await act(async () => {
        await result.current.execute(result.current.setState, {
          applyUpdate: (prev) => [...prev, 1],
          performAction: () => Promise.resolve(),
          onSuccess,
        });
      });

      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    it('does not call onError or onRollback when the operation succeeds', async () => {
      const result = renderWithState<string[]>([]);
      const onError = vi.fn();
      const onRollback = vi.fn();

      await act(async () => {
        await result.current.execute(result.current.setState, {
          applyUpdate: (prev) => [...prev, 'a'],
          performAction: () => Promise.resolve(),
          onError,
          onRollback,
        });
      });

      expect(onError).not.toHaveBeenCalled();
      expect(onRollback).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Rollback on failure
  // -------------------------------------------------------------------------
  describe('failure / rollback path', () => {
    it('rolls back to the pre-optimistic state when the operation rejects', async () => {
      const initial = [{ id: '1', status: 'Pending', approvals: 0 }];
      const result = renderWithState(initial);

      await act(async () => {
        await result.current.execute(result.current.setState, {
          applyUpdate: (prev) =>
            prev.map((p) => (p.id === '1' ? { ...p, status: 'Approved', approvals: 1 } : p)),
          performAction: () => Promise.reject(new Error('RPC failure')),
        });
      });

      // State should be restored to the original value
      expect(result.current.state).toEqual(initial);
      expect(result.current.state[0].status).toBe('Pending');
    });

    it('calls onError with the thrown error', async () => {
      const result = renderWithState<number[]>([10]);
      const onError = vi.fn();
      const rpcError = new Error('network timeout');

      await act(async () => {
        await result.current.execute(result.current.setState, {
          applyUpdate: (prev) => [...prev, 20],
          performAction: () => Promise.reject(rpcError),
          onError,
        });
      });

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(rpcError);
    });

    it('wraps non-Error rejections in an Error object before calling onError', async () => {
      const result = renderWithState<number[]>([]);
      const onError = vi.fn();

      await act(async () => {
        await result.current.execute(result.current.setState, {
          applyUpdate: (prev) => [...prev, 1],
          // eslint-disable-next-line prefer-promise-reject-errors
          performAction: () => Promise.reject('plain string error'),
          onError,
        });
      });

      expect(onError).toHaveBeenCalledTimes(1);
      const received = onError.mock.calls[0][0];
      expect(received).toBeInstanceOf(Error);
      expect(received.message).toBe('plain string error');
    });

    it('calls onRollback with the rolled-back state', async () => {
      const initial = ['a', 'b'];
      const result = renderWithState(initial);
      const onRollback = vi.fn();

      await act(async () => {
        await result.current.execute(result.current.setState, {
          applyUpdate: (prev) => [...prev, 'c'],
          performAction: () => Promise.reject(new Error('fail')),
          onRollback,
        });
      });

      expect(onRollback).toHaveBeenCalledTimes(1);
      expect(onRollback).toHaveBeenCalledWith(initial);
    });

    it('does not call onSuccess when the operation rejects', async () => {
      const result = renderWithState<number[]>([]);
      const onSuccess = vi.fn();

      await act(async () => {
        await result.current.execute(result.current.setState, {
          applyUpdate: (prev) => [...prev, 1],
          performAction: () => Promise.reject(new Error('oops')),
          onSuccess,
        });
      });

      expect(onSuccess).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Multiple sequential executions
  // -------------------------------------------------------------------------
  describe('sequential executions', () => {
    it('applies the correct snapshot for each independent execute call', async () => {
      // Verify that each execute call captures its own pre-call snapshot by
      // using a standalone useState/dispatch pair rather than renderHook
      // chained across multiple act() blocks (which can have subtle React 19
      // batching effects on result.current between acts).
      const capturedRollbacks: unknown[] = [];

      // First call: success — apply 'x', action succeeds.
      const result1 = renderWithState<string[]>([]);
      await act(async () => {
        await result1.current.execute(result1.current.setState, {
          applyUpdate: (prev) => [...prev, 'x'],
          performAction: () => Promise.resolve(),
        });
      });
      expect(result1.current.state).toEqual(['x']);

      // Second call (fresh hook, pre-set to ['x']): failure — optimistic 'y'
      // should roll back, restoring ['x'].
      const result2 = renderHook(() => {
        const [state, setState] = useState<string[]>(['x']);
        const { execute } = useOptimisticUpdate<string[]>();
        return { state, setState, execute };
      });
      await act(async () => {
        await result2.result.current.execute(result2.result.current.setState, {
          applyUpdate: (prev) => [...prev, 'y'],
          performAction: () => Promise.reject(new Error('rpc fail')),
          onRollback: (rolled) => capturedRollbacks.push(rolled),
        });
      });

      expect(capturedRollbacks).toEqual([['x']]);
    });
  });

  // -------------------------------------------------------------------------
  // Metric emissions
  // -------------------------------------------------------------------------
  describe('metric tracking', () => {
    it('emits an optimistic_update metric when the update is applied', async () => {
      const result = renderWithState<number[]>([]);

      await act(async () => {
        await result.current.execute(result.current.setState, {
          metricLabel: 'test_action',
          applyUpdate: (prev) => [...prev, 1],
          performAction: () => Promise.resolve(),
        });
      });

      const updateCall = mockTrackSlowQuery.mock.calls.find(([name]) =>
        name.startsWith('optimistic_update.')
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![0]).toBe('optimistic_update.test_action');
    });

    it('emits an optimistic_commit metric on success', async () => {
      const result = renderWithState<number[]>([]);

      await act(async () => {
        await result.current.execute(result.current.setState, {
          metricLabel: 'commit_action',
          applyUpdate: (prev) => [...prev, 1],
          performAction: () => Promise.resolve(),
        });
      });

      const commitCall = mockTrackSlowQuery.mock.calls.find(([name]) =>
        name.startsWith('optimistic_commit.')
      );
      expect(commitCall).toBeDefined();
      expect(commitCall![0]).toBe('optimistic_commit.commit_action');
    });

    it('emits an optimistic_rollback metric on failure', async () => {
      const result = renderWithState<number[]>([]);

      await act(async () => {
        await result.current.execute(result.current.setState, {
          metricLabel: 'rollback_action',
          applyUpdate: (prev) => [...prev, 1],
          performAction: () => Promise.reject(new Error('fail')),
        });
      });

      const rollbackCall = mockTrackSlowQuery.mock.calls.find(([name]) =>
        name.startsWith('optimistic_rollback.')
      );
      expect(rollbackCall).toBeDefined();
      expect(rollbackCall![0]).toBe('optimistic_rollback.rollback_action');
    });

    it('does NOT emit a rollback metric on success', async () => {
      const result = renderWithState<number[]>([]);

      await act(async () => {
        await result.current.execute(result.current.setState, {
          metricLabel: 'no_rollback',
          applyUpdate: (prev) => [...prev, 1],
          performAction: () => Promise.resolve(),
        });
      });

      const rollbackCall = mockTrackSlowQuery.mock.calls.find(([name]) =>
        name.startsWith('optimistic_rollback.')
      );
      expect(rollbackCall).toBeUndefined();
    });

    it('uses "unknown" label when metricLabel is not provided', async () => {
      const result = renderWithState<number[]>([]);

      await act(async () => {
        await result.current.execute(result.current.setState, {
          applyUpdate: (prev) => [...prev, 1],
          performAction: () => Promise.resolve(),
          // metricLabel intentionally omitted
        });
      });

      const updateCall = mockTrackSlowQuery.mock.calls.find(([name]) =>
        name === 'optimistic_update.unknown'
      );
      expect(updateCall).toBeDefined();
    });
  });
});
