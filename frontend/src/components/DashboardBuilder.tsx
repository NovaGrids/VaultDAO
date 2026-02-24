import React, { useState, useRef } from 'react';
import { Edit3, Save, Download, Grid3x3, X } from 'lucide-react';
import WidgetLibrary from './WidgetLibrary';
import LineChartWidget from './widgets/LineChartWidget';
import BarChartWidget from './widgets/BarChartWidget';
import PieChartWidget from './widgets/PieChartWidget';
import StatCardWidget from './widgets/StatCardWidget';
import ProposalListWidget from './widgets/ProposalListWidget';
import CalendarWidget from './widgets/CalendarWidget';
import type { WidgetConfig, WidgetType } from '../types/dashboard';
import { saveDashboardLayout, dashboardTemplates } from '../utils/dashboardTemplates';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

interface DashboardBuilderProps {
  initialWidgets?: WidgetConfig[];
}

const DashboardBuilder: React.FC<DashboardBuilderProps> = ({ initialWidgets = [] }) => {
  const [editMode, setEditMode] = useState(false);
  const [widgets, setWidgets] = useState<WidgetConfig[]>(initialWidgets);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [drillDownData, setDrillDownData] = useState<{ widget: string; data: unknown } | null>(null);
  const dashboardRef = useRef<HTMLDivElement>(null);

  const renderWidget = (widget: WidgetConfig) => {
    const handleDrillDown = (data: unknown) => {
      setDrillDownData({ widget: widget.title, data });
    };

    switch (widget.type) {
      case 'line-chart':
        return <LineChartWidget title={widget.title} onDrillDown={handleDrillDown} />;
      case 'bar-chart':
        return <BarChartWidget title={widget.title} onDrillDown={handleDrillDown} />;
      case 'pie-chart':
        return <PieChartWidget title={widget.title} onDrillDown={handleDrillDown} />;
      case 'stat-card':
        return <StatCardWidget title={widget.title} value="0" />;
      case 'proposal-list':
        return <ProposalListWidget title={widget.title} />;
      case 'calendar':
        return <CalendarWidget title={widget.title} />;
      default:
        return <div>Unknown widget</div>;
    }
  };

  const addWidget = (type: WidgetType) => {
    const id = `widget-${Date.now()}`;
    const newWidget: WidgetConfig = {
      id,
      type,
      title: type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    };

    setWidgets([...widgets, newWidget]);
    setShowLibrary(false);
  };

  const removeWidget = (id: string) => {
    setWidgets(widgets.filter(w => w.id !== id));
  };

  const handleSaveLayout = () => {
    saveDashboardLayout({ widgets });
    setEditMode(false);
  };

  const loadTemplate = (templateId: string) => {
    const template = dashboardTemplates.find(t => t.id === templateId);
    if (template) {
      setWidgets(template.layout.widgets);
      setShowTemplates(false);
    }
  };

  const exportDashboard = async (format: 'png' | 'pdf') => {
    if (!dashboardRef.current) return;

    const canvas = await html2canvas(dashboardRef.current);
    
    if (format === 'png') {
      const link = document.createElement('a');
      link.download = `dashboard-${Date.now()}.png`;
      link.href = canvas.toDataURL();
      link.click();
    } else {
      const pdf = new jsPDF('l', 'mm', 'a4');
      const imgData = canvas.toDataURL('image/png');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`dashboard-${Date.now()}.pdf`);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-800 rounded-lg border border-gray-700 p-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => editMode ? handleSaveLayout() : setEditMode(true)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              editMode ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {editMode ? <Save className="h-4 w-4" /> : <Edit3 className="h-4 w-4" />}
            <span className="text-sm">{editMode ? 'Save' : 'Edit'}</span>
          </button>
          {editMode && (
            <>
              <button
                onClick={() => setShowLibrary(!showLibrary)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
              >
                <Grid3x3 className="h-4 w-4" />
                <span className="text-sm">Add Widget</span>
              </button>
              <button
                onClick={() => setShowTemplates(!showTemplates)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
              >
                <Grid3x3 className="h-4 w-4" />
                <span className="text-sm">Templates</span>
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportDashboard('png')}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
          >
            <Download className="h-4 w-4" />
            <span className="text-sm">PNG</span>
          </button>
          <button
            onClick={() => exportDashboard('pdf')}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
          >
            <Download className="h-4 w-4" />
            <span className="text-sm">PDF</span>
          </button>
        </div>
      </div>

      {/* Widget Library */}
      {showLibrary && editMode && (
        <WidgetLibrary onAddWidget={addWidget} />
      )}

      {/* Templates */}
      {showTemplates && editMode && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-white mb-3">Dashboard Templates</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {dashboardTemplates.map((template) => (
              <button
                key={template.id}
                onClick={() => loadTemplate(template.id)}
                className="text-left p-4 bg-gray-900 rounded-lg border border-gray-700 hover:border-purple-500 transition-colors"
              >
                <p className="text-sm font-medium text-white">{template.name}</p>
                <p className="text-xs text-gray-400 mt-1">{template.description}</p>
                <p className="text-xs text-purple-400 mt-2">Role: {template.role}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Dashboard Grid */}
      <div ref={dashboardRef} className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {widgets.map((widget) => (
            <div key={widget.id} className="bg-gray-800 rounded-lg border border-gray-700 p-3 min-h-[300px]">
              {editMode && (
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500">Widget</span>
                  <button
                    onClick={() => removeWidget(widget.id)}
                    className="p-1 hover:bg-gray-700 rounded text-red-400"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
              {renderWidget(widget)}
            </div>
          ))}
        </div>
      </div>

      {/* Drill-down Modal */}
      {drillDownData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-gray-700 bg-gray-900 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-white">{drillDownData.widget} - Details</h3>
              <button
                onClick={() => setDrillDownData(null)}
                className="p-1 hover:bg-gray-700 rounded text-gray-400"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="text-gray-300">
              <pre className="bg-gray-800 p-4 rounded-lg overflow-auto">
                {JSON.stringify(drillDownData.data, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardBuilder;
