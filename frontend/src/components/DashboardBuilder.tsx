import React, { useState, useRef } from 'react';
import { Edit3, Save, Download, Plus } from 'lucide-react';
import { useReactToPrint } from 'react-to-print';
import type { WidgetConfig, DashboardLayout, WidgetType } from '../types/dashboard';
import ChartWidget from './widgets/ChartWidget';
import StatCardWidget from './widgets/StatCardWidget';
import ProposalListWidget from './widgets/ProposalListWidget';
import CalendarWidget from './widgets/CalendarWidget';
import WidgetLibrary from './WidgetLibrary';

interface DashboardBuilderProps {
  initialLayout?: DashboardLayout;
  onSave?: (layout: DashboardLayout) => void;
}

const DashboardBuilder: React.FC<DashboardBuilderProps> = ({ initialLayout, onSave }) => {
  const [isEditMode, setIsEditMode] = useState(false);
  const [widgets, setWidgets] = useState<WidgetConfig[]>(initialLayout?.widgets || []);
  const [showLibrary, setShowLibrary] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
  });

  const addWidget = (type: WidgetType) => {
    const id = `widget-${Date.now()}`;
    const newWidget: WidgetConfig = {
      id,
      type,
      title: `New ${type}`,
      config: getDefaultConfig(type),
    };

    setWidgets([...widgets, newWidget]);
    setShowLibrary(false);
  };

  const removeWidget = (id: string) => {
    setWidgets(widgets.filter((w) => w.id !== id));
  };

  const saveLayout = () => {
    const dashboardLayout: DashboardLayout = {
      id: initialLayout?.id || `layout-${Date.now()}`,
      name: initialLayout?.name || 'Custom Dashboard',
      widgets,
      layout: [],
    };
    localStorage.setItem('dashboard-layout', JSON.stringify(dashboardLayout));
    onSave?.(dashboardLayout);
    setIsEditMode(false);
  };

  const renderWidget = (widget: WidgetConfig) => {
    const props = {
      widget,
      onRemove: () => removeWidget(widget.id),
      onConfigure: () => console.log('Configure', widget.id),
      isEditMode,
    };

    switch (widget.type) {
      case 'line-chart':
      case 'bar-chart':
      case 'pie-chart':
        return <ChartWidget {...props} onDrillDown={(data) => console.log('Drill down', data)} />;
      case 'stat-card':
        return <StatCardWidget {...props} />;
      case 'proposal-list':
        return <ProposalListWidget {...props} />;
      case 'calendar':
        return <CalendarWidget {...props} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <div className="flex gap-2">
          {isEditMode && (
            <>
              <button
                onClick={() => setShowLibrary(!showLibrary)}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Widget
              </button>
              <button
                onClick={saveLayout}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                Save
              </button>
            </>
          )}
          <button
            onClick={() => setIsEditMode(!isEditMode)}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg flex items-center gap-2"
          >
            <Edit3 className="w-4 h-4" />
            {isEditMode ? 'Exit Edit' : 'Edit'}
          </button>
          <button
            onClick={handlePrint}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {showLibrary && isEditMode && <WidgetLibrary onAddWidget={addWidget} />}

      <div ref={printRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {widgets.map((widget) => (
          <div key={widget.id} className="min-h-[200px]">
            {renderWidget(widget)}
          </div>
        ))}
      </div>
    </div>
  );
};

const getDefaultConfig = (type: WidgetType): Record<string, unknown> => {
  switch (type) {
    case 'line-chart':
      return {
        data: [
          { name: 'Jan', value: 400 },
          { name: 'Feb', value: 300 },
          { name: 'Mar', value: 600 },
        ],
        series: [{ dataKey: 'value', name: 'Value', color: '#818cf8' }],
        xKey: 'name',
      };
    case 'bar-chart':
      return {
        data: [
          { name: 'A', value: 400 },
          { name: 'B', value: 300 },
          { name: 'C', value: 600 },
        ],
        series: [{ dataKey: 'value', name: 'Value', color: '#34d399' }],
        xKey: 'name',
      };
    case 'pie-chart':
      return {
        data: [
          { name: 'Category A', value: 400 },
          { name: 'Category B', value: 300 },
          { name: 'Category C', value: 300 },
        ],
      };
    case 'stat-card':
      return { value: '0', subtitle: 'No data' };
    case 'proposal-list':
      return { proposals: [] };
    case 'calendar':
      return { events: [] };
    default:
      return {};
  }
};

export default DashboardBuilder;
