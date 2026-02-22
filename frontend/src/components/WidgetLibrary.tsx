import React from 'react';
import { BarChart3, LineChart as LineChartIcon, PieChart as PieChartIcon, Activity, FileText, Calendar } from 'lucide-react';
import type { WidgetType } from '../types/dashboard';

interface WidgetLibraryProps {
  onAddWidget: (type: WidgetType) => void;
}

const widgets = [
  { type: 'line-chart' as WidgetType, name: 'Line Chart', icon: LineChartIcon },
  { type: 'bar-chart' as WidgetType, name: 'Bar Chart', icon: BarChart3 },
  { type: 'pie-chart' as WidgetType, name: 'Pie Chart', icon: PieChartIcon },
  { type: 'stat-card' as WidgetType, name: 'Stat Card', icon: Activity },
  { type: 'proposal-list' as WidgetType, name: 'Proposal List', icon: FileText },
  { type: 'calendar' as WidgetType, name: 'Calendar', icon: Calendar },
];

const WidgetLibrary: React.FC<WidgetLibraryProps> = ({ onAddWidget }) => {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-white mb-3">Widget Library</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {widgets.map((w) => (
          <button
            key={w.type}
            onClick={() => onAddWidget(w.type)}
            className="p-3 bg-gray-900 border border-gray-700 rounded-lg hover:border-purple-500 transition-colors flex flex-col items-center gap-2"
          >
            <w.icon className="w-6 h-6 text-purple-400" />
            <span className="text-xs text-gray-300">{w.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default WidgetLibrary;
