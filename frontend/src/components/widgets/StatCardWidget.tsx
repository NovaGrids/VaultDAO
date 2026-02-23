import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface StatCardWidgetProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: 'up' | 'down';
  trendValue?: string;
}

const StatCardWidget: React.FC<StatCardWidgetProps> = ({ title, value, subtitle, icon: Icon, trend, trendValue }) => {
  return (
    <div className="h-full bg-gray-900 rounded-lg p-4 border border-gray-700">
      <div className="flex items-start justify-between mb-2">
        <p className="text-sm text-gray-400">{title}</p>
        {Icon && <Icon className="h-5 w-5 text-purple-400" />}
      </div>
      <p className="text-2xl font-bold text-white mb-1">{value}</p>
      {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      {trend && trendValue && (
        <div className={`text-xs mt-2 ${trend === 'up' ? 'text-green-400' : 'text-red-400'}`}>
          {trend === 'up' ? '↑' : '↓'} {trendValue}
        </div>
      )}
    </div>
  );
};

export default StatCardWidget;
