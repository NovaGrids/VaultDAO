import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import InfiniteScroll from 'react-infinite-scroll-component';
import { ArrowDownUp, Download, RefreshCw } from 'lucide-react';
import { useWallet } from '../hooks/useWallet';
import type { GetVaultEventsResult, VaultActivity, VaultEventType } from '../types/activity';
import { formatDateTime, formatRelativeTime } from '../utils/dateUtils';
import TransactionFilters, {
  DEFAULT_TRANSACTION_FILTERS,
  type TransactionFilterState,
  type TransactionStatusFilter,
} from './TransactionFilters';
import TransactionDetail from './TransactionDetail';

export interface TransactionHistoryProps {
  onTransactionsLoaded?: (transactions: VaultActivity[]) => void;
}

const TYPE_LABELS: Record<VaultEventType, string> = {
  proposal_created: 'Proposal Created',
  proposal_approved: 'Proposal Approved',
  proposal_ready: 'Proposal Ready',
  proposal_executed: 'Proposal Executed',
  proposal_rejected: 'Proposal Rejected',
  signer_added: 'Signer Added',
  signer_removed: 'Signer Removed',
  config_updated: 'Config Updated',
  initialized: 'Vault Initialized',
  role_assigned: 'Role Assigned',
  unknown: 'Unknown',
};

const PAGE_SIZE = 30;
const HORIZON_URL = (import.meta.env.VITE_HORIZON_URL as string | undefined) ?? 'https://horizon-testnet.stellar.org';
const CONFIGURED_VAULT_ADDRESS = (import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined) ?? '';
type TransactionSortBy = 'date' | 'amount' | 'status';
type SortDirection = 'asc' | 'desc';
type TransactionGroupBy = 'none' | 'date' | 'type' | 'status';

interface TransactionGroup {
  key: string;
  label: string;
  items: VaultActivity[];
}

interface HorizonTransaction {
  id: string;
  paging_token: string;
  hash: string;
  successful: boolean;
  source_account: string;
  created_at: string;
  ledger_attr: number;
  memo?: string;
  memo_type: string;
  fee_charged: string;
  max_fee: string;
  operation_count: number;
}

interface HorizonTransactionsResponse {
  _embedded?: {
    records?: HorizonTransaction[];
  };
}

interface TransactionExportRow {
  id: string;
  timestamp: string;
  type: string;
  status: string;
  amount: string;
  address: string;
  ledger: string;
  actor: string;
  txHash: string;
  eventId: string;
  pagingToken: string;
  memo: string;
  feeCharged: string;
  maxFee: string;
  operationCount: string;
  details: string;
}

function truncateMiddle(value: string, lead = 6, tail = 4): string {
  if (!value || value.length <= lead + tail + 3) return value;
  return `${value.slice(0, lead)}...${value.slice(-tail)}`;
}

