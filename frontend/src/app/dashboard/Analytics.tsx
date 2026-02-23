import React, { useState, useMemo, useRef } from 'react';
import type { AnalyticsTimeRange, ActivityLike } from '../../types/analytics';
import { aggregateAnalytics } from '../../utils/analyticsAggregation';
import { exportAnalyticsToCsv, exportChartAsImage } from '../../utils/exportAnalytics';
import LineChart from '../../components/charts/LineChart';
import PieChart from '../../components/charts/PieChart';
import HeatMap from '../../components/charts/HeatMap';
import SpendingAnalytics from '../../components/SpendingAnalytics';
import {
  TrendingUp,
  PieChart as PieIcon,
  Users,
  Wallet,
  Download,
  Image,
  BarChart3,
  AlertCircle,
  CheckCircle2,
  Info,
} from 'lucide-react';

/** Generate mock activities for demo when no event source is available. */
function getMockActivities(): ActivityLike[] {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const activities: ActivityLike[] = [];
  const signers = ['GAAA...1111', 'GBBB...2222', 'GCCC...3333'];
  const recipients = ['GDEF...ABC1', 'GHIJ...DEF2', 'GKLM...GHI3'];
  for (let i = 0; i < 30; i++) {
    const d = new Date(now - (29 - i) * day);
    if (i % 3 === 0) {
      activities.push({
        id: `c-${i}`,
        type: 'proposal_created',
        timestamp: d.toISOString(),
        actor: signers[i % signers.length],
        details: { ledger: String(i), amount: 100 * (i + 1), recipient: recipients[i % 3] },
      });
    }
    if (i % 2 === 0 && i > 0) {
      activities.push({
        id: `a-${i}`,
        type: 'proposal_approved',
        timestamp: new Date(d.getTime() + 2 * 60 * 60 * 1000).toISOString(),
        actor: signers[(i + 1) % signers.length],
        details: { ledger: String(i - 1), approval_count: 1, threshold: 2 },
      });
    }
    if (i % 4 === 0 && i >= 2) {
      activities.push({
        id: `e-${i}`,
        type: 'proposal_executed',
        timestamp: new Date(d.getTime() + 5 * 60 * 60 * 1000).toISOString(),
        actor: signers[0],
        details: { amount: 500 + i * 10, recipient: recipients[i % 3] },
      });
    }
    if (i === 5 || i === 12) {
      activities.push({
        id: `r-${i}`,
        type: 'proposal_rejected',
        timestamp: d.toISOString(),
        actor: signers[2],
        details: {},
      });
    }
  }
  return activities;
}

const TIME_RANGES: { value: AnalyticsTimeRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '1 year' },
  { value: 'all', label: 'All' },
];

