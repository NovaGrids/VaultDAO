/**
 * Error analytics dashboard: recent errors and counts.
 * Mobile responsive.
 */

import { useEffect, useState } from 'react';
import { AlertCircle, BarChart3, RefreshCw, Trash2 } from 'lucide-react';
import { getErrorEvents, getErrorCountsByCode, getTotalErrorCount, clearErrorAnalytics, type ErrorEvent } from '../utils/errorAnalytics';
import { getOfflineQueueLength, flushOfflineErrorQueue } from './ErrorReporting';
import { toUserFriendlyError } from '../utils/errorMapping';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ErrorDashboard() {
  const [events, setEvents] = useState<ErrorEvent[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [queueLength, setQueueLength] = useState(0);
  const [flushing, setFlushing] = useState(false);

  const refresh = () => {
    setEvents(getErrorEvents());
    setCounts(getErrorCountsByCode());
    setTotal(getTotalErrorCount());
    setQueueLength(getOfflineQueueLength());
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleClear = () => {
    clearErrorAnalytics();
    refresh();
  };

  const handleFlushQueue = async () => {
    setFlushing(true);
    try {
      await flushOfflineErrorQueue();
      refresh();
    } finally {
      setFlushing(false);
    }
  };

  const codeEntries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-4 p-4 sm:gap-6 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-white sm:text-2xl">
          <BarChart3 className="h-6 w-6 text-red-400" aria-hidden />
          Error analytics
        </h1>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-700 px-3 py-2 text-sm font-medium text-white hover:bg-gray-600"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Refresh
          </button>
          {queueLength > 0 && (
            <button
              type="button"
              onClick={handleFlushQueue}
              disabled={flushing}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {flushing ? 'Sending…' : `Send ${queueLength} queued`}
            </button>
          )}
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-2 rounded-lg bg-red-900/60 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-900/80"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Clear session
          </button>
        </div>
      </div>

      {/* Summary cards - stack on mobile */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-700 bg-gray-800/80 p-4">
          <p className="text-sm text-gray-400">Session total</p>
          <p className="mt-1 text-2xl font-semibold text-white">{total}</p>
        </div>
        <div className="rounded-xl border border-gray-700 bg-gray-800/80 p-4">
          <p className="text-sm text-gray-400">By code</p>
          <p className="mt-1 text-2xl font-semibold text-white">{codeEntries.length}</p>
        </div>
        <div className="rounded-xl border border-gray-700 bg-gray-800/80 p-4">
          <p className="text-sm text-gray-400">Offline queue</p>
          <p className="mt-1 text-2xl font-semibold text-amber-400">{queueLength}</p>
        </div>
      </div>

      {/* Counts by code */}
      {codeEntries.length > 0 && (
        <section className="rounded-xl border border-gray-700 bg-gray-800/80 p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-400">By error code</h2>
          <ul className="space-y-2">
            {codeEntries.map(([code, count]) => (
              <li
                key={code}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-900/60 px-3 py-2 sm:px-4"
              >
                <code className="text-sm font-mono text-gray-300">{code}</code>
                <span className="text-sm font-medium text-white">{count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Recent events */}
      <section className="rounded-xl border border-gray-700 bg-gray-800/80 p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-400">Recent errors</h2>
        {events.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">No errors recorded this session.</p>
        ) : (
          <ul className="max-h-[400px] space-y-2 overflow-y-auto custom-scrollbar">
            {events.slice(0, 50).map((ev) => {
              const friendly = toUserFriendlyError({ code: ev.code, message: ev.message });
              return (
                <li
                  key={ev.id}
                  className="flex flex-col gap-1 rounded-lg border border-gray-700 bg-gray-900/60 p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0 text-red-400" aria-hidden />
                      <span className="truncate text-sm font-medium text-white">{friendly.title}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-gray-400 sm:max-w-md">{ev.message}</p>
                    <p className="mt-1 text-xs text-gray-500">{formatTime(ev.timestamp)} · {ev.code}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
