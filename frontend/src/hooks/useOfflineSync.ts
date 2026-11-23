/**
 * useOfflineSync
 *
 * Manages the offline action queue lifecycle:
 * - Tracks queue entries and exposes them to UI
 * - On reconnect, replays queued actions in insertion order
 * - Applies exponential back-off between retries (base 2 s, max 64 s)
 * - Resubmits signed XDR entries directly without re-signing
 * - Shows a toast for each replayed action (success or failure)
 * - Marks entries 'confirmed' when the transaction lands on-chain, then
 *   removes them from the queue
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getQueuedActions,
  getQueuedActionCount,
  removeQueuedAction,
  updateActionAttempt,
  updateActionStatus,
  type OfflineAction,
  type OfflineActionType,
} from '../utils/offlineQueue';
import { useToast } from './useToast';

// ─── Back-off ─────────────────────────────────────────────────────────────────

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 64_000;

/** Delay for attempt N (0-indexed), capped at BACKOFF_MAX_MS. */
function backoffDelay(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UseOfflineSyncReturn {
  /** All entries currently in the queue (pending + failed). */
  queuedActions: OfflineAction[];
  queuedCount: number;
  isReplaying: boolean;
  replayQueue: () => Promise<void>;
  refreshQueue: () => Promise<void>;
  /** @deprecated use refreshQueue */
  refreshCount: () => Promise<void>;
}

type ActionExecutor = (
  actionType: OfflineActionType,
  parameters: Record<string, unknown>,
) => Promise<string | void>;

/**
 * Submit a signed XDR envelope directly to the Soroban RPC.
 * Returns the transaction hash on success.
 */
type XdrSubmitter = (signedXdr: string) => Promise<string>;

export interface UseOfflineSyncOptions {
  /**
   * Callback that re-executes a contract action by type + params (re-signs).
   * Required for entries without a stored XDR.
   */
  executeAction?: ActionExecutor;
  /**
   * Callback that sends a pre-signed XDR to the network and returns the
   * transaction hash.  Required for XDR-backed entries.
   */
  submitXdr?: XdrSubmitter;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useOfflineSync(
  executeActionOrOptions?: ActionExecutor | UseOfflineSyncOptions,
): UseOfflineSyncReturn {
  // Accept either the legacy (executeAction) signature or the new options bag
  const opts: UseOfflineSyncOptions =
    typeof executeActionOrOptions === 'function'
      ? { executeAction: executeActionOrOptions }
      : (executeActionOrOptions ?? {});

  const { showToast } = useToast();
  const [queuedActions, setQueuedActions] = useState<OfflineAction[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);
  const wasOfflineRef = useRef(!navigator.onLine);
  const executeRef = useRef(opts.executeAction);
  const submitXdrRef = useRef(opts.submitXdr);
  executeRef.current = opts.executeAction;
  submitXdrRef.current = opts.submitXdr;

  const refreshQueue = useCallback(async () => {
    try {
      const actions = await getQueuedActions();
      setQueuedActions(actions.filter((a) => a.status !== 'confirmed'));
    } catch {
      // IndexedDB may not be available in all environments
    }
  }, []);

  // Keep the deprecated refreshCount alias working
  const refreshCount = refreshQueue;

  // Initial load
  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  const replayQueue = useCallback(async () => {
    if (isReplaying) return;

    let actions: OfflineAction[];
    try {
      actions = await getQueuedActions();
    } catch {
      return;
    }

    const pending = actions.filter((a) => a.status !== 'confirmed');
    if (pending.length === 0) return;

    setIsReplaying(true);

    for (const action of pending) {
      const label = formatActionLabel(action.actionType, action.parameters);

      // Apply back-off before retrying a previously-failed entry
      if (action.attempts > 0) {
        await sleep(backoffDelay(action.attempts - 1));
      }

      try {
        await updateActionStatus(action.id, 'submitting');
        setQueuedActions((prev) =>
          prev.map((a) => (a.id === action.id ? { ...a, status: 'submitting' } : a)),
        );

        let txHash: string | undefined;

        if (action.signedXdr && submitXdrRef.current) {
          // Fast path: resubmit the already-signed envelope
          txHash = await submitXdrRef.current(action.signedXdr);
        } else if (executeRef.current) {
          // Slow path: re-execute (re-sign) the action
          const result = await executeRef.current(action.actionType, action.parameters);
          txHash = typeof result === 'string' ? result : undefined;
        } else {
          throw new Error('No executor or XDR submitter configured for this entry');
        }

        await updateActionStatus(action.id, 'confirmed', txHash);
        // Remove confirmed entries so they no longer appear in the banner
        await removeQueuedAction(action.id);
        showToast(`✓ Submitted: ${label}${txHash ? ` (${txHash.slice(0, 8)}…)` : ''}`, 'success');
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await updateActionAttempt(action.id, errMsg);
        showToast(`✗ Failed: ${label} — ${errMsg}`, 'error');
      }
    }

    setIsReplaying(false);
    await refreshQueue();
  }, [isReplaying, showToast, refreshQueue]);

  // Trigger replay when the browser goes from offline → online
  useEffect(() => {
    const handleOnline = () => {
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false;
        void replayQueue();
      }
    };

    const handleOffline = () => {
      wasOfflineRef.current = true;
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [replayQueue]);

  // Listen for SW sync results
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SYNC_RESULTS') {
        void refreshQueue();
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
  }, [refreshQueue]);

  return {
    queuedActions,
    queuedCount: queuedActions.length,
    isReplaying,
    replayQueue,
    refreshQueue,
    refreshCount,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatActionLabel(
  actionType: OfflineActionType,
  parameters: Record<string, unknown>,
): string {
  switch (actionType) {
    case 'approve_proposal':
      return `Approve proposal #${parameters.proposalId ?? '?'}`;
    case 'execute_proposal':
      return `Execute proposal #${parameters.proposalId ?? '?'}`;
    case 'reject_proposal':
      return `Reject proposal #${parameters.proposalId ?? '?'}`;
    case 'propose_transfer':
      return `Propose transfer to ${String(parameters.recipient ?? '?').slice(0, 8)}…`;
    default:
      return actionType;
  }
}
