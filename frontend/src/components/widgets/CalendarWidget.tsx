import React from 'react';
import { X, Settings } from 'lucide-react';
import type { WidgetConfig } from '../../types/dashboard';

interface CalendarWidgetProps {
  widget: WidgetConfig;
  onRemove?: () => void;
  onConfigure?: () => void;
  isEditMode?: boolean;
}

const CalendarWidget: React.FC<CalendarWidgetProps> = ({ widget, onRemove, onConfigure, isEditMode }) => {
  const { title, config } = widget;
  const events = (config.events as { date: string; title: string }[]) || [];

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
      <div className="flex-1 overflow-y-auto space-y-2">
        {events.map((e, i) => (
          <div key={i} className="p-2 bg-gray-900 rounded border border-gray-700">
            <p className="text-xs text-gray-400">{e.date}</p>
            <p className="text-sm text-white">{e.title}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CalendarWidget;
