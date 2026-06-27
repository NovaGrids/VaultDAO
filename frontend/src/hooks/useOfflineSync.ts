/**
 * useOfflineSync
 *
 * Manages the offline action queue lifecycle:
 * - Tracks queue count and exposes it to UI
 * - On reconnect, replays queued actions in order
 * - Shows a toast for each replayed action (success or failure)
 * - Failed actions remain in the queue for manual retry
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getQueuedActions,
  getQueuedActionCount,
  removeQueuedAction,
  updateActionAttempt,
  type OfflineAction,
  type OfflineActionType,
} from '../utils/offlineQueue';
import { useToast } from './useToast';

export interface UseOfflineSyncReturn {
  queuedCount: number;
  isReplaying: boolean;
  replayQueue: () => Promise<void>;
  refreshCount: () => Promise<void>;
}

type ActionExecutor = (
  actionType: OfflineActionType,
  parameters: Record<string, unknown>,
) => Promise<string | void>;

/**
 * @param executeAction - Callback that actually executes a contract action.
 *   Receives the action type and parameters; should throw on failure.
 */
export function useOfflineSync(executeAction?: ActionExecutor): UseOfflineSyncReturn {
  const { showToast } = useToast();
  const [queuedCount, setQueuedCount] = useState(0);
  const [isReplaying, setIsReplaying] = useState(false);
  const wasOfflineRef = useRef(!navigator.onLine);
  const executeRef = useRef(executeAction);
  executeRef.current = executeAction;

  const refreshCount = useCallback(async () => {
    try {
      const c = await getQueuedActionCount();
      setQueuedCount(c);
    } catch {
      // IndexedDB may not be available in all environments
    }
  }, []);

  // Initial count
  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  const replayQueue = useCallback(async () => {
    if (!executeRef.current) return;
    if (isReplaying) return;

    let actions: OfflineAction[];
    try {
      actions = await getQueuedActions();
    } catch {
      return;
    }

    if (actions.length === 0) return;

    setIsReplaying(true);

    for (const action of actions) {
      const label = formatActionLabel(action.actionType, action.parameters);
      try {
        await executeRef.current(action.actionType, action.parameters);
        await removeQueuedAction(action.id);
        showToast(`✓ Replayed: ${label}`, 'success');
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await updateActionAttempt(action.id, errMsg);
        showToast(`✗ Failed to replay: ${label} — ${errMsg}`, 'error');
      }
    }

    setIsReplaying(false);
    await refreshCount();
  }, [isReplaying, showToast, refreshCount]);

  // Listen for online event to trigger replay
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
        void refreshCount();
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
  }, [refreshCount]);

  return { queuedCount, isReplaying, replayQueue, refreshCount };
}

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