const Analytics: React.FC = () => {
  const [timeRange, setTimeRange] = useState<AnalyticsTimeRange>('30d');
  const [loading] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'spending'>('overview');
  const proposalChartRef = useRef<HTMLDivElement>(null);
  const spendingChartRef = useRef<HTMLDivElement>(null);
  const treasuryChartRef = useRef<HTMLDivElement>(null);
  const heatmapRef = useRef<HTMLDivElement>(null);

  const activities = useMemo(() => getMockActivities(), []);

  const analytics = useMemo(
    () => (loading ? null : aggregateAnalytics(activities, timeRange)),
    [activities, timeRange, loading]
  );

  const transactions = useMemo(() => {
    return activities
      .filter(a => a.type === 'proposal_executed')
      .map(a => ({
        amount: Number(a.details?.amount || 0),
        timestamp: a.timestamp,
        recipient: String(a.details?.recipient || 'unknown')
      }));
  }, [activities]);

  const insights = useMemo(() => {
    if (!analytics) return [];
    const list: { text: string; type: 'info' | 'warning' | 'success' }[] = [];
    if (analytics.pendingCount > 0) {
      list.push({
        text: `${analytics.pendingCount} proposal(s) pending approval`,
        type: 'info',
      });
    }
    if (analytics.approvalRate >= 80) {
      list.push({ text: `Approval rate is ${analytics.approvalRate.toFixed(0)}%`, type: 'success' });
    } else if (analytics.approvalRate > 0) {
      list.push({
        text: `Approval rate is ${analytics.approvalRate.toFixed(0)}%`,
        type: 'info',
      });
    }
    if (analytics.dailyLimitUsedPercent != null && analytics.dailyLimitUsedPercent >= 80) {
      list.push({
        text: `Daily limit ${analytics.dailyLimitUsedPercent.toFixed(0)}% used`,
        type: 'warning',
      });
    }
    if (analytics.totalVolume > 0) {
      list.push({
        text: `Total volume: ${analytics.totalVolume.toLocaleString()} units`,
        type: 'info',
      });
    }
    if (list.length === 0) {
      list.push({ text: 'No recent activity in this range', type: 'info' });
    }
    return list;
  }, [analytics]);

  const handleExportCsv = () => {
    if (analytics) exportAnalyticsToCsv(analytics);
  };

  const handleExportChart = (ref: React.RefObject<HTMLDivElement | null>, name: string) => {
    exportChartAsImage(ref.current, `analytics-${name}.png`);
  };

  const hasData =
    analytics &&
    (analytics.proposalTrends.length > 0 ||
      analytics.spendingByToken.length > 0 ||
      analytics.signerActivity.length > 0 ||
      analytics.treasuryBalance.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold">Analytics</h2>
          <p className="text-gray-400 mt-1">Charts, trends, and insights about vault activity.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as AnalyticsTimeRange)}
            className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white"
          >
            {TIME_RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!analytics}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm disabled:opacity-50"
          >
            <Download size={16} />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => handleExportChart(proposalChartRef, 'proposal-trends')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm"
          >
            <Image size={16} />
            Export charts
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-700">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'overview'
              ? 'text-purple-400 border-b-2 border-purple-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('spending')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'spending'
              ? 'text-purple-400 border-b-2 border-purple-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          Spending Analytics
        </button>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-purple-500 border-t-transparent" />
        </div>
      )}

      {!loading && analytics && activeTab === 'spending' && (
        <SpendingAnalytics
          transactions={transactions}
          currentBalance={analytics.totalVolume}
          monthlyBudget={50000}
        />
      )}

      {!loading && analytics && activeTab === 'overview' && (
        <>
          {/* Insights */}
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
            <h3 className="text-sm font-medium text-gray-300 mb-3">Insights</h3>
            <ul className="space-y-2">
              {insights.map((insight, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  {insight.type === 'success' && <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />}
                  {insight.type === 'warning' && <AlertCircle size={16} className="text-amber-400 flex-shrink-0" />}
                  {insight.type === 'info' && <Info size={16} className="text-blue-400 flex-shrink-0" />}
                  <span className="text-gray-300">{insight.text}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/20">
                <BarChart3 size={20} className="text-purple-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Approval rate</p>
                <p className="text-xl font-bold">{analytics.approvalRate.toFixed(1)}%</p>
              </div>
            </div>
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/20">
                <TrendingUp size={20} className="text-green-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Avg approval time</p>
                <p className="text-xl font-bold">
                  {analytics.averageApprovalTimeHours < 1
                    ? `${(analytics.averageApprovalTimeHours * 60).toFixed(0)} min`
                    : `${analytics.averageApprovalTimeHours.toFixed(1)} h`}
                </p>
              </div>
            </div>
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/20">
                <Users size={20} className="text-blue-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-gray-500 uppercase">Most active signer</p>
                <p className="text-sm font-medium truncate" title={analytics.mostActiveSigner}>
                  {analytics.mostActiveSigner}
                </p>
              </div>
            </div>
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/20">
                <PieIcon size={20} className="text-amber-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-gray-500 uppercase">Top recipient</p>
                <p className="text-sm font-medium truncate" title={analytics.topRecipient}>
                  {analytics.topRecipient}
                </p>
              </div>
            </div>
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gray-500/20">
                <Wallet size={20} className="text-gray-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Total volume</p>
                <p className="text-xl font-bold">{analytics.totalVolume.toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* Charts grid: mobile 1 col, tablet 2, desktop 3-4 */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            <div
              ref={proposalChartRef}
              className="bg-gray-800 rounded-xl border border-gray-700 p-4 md:p-5"
            >
              <LineChart
                data={analytics.proposalTrends as unknown as Record<string, unknown>[]}
                xKey="date"
                series={[
                  { dataKey: 'created', name: 'Created', color: '#818cf8' },
                  { dataKey: 'approved', name: 'Approved', color: '#34d399' },
                  { dataKey: 'executed', name: 'Executed', color: '#22c55e' },
                ]}
                height={280}
                title="Proposal trends"
              />
            </div>

            <div
              ref={spendingChartRef}
              className="bg-gray-800 rounded-xl border border-gray-700 p-4 md:p-5"
            >
              <PieChart
                data={analytics.spendingByToken}
                height={280}
                title="Spending by token / recipient"
                showCount
              />
            </div>

            <div
              ref={treasuryChartRef}
              className="bg-gray-800 rounded-xl border border-gray-700 p-4 md:p-5 md:col-span-2 xl:col-span-1"
            >
              <LineChart
                data={analytics.treasuryBalance as unknown as Record<string, unknown>[]}
                xKey="date"
                series={[{ dataKey: 'total', name: 'Cumulative volume', color: '#8b5cf6' }]}
                height={280}
                title="Treasury balance / cumulative volume"
              />
            </div>

            <div
              ref={heatmapRef}
              className="bg-gray-800 rounded-xl border border-gray-700 p-4 md:p-5 md:col-span-2 xl:col-span-3"
            >
              <HeatMap
                data={analytics.signerActivity}
                height={260}
                title="Signer activity (approvals by period)"
              />
            </div>
          </div>

          {!hasData && (
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-12 text-center">
              <p className="text-gray-400">No data in this time range.</p>
              <p className="text-sm text-gray-500 mt-1">Try selecting a different range or run more vault actions.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Analytics;
