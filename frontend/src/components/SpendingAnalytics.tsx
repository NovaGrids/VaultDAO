import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
  ReferenceLine,
} from 'recharts';
import { TrendingUp, DollarSign, AlertCircle } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { linearRegression, forecastNext, calculateStdError } from '../utils/forecasting';


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TokenSlice {
  token: string;
  amount: number;
}

interface SpendingHistory {
  date: string;
  amount: number;
  dailyLimit: number;
}

interface SpendingData {
  dailyUsed: number;
  weeklyUsed: number;
  dailyLimit: number;
  weeklyLimit: number;
  history: SpendingHistory[];
  byToken: TokenSlice[];
}

const CACHE_TTL_MS = 60_000; // 60 seconds

const PIE_COLORS = ['#8b5cf6', '#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#06b6d4'];

// ---------------------------------------------------------------------------
// Gauge component
// ---------------------------------------------------------------------------

interface UtilizationGaugeProps {
  label: string;
  used: number;
  limit: number;
}

const UtilizationGauge: React.FC<UtilizationGaugeProps> = ({ label, used, limit }) => {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const color = pct >= 80 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-500' : 'bg-green-500';
  const textColor = pct >= 80 ? 'text-red-400' : pct >= 60 ? 'text-amber-400' : 'text-green-400';

  return (
    <div className="bg-gray-800/80 rounded-xl border border-gray-700 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-300">{label}</span>
        <span className={`text-sm font-bold ${textColor}`}>{pct.toFixed(1)}%</span>
      </div>
      <div className="relative h-3 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label} utilization: ${pct.toFixed(1)}%`}
        />
      </div>
      <div className="flex justify-between mt-2 text-xs text-gray-500">
        <span>{used.toLocaleString()} used</span>
        <span>{limit.toLocaleString()} limit</span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

/** Resolve the backend base URL from optional env var, falling back to same-origin */
function getApiBase(): string {
  return (import.meta.env.VITE_API_URL as string | undefined) ?? '';
}

/** Resolve the API key from optional env var */
function getApiKey(): string {
  return (import.meta.env.VITE_API_KEY as string | undefined) ?? '';
}

async function fetchSpending(): Promise<{ dailyUsed: number; weeklyUsed: number; dailyLimit: number; weeklyLimit: number }> {
  const res = await fetch(`${getApiBase()}/api/v1/analytics/spending`, {
    headers: { 'X-API-Key': getApiKey() },
  });
  if (!res.ok) throw new Error(`Spending fetch failed: ${res.status}`);
  const json = await res.json() as { data?: { dailyUsed?: number; weeklyUsed?: number; dailyLimit?: number; weeklyLimit?: number } };
  const d = json.data ?? {};
  return {
    dailyUsed: Number(d.dailyUsed ?? 0),
    weeklyUsed: Number(d.weeklyUsed ?? 0),
    dailyLimit: Number(d.dailyLimit ?? 0),
    weeklyLimit: Number(d.weeklyLimit ?? 0),
  };
}

async function fetchSpendingHistory(): Promise<SpendingHistory[]> {
  const res = await fetch(`${getApiBase()}/api/v1/analytics/spending/history?days=30`, {
    headers: { 'X-API-Key': getApiKey() },
  });
  if (!res.ok) throw new Error(`History fetch failed: ${res.status}`);
  const json = await res.json() as { data?: SpendingHistory[] };
  return json.data ?? [];
}

async function fetchSpendingByToken(): Promise<TokenSlice[]> {
  const res = await fetch(`${getApiBase()}/api/v1/analytics/spending/by-token`, {
    headers: { 'X-API-Key': getApiKey() },
  });
  if (!res.ok) throw new Error(`By-token fetch failed: ${res.status}`);
  const json = await res.json() as { data?: TokenSlice[] };
  return json.data ?? [];
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface SpendingAnalyticsProps {
  /** Optional override for testing — bypasses API fetch */
  mockData?: SpendingData;
}

const SpendingAnalytics: React.FC<SpendingAnalyticsProps> = ({ mockData }) => {
  const { showToast } = useToast();

  const [data, setData] = useState<SpendingData | null>(mockData ?? null);
  const [loading, setLoading] = useState(!mockData);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<{ data: SpendingData; fetchedAt: number } | null>(null);
  const warnedRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    if (mockData) return; // skip fetch when mock provided

    // Cache check
    if (cacheRef.current && Date.now() - cacheRef.current.fetchedAt < CACHE_TTL_MS) {
      setData(cacheRef.current.data);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [spending, history, byToken] = await Promise.all([
        fetchSpending(),
        fetchSpendingHistory(),
        fetchSpendingByToken(),
      ]);
      const result: SpendingData = { ...spending, history, byToken };
      cacheRef.current = { data: result, fetchedAt: Date.now() };
      setData(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load spending data';
      setError(msg);
      // Fall back to empty data so charts still render
      setData({ dailyUsed: 0, weeklyUsed: 0, dailyLimit: 0, weeklyLimit: 0, history: [], byToken: [] });
    } finally {
      setLoading(false);
    }
  }, [mockData]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ---------------------------------------------------------------------------
  // Utilization warning toast (once per session when > 80%)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!data || warnedRef.current) return;
    const dailyPct = data.dailyLimit > 0 ? (data.dailyUsed / data.dailyLimit) * 100 : 0;
    const weeklyPct = data.weeklyLimit > 0 ? (data.weeklyUsed / data.weeklyLimit) * 100 : 0;
    if (dailyPct > 80 || weeklyPct > 80) {
      const which = dailyPct > weeklyPct ? 'Daily' : 'Weekly';
      const pct = Math.max(dailyPct, weeklyPct).toFixed(1);
      showToast(`⚠️ ${which} spending limit at ${pct}% utilization`, 'warning');
      warnedRef.current = true;
    }
  }, [data, showToast]);

  // ---------------------------------------------------------------------------
  // Chart data: historical + 7-day forecast
  // ---------------------------------------------------------------------------

  const chartData = useMemo(() => {
    if (!data || data.history.length < 3) return [];

    const sorted = [...data.history].sort((a, b) => a.date.localeCompare(b.date));
    const points = sorted.map((d, i) => ({ x: i, y: d.amount }));
    const { slope, intercept } = linearRegression(points);
    const stdError = calculateStdError(points, slope, intercept);
    const lastX = points.length - 1;

    const historical: Record<string, unknown>[] = sorted.map((d, i) => ({
      name: d.date.slice(5), // MM-DD
      actual: d.amount,
      limit: d.dailyLimit,
      forecast: i === lastX ? d.amount : null,
    }));

    const forecast: Record<string, unknown>[] = forecastNext(7, slope, intercept, lastX).map((p, i) => ({
      name: `+${i + 1}d`,
      forecast: Math.round(p.y),
      upper: Math.round(p.y + 1.96 * stdError),
      lower: Math.round(Math.max(0, p.y - 1.96 * stdError)),
      limit: data.dailyLimit,
    }));

    return [...historical, ...forecast];
  }, [data]);

  // ---------------------------------------------------------------------------
  // Pie chart data
  // ---------------------------------------------------------------------------

  const pieData = useMemo(() => {
    if (!data?.byToken?.length) return [];
    return data.byToken.map(t => ({ name: t.token, value: t.amount }));
  }, [data]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-4 animate-pulse h-40" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-amber-400 text-sm flex items-center gap-2">
          <AlertCircle size={16} />
          {error} — showing cached or empty data.
        </div>
      )}

      {/* Utilization Gauges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <UtilizationGauge label="Daily Limit" used={data?.dailyUsed ?? 0} limit={data?.dailyLimit ?? 0} />
        <UtilizationGauge label="Weekly Limit" used={data?.weeklyUsed ?? 0} limit={data?.weeklyLimit ?? 0} />
      </div>

      {/* Daily Spend vs Limit Area Chart + Forecast */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-semibold text-white flex items-center gap-2">
            <TrendingUp size={18} className="text-purple-400" />
            Daily Spend vs Limit (30d + 7d forecast)
          </h4>
          <button
            onClick={fetchData}
            className="text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 bg-gray-700 rounded-lg"
          >
            Refresh
          </button>
        </div>
        {chartData.length < 3 ? (
          <p className="text-center text-gray-500 py-12">Insufficient data for chart</p>
        ) : (
          <div className="h-64 w-full" data-testid="spending-area-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                <XAxis dataKey="name" stroke="#4b5563" fontSize={10} tickLine={false} />
                <YAxis stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', fontSize: '12px' }}
                />
                {(data?.dailyLimit ?? 0) > 0 && (
                  <ReferenceLine y={data!.dailyLimit} stroke="#ef4444" strokeDasharray="4 4"
                    label={{ position: 'right', value: 'Limit', fill: '#ef4444', fontSize: 10 }} />
                )}
                <Area type="monotone" dataKey="actual" stroke="#8b5cf6" strokeWidth={2} fill="url(#spendGradient)" name="Actual" />
                <Line type="monotone" dataKey="forecast" stroke="#22c55e" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Forecast" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        {/* Legend */}
        <div className="flex justify-center gap-6 mt-4">
          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-purple-500" /><span className="text-xs text-gray-500 uppercase font-bold">Actual</span></div>
          <div className="flex items-center gap-2"><div className="w-3 h-0.5 bg-green-500" style={{ borderTop: '2px dashed' }} /><span className="text-xs text-gray-500 uppercase font-bold">Forecast</span></div>
          <div className="flex items-center gap-2"><div className="w-3 h-0.5 bg-red-500" style={{ borderTop: '2px dashed' }} /><span className="text-xs text-gray-500 uppercase font-bold">Limit</span></div>
        </div>
      </div>

      {/* By-Token Pie Chart */}
      {pieData.length > 0 && (
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h4 className="font-semibold text-white flex items-center gap-2 mb-4">
            <DollarSign size={18} className="text-amber-400" />
            Spending by Token
          </h4>
          <div className="h-64 w-full" data-testid="spending-pie-chart">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={90} dataKey="value" nameKey="name" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => v.toLocaleString()} contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', fontSize: '12px' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
};

export default SpendingAnalytics;
