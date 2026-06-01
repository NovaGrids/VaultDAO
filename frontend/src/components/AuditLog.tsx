import React, { useState, useCallback, useEffect, useRef } from 'react';
import InfiniteScroll from 'react-infinite-scroll-component';
import {
  Copy,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  UserPlus,
  UserMinus,
  CheckCircle2,
  XCircle,
  PlayCircle,
  PlusCircle,
  Settings,
  Key,
  Zap,
  AlertTriangle,
} from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { env } from '../config/env';
import AuditExporter from './AuditExporter';

const API_BASE =
  (import.meta.env as Record<string, string | undefined>).VITE_API_BASE_URL ??
  'http://localhost:3000';
const PAGE_SIZE = 50;

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuditAction =
  | 'proposal_created'
  | 'proposal_approved'
  | 'proposal_executed'
  | 'proposal_rejected'
  | 'signer_added'
  | 'signer_removed'
  | 'config_updated'
  | 'role_assigned'
  | 'initialized';

export interface BackendAuditEntry {
  id: string;
  action: AuditAction | string;
  actor: string;
  target?: string;
  txHash?: string;
  timestamp: string;
  details?: Record<string, unknown>;
  hash?: string;
  prev_hash?: string;
}

interface VerificationResult {
  verified: boolean;
  brokenAtEntry: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(isoString).toLocaleDateString();
}

function ActionIcon({ action }: { action: string }) {
  const cls = 'w-4 h-4 flex-shrink-0';
  switch (action) {
    case 'proposal_created':
      return <PlusCircle className={`${cls} text-blue-400`} aria-hidden="true" />;
    case 'proposal_approved':
      return <CheckCircle2 className={`${cls} text-green-400`} aria-hidden="true" />;
    case 'proposal_executed':
      return <PlayCircle className={`${cls} text-purple-400`} aria-hidden="true" />;
    case 'proposal_rejected':
      return <XCircle className={`${cls} text-red-400`} aria-hidden="true" />;
    case 'signer_added':
      return <UserPlus className={`${cls} text-teal-400`} aria-hidden="true" />;
    case 'signer_removed':
      return <UserMinus className={`${cls} text-orange-400`} aria-hidden="true" />;
    case 'config_updated':
      return <Settings className={`${cls} text-gray-400`} aria-hidden="true" />;
    case 'role_assigned':
      return <Key className={`${cls} text-yellow-400`} aria-hidden="true" />;
    case 'initialized':
      return <Zap className={`${cls} text-indigo-400`} aria-hidden="true" />;
    default:
      return <AlertTriangle className={`${cls} text-gray-500`} aria-hidden="true" />;
  }
}

const ALL_ACTIONS: (AuditAction | string)[] = [
  'proposal_created',
  'proposal_approved',
  'proposal_executed',
  'proposal_rejected',
  'signer_added',
  'signer_removed',
  'config_updated',
  'role_assigned',
  'initialized',
];

// ─── Component ───────────────────────────────────────────────────────────────

