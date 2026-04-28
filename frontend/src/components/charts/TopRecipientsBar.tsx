import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { RecipientBar } from '../../utils/analyticsAggregation';

interface Props {
  data: RecipientBar[];
  height?: number;
}

interface TooltipPayload {
  value: number;
  payload: RecipientBar;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayload[];
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const { address, total, count } = payload[0].payload;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm max-w-xs">
      <p className="text-gray-400 truncate">{address}</p>
      <p className="text-white font-semibold">{total.toLocaleString()} XLM</p>
      <p className="text-gray-500">{count} transaction{count !== 1 ? 's' : ''}</p>
    </div>
  );
};

const truncateAddr = (addr: string) =>
  addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;

const TopRecipientsBar: React.FC<Props> = ({ data, height = 260 }) => {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-gray-500 text-sm" style={{ height }}>
        No recipient data in this range
      </div>
    );
  }

  const chartData = data.map((d) => ({ ...d, label: truncateAddr(d.address) }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="label"
          stroke="#9ca3af"
          tick={{ fill: '#9ca3af', fontSize: 11 }}
          angle={-20}
          textAnchor="end"
        />
        <YAxis stroke="#9ca3af" tick={{ fill: '#9ca3af', fontSize: 11 }} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="total" name="Total received" fill="#818cf8" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
};

export default TopRecipientsBar;
