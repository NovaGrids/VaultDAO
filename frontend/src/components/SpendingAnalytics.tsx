import React, { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Calendar, AlertCircle } from 'lucide-react';
import ForecastChart from './ForecastChart';
import AnomalyDetector from './AnomalyDetector';
import { forecastSpending, calculateBurnRate, calculateRunway } from '../utils/forecasting';
import { analyzeAnomalies } from '../utils/anomalyDetection';

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

const SpendingAnalytics: React.FC<SpendingAnalyticsProps> = ({
  transactions,
  currentBalance,
  monthlyBudget = 10000
}) => {
  const [forecastPeriod, setForecastPeriod] = useState<30 | 90>(30);

  const analytics = useMemo(() => {
    const last30Days = transactions.filter(t => {
      const diff = Date.now() - new Date(t.timestamp).getTime();
      return diff < 30 * 24 * 60 * 60 * 1000;
    });

    const dailySpending = last30Days.reduce((acc, t) => {
      const date = t.timestamp.slice(0, 10);
      acc[date] = (acc[date] || 0) + t.amount;
      return acc;
    }, {} as Record<string, number>);

    const historicalData = Object.entries(dailySpending)
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const forecast = forecastSpending(historicalData, forecastPeriod);
    const totalSpent = last30Days.reduce((sum, t) => sum + t.amount, 0);
    const burnRate = calculateBurnRate(last30Days.map(t => t.amount), 30);
    const runway = calculateRunway(currentBalance, burnRate);
    const anomalies = analyzeAnomalies(last30Days);

    const budgetUsed = (totalSpent / monthlyBudget) * 100;
    const velocity = last30Days.length > 0 ? totalSpent / 30 : 0;

    return {
      forecast,
      totalSpent,
      burnRate,
      runway,
      anomalies,
      budgetUsed,
      velocity,
      transactionCount: last30Days.length
    };
  }, [transactions, currentBalance, monthlyBudget, forecastPeriod]);

  const getBudgetColor = (percent: number) => {
    if (percent >= 100) return 'bg-red-500';
    if (percent >= 90) return 'bg-amber-500';
    if (percent >= 80) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign size={18} className="text-purple-400" />
            <span className="text-sm text-gray-400">Burn Rate</span>
          </div>
          <p className="text-2xl font-bold">{analytics.burnRate.toFixed(0)}</p>
          <p className="text-xs text-gray-500 mt-1">XLM/day</p>
        </div>

        <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Calendar size={18} className="text-blue-400" />
            <span className="text-sm text-gray-400">Runway</span>
          </div>
          <p className="text-2xl font-bold">
            {analytics.runway === Infinity ? '∞' : Math.floor(analytics.runway)}
          </p>
          <p className="text-xs text-gray-500 mt-1">days</p>
        </div>

        <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={18} className="text-green-400" />
            <span className="text-sm text-gray-400">Velocity</span>
          </div>
          <p className="text-2xl font-bold">{analytics.velocity.toFixed(0)}</p>
          <p className="text-xs text-gray-500 mt-1">XLM/day avg</p>
        </div>

        <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown size={18} className="text-amber-400" />
            <span className="text-sm text-gray-400">Total Spent (30d)</span>
          </div>
          <p className="text-2xl font-bold">{analytics.totalSpent.toLocaleString()}</p>
          <p className="text-xs text-gray-500 mt-1">{analytics.transactionCount} transactions</p>
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
            onChange={(e) => setForecastPeriod(Number(e.target.value) as 30 | 90)}
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
