/**
 * ResizableDashboard (Issue #1392)
 *
 * Wraps dashboard widgets in a react-grid-layout grid so they can be dragged
 * and resized, and persists the arrangement per vault via `useDashboardLayout`.
 * Size constraints come from each widget's default layout entry, so a widget
 * can never be dragged down to an unreadable size.
 */
import React, { useMemo } from "react";
import GridLayout, {
  type Layout as GridLayoutType,
  type LayoutItem as GridLayoutItem,
} from "react-grid-layout/legacy";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { RotateCcw } from "lucide-react";

import {
  useDashboardLayout,
  type DashboardLayout,
  type WidgetLayout,
} from "../hooks/useDashboardLayout";

const COLS = 12;
const ROW_HEIGHT = 80;

export interface DashboardWidget {
  /** Stable id; also the grid item key. */
  id: string;
  title: string;
  /** Default placement and size constraints for this widget. */
  layout: Omit<WidgetLayout, "i">;
  render: () => React.ReactNode;
}

interface ResizableDashboardProps {
  /** Vault the layout belongs to; layouts are stored per contract. */
  contractId: string;
  widgets: DashboardWidget[];
  width?: number;
}

export default function ResizableDashboard({
  contractId,
  widgets,
  width = 1200,
}: ResizableDashboardProps) {
  const defaultLayout: DashboardLayout = useMemo(
    () => widgets.map((widget) => ({ i: widget.id, ...widget.layout })),
    [widgets],
  );

  const { layout, saveLayout, resetLayout, isCustomized } = useDashboardLayout(
    contractId,
    defaultLayout,
  );

  return (
    <div className="resizable-dashboard">
      <div className="flex items-center justify-end gap-2 p-2">
        <button
          type="button"
          onClick={resetLayout}
          disabled={!isCustomized}
          aria-label="Reset dashboard layout to default"
          className="inline-flex items-center gap-1 rounded border px-2 py-1 text-sm disabled:opacity-50"
        >
          <RotateCcw size={14} aria-hidden="true" />
          Reset to default
        </button>
      </div>

      <GridLayout
        className="layout"
        layout={layout as GridLayoutType}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        width={width}
        isDraggable
        isResizable
        draggableHandle=".widget-drag-handle"
        onLayoutChange={(next: GridLayoutType) =>
          saveLayout(next.map((item: GridLayoutItem) => ({ ...item })))
        }
      >
        {widgets.map((widget) => (
          <div key={widget.id} className="rounded border bg-white shadow-sm">
            <div className="widget-drag-handle cursor-move border-b px-3 py-2 text-sm font-medium">
              {widget.title}
            </div>
            <div className="p-3">{widget.render()}</div>
          </div>
        ))}
      </GridLayout>
    </div>
  );
}
