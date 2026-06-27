import { useTranslation } from 'react-i18next';
import type { PerformanceMetrics } from '../../utils/performanceTracking';

type Status = 'good' | 'warning' | 'poor';

function getStatus(metric: string, value?: number): Status {
  if (value === undefined) return 'good';
  switch (metric) {
    case 'lcp':  return value <= 2500 ? 'good' : value <= 4000 ? 'warning' : 'poor';
    case 'fid':  return value <= 100  ? 'good' : value <= 300  ? 'warning' : 'poor';
    case 'cls':  return value <= 0.1  ? 'good' : value <= 0.25 ? 'warning' : 'poor';
    case 'ttfb': return value <= 600  ? 'good' : value <= 1200 ? 'warning' : 'poor';
    case 'fcp':  return value <= 1800 ? 'good' : value <= 3000 ? 'warning' : 'poor';
    case 'mem':  return value <= 60   ? 'good' : value <= 80   ? 'warning' : 'poor';
    default:     return 'good';
  }
}

const STATUS_COLORS: Record<Status, string> = {
  good:    'border-green-400 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300',
  warning: 'border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300',
  poor:    'border-red-400 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300',
};

const BADGE_COLORS: Record<Status, string> = {
  good:    'bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-200',
  warning: 'bg-yellow-100 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200',
  poor:    'bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200',
};

interface CardProps {
  label: string;
  value?: number;
  unit: string;
  metricKey: string;
}

function MetricCard({ label, value, unit, metricKey }: CardProps) {
  const { t } = useTranslation();
  const status = getStatus(metricKey, value);
  return (
    <div className={`p-4 rounded-lg border-2 ${STATUS_COLORS[status]}`}>
      <p className="text-xs font-medium mb-1 opacity-80">{label}</p>
      <p className="text-2xl font-bold">{value !== undefined ? value.toFixed(metricKey === 'cls' ? 3 : 0) : '—'}</p>
      <p className="text-xs mt-0.5 opacity-70">{unit}</p>
      <span className={`inline-block mt-2 px-2 py-0.5 rounded text-xs font-semibold ${BADGE_COLORS[status]}`}>
        {t(`performance.${status}`).toUpperCase()}
      </span>
    </div>
  );
}

interface Props {
  metrics: PerformanceMetrics | null;
}

export default function VitalsGrid({ metrics }: Props) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <MetricCard label={t('performance.lcp')}  value={metrics?.lcp}  unit="ms"    metricKey="lcp" />
      <MetricCard label={t('performance.fid')}  value={metrics?.fid}  unit="ms"    metricKey="fid" />
      <MetricCard label={t('performance.cls')}  value={metrics?.cls}  unit="score" metricKey="cls" />
      <MetricCard label={t('performance.ttfb')} value={metrics?.ttfb} unit="ms"    metricKey="ttfb" />
      <MetricCard label={t('performance.fcp')}  value={metrics?.fcp}  unit="ms"    metricKey="fcp" />
      <MetricCard
        label={t('performance.memoryUsage')}
        value={metrics?.memoryUsage?.percentageUsed}
        unit="%"
        metricKey="mem"
      />
    </div>
  );
}