const AuditLog: React.FC = () => {
  const { notify, showToast } = useToast();

  const [entries, setEntries] = useState<BackendAuditEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState<string>('');

  // Verification state
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);

  // Track broken entry index for highlighting
  const brokenEntryRef = useRef<number | null>(null);

  const fetchPage = useCallback(
    async (nextOffset: number, filter: string, replace: boolean) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          contractId: env.contractId,
          offset: String(nextOffset),
          limit: String(PAGE_SIZE),
        });
        if (filter) params.set('action', filter);

        const res = await fetch(`${API_BASE}/api/v1/audit?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { entries?: BackendAuditEntry[]; data?: BackendAuditEntry[]; total?: number };
        const fetched = data.entries ?? data.data ?? [];

        setEntries((prev) => (replace ? fetched : [...prev, ...fetched]));
        setOffset(nextOffset + fetched.length);
        setHasMore(fetched.length === PAGE_SIZE);
      } catch (e) {
        notify('audit_error', e instanceof Error ? e.message : 'Failed to load audit log', 'error');
      } finally {
        setLoading(false);
      }
    },
    [notify],
  );

  // Initial load
  useEffect(() => {
    void fetchPage(0, actionFilter, true);
    // Reset verification when filter changes
    setVerificationResult(null);
    setVerificationError(null);
    brokenEntryRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      void fetchPage(offset, actionFilter, false);
    }
  }, [loading, hasMore, offset, actionFilter, fetchPage]);

  const handleFilterChange = (action: string) => {
    setActionFilter(action);
    setOffset(0);
    setHasMore(true);
  };

  const copyActor = (actor: string) => {
    void navigator.clipboard.writeText(actor);
    showToast('Address copied', 'success');
  };

  // ── Chain Verification ────────────────────────────────────────────────────

  const handleVerifyChain = useCallback(async () => {
    setVerifying(true);
    setVerificationResult(null);
    setVerificationError(null);
    brokenEntryRef.current = null;

    try {
      const params = new URLSearchParams({
        contractId: env.contractId,
        offset: '0',
        limit: String(Math.max(entries.length, PAGE_SIZE)),
      });

      const res = await fetch(`${API_BASE}/api/v1/audit/verify?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { data?: VerificationResult } | VerificationResult;

      // Handle both wrapped and unwrapped response shapes
      const result: VerificationResult =
        'data' in data && data.data ? data.data : (data as VerificationResult);

      setVerificationResult(result);
      brokenEntryRef.current = result.brokenAtEntry;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Verification failed';
      setVerificationError(msg);
      notify('audit_verify_error', msg, 'error');
    } finally {
      setVerifying(false);
    }
  }, [entries.length, notify]);

  // ── Render ────────────────────────────────────────────────────────────────

  const isBrokenEntry = (index: number) =>
    verificationResult !== null &&
    !verificationResult.verified &&
    verificationResult.brokenAtEntry !== null &&
    index >= verificationResult.brokenAtEntry;

  return (
    <div className="space-y-4">
      {/* Toolbar: filter + verify + export */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Action filter */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleFilterChange('')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              actionFilter === ''
                ? 'bg-purple-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            All
          </button>
          {ALL_ACTIONS.map((a) => (
            <button
              key={a}
              onClick={() => handleFilterChange(a)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                actionFilter === a
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {a}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => void handleVerifyChain()}
            disabled={verifying || entries.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 rounded-lg text-sm transition-colors"
            aria-label="Verify audit chain integrity"
            data-testid="verify-chain-button"
          >
            {verifying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Verifying…
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                Verify Chain
              </>
            )}
          </button>

          <AuditExporter entries={entries} />
        </div>
      </div>

      {/* Verification banner */}
      {verificationResult !== null && (
        <div
          className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm border ${
            verificationResult.verified
              ? 'bg-green-500/10 border-green-500/30 text-green-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
          role="status"
          aria-live="polite"
          data-testid="verification-banner"
        >
          {verificationResult.verified ? (
            <>
              <ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-semibold">Chain Verified ✓</p>
                <p className="text-xs opacity-80 mt-0.5">
                  All {entries.length} entries form a valid hash chain.
                </p>
              </div>
            </>
          ) : (
            <>
              <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-semibold">
                  Chain Broken at entry #{verificationResult.brokenAtEntry ?? '?'} ✗
                </p>
                <p className="text-xs opacity-80 mt-0.5">
                  The hash chain is invalid from entry #{verificationResult.brokenAtEntry ?? '?'}{' '}
                  onwards. This may indicate tampered or missing records.
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {verificationError && (
        <div
          className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm bg-red-500/10 border border-red-500/30 text-red-300"
          role="alert"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          {verificationError}
        </div>
      )}

      {/* Infinite scroll table */}
      <div
        id="audit-scroll-container"
        className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden"
      >
        <InfiniteScroll
          dataLength={entries.length}
          next={loadMore}
          hasMore={hasMore}
          loader={
            <div className="px-4 py-4 text-center text-gray-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" aria-hidden="true" />
              Loading more entries…
            </div>
          }
          endMessage={
            entries.length > 0 ? (
              <div className="px-4 py-3 text-center text-gray-500 text-xs border-t border-gray-700">
                All {entries.length} entries loaded
              </div>
            ) : null
          }
          scrollableTarget="audit-scroll-container"
          style={{ overflow: 'visible' }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Audit log entries">
              <thead className="bg-gray-800 border-b border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                    Action
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                    Actor
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                    Target
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                    Time
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">
                    Tx
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {entries.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                      No audit entries found.
                    </td>
                  </tr>
                ) : (
                  entries.map((entry, index) => {
                    const broken = isBrokenEntry(index);
                    const isBreakPoint =
                      verificationResult !== null &&
                      !verificationResult.verified &&
                      index === verificationResult.brokenAtEntry;

                    return (
                      <tr
                        key={entry.id}
                        className={`transition-colors ${
                          broken
                            ? 'bg-red-500/10 hover:bg-red-500/15'
                            : 'hover:bg-gray-700/30'
                        }`}
                        data-testid={broken ? 'broken-entry' : 'audit-entry'}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <ActionIcon action={entry.action} />
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                broken
                                  ? 'bg-red-500/20 text-red-300'
                                  : 'bg-purple-500/20 text-purple-300'
                              }`}
                            >
                              {entry.action}
                            </span>
                            {isBreakPoint && (
                              <span
                                className="ml-1 px-1.5 py-0.5 bg-red-600/30 border border-red-500/50 rounded text-xs text-red-300"
                                title="Hash chain breaks at this entry — subsequent entries may be tampered"
                                role="tooltip"
                                data-testid="chain-break-tooltip"
                              >
                                ⚠ chain break
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <code className="text-xs text-gray-300">{truncate(entry.actor)}</code>
                            <button
                              onClick={() => copyActor(entry.actor)}
                              className="text-gray-500 hover:text-gray-300 transition-colors p-0.5 rounded"
                              title={`Copy full address: ${entry.actor}`}
                              aria-label={`Copy actor address ${entry.actor}`}
                            >
                              <Copy size={12} aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400">
                          {entry.target ? truncate(entry.target) : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                          <span
                            title={new Date(entry.timestamp).toLocaleString()}
                            className="cursor-help"
                          >
                            {relativeTime(entry.timestamp)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {entry.txHash ? (
                            <a
                              href={`${env.explorerUrl}/tx/${entry.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-purple-400 hover:text-purple-300 transition-colors"
                              title="View on Stellar Expert"
                              aria-label={`View transaction ${entry.txHash} on Stellar Expert`}
                            >
                              <ExternalLink size={14} aria-hidden="true" />
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
                {loading && entries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-xs">
                      <Loader2 className="w-4 h-4 animate-spin inline mr-2" aria-hidden="true" />
                      Loading…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </InfiniteScroll>
      </div>
    </div>
  );
};

export default AuditLog;
