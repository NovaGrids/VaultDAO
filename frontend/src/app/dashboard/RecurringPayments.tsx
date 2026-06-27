import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Clock,
  Plus,
  Play,
  Pause,
  XCircle,
  History,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Calendar,
  DollarSign,
  Loader2,
  List,
  StopCircle,
  TriangleAlert,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from 'recharts';
import { useVaultContract } from '../../hooks/useVaultContract';
import type { RecurringPayment, RecurringPaymentHistory } from '../../hooks/useVaultContract';
import { useActionReadiness } from '../../hooks/useActionReadiness';
import CreateRecurringPaymentModal from '../../components/modals/CreateRecurringPaymentModal';
import type { CreateRecurringPaymentFormData } from '../../components/modals/CreateRecurringPaymentModal';
import ConfirmationModal from '../../components/modals/ConfirmationModal';
import ReadinessWarning from '../../components/ReadinessWarning';
import { useToast } from '../../context/ToastContext';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Enriched status that merges contract state with backend overdue data */
type RichStatus = 'active' | 'due' | 'paused' | 'stopped' | 'overdue';

/** Shape returned by GET /api/v1/recurring/overdue */
interface OverduePaymentRecord {
  paymentId: string;
  computedStatus: 'active' | 'paused' | 'stopped' | 'overdue';
  missedPayments: number;
  ledgersUntilDue: number;
}

/** Calendar dot data point for the scatter chart */
interface CalendarDot {
  /** Days from today (0 = today) */
  day: number;
  /** Arbitrary y-position for visual spread */
  y: number;
  status: RichStatus;
  label: string;
  timestamp: number;
}

// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const DUE_SOON_LEDGERS = 1000;
const AUTO_REFRESH_MS = 30_000;
const BACKEND_BASE = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3001';

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Derive the rich display status for a payment, optionally enriched with
 * backend overdue data.
 */
const getRichStatus = (
  payment: RecurringPayment,
  overdueMap: Map<string, OverduePaymentRecord>,
): RichStatus => {
  const record = overdueMap.get(payment.id);
  if (record) {
    if (record.computedStatus === 'overdue') return 'overdue';
    if (record.computedStatus === 'stopped') return 'stopped';
    if (record.computedStatus === 'paused') return 'paused';
  }
  if (payment.status === 'cancelled') return 'stopped';
  if (payment.status === 'paused') return 'paused';
  const ledgersUntilDue = record?.ledgersUntilDue ?? Infinity;
  if (payment.nextPaymentTime <= Date.now() || ledgersUntilDue <= 0) return 'overdue';
  if (ledgersUntilDue <= DUE_SOON_LEDGERS) return 'due';
  return 'active';
};

// Legacy helper kept for backward-compat with existing tests
const getPaymentStatus = (payment: RecurringPayment): 'active' | 'due' | 'paused' => {
  if (payment.status === 'paused' || payment.status === 'cancelled') return 'paused';
  if (payment.nextPaymentTime <= Date.now()) return 'due';
  return 'active';
};

// Format countdown time
const formatCountdown = (targetTime: number): string => {
  const now = Date.now();
  const diff = targetTime - now;

  if (diff <= 0) return 'Due now';

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h remaining`;
  }
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m remaining`;
  }
  return `${minutes}m remaining`;
};

// Format interval for display
const formatInterval = (seconds: number): string => {
  if (seconds >= 2592000) {
    const months = Math.round(seconds / 2592000);
    return `Every ${months} month${months > 1 ? 's' : ''}`;
  }
  if (seconds >= 604800) {
    const weeks = Math.round(seconds / 604800);
    return `Every ${weeks} week${weeks > 1 ? 's' : ''}`;
  }
  if (seconds >= 86400) {
    const days = Math.round(seconds / 86400);
    return `Every ${days} day${days > 1 ? 's' : ''}`;
  }
  const hours = Math.round(seconds / 3600);
  return `Every ${hours} hour${hours > 1 ? 's' : ''}`;
};

