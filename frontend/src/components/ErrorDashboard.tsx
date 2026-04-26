import { useEffect, useState } from 'react';
import { AlertCircle, BarChart3, RefreshCw, Trash2, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { 
  getErrorEvents, 
  getErrorCountsByCode, 
  getTotalErrorCount, 
  clearErrorAnalytics, 
  exportErrorsAsJson,
  getRecentErrors,
  type ErrorEvent 
} from '../utils/errorAnalytics';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

export default function ErrorDashboard() {
  const [events, setEvents] = useState<ErrorEvent[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = () => {
    setEvents(getRecentErrors(20));
    setCounts(getErrorCountsByCode());
    setTotal(getTotalErrorCount());
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleClear = () => {
    if (window.confirm('Clear all error history?')) {
      clearErrorAnalytics();
      refresh();
    }
  };

  const handleExport = () => {
    const data = exportErrorsAsJson();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vaultdao-errors-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <BarChart3 className="h-6 w-6 text-red-400" />
            Error Dashboard
          </h1>
          <p className="text-gray-400 text-sm mt-1">System health and error reporting</p>
        </div>
        
        <div className="flex flex-wrap gap-2">
          <button
            onClick={refresh}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 border border-white/5"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
          >
            <Download className="h-4 w-4" />
            Export JSON
          </button>
          <button
            onClick={handleClear}
            className="inline-flex items-center gap-2 rounded-lg bg-red-900/40 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-900/60 border border-red-500/20"
          >
            <Trash2 className="h-4 w-4" />
            Clear All
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-white/5 bg-gray-900/50 p-4 backdrop-blur-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Total Errors</p>
          <p className="mt-2 text-3xl font-bold text-white">{total}</p>
        </div>
        <div className="rounded-xl border border-white/5 bg-gray-900/50 p-4 backdrop-blur-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Distinct Types</p>
          <p className="mt-2 text-3xl font-bold text-white">{Object.keys(counts).length}</p>
        </div>
        <div className="rounded-xl border border-white/5 bg-gray-900/50 p-4 backdrop-blur-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Last Updated</p>
          <p className="mt-2 text-sm font-medium text-gray-400">{new Date().toLocaleTimeString()}</p>
        </div>
      </div>

      <section className="rounded-xl border border-white/5 bg-gray-900/50 backdrop-blur-sm overflow-hidden">
        <div className="border-b border-white/5 bg-white/5 px-5 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">Recent Errors (Last 20)</h2>
        </div>
        
        {events.length === 0 ? (
          <div className="py-20 text-center">
            <AlertCircle className="h-12 w-12 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No errors recorded in this session</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {events.map((ev) => (
              <div key={ev.id} className="p-0">
                <button 
                  onClick={() => toggleExpand(ev.id)}
                  className="w-full text-left p-4 hover:bg-white/5 transition-colors flex items-start gap-4"
                >
                  <AlertCircle className="h-5 w-5 text-red-400 mt-1 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-red-300 bg-red-500/10 px-2 py-0.5 rounded">
                        {ev.id}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatTime(ev.timestamp)}
                      </span>
                    </div>
                    <p className="mt-1 font-semibold text-white truncate">{ev.message}</p>
                    <p className="text-xs text-gray-500 mt-1">{ev.code}</p>
                  </div>
                  {expandedId === ev.id ? <ChevronUp className="h-4 w-4 text-gray-600" /> : <ChevronDown className="h-4 w-4 text-gray-600" />}
                </button>
                
                {expandedId === ev.id && (
                  <div className="px-4 pb-4 pt-0 bg-black/20">
                    <div className="rounded-lg border border-white/5 bg-black/40 p-4 mt-2">
                      <div className="space-y-4">
                        {ev.context && (
                          <div>
                            <p className="text-[10px] font-bold uppercase text-gray-500 mb-1">Component Stack</p>
                            <pre className="text-xs text-gray-400 overflow-auto max-h-40 whitespace-pre-wrap font-mono leading-relaxed">
                              {ev.context}
                            </pre>
                          </div>
                        )}
                        {ev.stack && (
                          <div>
                            <p className="text-[10px] font-bold uppercase text-gray-500 mb-1">Error Stack</p>
                            <pre className="text-xs text-red-300/70 overflow-auto max-h-40 whitespace-pre-wrap font-mono leading-relaxed">
                              {ev.stack}
                            </pre>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/5">
                          <div>
                            <p className="text-[10px] font-bold uppercase text-gray-500 mb-1">URL</p>
                            <p className="text-xs text-gray-400 truncate">{ev.url}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase text-gray-500 mb-1">User Agent</p>
                            <p className="text-xs text-gray-400 truncate">{ev.userAgent}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
