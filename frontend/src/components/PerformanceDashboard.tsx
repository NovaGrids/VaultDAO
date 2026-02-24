import { useState, useEffect } from 'react';
import { Activity, AlertCircle, TrendingUp, Zap, BarChart3, Cpu } from 'lucide-react';
import { performanceTracker, type PerformanceMetrics } from '../utils/performanceTracking';
import LineChart from './charts/LineChart';

interface MetricsHistory {
  timestamp: number;
  lcp?: number;
  fid?: number;
  cls?: number;
  memory?: number;
}

interface MetricCardProps {
  label: string;
  value?: number;
  unit: string;
  status: 'good' | 'warning' | 'poor';
}

function MetricCard({ label, value, unit, status }: MetricCardProps) {
  const getStatusColor = (status: 'good' | 'warning' | 'poor'): string => {
    switch (status) {
      case 'good':
        return 'text-green-600 bg-green-50';
      case 'warning':
        return 'text-yellow-600 bg-yellow-50';
      case 'poor':
        return 'text-red-600 bg-red-50';
    }
  };

  const getStatusBadgeColor = (status: 'good' | 'warning' | 'poor'): string => {
    switch (status) {
      case 'good':
        return 'bg-green-100 text-green-800';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800';
      case 'poor':
        return 'bg-red-100 text-red-800';
    }
  };

  return (
    <div className={`p-4 rounded-lg border ${getStatusColor(status)}`}>
      <div className="text-sm font-medium mb-1">{label}</div>
      <div className="text-2xl font-bold">{value?.toFixed(2) ?? 'N/A'}</div>
      <div className="text-xs mt-1">{unit}</div>
      <span className={`inline-block mt-2 px-2 py-1 rounded text-xs font-medium ${getStatusBadgeColor(status)}`}>
        {status.toUpperCase()}
      </span>
    </div>
  );
}

