/**
 * PendingTransactionsBanner
 *
 * A persistent banner that lists every queued transaction with its current
 * status.  Shown whenever the offline queue contains at least one entry.
 *
 * Integrates with useOfflineSync and reads directly from IndexedDB via the
 * queue helpers so it stays accurate across tab focus changes.
 */

import React, { useState } from 'react';
import { Clock, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, X, RefreshCw } from 'lucide-react';
import type { OfflineAction, QueueEntryStatus } from '../utils/offlineQueue';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PendingTransactionsBannerProps {
  /** Actions from useOfflineSync.queuedActions */
  actions: OfflineAction[];
  /** Whether a replay is currently in progress */
  isReplaying: boolean;
  /** Trigger a manual replay */
  onRetryAll: () => void;
  /** Remove a single entry from the queue */
  onDismiss: (id: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusLabel(status: QueueEntryStatus): string {
  switch (status) {
    case 'pending':    return 'Queued';
    case 'submitting': return 'Submitting…';
    case 'confirmed':  return 'Confirmed';
    case 'failed':     return 'Failed';
  }
}

function actionLabel(action: OfflineAction): string {
  const params = action.parameters;
  switch (action.actionType) {
    case 'approve_proposal':
      return `Approve proposal #${params.proposalId ?? '?'}`;
    case 'execute_proposal':
      return `Execute proposal #${params.proposalId ?? '?'}`;
    case 'reject_proposal':
      return `Reject proposal #${params.proposalId ?? '?'}`;
    case 'propose_transfer':
      return `Transfer to ${String(params.recipient ?? '?').slice(0, 8)}…`;
    default:
      return action.actionType;
  }
}

function StatusIcon({ status }: { status: QueueEntryStatus }) {
  switch (status) {
    case 'pending':
      return <Clock className="h-4 w-4 text-yellow-400" aria-hidden="true" />;
    case 'submitting':
      return <Loader2 className="h-4 w-4 text-blue-400 animate-spin" aria-hidden="true" />;
    case 'confirmed':
      return <CheckCircle2 className="h-4 w-4 text-green-400" aria-hidden="true" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-400" aria-hidden="true" />;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PendingTransactionsBanner({
  actions,
  isReplaying,
  onRetryAll,
  onDismiss,
}: PendingTransactionsBannerProps) {
  const [expanded, setExpanded] = useState(false);

  if (actions.length === 0) return null;

  const pendingCount = actions.filter((a) => a.status === 'pending').length;
  const failedCount  = actions.filter((a) => a.status === 'failed').length;

  const summaryText = isReplaying
    ? `Submitting ${actions.length} transaction${actions.length !== 1 ? 's' : ''}…`
    : failedCount > 0
    ? `${failedCount} transaction${failedCount !== 1 ? 's' : ''} failed — ${pendingCount} pending`
    : `${actions.length} transaction${actions.length !== 1 ? 's' : ''} pending submission`;

  return (
    <div
      className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 text-white overflow-hidden"
      role="status"
      aria-live="polite"
      aria-label="Pending transactions"
      data-testid="pending-transactions-banner"
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          {isReplaying
            ? <Loader2 className="h-4 w-4 text-yellow-400 animate-spin shrink-0" aria-hidden="true" />
            : <Clock className="h-4 w-4 text-yellow-400 shrink-0" aria-hidden="true" />
          }
          <span className="text-sm font-medium text-yellow-200 truncate">{summaryText}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isReplaying && navigator.onLine && (
            <button
              onClick={onRetryAll}
              className="flex items-center gap-1 text-xs text-yellow-300 hover:text-yellow-100 transition-colors"
              title="Retry all pending transactions"
              data-testid="retry-all-btn"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Retry all
            </button>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-yellow-300 hover:text-yellow-100 transition-colors"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse transaction list' : 'Expand transaction list'}
            data-testid="toggle-expand-btn"
          >
            {expanded
              ? <ChevronUp className="h-4 w-4" aria-hidden="true" />
              : <ChevronDown className="h-4 w-4" aria-hidden="true" />
            }
          </button>
        </div>
      </div>

      {/* Expanded entry list */}
      {expanded && (
        <ul
          className="border-t border-yellow-500/20 divide-y divide-yellow-500/10"
          aria-label="Queued transactions"
          data-testid="pending-transactions-list"
        >
          {actions.map((action) => (
            <li
              key={action.id}
              className="flex items-start gap-3 px-4 py-2.5"
              data-testid={`pending-tx-item-${action.id}`}
            >
              <StatusIcon status={action.status} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200 truncate">{actionLabel(action)}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {statusLabel(action.status)}
                  {action.attempts > 0 && action.status !== 'confirmed' && (
                    <span className="ml-2 text-gray-500">
                      · {action.attempts} attempt{action.attempts !== 1 ? 's' : ''}
                    </span>
                  )}
                  {action.txHash && (
                    <span
                      className="ml-2 font-mono text-green-400"
                      title={action.txHash}
                    >
                      {action.txHash.slice(0, 8)}…
                    </span>
                  )}
                </p>
                {action.lastError && action.status === 'failed' && (
                  <p
                    className="text-xs text-red-400 mt-0.5 truncate"
                    title={action.lastError}
                    data-testid={`pending-tx-error-${action.id}`}
                  >
                    {action.lastError}
                  </p>
                )}
              </div>
              <button
                onClick={() => onDismiss(action.id)}
                className="text-gray-500 hover:text-gray-300 transition-colors p-0.5 shrink-0"
                aria-label={`Dismiss ${actionLabel(action)}`}
                data-testid={`dismiss-tx-${action.id}`}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default PendingTransactionsBanner;
