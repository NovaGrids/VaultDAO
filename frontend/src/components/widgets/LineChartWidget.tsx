import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface LineChartWidgetProps {
  title: string;
  data?: Record<string, unknown>[];
  onDrillDown?: (data: Record<string, unknown>) => void;
}

const LineChartWidget: React.FC<LineChartWidgetProps> = ({ title, data = [], onDrillDown }) => {
  const defaultData = [
    { name: 'Jan', value: 4000 },
    { name: 'Feb', value: 3000 },
    { name: 'Mar', value: 5000 },
    { name: 'Apr', value: 4500 },
    { name: 'May', value: 6000 },
    { name: 'Jun', value: 5500 },
  ];

  const chartData = data.length > 0 ? data : defaultData;

  return (
    <div className="h-full flex flex-col">
      <h3 className="text-sm font-semibold text-white mb-2">{title}</h3>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} onClick={onDrillDown}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="name" stroke="#9CA3AF" />
          <YAxis stroke="#9CA3AF" />
          <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }} />
          <Line type="monotone" dataKey="value" stroke="#8B5CF6" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default LineChartWidget;
