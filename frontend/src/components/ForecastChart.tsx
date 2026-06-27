import React, { useState, useMemo } from 'react';
import { 
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, ReferenceLine 
} from 'recharts';
import { TrendingUp, Calendar } from 'lucide-react';
import { linearRegression, forecastNext, calculateStdError } from '../utils/forecasting';

interface ForecastChartProps {
  historicalData: { date: string; amount: number }[];
  forecastDays?: number;
  dailyLimit?: number;
  weeklyLimit?: number;
}

const ForecastChart: React.FC<ForecastChartProps> = ({ 
  historicalData, forecastDays = 30, dailyLimit, weeklyLimit 
}) => {
  const [windowDays, setWindowDays] = useState(30);

  const chartData = useMemo(() => {
    if (historicalData.length < 3) return [];

    const now = new Date();
    const cutoff = new Date();
    cutoff.setDate(now.getDate() - windowDays);

    const filtered = historicalData
      .filter(d => new Date(d.date) >= cutoff)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (filtered.length < 3) return [];

    const points = filtered.map((d, i) => ({ x: i, y: d.amount }));
    const { slope, intercept } = linearRegression(points);
    const stdError = calculateStdError(points, slope, intercept);
    const lastX = points.length - 1;

    const historical = filtered.map((d, i) => ({
      name: d.date.split('T')[0],
      historical: d.amount,
      forecast: i === lastX ? d.amount : null,
    }));

    const forecast = forecastNext(forecastDays, slope, intercept, lastX).map((p, i) => ({
      name: `Forecast +${i + 1}d`,
      forecast: p.y,
      upper: p.y + 1.96 * stdError,
      lower: Math.max(0, p.y - 1.96 * stdError),
    }));

    return [...historical, ...forecast];
  }, [historicalData, windowDays, forecastDays]);

  if (historicalData.length < 3) {
    return (
      <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-white/5 rounded-2xl bg-gray-900/20">
        <TrendingUp className="text-gray-700 mb-2" size={32} />
        <p className="text-gray-500 font-medium">Insufficient data for forecasting</p>
        <p className="text-xs text-gray-600 mt-1">Need at least 3 historical points</p>
      </div>
    );
  }

  return (
    <div className="p-6 rounded-2xl bg-gray-900/50 border border-white/5 backdrop-blur-xl">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <TrendingUp size={20} className="text-purple-400" />
            Spending Forecast
          </h3>
          <p className="text-xs text-gray-500 mt-1">Linear regression trend analysis</p>
        </div>
        
        <div className="flex bg-black/40 p-1 rounded-lg border border-white/5">
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setWindowDays(d)}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                windowDays === d ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {d}D
            </button>
          ))}
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
            <XAxis dataKey="name" hide />
            <YAxis stroke="#4b5563" fontSize={10} tickLine={false} axisLine={false} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', fontSize: '12px' }}
              itemStyle={{ fontWeight: 'bold' }}
            />
            {dailyLimit && <ReferenceLine y={dailyLimit} stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'right', value: 'Daily', fill: '#ef4444', fontSize: 10 }} />}
            {weeklyLimit && <ReferenceLine y={weeklyLimit} stroke="#f59e0b" strokeDasharray="3 3" label={{ position: 'right', value: 'Weekly', fill: '#f59e0b', fontSize: 10 }} />}
            <Area type="monotone" dataKey="upper" stroke="none" fill="#8b5cf6" fillOpacity={0.1} />
            <Area type="monotone" dataKey="lower" stroke="none" fill="#8b5cf6" fillOpacity={0.1} />
            <Area type="monotone" dataKey="historical" stroke="#22c55e" strokeWidth={2} fill="url(#areaGradient)" />
            <Line type="monotone" dataKey="forecast" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="5 5" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex justify-center gap-6 mt-6">
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-green-500" /><span className="text-[10px] font-bold text-gray-500 uppercase">Actual</span></div>
        <div className="flex items-center gap-2"><div className="w-3 h-0.5 bg-purple-500 border-dashed" style={{ borderTop: '2px dashed' }} /><span className="text-[10px] font-bold text-gray-500 uppercase">Forecast</span></div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-purple-500/20" /><span className="text-[10px] font-bold text-gray-500 uppercase">Confidence</span></div>
      </div>
    </div>
  );
};

export default ForecastChart;
