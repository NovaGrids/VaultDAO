import React from 'react';
import { X, Settings } from 'lucide-react';
import LineChart from '../charts/LineChart';
import BarChart from '../charts/BarChart';
import PieChart from '../charts/PieChart';
import type { WidgetConfig } from '../../types/dashboard';

interface ChartWidgetProps {
  widget: WidgetConfig;
  onRemove?: () => void;
  onConfigure?: () => void;
  onDrillDown?: (data: unknown) => void;
  isEditMode?: boolean;
}

const ChartWidget: React.FC<ChartWidgetProps> = ({ widget, onRemove, onConfigure, onDrillDown, isEditMode }) => {
  const { type, title, config } = widget;
  const data = (config.data as Record<string, unknown>[]) || [];

  const handleClick = (e: unknown) => {
    if (onDrillDown && !isEditMode) {
      onDrillDown(e);
    }
  };

  return (
    <div className="h-full bg-gray-800 border border-gray-700 rounded-lg p-4 flex flex-col">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {isEditMode && (
          <div className="flex gap-2">
            <button onClick={onConfigure} className="p-1 hover:bg-gray-700 rounded">
              <Settings className="w-4 h-4 text-gray-400" />
            </button>
            <button onClick={onRemove} className="p-1 hover:bg-gray-700 rounded">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0" onClick={handleClick}>
        {type === 'line-chart' && (
          <LineChart
            data={data}
            series={(config.series as { dataKey: string; name: string; color?: string }[]) || []}
            xKey={(config.xKey as string) || 'name'}
            height={200}
          />
        )}
        {type === 'bar-chart' && (
          <BarChart
            data={data}
            series={(config.series as { dataKey: string; name: string; color?: string }[]) || []}
            xKey={(config.xKey as string) || 'name'}
            height={200}
          />
        )}
        {type === 'pie-chart' && (
          <PieChart
            data={data as { name: string; value: number }[]}
            height={200}
          />
        )}
      </div>
    </div>
  );
};

export default ChartWidget;
