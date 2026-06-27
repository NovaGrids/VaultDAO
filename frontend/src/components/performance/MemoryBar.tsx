import { useTranslation } from 'react-i18next';
import type { MemoryMetrics } from '../../utils/performanceTracking';

interface Props {
  memory?: MemoryMetrics;
}

export default function MemoryBar({ memory }: Props) {
  const { t } = useTranslation();

  if (!memory) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
          {t('performance.memoryUsage')}
        </p>
        <p className="text-xs text-gray-400">Not available in this browser</p>
      </div>
    );
  }

  const pct = memory.percentageUsed;
  const barColor = pct > 80 ? 'bg-red-500' : pct > 60 ? 'bg-yellow-500' : 'bg-green-500';
  const usedMB = (memory.usedJSHeapSize / 1024 / 1024).toFixed(1);
  const limitMB = (memory.jsHeapSizeLimit / 1024 / 1024).toFixed(1);

  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex justify-between items-center mb-2">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          {t('performance.heapUsage')}
        </p>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {usedMB} MB / {limitMB} MB ({pct.toFixed(1)}%)
        </span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
        <div
          className={`h-3 rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Heap usage ${pct.toFixed(1)}%`}
        />
      </div>
    </div>
  );
}
