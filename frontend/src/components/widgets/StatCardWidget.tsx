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
    <div className="h-full bg-white dark:bg-gray-900 rounded-xl p-5 border border-slate-200 dark:border-gray-700 shadow-sm transition-colors">
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm font-medium text-slate-500 dark:text-gray-400">{title}</p>
        {Icon && (
          <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
            <Icon className="h-5 w-5 text-purple-600 dark:text-purple-400" />
          </div>
        )}
      </div>
      <p className="text-2xl font-bold text-slate-900 dark:text-white mb-1">{value}</p>
      {subtitle && <p className="text-xs text-slate-400 dark:text-gray-500 font-medium">{subtitle}</p>}
      {trend && trendValue && (
        <div className={`text-xs mt-3 flex items-center font-bold ${trend === 'up' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          <span className="mr-1">{trend === 'up' ? '↑' : '↓'}</span>
          {trendValue}
          <span className="ml-1 font-normal text-slate-400 dark:text-gray-500">vs last week</span>
        </div>
      )}
    </div>
  );
};

export default StatCardWidget;