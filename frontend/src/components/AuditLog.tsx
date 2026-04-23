import React, { useState, useEffect, useMemo } from 'react';
import { Search, Filter, Shield, AlertTriangle, CheckCircle, ChevronLeft, ChevronRight, RefreshCw, Info } from 'lucide-react';
import type { AuditVerificationResult, AuditEntry } from '../utils/auditVerification';
import { verifyAuditChain, prepareChainedAuditLog, entryDetailAmount } from '../utils/auditVerification';
import { useVaultContract } from '../hooks/useVaultContract';
import { useToast } from '../hooks/useToast';
import { env } from '../config/env';

interface FilterState {
  search: string;
  dateFrom: string;
  dateTo: string;
  userFilter: string;
  actionTypeFilter: string[];
  amountMin: string;
  amountMax: string;
}

const ITEMS_PER_PAGE = 50;

function formatUserLabel(user: string): string {
  if (!user || user === 'System') return user;
  if (user.length <= 16) return user;
  return `${user.slice(0, 8)}...${user.slice(-6)}`;
}

const AuditLog: React.FC = () => {
  const { getAllVaultEventsForAudit } = useVaultContract();
  const { notify } = useToast();

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [verification, setVerification] = useState<AuditVerificationResult | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  const [filters, setFilters] = useState<FilterState>({
    search: '',
    dateFrom: '',
    dateTo: '',
    userFilter: '',
    actionTypeFilter: [],
    amountMin: '',
    amountMax: '',
  });

  const fetchAuditLog = async () => {
    setLoading(true);
    try {
      const result = await getAllVaultEventsForAudit(2000);
      const chainedEntries = prepareChainedAuditLog(result.activities, env.contractId);
      setEntries(chainedEntries);
      const v = verifyAuditChain(chainedEntries);
      setVerification(v);
      if (!v.isValid) {
        notify('audit_tamper', v.headline, 'error');
      }
    } catch (err) {
      console.error('Failed to fetch audit log:', err);
      notify('audit_error', 'Failed to load audit log', 'error');
      setVerification(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAuditLog();
    // Intentionally once on mount — pagination helper from the contract hook is not referentially stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredEntries = useMemo(() => {
    const minAmt = filters.amountMin.trim() ? parseFloat(filters.amountMin) : null;
    const maxAmt = filters.amountMax.trim() ? parseFloat(filters.amountMax) : null;

    return entries.filter(entry => {
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const matchesSearch =
          entry.action.toLowerCase().includes(searchLower) ||
          entry.user.toLowerCase().includes(searchLower) ||
          entry.transactionHash.toLowerCase().includes(searchLower) ||
          entry.sourceEventId.toLowerCase().includes(searchLower) ||
          entry.ledger.includes(searchLower) ||
          JSON.stringify(entry.details).toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      if (filters.dateFrom) {
        const entryDate = new Date(entry.timestamp);
        const fromDate = new Date(filters.dateFrom);
        if (entryDate < fromDate) return false;
      }

      if (filters.dateTo) {
        const entryDate = new Date(entry.timestamp);
        const toDate = new Date(filters.dateTo);
        toDate.setHours(23, 59, 59);
        if (entryDate > toDate) return false;
      }

      if (filters.userFilter && !entry.user.toLowerCase().includes(filters.userFilter.toLowerCase())) {
        return false;
      }

      if (filters.actionTypeFilter.length > 0 && !filters.actionTypeFilter.includes(entry.action)) {
        return false;
      }

      if (minAmt != null || maxAmt != null) {
        const amt = entryDetailAmount(entry);
        if (amt == null) return false;
        if (minAmt != null && amt < minAmt) return false;
        if (maxAmt != null && amt > maxAmt) return false;
      }

      return true;
    });
  }, [entries, filters]);

  const paginatedEntries = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredEntries.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredEntries, currentPage]);

  const totalPages = Math.ceil(filteredEntries.length / ITEMS_PER_PAGE);

  const actionTypes = useMemo(() => {
    const types = new Set(entries.map(e => e.action));
    return Array.from(types);
  }, [entries]);

  const tamperedSet = useMemo(() => new Set(verification?.tamperedEntries ?? []), [verification]);

  const handleFilterChange = (key: keyof FilterState, value: unknown) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      dateFrom: '',
      dateTo: '',
      userFilter: '',
      actionTypeFilter: [],
      amountMin: '',
      amountMax: '',
    });
    setCurrentPage(1);
  };

  const statusBadge = verification ? (
    <div
      className={`flex flex-col gap-1 px-3 py-2 rounded-lg border max-w-md ${
        !verification.isValid
          ? 'bg-red-500/10 border-red-500/30 text-red-300'
          : verification.integrity === 'strong'
            ? 'bg-green-500/10 border-green-500/30 text-green-400'
            : verification.integrity === 'none'
              ? 'bg-gray-500/10 border-gray-500/30 text-gray-400'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
      }`}
    >
      <div className="flex items-center gap-2">
        {!verification.isValid ? (
          <AlertTriangle size={16} />
        ) : verification.integrity === 'strong' ? (
          <CheckCircle size={16} />
        ) : verification.integrity === 'none' ? (
          <Info size={16} />
        ) : (
          <Shield size={16} />
        )}
        <span className="text-xs font-medium leading-snug">{verification.headline}</span>
      </div>
      {verification.detailLines.length > 0 && (
        <ul className="text-[11px] text-gray-400 list-disc pl-4 space-y-0.5">
          {verification.detailLines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  ) : null;

  const structuralIssues = verification?.issues.filter(
    i => i.code === 'hash_mismatch' || i.code === 'chain_break'
  ) ?? [];
  const qualityIssues = verification?.issues.filter(
    i => i.code === 'missing_payload' || i.code === 'failed_call'
  ) ?? [];

  return (
    <div className="min-h-screen bg-gray-900 p-4 sm:p-6 text-white">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold">Audit Log</h1>
            <p className="text-gray-400 text-sm mt-1">
              Cryptographic chain over Soroban contract events for this vault (newest pages merged up to 2k events).
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
            {statusBadge}
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <button
                type="button"
                onClick={() => void fetchAuditLog()}
                disabled={loading}
                className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg transition-colors"
              >
                <Filter size={16} />
                Filters
              </button>
            </div>
          </div>
        </div>

        {verification && verification.issues.length > 0 && (
          <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            {structuralIssues.length > 0 && (
              <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4">
                <div className="text-xs font-semibold text-red-300 uppercase tracking-wide mb-2">Chain problems</div>
                <ul className="text-sm text-red-200/90 space-y-1 max-h-40 overflow-y-auto">
                  {structuralIssues.slice(0, 12).map((iss, idx) => (
                    <li key={`${iss.entryId}-${iss.code}-${idx}`}>{iss.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {qualityIssues.length > 0 && verification.isValid && (
              <div className="rounded-xl border border-amber-500/25 bg-amber-950/15 p-4">
                <div className="text-xs font-semibold text-amber-300 uppercase tracking-wide mb-2">Data quality</div>
                <ul className="text-sm text-amber-100/90 space-y-1 max-h-40 overflow-y-auto">
                  {qualityIssues.slice(0, 12).map((iss, idx) => (
                    <li key={`${iss.entryId}-${iss.code}-${idx}`}>{iss.message}</li>
                  ))}
                  {qualityIssues.length > 12 && (
                    <li className="text-amber-200/70">…and {qualityIssues.length - 12} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        {showFilters && (
          <div className="bg-gray-800/50 rounded-xl p-4 mb-6 border border-gray-700">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500" size={16} />
                  <input
                    type="text"
                    value={filters.search}
                    onChange={(e) => handleFilterChange('search', e.target.value)}
                    placeholder="Action, user, event id, ledger, details…"
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-10 pr-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">From Date</label>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">To Date</label>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">User</label>
                <input
                  type="text"
                  value={filters.userFilter}
                  onChange={(e) => handleFilterChange('userFilter', e.target.value)}
                  placeholder="Filter by user..."
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Min amount (from details)</label>
                <input
                  type="number"
                  value={filters.amountMin}
                  onChange={(e) => handleFilterChange('amountMin', e.target.value)}
                  placeholder="e.g. 100"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Max amount (from details)</label>
                <input
                  type="number"
                  value={filters.amountMax}
                  onChange={(e) => handleFilterChange('amountMax', e.target.value)}
                  placeholder="e.g. 10000"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-400 mb-1">Action Types</label>
                <div className="flex flex-wrap gap-2">
                  {actionTypes.map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        const current = filters.actionTypeFilter;
                        const updated = current.includes(type)
                          ? current.filter(t => t !== type)
                          : [...current, type];
                        handleFilterChange('actionTypeFilter', updated);
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                        filters.actionTypeFilter.includes(type)
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={clearFilters}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-800 border-b border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Timestamp</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Ledger</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">User</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Action</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Details</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Event</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                      Loading audit log from chain…
                    </td>
                  </tr>
                ) : paginatedEntries.length > 0 ? (
                  paginatedEntries.map(entry => {
                    const broken = tamperedSet.has(entry.id);
                    return (
                      <tr
                        key={entry.id}
                        className={`hover:bg-gray-700/30 transition-colors ${
                          broken ? 'bg-red-950/30 border-l-2 border-l-red-500' : ''
                        }`}
                      >
                        <td className="px-4 py-3 text-sm text-gray-300 whitespace-nowrap">
                          {new Date(entry.timestamp).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-400 whitespace-nowrap">{entry.ledger}</td>
                        <td className="px-4 py-3 text-sm text-gray-300">
                          <code className="text-xs bg-gray-900 px-2 py-1 rounded">{formatUserLabel(entry.user)}</code>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className="px-2 py-1 bg-purple-500/20 text-purple-300 rounded text-xs font-medium">
                            {entry.action}
                          </span>
                          {entry.callSucceeded === false && (
                            <span className="ml-1 text-[10px] uppercase text-red-400">failed call</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-400 max-w-xs truncate" title={JSON.stringify(entry.details)}>
                          {JSON.stringify(entry.details)}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <code className="text-xs text-gray-500 break-all">{entry.sourceEventId.slice(0, 20)}…</code>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                      No audit entries match your filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700">
              <div className="text-sm text-gray-400">
                Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredEntries.length)} of {filteredEntries.length} entries
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 rounded-lg transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <div className="flex items-center px-4 py-2 bg-gray-700 rounded-lg text-sm">
                  Page {currentPage} of {totalPages}
                </div>
                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 rounded-lg transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
            <div className="text-gray-400 text-sm mb-1">Total Actions</div>
            <div className="text-2xl font-bold text-white">{entries.length}</div>
          </div>
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
            <div className="text-gray-400 text-sm mb-1">Unique Users</div>
            <div className="text-2xl font-bold text-white">
              {new Set(entries.map(e => e.user)).size}
            </div>
          </div>
          <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
            <div className="text-gray-400 text-sm mb-1">Action Types</div>
            <div className="text-2xl font-bold text-white">{actionTypes.length}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuditLog;
