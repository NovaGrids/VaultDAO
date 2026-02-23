import React from 'react';
import { BarChart3, LineChart as LineChartIcon, PieChart as PieChartIcon, Activity, FileText, Calendar } from 'lucide-react';
import type { WidgetType } from '../types/dashboard';

interface WidgetLibraryProps {
  onAddWidget: (type: WidgetType) => void;
}

const widgetTypes = [
  { type: 'line-chart' as WidgetType, name: 'Line Chart', icon: LineChartIcon, description: 'Trend analysis' },
  { type: 'bar-chart' as WidgetType, name: 'Bar Chart', icon: BarChart3, description: 'Compare values' },
  { type: 'pie-chart' as WidgetType, name: 'Pie Chart', icon: PieChartIcon, description: 'Distribution' },
  { type: 'stat-card' as WidgetType, name: 'Stat Card', icon: Activity, description: 'Key metrics' },
  { type: 'proposal-list' as WidgetType, name: 'Proposals', icon: FileText, description: 'Recent proposals' },
  { type: 'calendar' as WidgetType, name: 'Calendar', icon: Calendar, description: 'Events & deadlines' },
];

const WidgetLibrary: React.FC<WidgetLibraryProps> = ({ onAddWidget }) => {
  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <h3 className="text-sm font-semibold text-white mb-3">Widget Library</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {widgetTypes.map((widget) => {
          const Icon = widget.icon;
          return (
            <button
              key={widget.type}
              onClick={() => onAddWidget(widget.type)}
              className="flex flex-col items-center gap-2 p-3 bg-gray-900 rounded-lg border border-gray-700 hover:border-purple-500 transition-colors text-center"
            >
              <Icon className="h-6 w-6 text-purple-400" />
              <div>
                <p className="text-xs font-medium text-white">{widget.name}</p>
                <p className="text-xs text-gray-500">{widget.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default WidgetLibrary;
