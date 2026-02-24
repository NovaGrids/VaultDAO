import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

interface PieChartWidgetProps {
  title: string;
  data?: Record<string, unknown>[];
  onDrillDown?: (data: Record<string, unknown>) => void;
}

const COLORS = ['#8B5CF6', '#EC4899', '#10B981', '#F59E0B', '#3B82F6'];

const PieChartWidget: React.FC<PieChartWidgetProps> = ({ title, data = [], onDrillDown }) => {
  const defaultData = [
    { name: 'Operations', value: 40 },
    { name: 'Development', value: 30 },
    { name: 'Marketing', value: 20 },
    { name: 'Reserve', value: 10 },
  ];

  const chartData = data.length > 0 ? data : defaultData;

  return (
    <div className="h-full flex flex-col">
      <h3 className="text-sm font-semibold text-white mb-2">{title}</h3>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart onClick={onDrillDown}>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
            outerRadius={80}
            fill="#8884d8"
            dataKey="value"
          >
            {chartData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PieChartWidget;
