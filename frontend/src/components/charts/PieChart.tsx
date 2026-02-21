import React from 'react';
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

const DEFAULT_COLORS = [
  '#818cf8',
  '#34d399',
  '#22c55e',
  '#f59e0b',
  '#ec4899',
  '#06b6d4',
  '#8b5cf6',
];

export interface PieChartSlice {
  name: string;
  value: number;
  count?: number;
}

export interface PieChartProps {
  data: PieChartSlice[];
  height?: number;
  title?: string;
  showCount?: boolean;
}

interface PieLabelProps {
  name?: string;
  percent?: number | string;
}

// Fixed: Define LegendEntry to match library expectations exactly
interface LegendEntry {
  value?: string;
  payload?: Record<string, unknown>;
}

const PieChart: React.FC<PieChartProps> = ({
  data,
  height = 280,
  title,
  showCount = false,
}) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  const withPct = data.map((d) => ({
    ...d,
    percent: total ? ((d.value / total) * 100).toFixed(1) : '0',
  }));

  return (
    <div className="w-full" style={{ minHeight: height }}>
      {title && (
        <h3 className="text-sm font-medium text-gray-300 mb-2">{title}</h3>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <RechartsPieChart>
          <Pie
            data={withPct}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={height * 0.2}
            outerRadius={height * 0.38}
            paddingAngle={2}
            label={(props: PieLabelProps) =>
              `${props.name ?? ''} ${props.percent ?? 0}%`
            }
          >
            {withPct.map((_, i) => (
              <Cell
                key={i}
                fill={DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                stroke="#1f2937"
                strokeWidth={2}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: '#1f2937',
              border: '1px solid #374151',
              borderRadius: '8px',
            }}
            formatter={(value: number | undefined, name?: string, props?: { payload?: { count?: number; percent?: string } }) => [
              showCount && props?.payload?.count != null
                ? `${value ?? 0} (${props.payload.count} tx)`
                : value ?? 0,
              name ?? '',
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 12 }}
            formatter={(value: string | undefined, entry: LegendEntry) => {
              const displayValue = value ?? entry.value ?? '';
              // Safely cast the specific payload part we need
              const payload = entry?.payload as { percent?: string | number } | undefined;
              return (
                <span className="text-gray-400">
                  {displayValue}
                  {payload?.percent != null && ` (${payload.percent}%)`}
                </span>
              );
            }}
          />
        </RechartsPieChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PieChart;