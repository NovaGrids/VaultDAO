import React, { useState, useCallback, useEffect } from 'react';
import { Copy, ExternalLink, ChevronDown } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { env } from '../config/env';

const API_BASE = ((import.meta.env as Record<string, string | undefined>).VITE_API_BASE_URL) ?? 'http://localhost:3000';
const PAGE_SIZE = 20;

export type AuditAction =
  | 'proposal_created' | 'proposal_approved' | 'proposal_executed'
  | 'proposal_rejected' | 'signer_added' | 'signer_removed'
  | 'config_updated' | 'role_assigned' | 'initialized';

export interface BackendAuditEntry {
  id: string;
  action: AuditAction | string;
  actor: string;
  target?: string;
  txHash?: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

function truncate(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

const ALL_ACTIONS: (AuditAction | string)[] = [
  'proposal_created', 'proposal_approved', 'proposal_executed',
  'proposal_rejected', 'signer_added', 'signer_removed',
  'config_updated', 'role_assigned', 'initialized',
];

const AuditLog: React.FC = () => {
  const { notify, showToast } = useToast();
  const [entries, setEntries] = useState<BackendAuditEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState<string>('');

  const fetchPage = useCallback(async (nextOffset: number, filter: string, replace: boolean) => {
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
      const data = await res.json() as { entries: BackendAuditEntry[]; total?: number };
      const fetched = data.entries ?? [];

      setEntries((prev) => replace ? fetched : [...prev, ...fetched]);
      setOffset(nextOffset + fetched.length);
      setHasMore(fetched.length === PAGE_SIZE);
    } catch (e) {
      notify('audit_error', e instanceof Error ? e.message : 'Failed to load audit log', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  // Initial load
  useEffect(() => {
    void fetchPage(0, actionFilter, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter]);

  const handleFilterChange = (action: string) => {
    setActionFilter(action);
    setOffset(0);
    setHasMore(true);
  };

  const copyActor = (actor: string) => {
    void navigator.clipboard.writeText(actor);
    showToast('Address copied', 'success');
  };

  return (
    <div className="space-y-4">
      {/* Action filter */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => handleFilterChange('')}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
            actionFilter === '' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          All
        </button>
        {ALL_ACTIONS.map((a) => (
          <button
            key={a}
            onClick={() => handleFilterChange(a)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              actionFilter === a ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-800 border-b border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Action</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Actor</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Target</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Timestamp</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Tx</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {entries.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">No audit entries found.</td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-700/30 transition-colors">
                    <td className="px-4 py-3 text-gray-500 text-xs">{entry.id.slice(0, 12)}…</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 bg-purple-500/20 text-purple-300 rounded text-xs font-medium">
                        {entry.action}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <code className="text-xs text-gray-300">{truncate(entry.actor)}</code>
                        <button
                          onClick={() => copyActor(entry.actor)}
                          className="text-gray-500 hover:text-gray-300 transition-colors"
                          title="Copy address"
                        >
                          <Copy size={12} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {entry.target ? truncate(entry.target) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      {entry.txHash ? (
                        <a
                          href={`${env.explorerUrl}/tx/${entry.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-purple-400 hover:text-purple-300 transition-colors"
                          title="View on Stellar Expert"
                        >
                          <ExternalLink size={14} />
                        </a>
                      ) : '—'}
                    </td>
                  </tr>
                ))
              )}
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-4 text-center text-gray-400 text-xs">Loading…</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {hasMore && !loading && (
          <div className="px-4 py-3 border-t border-gray-700 flex justify-center">
            <button
              onClick={() => void fetchPage(offset, actionFilter, false)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
            >
              <ChevronDown size={16} /> Load More
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuditLog;
