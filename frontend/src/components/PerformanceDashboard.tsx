import { useState, useEffect } from 'react';
import { Activity, AlertCircle, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { performanceTracker, type PerformanceMetrics } from '../utils/performanceTracking';
import { getRpcHistory, type RpcCall } from '../utils/apiTracking';
import VitalsGrid from './performance/VitalsGrid';
import RpcLatencyChart from './performance/RpcLatencyChart';
import MemoryBar from './performance/MemoryBar';

const TABS = ['overview', 'vitals', 'resources', 'recommendations'] as const;
type Tab = (typeof TABS)[number];

export default function PerformanceDashboard() {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [rpcCalls, setRpcCalls] = useState<RpcCall[]>([]);
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  useEffect(() => {
    const update = () => {
      setMetrics(performanceTracker.getMetrics());
      setRecommendations(performanceTracker.getRecommendations());
      setRpcCalls(getRpcHistory());
    };
    update();
    const id = setInterval(update, 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="w-full bg-white dark:bg-gray-900 rounded-lg shadow-lg p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Activity className="w-7 h-7 text-blue-500" aria-hidden="true" />
          {t('performance.title')}
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">{t('performance.subtitle')}</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === tab
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            {t(`performance.${tab}`)}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-6">
          <VitalsGrid metrics={metrics} />
          <RpcLatencyChart calls={rpcCalls} />
        </div>
      )}

      {activeTab === 'vitals' && (
        <div className="space-y-4">
          <VitalsGrid metrics={metrics} />
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800 text-sm space-y-2">
            <p className="font-semibold text-gray-800 dark:text-gray-200">{t('performance.thresholds')}</p>
            {[
              { label: 'LCP', good: '≤2.5s', warn: '≤4s' },
              { label: 'FID', good: '≤100ms', warn: '≤300ms' },
              { label: 'CLS', good: '≤0.1', warn: '≤0.25' },
            ].map((row) => (
              <div key={row.label} className="flex justify-between text-gray-600 dark:text-gray-400">
                <span>{row.label}</span>
                <span>
                  <span className="text-green-600">{t('performance.good')}: {row.good}</span>
                  {' · '}
                  <span className="text-yellow-600">{t('performance.warning')}: {row.warn}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'resources' && (
        <div className="space-y-4">
          <MemoryBar memory={metrics?.memoryUsage} />
          {metrics?.resourceTimings && metrics.resourceTimings.length > 0 && (
            <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
              <p className="font-semibold text-gray-800 dark:text-gray-200 mb-3">{t('performance.largestResources')}</p>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {[...metrics.resourceTimings]
                  .sort((a, b) => (b.transferSize ?? 0) - (a.transferSize ?? 0))
                  .slice(0, 10)
                  .map((r, i) => (
                    <div key={i} className="flex justify-between items-center text-sm p-2 bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700">
                      <span className="truncate text-gray-700 dark:text-gray-300 max-w-[60%]" title={r.name}>
                        {r.name.split('/').pop()}
                      </span>
                      <span className="text-gray-500 dark:text-gray-400 shrink-0">
                        {((r.transferSize ?? 0) / 1024).toFixed(1)}KB · {r.duration?.toFixed(0)}ms
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'recommendations' && (
        <div className="space-y-3">
          {recommendations.length > 0 ? (
            recommendations.map((rec, i) => (
              <div key={i} className="flex gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-sm text-amber-900 dark:text-amber-200">{rec}</p>
              </div>
            ))
          ) : (
            <div className="flex items-center gap-2 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <TrendingUp className="w-5 h-5 text-green-600" aria-hidden="true" />
              <p className="text-sm text-green-800 dark:text-green-200">{t('performance.allGood')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
