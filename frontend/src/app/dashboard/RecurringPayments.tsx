import React, { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { useVaultContract } from '../../hooks/useVaultContract';
import type { RecurringPayment, RecurringPaymentHistory } from '../../hooks/useVaultContract';
import CreateRecurringPaymentModal from '../../components/modals/CreateRecurringPaymentModal';
import type { CreateRecurringPaymentFormData } from '../../components/modals/CreateRecurringPaymentModal';
import ConfirmationModal from '../../components/modals/ConfirmationModal';
import { useToast } from '../../context/ToastContext';

// Payment status type
type PaymentStatus = 'active' | 'due' | 'paused';

// Determine payment status based on next payment time and current status
const getPaymentStatus = (payment: RecurringPayment): PaymentStatus => {
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
const StatusBadge: React.FC<{ status: PaymentStatus }> = ({ status }) => {
  const config = {
    active: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30', icon: CheckCircle },
    due: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30', icon: AlertCircle },
    paused: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30', icon: Pause },
  };
  
  const { bg, text, border, icon: Icon } = config[status];
  
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${bg} ${text} border ${border}`}>
      <Icon className="w-3.5 h-3.5" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
};

// Payment History Modal Component
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

// Payment Card Component
const PaymentCard: React.FC<{
  payment: RecurringPayment;
  onExecute: (payment: RecurringPayment) => void;
  onCancel: (payment: RecurringPayment) => void;
  onViewHistory: (payment: RecurringPayment) => void;
  executing: boolean;
}> = ({ payment, onExecute, onCancel, onViewHistory, executing }) => {
  const status = getPaymentStatus(payment);
  const isDue = status === 'due';
  const isPaused = status === 'paused';

  return (
    <div
      className={`bg-gray-800/50 border rounded-xl p-4 sm:p-5 transition-all hover:shadow-lg ${
        isDue
          ? 'border-yellow-500/50 shadow-yellow-500/10'
          : isPaused
          ? 'border-gray-600/50'
          : 'border-gray-700/50 hover:border-purple-500/30'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusBadge status={status} />
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
          <span className={isDue ? 'text-yellow-400 font-medium' : 'text-gray-300'}>
            {isPaused ? 'Paused' : formatCountdown(payment.nextPaymentTime)}
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
        {isDue && (
          <button
            onClick={() => onExecute(payment)}
            disabled={executing}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 rounded-lg font-medium transition-colors disabled:opacity-50 min-h-[44px]"
          >
            {executing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            Execute Now
          </button>
        )}
        <button
          onClick={() => onViewHistory(payment)}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-700/50 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors min-h-[44px]"
        >
          <History className="w-4 h-4" />
          History
        </button>
        {!isPaused && (
          <button
            onClick={() => onCancel(payment)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg font-medium transition-colors min-h-[44px]"
          >
            <XCircle className="w-4 h-4" />
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};

// Main RecurringPayments Component
const RecurringPayments: React.FC = () => {
  const { notify } = useToast();
  const {
    getRecurringPayments,
    getRecurringPaymentHistory,
    schedulePayment,
    executeRecurringPayment,
    cancelRecurringPayment,
    loading,
  } = useVaultContract();

  const [payments, setPayments] = useState<RecurringPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<RecurringPayment | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<RecurringPaymentHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [executingPaymentId, setExecutingPaymentId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateRecurringPaymentFormData>({
    recipient: '',
    token: 'native',
    amount: '',
    memo: '',
    interval: 86400, // Default to daily
  });

  // Fetch payments on mount
  const fetchPayments = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getRecurringPayments();
      setPayments(data);
    } catch (error) {
      console.error('Failed to fetch recurring payments:', error);
      notify('config_updated', 'Failed to load recurring payments', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [getRecurringPayments, notify]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  // Handle form field change
  const handleFieldChange = (field: keyof CreateRecurringPaymentFormData, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Handle create payment
  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const txHash = await schedulePayment(formData);
      notify('new_proposal', 'Recurring payment created successfully!', 'success');
      setIsCreateModalOpen(false);
      setFormData({
        recipient: '',
        token: 'native',
        amount: '',
        memo: '',
        interval: 86400,
      });
      await fetchPayments();
      console.log('Transaction hash:', txHash);
    } catch (error) {
      console.error('Failed to create recurring payment:', error);
      notify('config_updated', error instanceof Error ? error.message : 'Failed to create recurring payment', 'error');
    }
  };

  // Handle execute payment
  const handleExecutePayment = async (payment: RecurringPayment) => {
    setExecutingPaymentId(payment.id);
    try {
      const txHash = await executeRecurringPayment(payment.id);
      notify('proposal_executed', 'Payment executed successfully!', 'success');
      await fetchPayments();
      console.log('Transaction hash:', txHash);
    } catch (error) {
      console.error('Failed to execute payment:', error);
      notify('config_updated', error instanceof Error ? error.message : 'Failed to execute payment', 'error');
    } finally {
      setExecutingPaymentId(null);
    }
  };

  // Handle cancel payment
  const handleCancelPayment = async () => {
    if (!selectedPayment) return;
    try {
      const txHash = await cancelRecurringPayment(selectedPayment.id);
      notify('proposal_rejected', 'Recurring payment cancelled successfully', 'success');
      setIsCancelModalOpen(false);
      setSelectedPayment(null);
      await fetchPayments();
      console.log('Transaction hash:', txHash);
    } catch (error) {
      console.error('Failed to cancel payment:', error);
      notify('config_updated', error instanceof Error ? error.message : 'Failed to cancel payment', 'error');
    }
  };

  // Handle view history
  const handleViewHistory = async (payment: RecurringPayment) => {
    setSelectedPayment(payment);
    setIsHistoryModalOpen(true);
    setHistoryLoading(true);
    try {
      const history = await getRecurringPaymentHistory(payment.id);
      setPaymentHistory(history);
    } catch (error) {
      console.error('Failed to fetch payment history:', error);
      notify('config_updated', 'Failed to load payment history', 'error');
    } finally {
      setHistoryLoading(false);
    }
  };

  // Stats
  const activePayments = payments.filter((p) => getPaymentStatus(p) === 'active').length;
  const duePayments = payments.filter((p) => getPaymentStatus(p) === 'due').length;
  const pausedPayments = payments.filter((p) => getPaymentStatus(p) === 'paused').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Recurring Payments</h1>
          <p className="text-gray-400 mt-1">Manage automated payment schedules</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchPayments}
            disabled={isLoading}
            className="p-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors min-h-[44px]"
          >
            <Plus className="w-5 h-5" />
            <span className="hidden sm:inline">Create Payment</span>
            <span className="sm:hidden">Create</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{activePayments}</p>
              <p className="text-sm text-gray-400">Active</p>
            </div>
          </div>
        </div>
        <div className="bg-gray-800/50 border border-yellow-500/30 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-500/20 rounded-lg">
              <AlertCircle className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{duePayments}</p>
              <p className="text-sm text-gray-400">Due Now</p>
            </div>
          </div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-500/20 rounded-lg">
              <Pause className="w-5 h-5 text-gray-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{pausedPayments}</p>
              <p className="text-sm text-gray-400">Paused</p>
            </div>
          </div>
        </div>
      </div>

      {/* Payments List */}
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
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {payments.map((payment) => (
            <PaymentCard
              key={payment.id}
              payment={payment}
              onExecute={handleExecutePayment}
              onCancel={(p) => {
                setSelectedPayment(p);
                setIsCancelModalOpen(true);
              }}
              onViewHistory={handleViewHistory}
              executing={executingPaymentId === payment.id}
            />
          ))}
        </div>
      )}

      {/* Create Modal */}
      <CreateRecurringPaymentModal
        isOpen={isCreateModalOpen}
        loading={loading}
        formData={formData}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreatePayment}
        onFieldChange={handleFieldChange}
      />

      {/* History Modal */}
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

      {/* Cancel Confirmation Modal */}
      <ConfirmationModal
        isOpen={isCancelModalOpen}
        title="Cancel Recurring Payment"
        message={`Are you sure you want to cancel this recurring payment? This will stop all future payments to ${selectedPayment ? truncateAddress(selectedPayment.recipient) : ''}. This action cannot be undone.`}
        confirmText="Cancel Payment"
        cancelText="Keep Active"
        onConfirm={handleCancelPayment}
        onCancel={() => {
          setIsCancelModalOpen(false);
          setSelectedPayment(null);
        }}
        isDestructive
      />
    </div>
  );
};

export default RecurringPayments;
