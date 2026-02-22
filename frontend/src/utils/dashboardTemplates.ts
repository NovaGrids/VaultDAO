import type { DashboardTemplate } from '../types/dashboard';
import { Wallet, FileText, CheckCircle, LayoutDashboard } from 'lucide-react';

export const dashboardTemplates: DashboardTemplate[] = [
  {
    id: 'executive',
    name: 'Executive Dashboard',
    description: 'High-level overview for executives',
    role: 'admin',
    layout: {
      id: 'executive-layout',
      name: 'Executive Dashboard',
      widgets: [
        {
          id: 'stat-balance',
          type: 'stat-card',
          title: 'Vault Balance',
          config: { value: '0 XLM', icon: Wallet },
        },
        {
          id: 'stat-proposals',
          type: 'stat-card',
          title: 'Active Proposals',
          config: { value: '0', icon: FileText },
        },
        {
          id: 'stat-ready',
          type: 'stat-card',
          title: 'Ready to Execute',
          config: { value: '0', icon: CheckCircle },
        },
        {
          id: 'stat-signers',
          type: 'stat-card',
          title: 'Active Signers',
          config: { value: '0', icon: LayoutDashboard },
        },
        {
          id: 'chart-proposals',
          type: 'line-chart',
          title: 'Proposal Trends',
          config: {
            data: [],
            series: [{ dataKey: 'count', name: 'Proposals', color: '#818cf8' }],
            xKey: 'date',
          },
        },
        {
          id: 'chart-spending',
          type: 'pie-chart',
          title: 'Spending by Category',
          config: { data: [], dataKey: 'value', nameKey: 'name' },
        },
      ],
      layout: [
        { i: 'stat-balance', x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
        { i: 'stat-proposals', x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
        { i: 'stat-ready', x: 6, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
        { i: 'stat-signers', x: 9, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
        { i: 'chart-proposals', x: 0, y: 2, w: 6, h: 4, minW: 4, minH: 3 },
        { i: 'chart-spending', x: 6, y: 2, w: 6, h: 4, minW: 4, minH: 3 },
      ],
    },
  },
  {
    id: 'treasurer',
    name: 'Treasurer Dashboard',
    description: 'Financial tracking and proposal management',
    role: 'treasurer',
    layout: {
      id: 'treasurer-layout',
      name: 'Treasurer Dashboard',
      widgets: [
        {
          id: 'stat-balance',
          type: 'stat-card',
          title: 'Vault Balance',
          config: { value: '0 XLM', icon: Wallet },
        },
        {
          id: 'stat-pending',
          type: 'stat-card',
          title: 'Pending Approvals',
          config: { value: '0', icon: FileText },
        },
        {
          id: 'chart-spending',
          type: 'bar-chart',
          title: 'Monthly Spending',
          config: {
            data: [],
            series: [{ dataKey: 'amount', name: 'Amount', color: '#34d399' }],
            xKey: 'month',
          },
        },
        {
          id: 'list-proposals',
          type: 'proposal-list',
          title: 'Recent Proposals',
          config: { proposals: [] },
        },
        {
          id: 'calendar-events',
          type: 'calendar',
          title: 'Upcoming Events',
          config: { events: [] },
        },
      ],
      layout: [
        { i: 'stat-balance', x: 0, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
        { i: 'stat-pending', x: 4, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
        { i: 'chart-spending', x: 0, y: 2, w: 8, h: 4, minW: 4, minH: 3 },
        { i: 'list-proposals', x: 8, y: 0, w: 4, h: 6, minW: 3, minH: 4 },
        { i: 'calendar-events', x: 0, y: 6, w: 8, h: 4, minW: 4, minH: 3 },
      ],
    },
  },
  {
    id: 'admin',
    name: 'Admin Dashboard',
    description: 'Complete system overview',
    role: 'admin',
    layout: {
      id: 'admin-layout',
      name: 'Admin Dashboard',
      widgets: [
        {
          id: 'stat-balance',
          type: 'stat-card',
          title: 'Vault Balance',
          config: { value: '0 XLM', icon: Wallet },
        },
        {
          id: 'stat-proposals',
          type: 'stat-card',
          title: 'Total Proposals',
          config: { value: '0', icon: FileText },
        },
        {
          id: 'stat-signers',
          type: 'stat-card',
          title: 'Active Signers',
          config: { value: '0', icon: LayoutDashboard },
        },
        {
          id: 'chart-activity',
          type: 'line-chart',
          title: 'Activity Over Time',
          config: {
            data: [],
            series: [
              { dataKey: 'proposals', name: 'Proposals', color: '#818cf8' },
              { dataKey: 'executions', name: 'Executions', color: '#34d399' },
            ],
            xKey: 'date',
          },
        },
        {
          id: 'chart-distribution',
          type: 'pie-chart',
          title: 'Proposal Status Distribution',
          config: { data: [], dataKey: 'value', nameKey: 'status' },
        },
        {
          id: 'list-proposals',
          type: 'proposal-list',
          title: 'All Proposals',
          config: { proposals: [] },
        },
      ],
      layout: [
        { i: 'stat-balance', x: 0, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
        { i: 'stat-proposals', x: 4, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
        { i: 'stat-signers', x: 8, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
        { i: 'chart-activity', x: 0, y: 2, w: 8, h: 4, minW: 4, minH: 3 },
        { i: 'chart-distribution', x: 8, y: 2, w: 4, h: 4, minW: 3, minH: 3 },
        { i: 'list-proposals', x: 0, y: 6, w: 12, h: 4, minW: 6, minH: 3 },
      ],
    },
  },
];

export const getDashboardTemplate = (id: string): DashboardTemplate | undefined => {
  return dashboardTemplates.find((t) => t.id === id);
};

export const loadSavedLayout = () => {
  const saved = localStorage.getItem('dashboard-layout');
  return saved ? JSON.parse(saved) : null;
};
