import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { useVaultContract } from '../../hooks/useVaultContract';
import { useRealtime } from '../../contexts/RealtimeContext';
import ActivityItem from '../../components/ActivityItem';
import { env } from '../../config/env';
import type { VaultActivity, VaultEventType } from '../../types/activity';

type FilterType = 'all' | 'proposals' | 'signers' | 'config';

const FILTER_LABELS: { value: FilterType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'proposals', label: 'Proposals' },
  { value: 'signers', label: 'Signers' },
  { value: 'config', label: 'Config' },
];

const PROPOSAL_TYPES = new Set<VaultEventType>([
  'proposal_created', 'proposal_approved', 'proposal_ready',
  'proposal_executed', 'proposal_rejected',
]);
const SIGNER_TYPES = new Set<VaultEventType>(['signer_added', 'signer_removed']);
const CONFIG_TYPES = new Set<VaultEventType>(['config_updated', 'initialized', 'role_assigned']);

function matchesFilter(activity: VaultActivity, filter: FilterType): boolean {
  if (filter === 'all') return true;
  if (filter === 'proposals') return PROPOSAL_TYPES.has(activity.type);
  if (filter === 'signers') return SIGNER_TYPES.has(activity.type);
  if (filter === 'config') return CONFIG_TYPES.has(activity.type);
  return true;
}

const PAGE_SIZE = 20;

const Activity: React.FC = () => {
  const { getVaultEvents } = useVaultContract();
  const { subscribe, updatePresence, connectionStatus } = useRealtime();

  const [activities, setActivities] = useState<VaultActivity[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterType>('all');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);

  const seenIds = useRef<Set<string>>(new Set());

  const fetchInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getVaultEvents(undefined, PAGE_SIZE);
      seenIds.current = new Set(result.activities.map((a) => a.id));
      setActivities(result.activities);
      setCursor(result.cursor);
      setHasMore(result.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, [getVaultEvents]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await getVaultEvents(cursor, PAGE_SIZE);
      const fresh = result.activities.filter((a) => !seenIds.current.has(a.id));
      fresh.forEach((a) => seenIds.current.add(a.id));
      setActivities((prev) => [...prev, ...fresh]);
      setCursor(result.cursor);
      setHasMore(result.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, getVaultEvents]);

  useEffect(() => {
    updatePresence('online', 'Activity');
    fetchInitial();
  }, [fetchInitial, updatePresence]);

  // Real-time: prepend new events with fade-in animation
  useEffect(() => {
    const unsub = subscribe('activity_new', (data: Record<string, unknown>) => {
      const activity = data as unknown as VaultActivity;
      if (!activity.id || seenIds.current.has(activity.id)) return;
      seenIds.current.add(activity.id);
      setActivities((prev) => [activity, ...prev]);
      setNewIds((prev) => new Set(prev).add(activity.id));
      setTimeout(() => {
        setNewIds((prev) => {
          const next = new Set(prev);
          next.delete(activity.id);
          return next;
        });
      }, 600);
    });
    return unsub;
  }, [subscribe]);

  const visible = activities.filter((a) => matchesFilter(a, filter));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Activity</h1>
          <p className="text-gray-400 mt-1">Live vault event feed</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              connectionStatus === 'connected'
                ? 'bg-green-400'
                : connectionStatus === 'connecting'
                ? 'bg-yellow-400 animate-pulse'
                : 'bg-gray-500'
            }`}
            title={connectionStatus}
          />
          <span className="text-xs text-gray-500 capitalize">{connectionStatus}</span>
          <button
            onClick={fetchInitial}
            disabled={loading}
            className="p-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:text-white transition-colors disabled:opacity-50 ml-2"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Reconnecting banner */}
      {connectionStatus === 'connecting' && (
        <div className="flex items-center gap-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30 px-4 py-2 text-sm text-yellow-400">
          <Loader2 size={14} className="animate-spin" />
          Reconnecting to real-time updates…
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-lg p-1 w-fit">
        {FILTER_LABELS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === f.value
                ? 'bg-purple-600 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4 animate-pulse">
              <div className="w-10 h-10 rounded-full bg-gray-700 flex-shrink-0" />
              <div className="flex-1 bg-gray-800 rounded-xl h-20" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && visible.length === 0 && (
        <div className="bg-gray-800/40 border border-gray-700 rounded-xl p-12 text-center">
          <p className="text-gray-400 font-medium">No events found</p>
          <p className="text-gray-500 text-sm mt-1">
            {filter !== 'all'
              ? 'Try selecting a different filter.'
              : 'No vault activity yet.'}
          </p>
        </div>
      )}

      {/* Feed */}
      {!loading && visible.length > 0 && (
        <div className="relative">
          <div className="absolute left-5 top-0 bottom-0 w-px bg-gray-700/50" />
          <div className="space-y-1">
            {visible.map((activity) => (
              <div
                key={activity.id}
                className={newIds.has(activity.id) ? 'animate-fade-in' : ''}
              >
                <ActivityItem
                  activity={activity}
                  ledgerExplorerUrl={env.explorerUrl}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Load More — only on 'all' since filters are client-side */}
      {!loading && hasMore && filter === 'all' && (
        <div className="flex justify-center pt-2">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="flex items-center gap-2 px-6 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loadingMore ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading…
              </>
            ) : (
              'Load More'
            )}
          </button>
        </div>
      )}
    </div>
  );
};

export default Activity;
