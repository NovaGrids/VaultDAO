import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface BarChartWidgetProps {
  title: string;
  data?: Record<string, unknown>[];
  onDrillDown?: (data: Record<string, unknown>) => void;
}

const BarChartWidget: React.FC<BarChartWidgetProps> = ({ title, data = [], onDrillDown }) => {
  const defaultData = [
    { name: 'Transfers', value: 12 },
    { name: 'Payments', value: 8 },
    { name: 'Governance', value: 5 },
    { name: 'Other', value: 3 },
  ];

  const chartData = data.length > 0 ? data : defaultData;

  return (
    <div className="h-full flex flex-col">
      <h3 className="text-sm font-semibold text-white mb-2">{title}</h3>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} onClick={onDrillDown}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="name" stroke="#9CA3AF" />
          <YAxis stroke="#9CA3AF" />
          <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }} />
          <Bar dataKey="value" fill="#8B5CF6" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default BarChartWidget;
