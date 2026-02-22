import React from 'react';
import { X, Settings } from 'lucide-react';
import type { WidgetConfig } from '../../types/dashboard';

interface StatCardWidgetProps {
  widget: WidgetConfig;
  onRemove?: () => void;
  onConfigure?: () => void;
  isEditMode?: boolean;
}

const StatCardWidget: React.FC<StatCardWidgetProps> = ({ widget, onRemove, onConfigure, isEditMode }) => {
  const { title, config } = widget;
  const IconComponent = config.icon as React.ComponentType<{ className?: string }> | undefined;

  const renderIcon = () => {
    if (!IconComponent) return <div className="w-8 h-8" />;
    return <IconComponent className="w-8 h-8 text-purple-400" />;
  };

  return (
    <div className="h-full bg-gray-800 border border-gray-700 rounded-lg p-4 flex flex-col">
      {isEditMode && (
        <div className="flex justify-end gap-2 mb-2">
          <button onClick={onConfigure} className="p-1 hover:bg-gray-700 rounded">
            <Settings className="w-4 h-4 text-gray-400" />
          </button>
          <button onClick={onRemove} className="p-1 hover:bg-gray-700 rounded">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>
      )}
      <div className="flex items-center gap-3 flex-1">
        {renderIcon()}
        <div>
          <p className="text-sm text-gray-400">{title}</p>
          <p className="text-2xl font-bold text-white">{String(config.value || '')}</p>
          {config.subtitle ? <p className="text-xs text-gray-500">{String(config.subtitle)}</p> : null}
        </div>
      </div>
    </div>
  );
};

export default StatCardWidget;
