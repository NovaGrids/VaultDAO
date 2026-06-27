import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BarChart3, RefreshCw, Trash2, Download, ChevronDown, ChevronUp, ExternalLink, Copy } from 'lucide-react';
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

/**
 * Extract the top-level component name from a React component stack string.
 * Component stacks typically look like: "\n    at ComponentName (url)\n    at ParentComponent ..."
 */
function extractComponentName(componentStack: string): string | null {
  const match = componentStack.match(/at\s+([A-Z][A-Za-z0-9_]*)/);
  return match ? match[1] : null;
}

interface GroupedError {
  message: string;
  count: number;
  latestEvent: ErrorEvent;
  events: ErrorEvent[];
}

export default function ErrorDashboard() {
  const [events, setEvents] = useState<ErrorEvent[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = () => {
    setEvents(getRecentErrors(50));
    setCounts(getErrorCountsByCode());
    setTotal(getTotalErrorCount());
  };

  useEffect(() => {
    refresh();
  }, []);

  // Group errors by message and compute occurrence counts
  const groupedErrors = useMemo<GroupedError[]>(() => {
    const groups = new Map<string, GroupedError>();
    for (const ev of events) {
      const existing = groups.get(ev.message);
      if (existing) {
        existing.count += 1;
        existing.events.push(ev);
        if (ev.timestamp > existing.latestEvent.timestamp) {
          existing.latestEvent = ev;
        }
      } else {
        groups.set(ev.message, {
          message: ev.message,
          count: 1,
          latestEvent: ev,
          events: [ev],
        });
      }
    }
    return Array.from(groups.values()).sort(
      (a, b) => b.latestEvent.timestamp - a.latestEvent.timestamp
    );
  }, [events]);

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

  const handleReportToGitHub = (ev: ErrorEvent) => {
    const title = ev.message.slice(0, 120);
    const body = [
      `**Error Code:** ${ev.code}`,
      `**Error ID:** ${ev.id}`,
      `**Timestamp:** ${formatTime(ev.timestamp)}`,
      `**URL:** ${ev.url}`,
      '',
      '**Message:**',
      '```',
      ev.message,
      '```',
      ev.stack ? `\n**Stack:**\n\`\`\`\n${ev.stack}\n\`\`\`` : '',
      ev.context ? `\n**Component Stack:**\n\`\`\`\n${ev.context}\n\`\`\`` : '',
    ].join('\n');

    const url = `https://github.com/NovaGrids/VaultDAO/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleCopyError = async (ev: ErrorEvent) => {
    let text = `Error: ${ev.message}\nCode: ${ev.code}\nID: ${ev.id}\n`;
    if (ev.stack) {
      text += `\nStack:\n${ev.stack}\n`;
    }
    if (ev.context) {
      text += `\nComponent Stack:\n${ev.context}\n`;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(ev.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      console.warn('Clipboard API not available');
    }
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
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-400">Recent Errors (Last 50)</h2>
        </div>

        {groupedErrors.length === 0 ? (
          <div className="py-20 text-center">
            <AlertCircle className="h-12 w-12 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No errors recorded in this session</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {groupedErrors.map((group) => {
              const ev = group.latestEvent;
              const componentName = ev.context ? extractComponentName(ev.context) : null;

              return (
                <div key={ev.id} className="p-0">
                  <button
                    onClick={() => toggleExpand(ev.id)}
                    className="w-full text-left p-4 hover:bg-white/5 transition-colors flex items-start gap-4"
                  >
                    <AlertCircle className="h-5 w-5 text-red-400 mt-1 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-red-300 bg-red-500/10 px-2 py-0.5 rounded">
                            {ev.id}
                          </span>
                          {group.count > 1 && (
                            <span className="text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded font-medium">
                              x{group.count}
                            </span>
                          )}
                          {componentName && (
                            <span className="text-xs text-blue-300 bg-blue-500/10 px-2 py-0.5 rounded font-medium">
                              {componentName}
                            </span>
                          )}
                        </div>
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

                          <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
                            <button
                              onClick={() => handleReportToGitHub(ev)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 border border-white/10 transition-colors"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              Report to GitHub
                            </button>
                            <button
                              onClick={() => handleCopyError(ev)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 border border-white/10 transition-colors"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              {copiedId === ev.id ? 'Copied!' : 'Copy Error'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
