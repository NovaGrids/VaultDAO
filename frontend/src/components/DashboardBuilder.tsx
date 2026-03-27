import React, { useState, useRef, useCallback, memo } from 'react';
import { Edit3, Save, Download, Grid3x3, X, Package, GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  arrayMove,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import WidgetLibrary from './WidgetLibrary';
import WidgetSystem from './WidgetSystem';
import LineChartWidget from './widgets/LineChartWidget';
import BarChartWidget from './widgets/BarChartWidget';
import PieChartWidget from './widgets/PieChartWidget';
import StatCardWidget from './widgets/StatCardWidget';
import ProposalListWidget from './widgets/ProposalListWidget';
import CalendarWidget from './widgets/CalendarWidget';
import type { WidgetConfig, WidgetType } from '../types/dashboard';
import { saveDashboardLayout, dashboardTemplates } from '../utils/dashboardTemplates';

interface DashboardBuilderProps {
  initialWidgets?: WidgetConfig[];
}

interface WidgetItemProps {
  widget: WidgetConfig;
  editMode: boolean;
  onRemove: (id: string) => void;
  onDrillDown: (widget: string, data: unknown) => void;
}

function renderWidgetContent(widget: WidgetConfig, onDrillDown: (data: unknown) => void): React.ReactNode {
  switch (widget.type) {
    case 'line-chart':
      return <LineChartWidget title={widget.title} onDrillDown={onDrillDown} />;
    case 'bar-chart':
      return <BarChartWidget title={widget.title} onDrillDown={onDrillDown} />;
    case 'pie-chart':
      return <PieChartWidget title={widget.title} onDrillDown={onDrillDown} />;
    case 'stat-card':
      return <StatCardWidget title={widget.title} value="0" />;
    case 'proposal-list':
      return <ProposalListWidget title={widget.title} />;
    case 'calendar':
      return <CalendarWidget title={widget.title} />;
    default:
      return <div>Unknown widget</div>;
  }
}

// Sortable wrapper used inside DndContext
const SortableWidgetItem = memo(({ widget, editMode, onRemove, onDrillDown }: WidgetItemProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const handleDrillDown = useCallback(
    (data: unknown) => onDrillDown(widget.title, data),
    [widget.title, onDrillDown]
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-gray-800 rounded-lg border border-gray-700 p-3 min-h-[300px]"
    >
      {editMode && (
        <div className="flex items-center justify-between mb-2">
          {/* Drag handle — keyboard + pointer accessible */}
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Drag handle for ${widget.title}. Use arrow keys to reorder.`}
            className={[
              'p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700 cursor-grab active:cursor-grabbing',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800',
            ].join(' ')}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <button
            onClick={() => onRemove(widget.id)}
            aria-label={`Remove ${widget.title}`}
            className="p-1 hover:bg-gray-700 rounded text-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {renderWidgetContent(widget, handleDrillDown)}
    </div>
  );
});
SortableWidgetItem.displayName = 'SortableWidgetItem';

// Static (non-sortable) version used in DragOverlay
const WidgetOverlay = memo(({ widget }: { widget: WidgetConfig }) => (
  <div className="bg-gray-800 rounded-lg border border-purple-500 p-3 min-h-[300px] shadow-2xl opacity-90 cursor-grabbing">
    <div className="flex items-center justify-between mb-2">
      <GripVertical className="h-4 w-4 text-purple-400" />
    </div>
    {renderWidgetContent(widget, () => {})}
  </div>
));
WidgetOverlay.displayName = 'WidgetOverlay';

const DashboardBuilder: React.FC<DashboardBuilderProps> = ({ initialWidgets = [] }) => {
  const [editMode, setEditMode] = useState(false);
  const [widgets, setWidgets] = useState<WidgetConfig[]>(initialWidgets);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showWidgetSystem, setShowWidgetSystem] = useState(false);
  const [drillDownData, setDrillDownData] = useState<{ widget: string; data: unknown } | null>(null);
  const [exportingFormat, setExportingFormat] = useState<'png' | 'pdf' | null>(null);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const dashboardRef = useRef<HTMLDivElement>(null);

  // Both pointer (mouse/touch) and keyboard sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = useCallback(({ active }: DragStartEvent) => {
    setActiveId(active.id);
    const widget = widgets.find((w) => w.id === active.id);
    if (widget) {
      const pos = widgets.indexOf(widget) + 1;
      setAnnouncement(`Picked up ${widget.title}, position ${pos} of ${widgets.length}.`);
    }
  }, [widgets]);

  const handleDragEnd = useCallback(({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over || active.id === over.id) {
      setAnnouncement('Drag cancelled.');
      return;
    }
    setWidgets((prev) => {
      const oldIndex = prev.findIndex((w) => w.id === active.id);
      const newIndex = prev.findIndex((w) => w.id === over.id);
      const reordered = arrayMove(prev, oldIndex, newIndex);
      const widget = reordered[newIndex];
      setAnnouncement(
        `${widget.title} moved to position ${newIndex + 1} of ${reordered.length}.`
      );
      return reordered;
    });
  }, []);

  const handleDrillDown = useCallback((widget: string, data: unknown) => {
    setDrillDownData({ widget, data });
  }, []);

  const handleRemoveWidget = useCallback((id: string) => {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const addWidget = useCallback((type: WidgetType) => {
    const id = `widget-${Date.now()}`;
    const newWidget: WidgetConfig = {
      id,
      type,
      title: type.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    };
    setWidgets((prev) => [...prev, newWidget]);
    setShowLibrary(false);
  }, []);

  const handleSaveLayout = useCallback(() => {
    setWidgets((prev) => {
      saveDashboardLayout({ widgets: prev });
      return prev;
    });
    setEditMode(false);
  }, []);

  const loadTemplate = useCallback((templateId: string) => {
    const template = dashboardTemplates.find((t) => t.id === templateId);
    if (template) {
      setWidgets(template.layout.widgets);
      setShowTemplates(false);
    }
  }, []);

  const exportDashboard = useCallback(async (format: 'png' | 'pdf') => {
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
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        pdf.save(`dashboard-${Date.now()}.pdf`);
      }
    } finally {
      setExportingFormat(null);
    }
  }, [exportingFormat]);

  const activeWidget = activeId ? widgets.find((w) => w.id === activeId) : null;

  return (
    <div className="space-y-4">
      {/* Screen-reader live region for drag announcements */}
      <div
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>

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
          <button
            onClick={() => setShowWidgetSystem(!showWidgetSystem)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-colors"
          >
            <Package className="h-4 w-4" />
            <span className="text-sm">Widget Marketplace</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportDashboard('png')}
            disabled={!!exportingFormat}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            <span className="text-sm">{exportingFormat === 'png' ? 'Exporting…' : 'PNG'}</span>
          </button>
          <button
            onClick={() => exportDashboard('pdf')}
            disabled={!!exportingFormat}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            <span className="text-sm">{exportingFormat === 'pdf' ? 'Exporting…' : 'PDF'}</span>
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
        {editMode ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
              <div
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                role="list"
                aria-label="Dashboard widgets — use drag handles to reorder"
              >
                {widgets.map((widget) => (
                  <div key={widget.id} role="listitem">
                    <SortableWidgetItem
                      widget={widget}
                      editMode={editMode}
                      onRemove={handleRemoveWidget}
                      onDrillDown={handleDrillDown}
                    />
                  </div>
                ))}
              </div>
            </SortableContext>

            {/* Floating drag preview */}
            <DragOverlay>
              {activeWidget ? <WidgetOverlay widget={activeWidget} /> : null}
            </DragOverlay>
          </DndContext>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {widgets.map((widget) => (
              <SortableWidgetItem
                key={widget.id}
                widget={widget}
                editMode={false}
                onRemove={handleRemoveWidget}
                onDrillDown={handleDrillDown}
              />
            ))}
          </div>
        )}
      </div>

      {/* Widget System Modal */}
      {showWidgetSystem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-6xl h-[90vh] rounded-xl border border-gray-700 bg-gray-900 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-gray-700">
              <h2 className="text-2xl font-semibold text-white">Widget System</h2>
              <button
                onClick={() => setShowWidgetSystem(false)}
                className="p-2 hover:bg-gray-800 rounded-lg text-gray-400"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <WidgetSystem />
            </div>
          </div>
        </div>
      )}

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
