/**
 * DashboardBuilder
 *
 * Standardized on react-grid-layout for resizable, draggable widget positioning.
 * Layout is persisted to localStorage keyed by walletAddress + "dashboard_layout".
 * Layout changes are debounced 500ms before writing.
 * Each widget is wrapped in DashboardErrorBoundary.
 * WidgetLibrary slides in from the right.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import GridLayout, { type Layout as GridLayoutType } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { Edit3, Save, Download, X, Package, RotateCcw, PanelRight } from 'lucide-react';
import WidgetLibrary from './WidgetLibrary';
import WidgetSystem from './WidgetSystem';
import LineChartWidget from './widgets/LineChartWidget';
import BarChartWidget from './widgets/BarChartWidget';
import PieChartWidget from './widgets/PieChartWidget';
import StatCardWidget from './widgets/StatCardWidget';
import ProposalListWidget from './widgets/ProposalListWidget';
import CalendarWidget from './widgets/CalendarWidget';
import DashboardErrorBoundary from './DashboardErrorBoundary';
import type { WidgetConfig, WidgetType, LayoutItem as DashboardLayoutItem } from '../types/dashboard';
import { dashboardTemplates, saveDashboardLayout, loadDashboardLayout, clearDashboardLayout } from '../utils/dashboardTemplates';
import { useWallet } from '../hooks/useWallet';

interface DashboardBuilderProps {
  initialWidgets?: WidgetConfig[];
}

const COLS = 12;
const ROW_HEIGHT = 80;
const WIDGET_STORAGE_KEY = 'vaultdao-dashboard-widgets';

function renderWidgetContent(widget: WidgetConfig, onDrillDown: (data: unknown) => void): React.ReactNode {
  switch (widget.type) {
    case 'line-chart': return <LineChartWidget title={widget.title} onDrillDown={onDrillDown} />;
    case 'bar-chart': return <BarChartWidget title={widget.title} onDrillDown={onDrillDown} />;
    case 'pie-chart': return <PieChartWidget title={widget.title} onDrillDown={onDrillDown} />;
    case 'stat-card': return <StatCardWidget title={widget.title} value="0" />;
    case 'proposal-list': return <ProposalListWidget title={widget.title} />;
    case 'calendar': return <CalendarWidget title={widget.title} />;
    default: return <div className="flex items-center justify-center h-full text-gray-500 text-sm">Unknown widget</div>;
  }
}

/** Convert persisted layout items to react-grid-layout layout */
function toRGLLayout(items: DashboardLayoutItem[]): GridLayoutType {
  return items.map((item) => ({
    i: item.i,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    minW: item.minW ?? 2,
    minH: item.minH ?? 2,
  }));
}

/** Convert react-grid-layout layout back to persisted items */
function fromRGLLayout(layout: GridLayoutType): DashboardLayoutItem[] {
  return layout.map((item) => ({
    i: item.i,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    minW: item.minW,
    minH: item.minH,
  }));
}

/** Default layout for a widget not in any template */
function defaultLayoutItem(widgetId: string, index: number): DashboardLayoutItem {
  return {
    i: widgetId,
    x: (index * 4) % COLS,
    y: Math.floor(index / 3) * 4,
    w: 4,
    h: 4,
    minW: 2,
    minH: 2,
  };
}

