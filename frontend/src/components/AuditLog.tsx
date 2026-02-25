import React, { useState, useEffect, useMemo } from 'react';
import { Search, Filter, Shield, AlertTriangle, CheckCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import type { AuditEntry } from '../utils/auditVerification';
import { verifyAuditChain, buildAuditChain } from '../utils/auditVerification';
import { useVaultContract } from '../hooks/useVaultContract';
import { useToast } from '../hooks/useToast';

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

const AuditLog: React.FC = () => {
  const { getVaultEvents } = useVaultContract();
  const { notify } = useToast();
  
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<'verified' | 'tampered' | 'checking' | null>(null);
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

  useEffect(() => {
    fetchAuditLog();
  }, []);

  const fetchAuditLog = async () => {
    setLoading(true);
    try {
      const result = await getVaultEvents();
      const auditEntries: AuditEntry[] = result.activities.map((activity, index) => ({
        id: activity.id,
        timestamp: activity.timestamp,
        ledger: activity.ledger,
        user: activity.actor || 'System',
        action: activity.type,
        details: activity.details,
        transactionHash: activity.eventId || `tx_${index}`,
      }));
      
      const chainedEntries = buildAuditChain(auditEntries);
      setEntries(chainedEntries);
      verifyLogs(chainedEntries);
    } catch (err) {
      console.error('Failed to fetch audit log:', err);
      notify('audit_error', 'Failed to load audit log', 'error');
    } finally {
      setLoading(false);
    }
  };

  const verifyLogs = (logEntries: AuditEntry[]) => {
    setVerificationStatus('checking');
    setTimeout(() => {
      const verification = verifyAuditChain(logEntries);
      setVerificationStatus(verification.isValid ? 'verified' : 'tampered');
      
      if (!verification.isValid) {
        notify('audit_tamper', `Tampering detected in ${verification.tamperedEntries.length} entries`, 'error');
      }
    }, 500);
  };

  const filteredEntries = useMemo(() => {
    return entries.filter(entry => {
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const matchesSearch = 
          entry.action.toLowerCase().includes(searchLower) ||
          entry.user.toLowerCase().includes(searchLower) ||
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

  return (
    <div className="min-h-screen bg-gray-900 p-4 sm:p-6 text-white">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold">Audit Log</h1>
            <p className="text-gray-400 text-sm mt-1">
              Comprehensive immutable activity trail
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            {verificationStatus && (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                verificationStatus === 'verified' 
                  ? 'bg-green-500/10 border-green-500/30 text-green-400'
                  : verificationStatus === 'tampered'
                  ? 'bg-red-500/10 border-red-500/30 text-red-400'
                  : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
              }`}>
                {verificationStatus === 'verified' ? (
                  <>
                    <CheckCircle size={16} />
                    <span className="text-xs font-medium">Verified</span>
                  </>
                ) : verificationStatus === 'tampered' ? (
                  <>
                    <AlertTriangle size={16} />
                    <span className="text-xs font-medium">Tampered</span>
                  </>
                ) : (
                  <>
                    <Shield size={16} className="animate-pulse" />
                    <span className="text-xs font-medium">Checking...</span>
                  </>
                )}
              </div>
            )}
            
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg transition-colors"
            >
              <Filter size={16} />
              Filters
            </button>
          </div>
        </div>

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
                    placeholder="Search logs..."
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

              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-400 mb-1">Action Types</label>
                <div className="flex flex-wrap gap-2">
                  {actionTypes.map(type => (
                    <button
                      key={type}
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">User</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Action</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Details</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">TX Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                      Loading audit log...
                    </td>
                  </tr>
                ) : paginatedEntries.length > 0 ? (
                  paginatedEntries.map(entry => (
                    <tr key={entry.id} className="hover:bg-gray-700/30 transition-colors">
                      <td className="px-4 py-3 text-sm text-gray-300 whitespace-nowrap">
                        {new Date(entry.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">
                        <code className="text-xs bg-gray-900 px-2 py-1 rounded">
                          {entry.user.slice(0, 8)}...{entry.user.slice(-6)}
                        </code>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="px-2 py-1 bg-purple-500/20 text-purple-300 rounded text-xs font-medium">
                          {entry.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400 max-w-xs truncate">
                        {JSON.stringify(entry.details)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <code className="text-xs text-gray-500">
                          {entry.transactionHash.slice(0, 12)}...
                        </code>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                      No audit entries found
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
