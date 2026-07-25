import { useCallback } from 'react';
import { performanceTracker } from '../utils/performanceTracking';

export interface OptimisticUpdateOptions<T> {
  /** Apply an optimistic mutation to state before the async operation starts. */
  applyUpdate: (prev: T) => T;
  /** The async operation (e.g. RPC call) to perform after the optimistic update. */
  performAction: () => Promise<void>;
  /** Called with the current (rolled-back) state when the operation fails. */
  onRollback?: (rolledBackState: T) => void;
  /** Called when the operation succeeds. */
  onSuccess?: () => void;
  /** Called with the error when the operation fails (after rollback). */
  onError?: (err: Error) => void;
  /** Human-readable label used for metric tracking (e.g. "approve_proposal"). */
  metricLabel?: string;
}

export interface UseOptimisticUpdateReturn<T> {
  /**
   * Execute an optimistic update cycle:
   * 1. Save current state snapshot.
   * 2. Apply the optimistic mutation immediately.
   * 3. Run the async operation.
   * 4. On failure: rollback state, call onRollback/onError.
   * 5. On success: call onSuccess.
   */
  execute: (
    setState: React.Dispatch<React.SetStateAction<T>>,
    options: OptimisticUpdateOptions<T>
  ) => Promise<void>;
}

/**
 * A generic hook that provides a type-safe optimistic update pattern with
 * automatic rollback on failure.
 *
 * Emits performance metrics via `performanceTracker` for:
 *   - `optimistic_update.<label>` — fired on every optimistic application
 *   - `optimistic_commit.<label>` — fired when the operation succeeds
 *   - `optimistic_rollback.<label>` — fired when a rollback is triggered
 */
export function useOptimisticUpdate<T>(): UseOptimisticUpdateReturn<T> {
  const execute = useCallback(
    async (
      setState: React.Dispatch<React.SetStateAction<T>>,
      {
        applyUpdate,
        performAction,
        onRollback,
        onSuccess,
        onError,
        metricLabel = 'unknown',
      }: OptimisticUpdateOptions<T>
    ): Promise<void> => {
      const startTime = performance.now();

      // We capture the snapshot synchronously inside the setState updater so
      // we have the exact pre-optimistic value to restore on rollback.
      // Using a plain variable (closed over) rather than a ref ensures the
      // value is available at the point the rollback setState updater is
      // called, even after React flushes batched updates.
      let snapshot: T | undefined;

      // 1. Capture snapshot + apply optimistic update atomically.
      setState((prev) => {
        snapshot = prev;
        return applyUpdate(prev);
      });

      // Emit metric: optimistic update applied (duration 0 = event marker).
      performanceTracker.trackSlowQuery(
        `optimistic_update.${metricLabel}`,
        0,
        'computation'
      );

      try {
        // 2. Run the real async operation.
        await performAction();

        const duration = performance.now() - startTime;
        performanceTracker.trackSlowQuery(
          `optimistic_commit.${metricLabel}`,
          duration,
          'api'
        );

        onSuccess?.();
      } catch (rawErr) {
        const err = rawErr instanceof Error ? rawErr : new Error(String(rawErr));

        // 3. Rollback: restore the pre-optimistic snapshot.
        // `snapshot` is guaranteed to be set because step 1 ran synchronously.
        const rolledBack = snapshot as T;
        setState(() => rolledBack);

        const duration = performance.now() - startTime;
        performanceTracker.trackSlowQuery(
          `optimistic_rollback.${metricLabel}`,
          duration,
          'api'
        );

        onRollback?.(rolledBack);
        onError?.(err);
      }
    },
    []
  );

  return { execute };
}