export default function PerformanceDashboard() {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [metricsHistory, setMetricsHistory] = useState<MetricsHistory[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'vitals' | 'resources' | 'recommendations'>('overview');

  useEffect(() => {
    const updateMetrics = () => {
      const currentMetrics = performanceTracker.getMetrics();
      setMetrics(currentMetrics);
      setRecommendations(performanceTracker.getRecommendations());

      // Track history for charts
      setMetricsHistory((prev) => [
        ...prev,
        {
          timestamp: Date.now(),
          lcp: currentMetrics.lcp,
          fid: currentMetrics.fid,
          cls: currentMetrics.cls,
          memory: currentMetrics.memoryUsage?.percentageUsed,
        },
      ].slice(-60)); // Keep last 60 data points
    };

    updateMetrics();
    const interval = setInterval(updateMetrics, 2000);
    return () => clearInterval(interval);
  }, []);

  const getMetricStatus = (metric: string, value?: number): 'good' | 'warning' | 'poor' => {
    if (!value) return 'good';

    switch (metric) {
      case 'lcp':
        return value <= 2500 ? 'good' : value <= 4000 ? 'warning' : 'poor';
      case 'fid':
        return value <= 100 ? 'good' : value <= 300 ? 'warning' : 'poor';
      case 'cls':
        return value <= 0.1 ? 'good' : value <= 0.25 ? 'warning' : 'poor';
      case 'ttfb':
        return value <= 600 ? 'good' : value <= 1200 ? 'warning' : 'poor';
      case 'fcp':
        return value <= 1800 ? 'good' : value <= 3000 ? 'warning' : 'poor';
      case 'memory':
        return value <= 60 ? 'good' : value <= 80 ? 'warning' : 'poor';
      default:
        return 'good';
    }
  };

  return (
    <div className="w-full bg-white rounded-lg shadow-lg p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Activity className="w-6 h-6 md:w-8 md:h-8 text-blue-600" />
          Performance Dashboard
        </h1>
        <p className="text-gray-600 mt-1 text-sm md:text-base">Real-time performance metrics and optimization recommendations</p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-6 border-b overflow-x-auto">
        {(['overview', 'vitals', 'resources', 'recommendations'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 md:px-4 py-2 font-medium transition-colors whitespace-nowrap text-sm md:text-base ${
              activeTab === tab
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <MetricCard
              label="Largest Contentful Paint"
              value={metrics?.lcp}
              unit="ms"
              status={getMetricStatus('lcp', metrics?.lcp)}
            />
            <MetricCard
              label="First Input Delay"
              value={metrics?.fid}
              unit="ms"
              status={getMetricStatus('fid', metrics?.fid)}
            />
            <MetricCard
              label="Cumulative Layout Shift"
              value={metrics?.cls}
              unit="score"
              status={getMetricStatus('cls', metrics?.cls)}
            />
            <MetricCard
              label="Time to First Byte"
              value={metrics?.ttfb}
              unit="ms"
              status={getMetricStatus('ttfb', metrics?.ttfb)}
            />
            <MetricCard
              label="First Contentful Paint"
              value={metrics?.fcp}
              unit="ms"
              status={getMetricStatus('fcp', metrics?.fcp)}
            />
            <MetricCard
              label="Memory Usage"
              value={metrics?.memoryUsage?.percentageUsed}
              unit="%"
              status={getMetricStatus('memory', metrics?.memoryUsage?.percentageUsed)}
            />
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-5 h-5 text-blue-600" />
                <span className="font-medium text-gray-900">Slow Queries</span>
              </div>
              <div className="text-3xl font-bold text-blue-600">{metrics?.slowQueries.length ?? 0}</div>
              <p className="text-sm text-gray-600 mt-1">Queries exceeding 1s threshold</p>
            </div>

            <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="w-5 h-5 text-purple-600" />
                <span className="font-medium text-gray-900">Resources</span>
              </div>
              <div className="text-3xl font-bold text-purple-600">{metrics?.resourceTimings?.length ?? 0}</div>
              <p className="text-sm text-gray-600 mt-1">Total resources loaded</p>
            </div>
          </div>
        </div>
      )}

      {/* Web Vitals Tab */}
      {activeTab === 'vitals' && (
        <div className="space-y-6">
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <h3 className="font-semibold text-gray-900 mb-4">Web Vitals Thresholds</h3>
            <div className="space-y-3 text-sm">
              <div className="flex flex-col md:flex-row md:justify-between gap-2">
                <span className="text-gray-600">LCP (Largest Contentful Paint)</span>
                <span className="font-medium text-xs md:text-sm">Good: ≤2.5s | Warning: ≤4s | Poor: &gt;4s</span>
              </div>
              <div className="flex flex-col md:flex-row md:justify-between gap-2">
                <span className="text-gray-600">FID (First Input Delay)</span>
                <span className="font-medium text-xs md:text-sm">Good: ≤100ms | Warning: ≤300ms | Poor: &gt;300ms</span>
              </div>
              <div className="flex flex-col md:flex-row md:justify-between gap-2">
                <span className="text-gray-600">CLS (Cumulative Layout Shift)</span>
                <span className="font-medium text-xs md:text-sm">Good: ≤0.1 | Warning: ≤0.25 | Poor: &gt;0.25</span>
              </div>
            </div>
          </div>

          {metricsHistory.length > 0 && (
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h3 className="font-semibold text-gray-900 mb-4">Metrics Trend (Last 60s)</h3>
              <div className="h-64 bg-white rounded p-4 overflow-x-auto">
                <LineChart
                  data={metricsHistory.map((h) => ({
                    time: new Date(h.timestamp).toLocaleTimeString(),
                    lcp: h.lcp,
                    fid: h.fid,
                    cls: h.cls,
                  }))}
                  xKey="time"
                  series={[
                    { dataKey: 'lcp', name: 'LCP', color: '#3b82f6' },
                    { dataKey: 'fid', name: 'FID', color: '#ef4444' },
                    { dataKey: 'cls', name: 'CLS', color: '#f59e0b' },
                  ]}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Resources Tab */}
      {activeTab === 'resources' && (
        <div className="space-y-6">
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Cpu className="w-5 h-5" />
              Memory Usage
            </h3>
            {metrics?.memoryUsage && (
              <div className="space-y-3">
                <div>
                  <div className="flex flex-col md:flex-row md:justify-between mb-1 gap-2">
                    <span className="text-sm font-medium">Heap Usage</span>
                    <span className="text-sm text-gray-600">
                      {(metrics.memoryUsage.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB / {(metrics.memoryUsage.jsHeapSizeLimit / 1024 / 1024).toFixed(2)} MB
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        metrics.memoryUsage.percentageUsed > 80
                          ? 'bg-red-600'
                          : metrics.memoryUsage.percentageUsed > 60
                            ? 'bg-yellow-600'
                            : 'bg-green-600'
                      }`}
                      style={{ width: `${metrics.memoryUsage.percentageUsed}%` }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {metrics?.resourceTimings && metrics.resourceTimings.length > 0 && (
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h3 className="font-semibold text-gray-900 mb-4">Largest Resources</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {metrics.resourceTimings
                  .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
                  .slice(0, 10)
                  .map((resource, idx) => (
                    <div key={idx} className="flex flex-col md:flex-row md:justify-between md:items-center p-2 bg-white rounded border border-gray-200 gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{resource.name.split('/').pop()}</p>
                        <p className="text-xs text-gray-600 truncate">{resource.name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-gray-900">
                          {((resource.transferSize || 0) / 1024).toFixed(2)} KB
                        </p>
                        <p className="text-xs text-gray-600">{resource.duration?.toFixed(0)}ms</p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recommendations Tab */}
      {activeTab === 'recommendations' && (
        <div className="space-y-4">
          {recommendations.length > 0 ? (
            recommendations.map((rec, idx) => (
              <div key={idx} className="flex gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-900">{rec}</p>
              </div>
            ))
          ) : (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-900 flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                All performance metrics are within acceptable ranges!
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
