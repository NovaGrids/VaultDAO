import React, { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Calendar, AlertCircle, X, ChevronDown } from 'lucide-react';
import ForecastChart from './ForecastChart';
import AnomalyDetector from './AnomalyDetector';
import { forecastSpending, calculateBurnRate, calculateRunway } from '../utils/forecasting';
import { analyzeAnomalies } from '../utils/anomalyDetection';
import { filterTransactionsByDateRange } from '../utils/analyticsAggregation';

interface Transaction {
  amount: number;
  timestamp: string;
  recipient: string;
}

interface SpendingAnalyticsProps {
  transactions: Transaction[];
  currentBalance: number;
  monthlyBudget?: number;
}

type DatePreset = '7d' | '30d' | 'thisMonth' | 'allTime' | 'custom';

const SpendingAnalytics = ({
  transactions,
  currentBalance,
  monthlyBudget = 10000
}: SpendingAnalyticsProps) => {
  const [forecastPeriod, setForecastPeriod] = useState<30 | 90>(30);
  const [currentTime] = useState(() => Date.now());
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [activePreset, setActivePreset] = useState<DatePreset>('allTime');

  const handlePresetChange = (preset: DatePreset) => {
    setActivePreset(preset);
    const now = new Date();
    let from = '';
    let to = '';

    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    switch (preset) {
      case '7d':
        from = formatDate(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
        to = formatDate(now);
        break;
      case '30d':
        from = formatDate(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
        to = formatDate(now);
        break;
      case 'thisMonth':
        from = formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
        to = formatDate(now);
        break;
      case 'allTime':
        from = '';
        to = '';
        break;
      default:
        return;
    }
    setDateRange({ from, to });
  };

  const analytics = useMemo(() => {
    const filtered = filterTransactionsByDateRange<Transaction>(transactions, dateRange.from, dateRange.to);

    const dailySpending = filtered.reduce((acc, t) => {
      const date = t.timestamp.slice(0, 10);
      acc[date] = (acc[date] || 0) + t.amount;
      return acc;
    }, {} as Record<string, number>);

    const historicalData = Object.entries(dailySpending)
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // For metrics calculation, we use the filtered range duration
    const rangeDurationDays = (() => {
        if (!dateRange.from || !dateRange.to) {
            // Default to 30 days for metrics baseline if no range specified
            return 30;
        }
        const diff = new Date(dateRange.to).getTime() - new Date(dateRange.from).getTime();
        return Math.max(1, Math.ceil(diff / (24 * 60 * 60 * 1000)));
    })();

    const forecast = forecastSpending(historicalData, forecastPeriod);
    const totalSpent = filtered.reduce((sum, t) => sum + t.amount, 0);
    const burnRate = calculateBurnRate(filtered.map(t => t.amount), rangeDurationDays);
    const runway = calculateRunway(currentBalance, burnRate);
    const anomalies = analyzeAnomalies(filtered);

    const budgetUsed = (totalSpent / monthlyBudget) * 100;
    const velocity = filtered.length > 0 ? totalSpent / rangeDurationDays : 0;

    return {
      forecast,
      totalSpent,
      burnRate,
      runway,
      anomalies,
      budgetUsed,
      velocity,
      transactionCount: filtered.length,
      days: rangeDurationDays
    };
  }, [transactions, currentBalance, monthlyBudget, forecastPeriod, dateRange, currentTime]);

  const getBudgetColor = (percent: number) => {
    if (percent >= 100) return 'bg-red-500';
    if (percent >= 90) return 'bg-amber-500';
    if (percent >= 80) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <div className="space-y-6">
      {/* Date Range Picker */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 bg-gray-800/50 p-6 rounded-2xl border border-gray-700">
        <div className="space-y-3">
          <label className="text-xs text-gray-400 uppercase tracking-widest font-bold flex items-center gap-2">
            <Calendar size={14} className="text-purple-400" />
            Time Range Scoping
          </label>
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'allTime', label: 'All Time' },
              { id: 'thisMonth', label: 'This Month' },
              { id: '30d', label: 'Last 30 Days' },
              { id: '7d', label: 'Last 7 Days' },
            ].map((preset) => (
              <button
                key={preset.id}
                onClick={() => handlePresetChange(preset.id as DatePreset)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                  activePreset === preset.id
                    ? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-900/20'
                    : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="space-y-1.5 flex-1 md:flex-none">
            <p className="text-[10px] text-gray-500 font-bold uppercase ml-1">From</p>
            <input
              type="date"
              value={dateRange.from}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const value = e.target.value;
                setDateRange((prev: { from: string; to: string }) => ({ ...prev, from: value }));
                setActivePreset('custom');
              }}
              className="w-full md:w-40 bg-gray-900 border border-gray-700 rounded-xl px-4 py-2 text-sm text-white focus:ring-2 focus:ring-purple-500/50 outline-none transition-all"
            />
          </div>
          <div className="mt-6 text-gray-600">
            <ChevronDown size={20} className="-rotate-90" />
          </div>
          <div className="space-y-1.5 flex-1 md:flex-none">
            <p className="text-[10px] text-gray-500 font-bold uppercase ml-1">To</p>
            <input
              type="date"
              value={dateRange.to}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const value = e.target.value;
                setDateRange((prev: { from: string; to: string }) => ({ ...prev, to: value }));
                setActivePreset('custom');
              }}
              className="w-full md:w-40 bg-gray-900 border border-gray-700 rounded-xl px-4 py-2 text-sm text-white focus:ring-2 focus:ring-purple-500/50 outline-none transition-all"
            />
          </div>
          {(dateRange.from || dateRange.to) && (
             <button 
                onClick={() => handlePresetChange('allTime')}
                className="mt-6 p-2 text-gray-500 hover:text-white transition-colors"
                title="Clear Filters"
             >
                <X size={20} />
             </button>
          )}
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-800/80 backdrop-blur-sm rounded-2xl border border-gray-700 p-6 flex flex-col justify-between hover:border-purple-500/30 transition-colors group">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400 group-hover:bg-purple-500 group-hover:text-white transition-colors">
                <DollarSign size={20} />
              </div>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Burn Rate</span>
            </div>
            <p className="text-3xl font-black text-white">{analytics.burnRate.toFixed(0)}</p>
          </div>
          <p className="text-[10px] text-gray-500 mt-4 font-bold uppercase">XLM / day ({analytics.days}d avg)</p>
        </div>

        <div className="bg-gray-800/80 backdrop-blur-sm rounded-2xl border border-gray-700 p-6 flex flex-col justify-between hover:border-blue-500/30 transition-colors group">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400 group-hover:bg-blue-500 group-hover:text-white transition-colors">
                <Calendar size={20} />
              </div>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Runway</span>
            </div>
            <p className="text-3xl font-black text-white">
              {analytics.runway === Infinity ? '∞' : Math.floor(analytics.runway)}
            </p>
          </div>
          <p className="text-[10px] text-gray-500 mt-4 font-bold uppercase">Days remaining</p>
        </div>

        <div className="bg-gray-800/80 backdrop-blur-sm rounded-2xl border border-gray-700 p-6 flex flex-col justify-between hover:border-green-500/30 transition-colors group">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-green-500/10 rounded-lg text-green-400 group-hover:bg-green-500 group-hover:text-white transition-colors">
                <TrendingUp size={20} />
              </div>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Velocity</span>
            </div>
            <p className="text-3xl font-black text-white">{analytics.velocity.toFixed(0)}</p>
          </div>
          <p className="text-[10px] text-gray-500 mt-4 font-bold uppercase">XLM / day average</p>
        </div>

        <div className="bg-gray-800/80 backdrop-blur-sm rounded-2xl border border-gray-700 p-6 flex flex-col justify-between hover:border-amber-500/30 transition-colors group">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400 group-hover:bg-amber-500 group-hover:text-white transition-colors">
                <TrendingDown size={20} />
              </div>
              <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Total Period</span>
            </div>
            <p className="text-3xl font-black text-white">{analytics.totalSpent.toLocaleString()}</p>
          </div>
          <p className="text-[10px] text-gray-500 mt-4 font-bold uppercase">{analytics.transactionCount} transactions</p>
        </div>
      </div>

      {/* Budget Tracking */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-semibold text-white">Monthly Budget</h4>
          <span className="text-sm text-gray-400">
            {analytics.totalSpent.toLocaleString()} / {monthlyBudget.toLocaleString()} XLM
          </span>
        </div>
        <div className="relative h-4 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${getBudgetColor(analytics.budgetUsed)}`}
            style={{ width: `${Math.min(analytics.budgetUsed, 100)}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-gray-500">{analytics.budgetUsed.toFixed(1)}% used</span>
          {analytics.budgetUsed >= 80 && (
            <div className="flex items-center gap-1 text-xs text-amber-400">
              <AlertCircle size={14} />
              <span>Approaching limit</span>
            </div>
          )}
        </div>
      </div>

      {/* Forecast Chart */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-semibold text-white">Spending Forecast</h4>
          <select
            value={forecastPeriod}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForecastPeriod(Number(e.target.value) as 30 | 90)}
            className="bg-gray-700 border border-gray-600 rounded px-3 py-1 text-sm text-white"
          >
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
        <ForecastChart data={analytics.forecast} height={300} />
      </div>

      {/* Anomaly Detection */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <AnomalyDetector anomalies={analytics.anomalies} />
      </div>

      {/* Insights */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h4 className="font-semibold text-white mb-4">Automated Insights</h4>
        <ul className="space-y-2">
          {analytics.budgetUsed > 100 && (
            <li className="flex items-start gap-2 text-sm text-red-400">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>Monthly budget exceeded by {(analytics.budgetUsed - 100).toFixed(1)}%</span>
            </li>
          )}
          {analytics.runway < 30 && analytics.runway !== Infinity && (
            <li className="flex items-start gap-2 text-sm text-amber-400">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>Low runway: Only {Math.floor(analytics.runway)} days remaining at current burn rate</span>
            </li>
          )}
          {analytics.anomalies.length > 0 && (
            <li className="flex items-start gap-2 text-sm text-blue-400">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{analytics.anomalies.length} anomal{analytics.anomalies.length === 1 ? 'y' : 'ies'} detected in recent transactions</span>
            </li>
          )}
          {analytics.budgetUsed < 50 && (
            <li className="flex items-start gap-2 text-sm text-green-400">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>Spending is well within budget ({analytics.budgetUsed.toFixed(1)}% used)</span>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
};

export default SpendingAnalytics;
