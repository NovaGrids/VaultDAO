/**
 * RecipientDrillDownPanel — drill-down view for a specific recipient
 * Shows: total sent, payment count, last payment date, 30-day moving average trend
 */
import React, { useEffect, useState, useMemo } from 'react';
import { X, Copy, ExternalLink, TrendingUp, Calendar, DollarSign } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Transaction {
  amount: number;
  timestamp: string;
  recipient: string;
}

interface RecipientDrillDownPanelProps {
  isOpen: boolean;
  recipient: string;
  transactions: Transaction[];
  recipientLabel?: string;
  onClose: () => void;
}

/**
 * Calculate 30-day moving average from transactions
 */
function calculateTrendLine(txns: Transaction[]): { date: string; amount: number; movingAvg: number }[] {
  if (txns.length === 0) return [];

  // Sort by date
  const sorted = [...txns].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Group by date
  const dailyMap = new Map<string, number>();
  sorted.forEach((tx) => {
    const date = tx.timestamp.slice(0, 10);
    dailyMap.set(date, (dailyMap.get(date) || 0) + tx.amount);
  });

  // Create 30-day moving average
  const dates = Array.from(dailyMap.keys()).sort();
  const result: { date: string; amount: number; movingAvg: number }[] = [];

  dates.forEach((date, idx) => {
    const amount = dailyMap.get(date) || 0;
    const window = dates.slice(Math.max(0, idx - 29), idx + 1);
    const windowAmounts = window.map((d) => dailyMap.get(d) || 0);
    const movingAvg = windowAmounts.reduce((a, b) => a + b, 0) / window.length;

    result.push({ date, amount, movingAvg });
  });

  return result;
}

const RecipientDrillDownPanel: React.FC<RecipientDrillDownPanelProps> = ({
  isOpen,
  recipient,
  transactions,
  recipientLabel,
  onClose,
}) => {
  const [hasCopied, setHasCopied] = useState(false);

  useEffect(() => {
    if (!hasCopied) return;
    const timer = setTimeout(() => setHasCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [hasCopied]);

  // Filter transactions for this recipient
  const recipientTxns = useMemo(
    () => transactions.filter((tx) => tx.recipient === recipient),
    [transactions, recipient]
  );

  // Calculate metrics
  const metrics = useMemo(() => {
    const totalSent = recipientTxns.reduce((sum, tx) => sum + tx.amount, 0);
    const count = recipientTxns.length;
    const lastPaymentDate =
      recipientTxns.length > 0
        ? new Date(recipientTxns[recipientTxns.length - 1].timestamp).toLocaleDateString()
        : 'N/A';
    const avgPayment = count > 0 ? totalSent / count : 0;

    return { totalSent, count, lastPaymentDate, avgPayment };
  }, [recipientTxns]);

  const trendData = useMemo(() => calculateTrendLine(recipientTxns), [recipientTxns]);

  const handleCopyAddress = () => {
    void navigator.clipboard.writeText(recipient);
    setHasCopied(true);
  };

  const handleViewOnExplorer = () => {
    const explorerUrl = `https://stellar.expert/explorer/public/${recipient}`;
    window.open(explorerUrl, '_blank');
  };

  // Keyboard navigation: Escape to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 transition-opacity"
          onClick={onClose}
          data-testid="drill-down-backdrop"
        />
      )}

      {/* Slide-in Panel */}
      <div
        className={`fixed right-0 top-0 h-full w-full md:w-96 bg-gray-800 border-l border-gray-700 shadow-2xl z-50 transform transition-transform duration-300 ease-out overflow-y-auto ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        data-testid="drill-down-panel"
      >
        {/* Header */}
        <div className="sticky top-0 bg-gray-800 border-b border-gray-700 p-4 flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-white truncate" title={recipient}>
              {recipientLabel || recipient.slice(0, 8) + '...' + recipient.slice(-8)}
            </h3>
            {recipientLabel && (
              <p className="text-xs text-gray-400 font-mono truncate" title={recipient}>
                {recipient}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="ml-4 p-2 hover:bg-gray-700 rounded-lg transition-colors flex-shrink-0"
            aria-label="Close panel"
            data-testid="drill-down-close-btn"
          >
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Metrics Cards */}
          <div className="space-y-3">
            <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign size={16} className="text-purple-400" />
                <span className="text-xs text-gray-400 font-semibold">Total Sent</span>
              </div>
              <p className="text-2xl font-bold text-white">{metrics.totalSent.toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">XLM</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center gap-1 mb-1">
                  <TrendingUp size={14} className="text-blue-400" />
                  <span className="text-xs text-gray-400 font-semibold">Payments</span>
                </div>
                <p className="text-xl font-bold text-white">{metrics.count}</p>
              </div>

              <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center gap-1 mb-1">
                  <Calendar size={14} className="text-green-400" />
                  <span className="text-xs text-gray-400 font-semibold">Avg</span>
                </div>
                <p className="text-xl font-bold text-white">{metrics.avgPayment.toFixed(0)}</p>
              </div>
            </div>

            <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
              <div className="flex items-center gap-2 mb-1">
                <Calendar size={16} className="text-amber-400" />
                <span className="text-xs text-gray-400 font-semibold">Last Payment</span>
              </div>
              <p className="text-sm font-semibold text-white">{metrics.lastPaymentDate}</p>
            </div>
          </div>

          {/* Trend Line */}
          {trendData.length > 1 && (
            <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
              <h4 className="text-sm font-semibold text-white mb-3">Payment Trend (30-day MA)</h4>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={trendData} data-testid="trend-chart">
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12, fill: '#9CA3AF' }}
                    interval={Math.floor(trendData.length / 4)}
                  />
                  <YAxis tick={{ fontSize: 12, fill: '#9CA3AF' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1F2937',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                    }}
                    formatter={(value) => [
                      typeof value === 'number' ? `${value.toFixed(0)} XLM` : String(value ?? ''),
                      'Value',
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="movingAvg"
                    stroke="#8B5CF6"
                    strokeWidth={2}
                    dot={false}
                    name="30-day MA"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2">
            <button
              onClick={handleCopyAddress}
              className="w-full px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2"
              data-testid="copy-address-btn"
            >
              <Copy size={16} />
              {hasCopied ? 'Copied!' : 'Copy Address'}
            </button>
            <button
              onClick={handleViewOnExplorer}
              className="w-full px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2"
              data-testid="explorer-btn"
            >
              <ExternalLink size={16} />
              View on Stellar Explorer
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default RecipientDrillDownPanel;
