import { useTranslation } from 'react-i18next';
import type { RpcCall } from '../../utils/apiTracking';

interface Props {
  calls: RpcCall[];
}

/** Simple inline bar chart — no external charting lib needed */
export default function RpcLatencyChart({ calls }: Props) {
  const { t } = useTranslation();

  if (calls.length === 0) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          RPC Latency — last {20} calls
        </p>
        <p className="text-xs text-gray-400">{t('common.loading')}</p>
      </div>
    );
  }

  const maxDuration = Math.max(...calls.map((c) => c.duration), 1);

  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
        RPC Latency — last {calls.length} calls
      </p>
      <div className="space-y-1.5" role="list" aria-label="RPC latency history">
        {calls.map((call, i) => {
          const pct = (call.duration / maxDuration) * 100;
          const color = call.duration > 1000
            ? 'bg-red-500'
            : call.duration > 500
            ? 'bg-yellow-500'
            : 'bg-green-500';
          return (
            <div key={i} className="flex items-center gap-2 text-xs" role="listitem">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${call.success ? 'bg-green-400' : 'bg-red-400'}`}
                title={call.success ? 'success' : 'failed'}
              />
              <span className="w-28 truncate text-gray-500 dark:text-gray-400 shrink-0" title={call.endpoint}>
                {call.endpoint.split('/').pop() ?? call.endpoint}
              </span>
              <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full transition-all duration-300 ${color}`}
                  style={{ width: `${pct}%` }}
                  role="progressbar"
                  aria-valuenow={Math.round(call.duration)}
                  aria-valuemin={0}
                  aria-valuemax={Math.round(maxDuration)}
                />
              </div>
              <span className="w-14 text-right text-gray-600 dark:text-gray-400 shrink-0">
                {call.duration.toFixed(0)}ms
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 mt-3 text-xs text-gray-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> &lt;500ms</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> 500–1000ms</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> &gt;1000ms</span>
      </div>
    </div>
  );
}
