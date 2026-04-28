import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { ProposalOutcome } from '../../utils/analyticsAggregation';

interface Props {
  data: ProposalOutcome[];
  height?: number;
}

const COLORS: Record<string, string> = {
  Executed: '#22c55e',
  Rejected: '#ef4444',
  Pending: '#f59e0b',
  Expired: '#6b7280',
};

interface TooltipPayload {
  name: string;
  value: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayload[];
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm">
      <p className="text-gray-400">{payload[0].name}</p>
      <p className="text-white font-semibold">{payload[0].value} proposals</p>
    </div>
  );
};

const ProposalOutcomesPie: React.FC<Props> = ({ data, height = 260 }) => {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-gray-500 text-sm" style={{ height }}>
        No proposal data in this range
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="45%"
          innerRadius={height * 0.18}
          outerRadius={height * 0.35}
          paddingAngle={3}
        >
          {data.map((entry) => (
            <Cell
              key={entry.name}
              fill={COLORS[entry.name] ?? '#818cf8'}
              stroke="#1f2937"
              strokeWidth={2}
            />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 12 }}
          formatter={(value: string) => <span className="text-gray-400">{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
};

export default ProposalOutcomesPie;
