import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { useVaultContract } from '../../hooks/useVaultContract';
import type { AnalyticsTimeRange, ActivityLike } from '../../types/analytics';
import {
  aggregateDailySpending,
  aggregateProposalOutcomes,
  aggregateTopRecipients,
  aggregateSignerParticipation,
} from '../../utils/analyticsAggregation';
import SpendingAreaChart from '../../components/charts/SpendingAreaChart';
import ProposalOutcomesPie from '../../components/charts/ProposalOutcomesPie';
import TopRecipientsBar from '../../components/charts/TopRecipientsBar';
import SignerParticipationTable from '../../components/charts/SignerParticipationTable';

const TIME_RANGES: { value: AnalyticsTimeRange; label: string }[] = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: '1y', label: '1y' },
  { value: 'all', label: 'All' },
];

const ChartCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="bg-gray-800/60 backdrop-blur-sm border border-gray-700/60 rounded-xl p-4 sm:p-5 shadow-lg">
    <h3 className="text-sm font-semibold text-gray-300 mb-4">{title}</h3>
    {children}
  </div>
);

const SkeletonCard: React.FC = () => (
  <div className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-4 sm:p-5 animate-pulse">
    <div className="h-4 w-32 bg-gray-700 rounded mb-4" />
    <div className="h-52 bg-gray-700/50 rounded" />
  </div>
);

const Analytics: React.FC = () => {
  const { getVaultEvents } = useVaultContract();
  const [timeRange, setTimeRange] = useState<AnalyticsTimeRange>('30d');
  const [activities, setActivities] = useState<ActivityLike[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getVaultEvents(undefined, 200);
      setActivities(result.activities as ActivityLike[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  }, [getVaultEvents]);

  useEffect(() => { fetchActivities(); }, [fetchActivities]);

  const spending = useMemo(() => aggregateDailySpending(activities, timeRange), [activities, timeRange]);
  const outcomes = useMemo(() => aggregateProposalOutcomes(activities, timeRange), [activities, timeRange]);
  const recipients = useMemo(() => aggregateTopRecipients(activities, timeRange), [activities, timeRange]);
  const signers = useMemo(() => aggregateSignerParticipation(activities, timeRange), [activities, timeRange]);

  const hasData = spending.length > 0 || outcomes.length > 0 || recipients.length > 0 || signers.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Analytics</h1>
          <p className="text-gray-400 mt-1">Spending trends, proposal outcomes, and signer activity</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Time range selector */}
          <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-lg p-1">
            {TIME_RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setTimeRange(r.value)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  timeRange === r.value
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={fetchActivities}
            disabled={loading}
            className="p-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && !hasData && (
        <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-12 text-center">
          <p className="text-gray-400 text-lg font-medium">No data for this time range</p>
          <p className="text-gray-500 text-sm mt-1">Try selecting a wider range or perform vault actions first.</p>
        </div>
      )}

      {/* Charts */}
      {!loading && !error && hasData && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ChartCard title="Spending Over Time">
            <SpendingAreaChart data={spending} height={240} />
          </ChartCard>

          <ChartCard title="Proposal Outcomes">
            <ProposalOutcomesPie data={outcomes} height={240} />
          </ChartCard>

          <ChartCard title="Top Recipients">
            <TopRecipientsBar data={recipients} height={240} />
          </ChartCard>

          <ChartCard title="Signer Participation">
            <SignerParticipationTable data={signers} />
          </ChartCard>
        </div>
      )}
    </div>
  );
};

export default Analytics;