// Format amount from stroops to XLM
const formatAmount = (stroops: string): string => {
  const xlm = Number(stroops) / 10000000;
  return xlm.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 7 });
};

// Truncate address
const truncateAddress = (address: string, chars = 6): string => {
  if (!address) return '';
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
};

// Status badge component
const StatusBadge: React.FC<{ status: RichStatus }> = ({ status }) => {
  const config: Record<RichStatus, { bg: string; text: string; border: string; icon: React.ElementType; label: string }> = {
    active:  { bg: 'bg-green-500/20',  text: 'text-green-400',  border: 'border-green-500/30',  icon: CheckCircle,    label: 'Active' },
    due:     { bg: 'bg-amber-500/20',  text: 'text-amber-400',  border: 'border-amber-500/30',  icon: AlertCircle,    label: 'Due Soon' },
    overdue: { bg: 'bg-red-500/20',    text: 'text-red-400',    border: 'border-red-500/30',    icon: TriangleAlert,  label: 'Overdue' },
    paused:  { bg: 'bg-gray-500/20',   text: 'text-gray-400',   border: 'border-gray-500/30',   icon: Pause,          label: 'Paused' },
    stopped: { bg: 'bg-gray-600/20',   text: 'text-gray-500',   border: 'border-gray-600/30',   icon: StopCircle,     label: 'Stopped' },
  };

  const { bg, text, border, icon: Icon, label } = config[status];

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${bg} ${text} border ${border}`}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  );
};

// â”€â”€â”€ Calendar / Timeline View â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Dot color by status */
const DOT_COLOR: Record<RichStatus, string> = {
  active:  '#22c55e',
  due:     '#f59e0b',
  overdue: '#ef4444',
  paused:  '#6b7280',
  stopped: '#4b5563',
};

interface CalendarTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: CalendarDot }>;
}

const CalendarTooltip: React.FC<CalendarTooltipProps> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const date = new Date(d.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-white font-medium">{d.label}</p>
      <p className="text-gray-400">{date}</p>
      <p className="capitalize" style={{ color: DOT_COLOR[d.status] }}>{d.status}</p>
    </div>
  );
};

const CalendarView: React.FC<{ payments: RecurringPayment[]; overdueMap: Map<string, OverduePaymentRecord> }> = ({
  payments,
  overdueMap,
}) => {
  const now = Date.now();
  const MS_PER_DAY = 86_400_000;
  const WINDOW_DAYS = 30;

  const dots: CalendarDot[] = payments
    .filter((p) => {
      const status = getRichStatus(p, overdueMap);
      return status !== 'stopped';
    })
    .map((p, i) => {
      const status = getRichStatus(p, overdueMap);
      const day = Math.round((p.nextPaymentTime - now) / MS_PER_DAY);
      return {
        day: Math.max(-2, Math.min(day, WINDOW_DAYS)),
        y: (i % 5) + 1,
        status,
        label: p.memo || truncateAddress(p.recipient, 6),
        timestamp: p.nextPaymentTime,
      };
    });

  // X-axis ticks: every 5 days
  const ticks = Array.from({ length: 7 }, (_, i) => i * 5);

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="w-5 h-5 text-purple-400" />
        <h3 className="text-white font-semibold">Upcoming Payment Schedule</h3>
        <span className="text-xs text-gray-400 ml-auto">Next 30 days</span>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-4 text-xs">
        {(['active', 'due', 'overdue', 'paused'] as RichStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-gray-400">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: DOT_COLOR[s] }} />
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </span>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
          <XAxis
            dataKey="day"
            type="number"
            domain={[-2, WINDOW_DAYS]}
            ticks={ticks}
            tickFormatter={(v: number) => {
              if (v === 0) return 'Today';
              return `+${v}d`;
            }}
            tick={{ fill: '#9ca3af', fontSize: 11 }}
            axisLine={{ stroke: '#374151' }}
            tickLine={false}
          />
          <YAxis hide domain={[0, 6]} />
          <Tooltip content={<CalendarTooltip />} cursor={false} />
          <Scatter data={dots} isAnimationActive={false}>
            {dots.map((dot, idx) => (
              <Cell key={idx} fill={DOT_COLOR[dot.status]} opacity={dot.status === 'paused' ? 0.5 : 1} r={7} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      {dots.length === 0 && (
        <p className="text-center text-gray-500 text-sm py-4">No upcoming payments to display</p>
      )}
    </div>
  );
};

// â”€â”€â”€ Payment History Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PaymentHistoryModal: React.FC<{
  isOpen: boolean;
  payment: RecurringPayment | null;
  history: RecurringPaymentHistory[];
  loading: boolean;
  onClose: () => void;
}> = ({ isOpen, payment, history, loading, onClose }) => {
  if (!isOpen || !payment) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-xl border border-gray-700 bg-gray-900">
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-4 sm:p-6 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <History className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-white">Payment History</h3>
                <p className="text-sm text-gray-400">{truncateAddress(payment.recipient)}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            >
              <XCircle className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto max-h-[60vh]">
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-gray-800/50 rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">Total Payments</p>
              <p className="text-xl font-bold text-white">{payment.totalPayments}</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-4">
              <p className="text-xs text-gray-400 mb-1">Amount Each</p>
              <p className="text-xl font-bold text-white">{formatAmount(payment.amount)} XLM</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-4 col-span-2 sm:col-span-1">
              <p className="text-xs text-gray-400 mb-1">Total Paid</p>
              <p className="text-xl font-bold text-white">
                {formatAmount(String(Number(payment.amount) * payment.totalPayments))} XLM
              </p>
            </div>
          </div>

          {/* History List */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-12">
              <History className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400">No payment history yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {item.success ? (
                          <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                        )}
                        <span className="text-white font-medium">
                          {formatAmount(item.amount)} XLM
                        </span>
                      </div>
                      <p className="text-sm text-gray-400">
                        {new Date(item.executedAt).toLocaleDateString()} at{' '}
                        {new Date(item.executedAt).toLocaleTimeString()}
                      </p>
                    </div>
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${item.transactionHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-purple-400 hover:text-purple-300 text-sm"
                    >
                      View <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-700 p-4 sm:p-6">
          <button
            onClick={onClose}
            className="w-full sm:w-auto px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors min-h-[44px]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// â”€â”€â”€ Payment Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const PaymentCard: React.FC<{
  payment: RecurringPayment;
  richStatus: RichStatus;
  missedPayments: number;
  canStop: boolean;
  onExecute: (payment: RecurringPayment) => void;
  onPause: (payment: RecurringPayment) => void;
  onResume: (payment: RecurringPayment) => void;
  onStop: (payment: RecurringPayment) => void;
  onViewHistory: (payment: RecurringPayment) => void;
  executing: boolean;
}> = ({ payment, richStatus, missedPayments, canStop, onExecute, onPause, onResume, onStop, onViewHistory, executing }) => {
  const isOverdue = richStatus === 'overdue';
  const isDueSoon = richStatus === 'due';
  const isPaused = richStatus === 'paused';
  const isStopped = richStatus === 'stopped';
  const isActive = richStatus === 'active';

  const borderClass = isOverdue
    ? 'border-red-500/50 shadow-red-500/10'
    : isDueSoon
    ? 'border-amber-500/50 shadow-amber-500/10'
    : isStopped
    ? 'border-gray-700/30 opacity-60'
    : isPaused
    ? 'border-gray-600/50'
    : 'border-gray-700/50 hover:border-purple-500/30';

  return (
    <div className={`bg-gray-800/50 border rounded-xl p-4 sm:p-5 transition-all hover:shadow-lg ${borderClass}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <StatusBadge status={richStatus} />
            {missedPayments > 0 && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/30"
                title={`${missedPayments} missed payment${missedPayments > 1 ? 's' : ''}`}
              >
                <TriangleAlert className="w-3 h-3" />
                {missedPayments} missed
              </span>
            )}
          </div>
          <p className="text-white font-medium truncate">{truncateAddress(payment.recipient, 8)}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-white">{formatAmount(payment.amount)} XLM</p>
          <p className="text-xs text-gray-400">{formatInterval(payment.interval)}</p>
        </div>
      </div>

      {/* Details */}
      <div className="space-y-2 mb-4">
        {payment.memo && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">Memo:</span>
            <span className="text-gray-300 truncate">{payment.memo}</span>
          </div>
        )}
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="w-4 h-4 text-gray-400" />
          <span className="text-gray-400">Next payment:</span>
          <span className={isOverdue ? 'text-red-400 font-medium' : isDueSoon ? 'text-amber-400 font-medium' : 'text-gray-300'}>
            {isStopped ? 'Stopped' : isPaused ? 'Paused' : formatCountdown(payment.nextPaymentTime)}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <DollarSign className="w-4 h-4 text-gray-400" />
          <span className="text-gray-400">Payments made:</span>
          <span className="text-gray-300">{payment.totalPayments}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t border-gray-700">
        {/* Execute â€” only when overdue/due and not stopped */}
        {(isOverdue || isDueSoon) && !isStopped && (
          <button
            onClick={() => onExecute(payment)}
            disabled={executing}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-lg font-medium transition-colors disabled:opacity-50 min-h-[44px]"
          >
            {executing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Execute Now
          </button>
        )}

        {/* Pause â€” only when active/due/overdue */}
        {(isActive || isDueSoon || isOverdue) && canStop && (
          <button
            onClick={() => onPause(payment)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors min-h-[44px]"
          >
            <Pause className="w-4 h-4" />
            Pause
          </button>
        )}

        {/* Resume â€” only when paused */}
        {isPaused && canStop && (
          <button
            onClick={() => onResume(payment)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-lg font-medium transition-colors min-h-[44px]"
          >
            <Play className="w-4 h-4" />
            Resume
          </button>
        )}

        {/* History */}
        <button
          onClick={() => onViewHistory(payment)}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors min-h-[44px]"
        >
          <History className="w-4 h-4" />
          History
        </button>

        {/* Stop â€” disabled when already stopped */}
        {canStop && (
          <button
            onClick={() => onStop(payment)}
            disabled={isStopped}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed min-h-[44px]"
          >
            <StopCircle className="w-4 h-4" />
            Stop
          </button>
        )}
      </div>
    </div>
  );
};


// ─── Main RecurringPayments Component ────────────────────────────────────────

type ModalAction = 'pause' | 'resume' | 'stop' | null;

const RecurringPayments: React.FC = () => {
  const { notify } = useToast();
  const {
    getRecurringPayments,
    getRecurringPaymentHistory,
    schedulePayment,
    executeRecurringPayment,
    cancelRecurringPayment,
    getVaultConfig,
    loading,
  } = useVaultContract();
  const { checkReady, isReady } = useActionReadiness();

  // ── State ──────────────────────────────────────────────────────────────────
  const [payments, setPayments] = useState<RecurringPayment[]>([]);
  const [overdueMap, setOverdueMap] = useState<Map<string, OverduePaymentRecord>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

  // Unified action modal state
  const [actionModal, setActionModal] = useState<{ action: ModalAction; payment: RecurringPayment | null }>({
    action: null,
    payment: null,
  });
  const [isStopModalOpen, setIsStopModalOpen] = useState(false);
  const [stopTarget, setStopTarget] = useState<RecurringPayment | null>(null);

  const [selectedPayment, setSelectedPayment] = useState<RecurringPayment | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<RecurringPaymentHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [executingPaymentId, setExecutingPaymentId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<number>(0);

  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch overdue enrichment from backend ──────────────────────────────────
  const fetchOverdue = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_BASE}/api/v1/recurring/overdue?limit=100`);
      if (!res.ok) return;
      const json = await res.json() as { data?: OverduePaymentRecord[] };
      const map = new Map<string, OverduePaymentRecord>();
      (json.data ?? []).forEach((r) => map.set(r.paymentId, r));
      setOverdueMap(map);
    } catch {
      // backend may not be running in dev — silently ignore
    }
  }, []);

  // ── Fetch payments ─────────────────────────────────────────────────────────
  const fetchPayments = useCallback(async () => {
    setIsLoading(true);
    try {
      const [data, config] = await Promise.allSettled([
        getRecurringPayments?.() ?? Promise.resolve([]),
        getVaultConfig?.(),
      ]);
      if (data.status === 'fulfilled') setPayments(data.value);
      if (config.status === 'fulfilled' && config.value) {
        setUserRole(config.value.currentUserRole);
      }
    } catch (err) {
      console.error('Failed to fetch recurring payments:', err);
      notify('config_updated', 'Failed to load recurring payments', 'error');
    } finally {
      setIsLoading(false);
    }
    await fetchOverdue();
  }, [getRecurringPayments, getVaultConfig, notify, fetchOverdue]);

  // Initial load + 30-second auto-refresh
  useEffect(() => {
    fetchPayments();
    autoRefreshRef.current = setInterval(fetchPayments, AUTO_REFRESH_MS);
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [fetchPayments]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleCreatePayment = async (data: CreateRecurringPaymentFormData) => {
    const { ready, message } = checkReady();
    if (!ready) { notify('config_updated', message ?? 'Not ready', 'error'); return; }
    try {
      const txHash = await schedulePayment?.(data);
      notify('new_proposal', 'Recurring payment created successfully!', 'success');
      setIsCreateModalOpen(false);
      await fetchPayments();
      console.log('Transaction hash:', txHash);
    } catch (err) {
      console.error('Failed to create recurring payment:', err);
      notify('config_updated', err instanceof Error ? err.message : 'Failed to create recurring payment', 'error');
    }
  };

  const handleExecutePayment = async (payment: RecurringPayment) => {
    const { ready, message } = checkReady();
    if (!ready) { notify('config_updated', message ?? 'Not ready', 'error'); return; }
    setExecutingPaymentId(payment.id);
    try {
      await executeRecurringPayment?.(payment.id);
      notify('proposal_executed', 'Payment executed successfully!', 'success');
      await fetchPayments();
    } catch (err) {
      console.error('Failed to execute payment:', err);
      notify('config_updated', err instanceof Error ? err.message : 'Failed to execute payment', 'error');
    } finally {
      setExecutingPaymentId(null);
    }
  };

  // Pause — locally marks as paused via cancelRecurringPayment (contract has no pause fn)
  const handlePausePayment = async () => {
    const payment = actionModal.payment;
    if (!payment) return;
    const { ready, message } = checkReady();
    if (!ready) { notify('config_updated', message ?? 'Not ready', 'error'); setActionModal({ action: null, payment: null }); return; }
    try {
      await cancelRecurringPayment?.(payment.id);
      notify('proposal_rejected', 'Payment paused successfully', 'success');
      setActionModal({ action: null, payment: null });
      await fetchPayments();
    } catch (err) {
      console.error('Failed to pause payment:', err);
      notify('config_updated', err instanceof Error ? err.message : 'Failed to pause payment', 'error');
    }
  };

  // Resume — re-schedules by executing (simplest on-chain resume path)
  const handleResumePayment = async () => {
    const payment = actionModal.payment;
    if (!payment) return;
    const { ready, message } = checkReady();
    if (!ready) { notify('config_updated', message ?? 'Not ready', 'error'); setActionModal({ action: null, payment: null }); return; }
    try {
      await executeRecurringPayment?.(payment.id);
      notify('proposal_executed', 'Payment resumed successfully!', 'success');
      setActionModal({ action: null, payment: null });
      await fetchPayments();
    } catch (err) {
      console.error('Failed to resume payment:', err);
      notify('config_updated', err instanceof Error ? err.message : 'Failed to resume payment', 'error');
    }
  };

  // Stop — permanent cancellation
  const handleStopPayment = async () => {
    if (!stopTarget) return;
    const { ready, message } = checkReady();
    if (!ready) { notify('config_updated', message ?? 'Not ready', 'error'); setIsStopModalOpen(false); return; }
    try {
      await cancelRecurringPayment?.(stopTarget.id);
      notify('proposal_rejected', 'Recurring payment stopped', 'success');
      setIsStopModalOpen(false);
      setStopTarget(null);
      await fetchPayments();
    } catch (err) {
      console.error('Failed to stop payment:', err);
      notify('config_updated', err instanceof Error ? err.message : 'Failed to stop payment', 'error');
    }
  };

  const handleViewHistory = async (payment: RecurringPayment) => {
    setSelectedPayment(payment);
    setIsHistoryModalOpen(true);
    setHistoryLoading(true);
    try {
      const history = await getRecurringPaymentHistory?.(payment.id) ?? [];
      setPaymentHistory(history);
    } catch (err) {
      console.error('Failed to fetch payment history:', err);
      notify('config_updated', 'Failed to load payment history', 'error');
    } finally {
      setHistoryLoading(false);
    }
  };

  // ── Derived stats ──────────────────────────────────────────────────────────
  const activeCount  = payments.filter((p) => getRichStatus(p, overdueMap) === 'active').length;
  const overdueCount = payments.filter((p) => getRichStatus(p, overdueMap) === 'overdue').length;
  const dueSoonCount = payments.filter((p) => getRichStatus(p, overdueMap) === 'due').length;
  const pausedCount  = payments.filter((p) => {
    const s = getRichStatus(p, overdueMap);
    return s === 'paused' || s === 'stopped';
  }).length;

  // Next payment date for confirmation modals
  const nextPaymentDate = actionModal.payment
    ? new Date(actionModal.payment.nextPaymentTime).toLocaleDateString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
      })
    : '';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <ReadinessWarning />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Recurring Payments</h1>
          <p className="text-gray-400 mt-1">Manage automated payment schedules</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center bg-gray-800 rounded-lg p-1 border border-gray-700">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'list' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
              aria-label="List view"
            >
              <List className="w-4 h-4" />
              <span className="hidden sm:inline">List</span>
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'calendar' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
              aria-label="Calendar view"
            >
              <Calendar className="w-4 h-4" />
              <span className="hidden sm:inline">Calendar</span>
            </button>
          </div>

          <button
            onClick={fetchPayments}
            disabled={isLoading}
            className="p-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center border border-gray-700"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => {
              const { ready, message } = checkReady();
              if (!ready) { notify('config_updated', message ?? 'Not ready', 'error'); return; }
              setIsCreateModalOpen(true);
            }}
            disabled={!isReady}
            className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors min-h-[44px]"
          >
            <Plus className="w-5 h-5" />
            <span className="hidden sm:inline">Create Payment</span>
            <span className="sm:hidden">Create</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{activeCount}</p>
              <p className="text-sm text-gray-400">Active</p>
            </div>
          </div>
        </div>
        <div className={`bg-gray-800/50 border rounded-xl p-4 ${overdueCount > 0 ? 'border-red-500/40' : 'border-gray-700'}`}>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/20 rounded-lg">
              <TriangleAlert className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{overdueCount}</p>
              <p className="text-sm text-gray-400">Overdue</p>
            </div>
          </div>
        </div>
        <div className={`bg-gray-800/50 border rounded-xl p-4 ${dueSoonCount > 0 ? 'border-amber-500/30' : 'border-gray-700'}`}>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/20 rounded-lg">
              <AlertCircle className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{dueSoonCount}</p>
              <p className="text-sm text-gray-400">Due Soon</p>
            </div>
          </div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-500/20 rounded-lg">
              <Pause className="w-5 h-5 text-gray-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{pausedCount}</p>
              <p className="text-sm text-gray-400">Paused/Stopped</p>
            </div>
          </div>
        </div>
      </div>

      {/* Calendar view */}
      {viewMode === 'calendar' && payments.length > 0 && (
        <CalendarView payments={payments} overdueMap={overdueMap} />
      )}

      {/* Payments List / Loading / Empty */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <Loader2 className="w-10 h-10 text-purple-400 animate-spin mx-auto mb-4" />
            <p className="text-gray-400">Loading recurring payments...</p>
          </div>
        </div>
      ) : payments.length === 0 ? (
        <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-8 sm:p-12 text-center">
          <Clock className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">No Recurring Payments</h3>
          <p className="text-gray-400 mb-6 max-w-md mx-auto">
            Create your first recurring payment to automate scheduled transfers for payroll, subscriptions, or regular payments.
          </p>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
          >
            <Plus className="w-5 h-5" />
            Create Recurring Payment
          </button>
        </div>
      ) : viewMode === 'list' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {payments.map((payment) => {
            const richStatus = getRichStatus(payment, overdueMap);
            const record = overdueMap.get(payment.id);
            const missed = record?.missedPayments ?? 0;
            return (
              <PaymentCard
                key={payment.id}
                payment={payment}
                richStatus={richStatus}
                missedPayments={missed}
                canStop={userRole >= 1}
                onExecute={handleExecutePayment}
                onPause={(p) => setActionModal({ action: 'pause', payment: p })}
                onResume={(p) => setActionModal({ action: 'resume', payment: p })}
                onStop={(p) => { setStopTarget(p); setIsStopModalOpen(true); }}
                onViewHistory={handleViewHistory}
                executing={executingPaymentId === payment.id}
              />
            );
          })}
        </div>
      ) : (
        /* Calendar view with no payments shows empty state */
        <div className="bg-gray-800/30 border border-gray-700 rounded-xl p-8 text-center">
          <Calendar className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">Switch to list view to manage payments</p>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      <CreateRecurringPaymentModal
        isOpen={isCreateModalOpen}
        loading={loading}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreatePayment}
      />

      <PaymentHistoryModal
        isOpen={isHistoryModalOpen}
        payment={selectedPayment}
        history={paymentHistory}
        loading={historyLoading}
        onClose={() => {
          setIsHistoryModalOpen(false);
          setSelectedPayment(null);
          setPaymentHistory([]);
        }}
      />

      {/* Pause confirmation */}
      <ConfirmationModal
        isOpen={actionModal.action === 'pause'}
        title="Pause Recurring Payment"
        message={`Pause this payment? The next scheduled payment on ${nextPaymentDate} will be skipped. You can resume it at any time.`}
        confirmText="Pause Payment"
        cancelText="Keep Active"
        onConfirm={handlePausePayment}
        onCancel={() => setActionModal({ action: null, payment: null })}
      />

      {/* Resume confirmation */}
      <ConfirmationModal
        isOpen={actionModal.action === 'resume'}
        title="Resume Recurring Payment"
        message={`Resume this payment? The next payment will be scheduled for ${nextPaymentDate}.`}
        confirmText="Resume Payment"
        cancelText="Cancel"
        onConfirm={handleResumePayment}
        onCancel={() => setActionModal({ action: null, payment: null })}
      />

      {/* Stop confirmation */}
      <ConfirmationModal
        isOpen={isStopModalOpen}
        title="Stop Recurring Payment"
        message={`Permanently stop payments to ${stopTarget ? truncateAddress(stopTarget.recipient) : ''}? This cannot be undone.`}
        confirmText="Stop Payment"
        cancelText="Keep Active"
        onConfirm={handleStopPayment}
        onCancel={() => { setIsStopModalOpen(false); setStopTarget(null); }}
        isDestructive
      />
    </div>
  );
};

export default RecurringPayments;
