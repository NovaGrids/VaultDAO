/**
 * Persistent dashboard layout state (Issue #1392).
 *
 * Widget positions and sizes are stored in `localStorage` under a key derived
 * from the contract id, so each vault keeps its own arrangement and the layout
 * survives a refresh. Persisted entries are merged onto the default layout:
 * widgets that were added since the layout was saved still appear, and widgets
 * that no longer exist are dropped.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

/** A single widget's position and size, in react-grid-layout units. */
export interface WidgetLayout {
  /** Widget id; must match the grid child's `key`. */
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
  static?: boolean;
}

export type DashboardLayout = WidgetLayout[];

const STORAGE_PREFIX = 'vaultdao:dashboard-layout';

/** localStorage key for a vault's layout. */
export function layoutStorageKey(contractId: string): string {
  return `${STORAGE_PREFIX}:${contractId || 'default'}`;
}

/**
 * Clamps a widget to the size constraints declared on its default entry, so a
 * persisted layout written before the constraints changed can never restore a
 * widget at an unusable size.
 */
export function applyConstraints(
  widget: WidgetLayout,
  defaults: WidgetLayout,
): WidgetLayout {
  const minW = defaults.minW ?? 1;
  const maxW = defaults.maxW ?? Infinity;
  const minH = defaults.minH ?? 1;
  const maxH = defaults.maxH ?? Infinity;

  return {
    ...defaults,
    ...widget,
    x: Math.max(0, widget.x),
    y: Math.max(0, widget.y),
    w: Math.min(Math.max(widget.w, minW), maxW),
    h: Math.min(Math.max(widget.h, minH), maxH),
  };
}

/**
 * Merges a stored layout onto the defaults: unknown widget ids are ignored and
 * widgets missing from storage fall back to their default placement.
 */
export function mergeLayout(
  defaults: DashboardLayout,
  stored: unknown,
): DashboardLayout {
  if (!Array.isArray(stored)) return defaults;

  const byId = new Map<string, WidgetLayout>();
  for (const entry of stored) {
    if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as WidgetLayout).i === 'string' &&
      typeof (entry as WidgetLayout).x === 'number' &&
      typeof (entry as WidgetLayout).y === 'number' &&
      typeof (entry as WidgetLayout).w === 'number' &&
      typeof (entry as WidgetLayout).h === 'number'
    ) {
      byId.set((entry as WidgetLayout).i, entry as WidgetLayout);
    }
  }

  return defaults.map((widget) => {
    const persisted = byId.get(widget.i);
    return persisted ? applyConstraints(persisted, widget) : widget;
  });
}

function readLayout(
  contractId: string,
  defaults: DashboardLayout,
): DashboardLayout {
  try {
    const raw = window.localStorage.getItem(layoutStorageKey(contractId));
    if (!raw) return defaults;
    return mergeLayout(defaults, JSON.parse(raw));
  } catch {
    // Corrupt or unavailable storage should never break the dashboard.
    return defaults;
  }
}

export interface UseDashboardLayoutResult {
  /** Current layout, ready to hand to react-grid-layout. */
  layout: DashboardLayout;
  /** Persist a layout produced by a drag or resize. */
  saveLayout: (next: DashboardLayout) => void;
  /** Restore the default layout and clear the stored one. */
  resetLayout: () => void;
  /** True while the layout differs from the default. */
  isCustomized: boolean;
}

export function useDashboardLayout(
  contractId: string,
  defaultLayout: DashboardLayout,
): UseDashboardLayoutResult {
  const [layout, setLayout] = useState<DashboardLayout>(() =>
    readLayout(contractId, defaultLayout),
  );

  // Switching vaults loads that vault's own arrangement.
  useEffect(() => {
    setLayout(readLayout(contractId, defaultLayout));
    // defaultLayout is treated as a constant per contract; callers should
    // memoise it (see ResizableDashboard).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  const saveLayout = useCallback(
    (next: DashboardLayout) => {
      const constrained = mergeLayout(defaultLayout, next);
      setLayout(constrained);
      try {
        window.localStorage.setItem(
          layoutStorageKey(contractId),
          JSON.stringify(constrained),
        );
      } catch {
        // Quota errors are non-fatal: the layout still applies for this session.
      }
    },
    [contractId, defaultLayout],
  );

  const resetLayout = useCallback(() => {
    setLayout(defaultLayout);
    try {
      window.localStorage.removeItem(layoutStorageKey(contractId));
    } catch {
      // Ignore: the in-memory reset already happened.
    }
  }, [contractId, defaultLayout]);

  const isCustomized = useMemo(
    () => JSON.stringify(layout) !== JSON.stringify(defaultLayout),
    [layout, defaultLayout],
  );

  return { layout, saveLayout, resetLayout, isCustomized };
}
