import React from 'react';
import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

const COLORS = { created: '#818cf8', approved: '#34d399', executed: '#22c55e' };

export interface LineChartSeries {
  dataKey: string;
  name: string;
  color?: string;
}

export interface LineChartProps {
  data: Record<string, unknown>[];
  series: LineChartSeries[];
  xKey: string;
  height?: number;
  title?: string;
}

const LineChart: React.FC<LineChartProps> = ({
  data,
  series,
  xKey,
  height = 280,
  title,
}) => {
  return (
    <div className="w-full" style={{ minHeight: height }}>
      {title && (
        <h3 className="text-sm font-medium text-gray-300 mb-2">{title}</h3>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <RechartsLineChart
          data={data}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey={xKey}
            stroke="#9ca3af"
            tick={{ fill: '#9ca3af', fontSize: 11 }}
            tickFormatter={(v: unknown) => (v && String(v).length > 10 ? String(v).slice(0, 7) : String(v))}
          />
          <YAxis stroke="#9ca3af" tick={{ fill: '#9ca3af', fontSize: 11 }} />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1f2937',
              border: '1px solid #374151',
              borderRadius: '8px',
            }}
            labelStyle={{ color: '#e5e7eb' }}
            formatter={(value: number | undefined) => [value ?? 0, undefined]}
          />
          <Legend
            wrapperStyle={{ fontSize: 12 }}
            formatter={(value: string) => <span className="text-gray-400">{value}</span>}
          />
          {series.map((s) => (
            <Line
              key={s.dataKey}
              type="monotone"
              dataKey={s.dataKey}
              name={s.name}
              stroke={s.color ?? COLORS[s.dataKey as keyof typeof COLORS] ?? '#818cf8'}
              strokeWidth={2}
              dot={{ r: 3, fill: '#1f2937' }}
              connectNulls
            />
          ))}
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default LineChart;