const DashboardBuilder: React.FC<DashboardBuilderProps> = ({ initialWidgets = [] }) => {
  const { address: walletAddress } = useWallet();
  const [editMode, setEditMode] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showWidgetSystem, setShowWidgetSystem] = useState(false);
  const [drillDownData, setDrillDownData] = useState<{ widget: string; data: unknown } | null>(null);
  const [exportingFormat, setExportingFormat] = useState<'png' | 'pdf' | null>(null);
  const dashboardRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [widgets, setWidgets] = useState<WidgetConfig[]>(() => {
    try {
      const stored = localStorage.getItem(WIDGET_STORAGE_KEY);
      return stored ? JSON.parse(stored) : initialWidgets;
    } catch {
      return initialWidgets;
    }
  });

  const [layout, setLayout] = useState<GridLayoutType>(() => {
    try {
      const saved = loadDashboardLayout(walletAddress ?? undefined) as { layout?: DashboardLayoutItem[] } | null;
      if (saved?.layout) return toRGLLayout(saved.layout);
    } catch {
      /* ignore */
    }
    const tpl = dashboardTemplates[0];
    if (tpl) return toRGLLayout(tpl.layout.layout);
    return [];
  });

  useEffect(() => {
    if (!walletAddress) return;
    try {
      const saved = loadDashboardLayout(walletAddress) as { layout?: DashboardLayoutItem[] } | null;
      if (saved?.layout) {
        setLayout(toRGLLayout(saved.layout));
        return;
      }
    } catch {
      /* ignore */
    }
    const tpl = dashboardTemplates[0];
    if (tpl) setLayout(toRGLLayout(tpl.layout.layout));
  }, [walletAddress]);

  const persistLayout = useCallback(
    (newLayout: GridLayoutType, newWidgets: WidgetConfig[]) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(newWidgets));
        saveDashboardLayout(
          { layout: fromRGLLayout(newLayout), widgets: newWidgets },
          walletAddress ?? undefined,
        );
      }, 500);
    },
    [walletAddress],
  );

  const handleLayoutChange = useCallback(
    (newLayout: GridLayoutType) => {
      setLayout(newLayout);
      persistLayout(newLayout, widgets);
    },
    [widgets, persistLayout],
  );

  const addWidget = useCallback(
    (type: WidgetType) => {
      const id = `widget-${Date.now()}`;
      const newWidget: WidgetConfig = {
        id,
        type,
        title: type.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      };
      const newLayoutItem = defaultLayoutItem(id, widgets.length);
      setWidgets((prev) => {
        const updated = [...prev, newWidget];
        const nextLayout = [...layout, ...toRGLLayout([newLayoutItem])];
        persistLayout(nextLayout, updated);
        return updated;
      });
      setLayout((prev) => [...prev, ...toRGLLayout([newLayoutItem])]);
      setShowLibrary(false);
    },
    [widgets.length, layout, persistLayout],
  );

  const removeWidget = useCallback(
    (id: string) => {
      setWidgets((prev) => {
        const updated = prev.filter((w) => w.id !== id);
        const newLayout = layout.filter((l) => l.i !== id);
        persistLayout(newLayout, updated);
        return updated;
      });
      setLayout((prev) => prev.filter((l) => l.i !== id));
    },
    [layout, persistLayout],
  );

  const handleSave = useCallback(() => {
    localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(widgets));
    saveDashboardLayout({ layout: fromRGLLayout(layout), widgets }, walletAddress ?? undefined);
    setEditMode(false);
  }, [layout, widgets, walletAddress]);

  const handleReset = useCallback(() => {
    clearDashboardLayout(walletAddress ?? undefined);
    localStorage.removeItem(WIDGET_STORAGE_KEY);
    const tpl = dashboardTemplates[0];
    if (tpl) {
      setWidgets(tpl.layout.widgets);
      setLayout(toRGLLayout(tpl.layout.layout));
    }
  }, [walletAddress]);

  const loadTemplate = useCallback(
    (templateId: string) => {
      const tpl = dashboardTemplates.find((t) => t.id === templateId);
      if (tpl) {
        setWidgets(tpl.layout.widgets);
        const nextLayout = toRGLLayout(tpl.layout.layout);
        setLayout(nextLayout);
        persistLayout(nextLayout, tpl.layout.widgets);
        setShowTemplates(false);
      }
    },
    [persistLayout],
  );

  const exportDashboard = useCallback(
    async (format: 'png' | 'pdf') => {
      if (!dashboardRef.current || exportingFormat) return;
      setExportingFormat(format);
      try {
        const { default: html2canvas } = await import('html2canvas');
        const canvas = await html2canvas(dashboardRef.current);
        if (format === 'png') {
          const link = document.createElement('a');
          link.download = `dashboard-${Date.now()}.png`;
          link.href = canvas.toDataURL();
          link.click();
        } else {
          const { default: jsPDF } = await import('jspdf');
          const pdf = new jsPDF('l', 'mm', 'a4');
          const imgData = canvas.toDataURL('image/png');
          const w = pdf.internal.pageSize.getWidth();
          const h = (canvas.height * w) / canvas.width;
          pdf.addImage(imgData, 'PNG', 0, 0, w, h);
          pdf.save(`dashboard-${Date.now()}.pdf`);
        }
      } finally {
        setExportingFormat(null);
      }
    },
    [exportingFormat],
  );

  const safeLayout: GridLayoutType = widgets.map((w, i) => {
    const existing = layout.find((l) => l.i === w.id);
    return existing ?? defaultLayoutItem(w.id, i);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-800 rounded-lg border border-gray-700 p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => (editMode ? handleSave() : setEditMode(true))}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm ${editMode ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          >
            <Edit3 className="h-4 w-4" />
            {editMode ? 'Save Layout' : 'Edit Layout'}
          </button>
          {editMode && (
            <>
              <button
                onClick={() => setShowLibrary(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm"
              >
                <Package className="h-4 w-4" />
                Add Widget
              </button>
              <button
                onClick={() => setShowTemplates(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm"
              >
                Templates
              </button>
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
            </>
          )}
          <button
            onClick={() => exportDashboard('png')}
            disabled={!!exportingFormat}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {exportingFormat === 'png' ? 'Exporting…' : 'PNG'}
          </button>
          <button
            onClick={() => setShowWidgetSystem(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm"
          >
            <PanelRight className="h-4 w-4" />
            Widget System
          </button>
        </div>
      </div>

      {showTemplates && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-300">Dashboard Templates</h3>
            <button onClick={() => setShowTemplates(false)} className="text-gray-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {dashboardTemplates.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => loadTemplate(tpl.id)}
                className="text-left p-3 rounded-lg border border-gray-600 hover:border-purple-500 hover:bg-gray-700/50 transition-colors"
              >
                <p className="font-medium text-white text-sm">{tpl.name}</p>
                <p className="text-xs text-gray-400 mt-1">{tpl.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {showLibrary && (
        <div className="fixed inset-y-0 right-0 z-50 w-80 bg-gray-900 border-l border-gray-700 shadow-xl flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-gray-700">
            <h3 className="font-medium text-white">Widget Library</h3>
            <button onClick={() => setShowLibrary(false)} className="text-gray-400 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <WidgetLibrary onAddWidget={addWidget} />
          </div>
        </div>
      )}

      <div ref={dashboardRef} className="bg-gray-900 rounded-lg border border-gray-700 p-2 min-h-[400px]">
        {widgets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-gray-400 mb-4">No widgets yet. Click &quot;Edit Layout&quot; → &quot;Add Widget&quot; to get started.</p>
          </div>
        ) : (
          <GridLayout
            className="layout"
            layout={safeLayout}
            cols={COLS}
            rowHeight={ROW_HEIGHT}
            width={1200}
            isDraggable={editMode}
            isResizable={editMode}
            onLayoutChange={handleLayoutChange}
            draggableHandle=".drag-handle"
            margin={[8, 8]}
          >
            {widgets.map((widget) => (
              <div key={widget.id} className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden flex flex-col">
                {editMode && (
                  <div className="flex items-center justify-between px-3 py-1.5 bg-gray-700/50 border-b border-gray-700 flex-shrink-0">
                    <span className="drag-handle cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-200 text-xs select-none flex items-center gap-1">
                      ⠿ {widget.title}
                    </span>
                    <button
                      onClick={() => removeWidget(widget.id)}
                      aria-label={`Remove ${widget.title}`}
                      className="p-0.5 hover:bg-gray-600 rounded text-red-400 hover:text-red-300"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <div className="flex-1 min-h-0 p-2">
                  <DashboardErrorBoundary widgetTitle={widget.title}>
                    {renderWidgetContent(widget, (data) => setDrillDownData({ widget: widget.title, data }))}
                  </DashboardErrorBoundary>
                </div>
              </div>
            ))}
          </GridLayout>
        )}
      </div>

      {drillDownData && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-300">Drill-down: {drillDownData.widget}</h3>
            <button onClick={() => setDrillDownData(null)} className="text-gray-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <pre className="text-xs text-gray-400 overflow-auto max-h-40">{JSON.stringify(drillDownData.data, null, 2)}</pre>
        </div>
      )}

      {showWidgetSystem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-gray-900 rounded-xl border border-gray-700 max-w-2xl w-full max-h-[80vh] overflow-y-auto p-4 relative">
            <button
              type="button"
              onClick={() => setShowWidgetSystem(false)}
              className="absolute top-3 right-3 text-gray-400 hover:text-white"
              aria-label="Close widget system"
            >
              <X className="h-5 w-5" />
            </button>
            <WidgetSystem />
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardBuilder;