function stringifyField(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function getAmount(details: Record<string, unknown>): string {
  if (!('amount' in details)) return '—';
  return stringifyField(details.amount);
}

function getCounterparty(details: Record<string, unknown>): string {
  if ('recipient' in details && details.recipient) {
    return stringifyField(details.recipient);
  }
  if ('proposer' in details && details.proposer) {
    return stringifyField(details.proposer);
  }
  return '—';
}

function mergeAndSortTransactions(existing: VaultActivity[], incoming: VaultActivity[]): VaultActivity[] {
  return Array.from(new Map([...existing, ...incoming].map((item) => [item.id, item])).values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

function escapeCsvCell(value: unknown): string {
  const normalized = value == null ? '' : String(value);
  if (/["\n,]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function toCsv(rows: TransactionExportRow[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]) as Array<keyof TransactionExportRow>;
  const headerLine = headers.join(',');
  const bodyLines = rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(','));
  return [headerLine, ...bodyLines].join('\n');
}

function downloadTextFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function buildExportRows(items: VaultActivity[]): TransactionExportRow[] {
  return items.map((transaction) => ({
    id: transaction.id,
    timestamp: transaction.timestamp,
    type: TYPE_LABELS[transaction.type] ?? 'Unknown',
    status: getStatusLabel(transaction),
    amount: getAmount(transaction.details),
    address: getCounterparty(transaction.details),
    ledger: transaction.ledger,
    actor: transaction.actor || 'System',
    txHash: transaction.txHash ?? '',
    eventId: transaction.eventId,
    pagingToken: transaction.pagingToken ?? '',
    memo: stringifyField(transaction.details.memo),
    feeCharged: stringifyField(transaction.details.feeCharged),
    maxFee: stringifyField(transaction.details.maxFee),
    operationCount: stringifyField(transaction.details.operationCount),
    details: JSON.stringify(transaction.details),
  }));
}

const DesktopTransactionRow = memo(function DesktopTransactionRow({
  tx,
  onOpen,
}: {
  tx: VaultActivity;
  onOpen: (transaction: VaultActivity) => void;
}) {
  return (
    <tr
      className="hover:bg-gray-700/20 align-top cursor-pointer focus:outline-none focus:ring-1 focus:ring-purple-500"
      onClick={() => onOpen(tx)}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(tx);
        }
      }}
    >
      <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{formatDateTime(tx.timestamp)}</td>
      <td className="px-4 py-3">
        <span className="px-2 py-1 rounded-full text-xs bg-gray-700 text-gray-200">
          {TYPE_LABELS[tx.type] ?? 'Unknown'}
        </span>
      </td>
      <td className="px-4 py-3 text-gray-300">{getAmount(tx.details)}</td>
      <td className="px-4 py-3 font-mono text-xs text-gray-400">{truncateMiddle(getCounterparty(tx.details))}</td>
      <td className="px-4 py-3 text-gray-300">{tx.ledger}</td>
      <td className="px-4 py-3 font-mono text-xs text-gray-400">{truncateMiddle(tx.actor || 'System')}</td>
    </tr>
  );
});

const MobileTransactionCard = memo(function MobileTransactionCard({
  tx,
  onOpen,
}: {
  tx: VaultActivity;
  onOpen: (transaction: VaultActivity) => void;
}) {
  return (
    <article
      className="p-4 space-y-2 cursor-pointer active:bg-gray-700/40"
      onClick={() => onOpen(tx)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(tx);
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="px-2 py-1 rounded-full text-xs bg-gray-700 text-gray-200">
          {TYPE_LABELS[tx.type] ?? 'Unknown'}
        </span>
        <span className="text-xs text-gray-500">{formatRelativeTime(tx.timestamp)}</span>
      </div>
      <p className="text-sm text-gray-300">{formatDateTime(tx.timestamp)}</p>
      <p className="text-xs text-gray-400">Amount: {getAmount(tx.details)}</p>
      <p className="text-xs text-gray-400 break-all">Address: {getCounterparty(tx.details)}</p>
      <p className="text-xs text-gray-400">Ledger: {tx.ledger}</p>
      <p className="text-xs text-gray-500 font-mono break-all">Actor: {tx.actor || 'System'}</p>
    </article>
  );
});

function parseAmountValue(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const numeric = Number(value.replace(/,/g, ''));
    return Number.isFinite(numeric) ? numeric : 0;
  }
  return 0;
}

function getStatusValue(activity: VaultActivity): TransactionStatusFilter {
  const status = String(activity.details.status ?? '').toLowerCase();
  if (status === 'failed') return 'failed';
  if (status === 'pending') return 'pending';
  if (status === 'success') return 'success';
  return 'pending';
}

function getStatusRank(activity: VaultActivity): number {
  const status = getStatusValue(activity);
  if (status === 'failed') return 0;
  if (status === 'pending') return 1;
  return 2;
}

function getStatusLabel(activity: VaultActivity): string {
  const status = getStatusValue(activity);
  if (status === 'failed') return 'Failed';
  if (status === 'pending') return 'Pending';
  return 'Success';
}

function getGroupData(activity: VaultActivity, groupBy: TransactionGroupBy): { key: string; label: string } {
  if (groupBy === 'date') {
    const isoDate = activity.timestamp.slice(0, 10);
    return { key: isoDate, label: new Date(activity.timestamp).toLocaleDateString() };
  }

  if (groupBy === 'type') {
    return { key: activity.type, label: TYPE_LABELS[activity.type] ?? 'Unknown' };
  }

  if (groupBy === 'status') {
    const label = getStatusLabel(activity);
    return { key: label.toLowerCase(), label };
  }

  return { key: 'all', label: 'All Transactions' };
}

function isLikelyStellarAccount(value: string | null | undefined): value is string {
  return Boolean(value && value.startsWith('G') && value.length >= 32);
}

function resolveHistoryAddress(walletAddress: string | null): string | null {
  if (isLikelyStellarAccount(CONFIGURED_VAULT_ADDRESS)) return CONFIGURED_VAULT_ADDRESS;
  if (isLikelyStellarAccount(walletAddress)) return walletAddress;
  return null;
}

function inferTypeFromHorizonTransaction(tx: HorizonTransaction): VaultEventType {
  const memo = tx.memo?.toLowerCase() ?? '';
  if (memo.includes('created')) return 'proposal_created';
  if (memo.includes('approve')) return 'proposal_approved';
  if (memo.includes('ready')) return 'proposal_ready';
  if (memo.includes('execute')) return 'proposal_executed';
  if (memo.includes('reject') || !tx.successful) return 'proposal_rejected';
  return 'unknown';
}

function mapHorizonTransaction(tx: HorizonTransaction): VaultActivity {
  return {
    id: tx.id,
    type: inferTypeFromHorizonTransaction(tx),
    timestamp: tx.created_at,
    ledger: String(tx.ledger_attr),
    actor: tx.source_account,
    details: {
      recipient: tx.source_account,
      status: tx.successful ? 'success' : 'failed',
      memo: tx.memo ?? '',
      memoType: tx.memo_type,
      feeCharged: tx.fee_charged,
      maxFee: tx.max_fee,
      operationCount: tx.operation_count,
      hash: tx.hash,
      ledger: tx.ledger_attr,
    },
    txHash: tx.hash,
    eventId: tx.hash,
    pagingToken: tx.paging_token,
  };
}

function buildHorizonTransactionsUrl(account: string, cursor?: string): string {
  const normalizedBase = HORIZON_URL.replace(/\/+$/, '');
  const url = new URL(`${normalizedBase}/accounts/${account}/transactions`);
  url.searchParams.set('order', 'desc');
  url.searchParams.set('include_failed', 'true');
  url.searchParams.set('limit', String(PAGE_SIZE));
  if (cursor) url.searchParams.set('cursor', cursor);
  return url.toString();
}

async function fetchTransactionsFromHorizon(
  account: string,
  cursor?: string
): Promise<GetVaultEventsResult> {
  const url = buildHorizonTransactionsUrl(account, cursor);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Horizon request failed (${response.status})`);
  }

  const data = (await response.json()) as HorizonTransactionsResponse;
  const records = data._embedded?.records ?? [];
  const activities = records.map(mapHorizonTransaction);
  const nextCursor = records.length > 0 ? records[records.length - 1].paging_token : undefined;

  return {
    activities,
    latestLedger: records.length > 0 ? String(records[0].ledger_attr) : '0',
    cursor: nextCursor,
    hasMore: records.length === PAGE_SIZE && Boolean(nextCursor),
  };
}

const TransactionHistory: React.FC<TransactionHistoryProps> = ({ onTransactionsLoaded }) => {
  const { address } = useWallet();
  const [transactions, setTransactions] = useState<VaultActivity[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [sortBy, setSortBy] = useState<TransactionSortBy>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [groupBy, setGroupBy] = useState<TransactionGroupBy>('none');
  const [filters, setFilters] = useState<TransactionFilterState>(DEFAULT_TRANSACTION_FILTERS);
  const [mobilePullToRefresh, setMobilePullToRefresh] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<VaultActivity | null>(null);
  const historyAddress = useMemo(() => resolveHistoryAddress(address), [address]);
  const deferredTransactions = useDeferredValue(transactions);

  const loadInitialTransactions = useCallback(async () => {
    if (!historyAddress) {
      setTransactions([]);
      setCursor(undefined);
      setHasMore(false);
      setError('Connect a Stellar account to load transaction history from Horizon.');
      return;
    }

    setLoadingInitial(true);
    setError(null);

    try {
      const result = await fetchTransactionsFromHorizon(historyAddress);
      const sorted = mergeAndSortTransactions([], result.activities);

      setTransactions(sorted);
      setCursor(result.cursor);
      setHasMore(result.hasMore);
    } catch (err) {
      console.error('Failed to load transaction history:', err);
      setError('Failed to load transaction history. Please try again.');
      setTransactions([]);
      setHasMore(false);
      setCursor(undefined);
    } finally {
      setLoadingInitial(false);
    }
  }, [historyAddress]);

  const loadMoreTransactions = useCallback(async () => {
    if (loadingInitial || loadingMore || !hasMore || !historyAddress) return;

    setLoadingMore(true);

    try {
      const result = await fetchTransactionsFromHorizon(historyAddress, cursor);
      setTransactions((prev) => mergeAndSortTransactions(prev, result.activities));
      setCursor(result.cursor);
      setHasMore(result.hasMore);
    } catch (err) {
      console.error('Failed to load additional transactions:', err);
      setError('Failed to load more transactions.');
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, hasMore, historyAddress, loadingInitial, loadingMore]);

  useEffect(() => {
    void loadInitialTransactions();
  }, [loadInitialTransactions]);

  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 768px)');
    const touchQuery = window.matchMedia('(pointer: coarse)');

    const updatePullToRefresh = (): void => {
      setMobilePullToRefresh(mobileQuery.matches || touchQuery.matches);
    };

    updatePullToRefresh();
    mobileQuery.addEventListener('change', updatePullToRefresh);
    touchQuery.addEventListener('change', updatePullToRefresh);

    return () => {
      mobileQuery.removeEventListener('change', updatePullToRefresh);
      touchQuery.removeEventListener('change', updatePullToRefresh);
    };
  }, []);

  useEffect(() => {
    onTransactionsLoaded?.(transactions);
  }, [onTransactionsLoaded, transactions]);

  const totalExecuted = useMemo(
    () => transactions.filter((t) => t.type === 'proposal_executed').length,
    [transactions]
  );

  const filteredTransactions = useMemo(() => {
    const minAmount =
      filters.amountMin.trim() === '' || Number.isNaN(Number(filters.amountMin))
        ? null
        : Number(filters.amountMin);
    const maxAmount =
      filters.amountMax.trim() === '' || Number.isNaN(Number(filters.amountMax))
        ? null
        : Number(filters.amountMax);
    const dateFrom = filters.dateFrom ? new Date(filters.dateFrom).setHours(0, 0, 0, 0) : null;
    const dateTo = filters.dateTo ? new Date(filters.dateTo).setHours(23, 59, 59, 999) : null;
    const addressQuery = filters.address.trim().toLowerCase();

    return deferredTransactions.filter((transaction) => {
      if (filters.types.length > 0 && !filters.types.includes(transaction.type)) return false;

      const amount = parseAmountValue(transaction.details.amount);
      if (minAmount != null && amount < minAmount) return false;
      if (maxAmount != null && amount > maxAmount) return false;

      const transactionTime = new Date(transaction.timestamp).getTime();
      if (dateFrom != null && transactionTime < dateFrom) return false;
      if (dateTo != null && transactionTime > dateTo) return false;

      const status = getStatusValue(transaction);
      if (filters.statuses.length > 0 && !filters.statuses.includes(status)) return false;

      if (addressQuery) {
        const actor = String(transaction.actor ?? '').toLowerCase();
        const counterparty = getCounterparty(transaction.details).toLowerCase();
        if (!actor.includes(addressQuery) && !counterparty.includes(addressQuery)) return false;
      }

      return true;
    });
  }, [deferredTransactions, filters]);

  const sortedTransactions = useMemo(() => {
    const directionMultiplier = sortDirection === 'asc' ? 1 : -1;
    return [...filteredTransactions].sort((a, b) => {
      if (sortBy === 'date') {
        const left = new Date(a.timestamp).getTime();
        const right = new Date(b.timestamp).getTime();
        return (left - right) * directionMultiplier;
      }

      if (sortBy === 'amount') {
        const left = parseAmountValue(a.details.amount);
        const right = parseAmountValue(b.details.amount);
        return (left - right) * directionMultiplier;
      }

      const left = getStatusRank(a);
      const right = getStatusRank(b);
      return (left - right) * directionMultiplier;
    });
  }, [filteredTransactions, sortBy, sortDirection]);

  const groupedTransactions = useMemo(() => {
    const grouped = new Map<string, TransactionGroup>();

    for (const transaction of sortedTransactions) {
      const { key, label } = getGroupData(transaction, groupBy);
      const existing = grouped.get(key);
      if (existing) {
        existing.items.push(transaction);
      } else {
        grouped.set(key, { key, label, items: [transaction] });
      }
    }

    return Array.from(grouped.values());
  }, [groupBy, sortedTransactions]);

  const handleExportCsv = useCallback(() => {
    const rows = buildExportRows(sortedTransactions);
    if (rows.length === 0) return;
    const filename = `transaction-history-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    downloadTextFile(toCsv(rows), filename, 'text/csv;charset=utf-8');
  }, [sortedTransactions]);

  const handleExportJson = useCallback(() => {
    const rows = buildExportRows(sortedTransactions);
    if (rows.length === 0) return;
    const filename = `transaction-history-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    downloadTextFile(JSON.stringify(rows, null, 2), filename, 'application/json;charset=utf-8');
  }, [sortedTransactions]);

  const handleOpenTransactionDetail = useCallback((transaction: VaultActivity) => {
    setSelectedTransaction(transaction);
  }, []);

  const handleCloseTransactionDetail = useCallback(() => {
    setSelectedTransaction(null);
  }, []);

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-gray-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Transaction History</h3>
          <p className="text-sm text-gray-400 mt-1">
            {sortedTransactions.length} shown of {transactions.length} loaded, {totalExecuted} executed transactions
          </p>
        </div>
        <div className="grid grid-cols-2 sm:flex gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={sortedTransactions.length === 0}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium min-h-[44px] sm:min-h-0 w-full sm:w-auto"
          >
            <Download size={16} />
            Export CSV
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            disabled={sortedTransactions.length === 0}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium min-h-[44px] sm:min-h-0 w-full sm:w-auto"
          >
            <Download size={16} />
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => void loadInitialTransactions()}
            disabled={loadingInitial}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-60 disabled:cursor-not-allowed text-sm font-medium min-h-[44px] sm:min-h-0 w-full sm:w-auto col-span-2 sm:col-span-1"
          >
            <RefreshCw size={16} className={loadingInitial ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <div className="px-4 sm:px-5 py-3 border-b border-gray-700">
        <TransactionFilters
          filters={filters}
          onChange={setFilters}
          resultCount={sortedTransactions.length}
        />
      </div>

      <div className="px-4 sm:px-5 py-3 border-b border-gray-700 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wide">
          <ArrowDownUp size={14} />
          Sort & Group
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as TransactionSortBy)}
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-purple-500 min-h-[44px] sm:min-h-0"
          >
            <option value="date">Date</option>
            <option value="amount">Amount</option>
            <option value="status">Status</option>
          </select>
          <button
            type="button"
            onClick={() => setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white hover:bg-gray-800 transition-colors min-h-[44px] sm:min-h-0"
          >
            {sortDirection === 'asc' ? 'Ascending' : 'Descending'}
          </button>
          <select
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value as TransactionGroupBy)}
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-purple-500 min-h-[44px] sm:min-h-0 sm:col-span-2 lg:col-span-1"
          >
            <option value="none">No Grouping</option>
            <option value="date">Group by Date</option>
            <option value="type">Group by Type</option>
            <option value="status">Group by Status</option>
          </select>
        </div>
      </div>

      {loadingInitial && transactions.length === 0 && (
        <div className="px-4 sm:px-5 py-8 text-center text-gray-400">Loading transaction history...</div>
      )}

      {!loadingInitial && error && (
        <div className="px-4 sm:px-5 py-8 text-center">
          <p className="text-red-400 mb-3">{error}</p>
          <button
            type="button"
            onClick={() => void loadInitialTransactions()}
            className="px-4 py-2 rounded-lg bg-red-600/20 text-red-300 border border-red-600/40 hover:bg-red-600/30 min-h-[44px] sm:min-h-0"
          >
            Retry
          </button>
        </div>
      )}

      {!loadingInitial && !error && transactions.length === 0 && (
        <div className="px-4 sm:px-5 py-8 text-center text-gray-400">No transaction activity found.</div>
      )}

      {!error && transactions.length > 0 && (
        <InfiniteScroll
          dataLength={sortedTransactions.length}
          next={() => void loadMoreTransactions()}
          hasMore={hasMore}
          pullDownToRefresh={mobilePullToRefresh}
          pullDownToRefreshThreshold={70}
          refreshFunction={loadInitialTransactions}
          pullDownToRefreshContent={
            <div className="px-4 py-3 text-center text-xs text-gray-500 md:hidden">
              Pull down to refresh
            </div>
          }
          releaseToRefreshContent={
            <div className="px-4 py-3 text-center text-xs text-purple-300 md:hidden">
              Release to refresh
            </div>
          }
          loader={<div className="px-4 sm:px-5 py-4 text-center text-gray-400">Loading more transactions...</div>}
          endMessage={
            <div className="px-4 sm:px-5 py-4 text-center text-xs text-gray-500">All available transactions are loaded.</div>
          }
          scrollThreshold="200px"
          style={{ overflow: 'visible' }}
        >
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-700/40 text-gray-300">
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Type</th>
                  <th className="px-4 py-3 text-left font-medium">Amount</th>
                  <th className="px-4 py-3 text-left font-medium">Address</th>
                  <th className="px-4 py-3 text-left font-medium">Ledger</th>
                  <th className="px-4 py-3 text-left font-medium">Actor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {groupedTransactions.map((group) => (
                  <React.Fragment key={group.key}>
                    {groupBy !== 'none' && (
                      <tr className="bg-gray-900/60">
                        <td colSpan={6} className="px-4 py-2 text-xs text-purple-300 font-semibold uppercase tracking-wide">
                          {group.label} ({group.items.length})
                        </td>
                      </tr>
                    )}
                    {group.items.map((tx) => (
                      <DesktopTransactionRow key={tx.id} tx={tx} onOpen={handleOpenTransactionDetail} />
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden">
            {groupedTransactions.map((group) => (
              <section key={group.key} className="border-b border-gray-700 last:border-b-0">
                {groupBy !== 'none' && (
                  <div className="px-4 py-2 text-xs text-purple-300 font-semibold uppercase tracking-wide bg-gray-900/60">
                    {group.label} ({group.items.length})
                  </div>
                )}
                <div className="divide-y divide-gray-700">
                  {group.items.map((tx) => (
                    <MobileTransactionCard key={tx.id} tx={tx} onOpen={handleOpenTransactionDetail} />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {loadingMore && (
            <div className="px-4 sm:px-5 pb-4 text-center text-xs text-gray-500">Fetching older transactions...</div>
          )}
        </InfiniteScroll>
      )}

      <TransactionDetail
        isOpen={selectedTransaction !== null}
        transaction={selectedTransaction}
        onClose={handleCloseTransactionDetail}
      />
    </div>
  );
};

export default TransactionHistory;
