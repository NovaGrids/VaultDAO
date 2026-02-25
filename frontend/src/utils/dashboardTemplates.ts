import type { DashboardTemplate } from '../types/dashboard';

export const dashboardTemplates: DashboardTemplate[] = [
  {
    id: 'executive',
    name: 'Executive Dashboard',
    description: 'High-level overview for executives',
    role: 'Admin',
    layout: {
      id: 'executive',
      name: 'Executive',
      widgets: [
        { id: 'stat-1', type: 'stat-card', title: 'Total Balance' },
        { id: 'stat-2', type: 'stat-card', title: 'Active Proposals' },
        { id: 'stat-3', type: 'stat-card', title: 'Monthly Spend' },
        { id: 'pie-1', type: 'pie-chart', title: 'Budget Allocation' },
        { id: 'line-1', type: 'line-chart', title: 'Treasury Growth' },
        { id: 'proposals-1', type: 'proposal-list', title: 'Recent Proposals' },
      ],
      layout: [
        { i: 'stat-1', x: 0, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
        { i: 'stat-2', x: 4, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
        { i: 'stat-3', x: 8, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
        { i: 'pie-1', x: 0, y: 2, w: 6, h: 4, minW: 4, minH: 3 },
        { i: 'line-1', x: 6, y: 2, w: 6, h: 4, minW: 4, minH: 3 },
        { i: 'proposals-1', x: 0, y: 6, w: 12, h: 4, minW: 6, minH: 3 },
      ],
    },
  },
  {
    id: 'treasurer',
    name: 'Treasurer Dashboard',
    description: 'Financial tracking and analysis',
    role: 'Treasurer',
    layout: {
      id: 'treasurer',
      name: 'Treasurer',
      widgets: [
        { id: 'line-1', type: 'line-chart', title: 'Cash Flow' },
        { id: 'bar-1', type: 'bar-chart', title: 'Spending by Category' },
        { id: 'stat-1', type: 'stat-card', title: 'Available Balance' },
        { id: 'stat-2', type: 'stat-card', title: 'Pending Payments' },
        { id: 'calendar-1', type: 'calendar', title: 'Payment Schedule' },
        { id: 'proposals-1', type: 'proposal-list', title: 'Financial Proposals' },
      ],
      layout: [
        { i: 'line-1', x: 0, y: 0, w: 8, h: 4, minW: 6, minH: 3 },
        { i: 'stat-1', x: 8, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
        { i: 'stat-2', x: 8, y: 2, w: 4, h: 2, minW: 2, minH: 2 },
        { i: 'bar-1', x: 0, y: 4, w: 6, h: 4, minW: 4, minH: 3 },
        { i: 'calendar-1', x: 6, y: 4, w: 6, h: 4, minW: 4, minH: 3 },
        { i: 'proposals-1', x: 0, y: 8, w: 12, h: 4, minW: 6, minH: 3 },
      ],
    },
  },
  {
    id: 'admin',
    name: 'Admin Dashboard',
    description: 'Governance and operations',
    role: 'Admin',
    layout: {
      id: 'admin',
      name: 'Admin',
      widgets: [
        { id: 'proposals-1', type: 'proposal-list', title: 'All Proposals' },
        { id: 'bar-1', type: 'bar-chart', title: 'Proposal Activity' },
        { id: 'stat-1', type: 'stat-card', title: 'Active Members' },
        { id: 'stat-2', type: 'stat-card', title: 'Pending Votes' },
        { id: 'calendar-1', type: 'calendar', title: 'Governance Calendar' },
      ],
      layout: [
        { i: 'proposals-1', x: 0, y: 0, w: 8, h: 6, minW: 6, minH: 4 },
        { i: 'stat-1', x: 8, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
        { i: 'stat-2', x: 8, y: 2, w: 4, h: 2, minW: 2, minH: 2 },
        { i: 'bar-1', x: 8, y: 4, w: 4, h: 4, minW: 4, minH: 3 },
        { i: 'calendar-1', x: 0, y: 6, w: 8, h: 4, minW: 4, minH: 3 },
      ],
    },
  },
];

export const getTemplate = (id: string): DashboardTemplate | undefined => {
  return dashboardTemplates.find(t => t.id === id);
};

export const saveDashboardLayout = (layout: unknown) => {
  localStorage.setItem('vaultdao-dashboard-layout', JSON.stringify(layout));
};

export const loadDashboardLayout = (): unknown | null => {
  const saved = localStorage.getItem('vaultdao-dashboard-layout');
  return saved ? JSON.parse(saved) : null;
};
