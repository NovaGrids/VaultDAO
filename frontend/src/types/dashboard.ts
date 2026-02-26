export type WidgetType = 'line-chart' | 'bar-chart' | 'pie-chart' | 'stat-card' | 'proposal-list' | 'calendar';

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  dataSource?: string;
  settings?: Record<string, unknown>;
}

export interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

export interface DashboardLayout {
  id: string;
  name: string;
  widgets: WidgetConfig[];
  layout: LayoutItem[];
}

export interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  role: string;
  layout: DashboardLayout;
}
