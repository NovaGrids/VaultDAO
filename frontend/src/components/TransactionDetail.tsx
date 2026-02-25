import { useEffect, useMemo } from 'react';
import { Activity, Calendar, ExternalLink, Hash, User, X } from 'lucide-react';
import CopyButton from './CopyButton';
import type { VaultActivity, VaultEventType } from '../types/activity';
import { formatDateTime, formatRelativeTime } from '../utils/dateUtils';

interface TransactionDetailProps {
  isOpen: boolean;
  transaction: VaultActivity | null;
  onClose: () => void;
  explorerBaseUrl?: string;
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

const DEFAULT_EXPLORER_BASE =
  (import.meta.env.VITE_STELLAR_EXPLORER_URL as string | undefined) ??
  'https://stellar.expert/explorer/testnet';

function getStatus(transaction: VaultActivity): 'success' | 'failed' | 'pending' {
  const rawStatus = String(transaction.details.status ?? '').toLowerCase();
  if (rawStatus === 'success' || rawStatus === 'failed' || rawStatus === 'pending') {
    return rawStatus;
  }
  return 'pending';
}

function getStatusClasses(status: 'success' | 'failed' | 'pending'): string {
  if (status === 'success') return 'bg-green-500/15 text-green-300 border border-green-500/30';
  if (status === 'failed') return 'bg-red-500/15 text-red-300 border border-red-500/30';
  return 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/30';
}

function stringifyUnknown(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function TransactionDetail({
  isOpen,
  transaction,
  onClose,
  explorerBaseUrl = DEFAULT_EXPLORER_BASE,
}: TransactionDetailProps): JSX.Element | null {
  useEffect(() => {
    if (!isOpen) return undefined;

    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onEscape);
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', onEscape);
    };
  }, [isOpen, onClose]);

  const transactionHash = transaction?.txHash ?? transaction?.eventId ?? '';
  const status = transaction ? getStatus(transaction) : 'pending';
  const normalizedExplorer = explorerBaseUrl.replace(/\/+$/, '');
  const transactionUrl = transactionHash ? `${normalizedExplorer}/tx/${transactionHash}` : '';
  const ledgerUrl = transaction ? `${normalizedExplorer}/ledger/${transaction.ledger}` : '';

  const detailEntries = useMemo(() => {
    if (!transaction) return [];
    return Object.entries(transaction.details);
  }, [transaction]);

  if (!isOpen || !transaction) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-3xl bg-gray-800 border border-gray-700 sm:rounded-xl overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-4 sm:px-6 py-4 border-b border-gray-700 flex items-start justify-between gap-3">
          <div>
            <h3 id="transaction-detail-title" className="text-lg sm:text-xl font-semibold text-white">
              Transaction Details
            </h3>
            <p className="text-xs sm:text-sm text-gray-400 mt-1">
              {TYPE_LABELS[transaction.type] ?? 'Unknown'} · {formatDateTime(transaction.timestamp)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium uppercase ${getStatusClasses(status)}`}>
              {status}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg"
              aria-label="Close transaction detail"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-4 sm:p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3">
              <p className="text-[11px] uppercase tracking-wide text-gray-500 flex items-center gap-1">
                <Calendar size={13} />
                Time
              </p>
              <p className="text-sm text-gray-100 mt-1">{formatDateTime(transaction.timestamp)}</p>
              <p className="text-xs text-gray-500 mt-1">{formatRelativeTime(transaction.timestamp)}</p>
            </div>
            <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3">
              <p className="text-[11px] uppercase tracking-wide text-gray-500 flex items-center gap-1">
                <Activity size={13} />
                Type
              </p>
              <p className="text-sm text-gray-100 mt-1">{TYPE_LABELS[transaction.type] ?? 'Unknown'}</p>
              <p className="text-xs text-gray-500 mt-1">Ledger {transaction.ledger}</p>
            </div>
          </div>

          <div className="rounded-xl border border-gray-700 overflow-hidden">
            <div className="px-4 py-2 bg-gray-900/50 border-b border-gray-700 text-xs font-semibold text-gray-300 uppercase tracking-wide">
              Core Fields
            </div>
            <div className="divide-y divide-gray-700">
              <div className="px-4 py-3 flex items-start justify-between gap-3">
                <p className="text-xs text-gray-500 pt-1">Transaction Hash</p>
                <div className="flex items-start gap-2">
                  <code className="text-xs text-gray-300 break-all">{transactionHash || '—'}</code>
                  {transactionHash && <CopyButton text={transactionHash} />}
                </div>
              </div>
              <div className="px-4 py-3 flex items-start justify-between gap-3">
                <p className="text-xs text-gray-500 pt-1">Actor</p>
                <div className="flex items-start gap-2">
                  <code className="text-xs text-gray-300 break-all">{transaction.actor || 'System'}</code>
                  {transaction.actor && <CopyButton text={transaction.actor} />}
                </div>
              </div>
              <div className="px-4 py-3 flex items-start justify-between gap-3">
                <p className="text-xs text-gray-500 pt-1">Event ID</p>
                <div className="flex items-start gap-2">
                  <code className="text-xs text-gray-300 break-all">{transaction.eventId}</code>
                  <CopyButton text={transaction.eventId} />
                </div>
              </div>
              <div className="px-4 py-3 flex items-start justify-between gap-3">
                <p className="text-xs text-gray-500 pt-1">Paging Token</p>
                <div className="flex items-start gap-2">
                  <code className="text-xs text-gray-300 break-all">{transaction.pagingToken ?? '—'}</code>
                  {transaction.pagingToken && <CopyButton text={transaction.pagingToken} />}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <a
              href={transactionUrl || undefined}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm border transition-colors ${
                transactionUrl
                  ? 'border-gray-600 bg-gray-900 hover:bg-gray-700 text-white'
                  : 'border-gray-700 bg-gray-900/50 text-gray-500 pointer-events-none'
              }`}
            >
              <Hash size={15} />
              Open Transaction
              <ExternalLink size={14} />
            </a>
            <a
              href={ledgerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm border border-gray-600 bg-gray-900 hover:bg-gray-700 text-white transition-colors"
            >
              <User size={15} />
              Open Ledger
              <ExternalLink size={14} />
            </a>
          </div>

          <div className="rounded-xl border border-gray-700 overflow-hidden">
            <div className="px-4 py-2 bg-gray-900/50 border-b border-gray-700 text-xs font-semibold text-gray-300 uppercase tracking-wide">
              Parsed Details
            </div>
            <div className="divide-y divide-gray-700">
              {detailEntries.length > 0 ? (
                detailEntries.map(([key, value]) => (
                  <div key={key} className="px-4 py-3 flex items-start justify-between gap-3">
                    <p className="text-xs text-gray-500 pt-1">{key}</p>
                    <p className="text-xs text-gray-300 break-all text-right">{stringifyUnknown(value)}</p>
                  </div>
                ))
              ) : (
                <div className="px-4 py-6 text-center text-gray-500 text-sm">No detail fields available.</div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-gray-700 overflow-hidden">
            <div className="px-4 py-2 bg-gray-900/50 border-b border-gray-700 text-xs font-semibold text-gray-300 uppercase tracking-wide">
              Raw JSON
            </div>
            <pre className="p-4 text-xs text-gray-300 overflow-auto whitespace-pre-wrap break-all">
              {JSON.stringify(transaction, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TransactionDetail;
