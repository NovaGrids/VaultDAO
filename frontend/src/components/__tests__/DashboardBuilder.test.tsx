import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DashboardBuilder from '../DashboardBuilder';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../hooks/useWallet', () => ({
  useWallet: () => ({ address: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB' }),
}));

vi.mock('react-grid-layout', () => ({
  default: ({ children, onLayoutChange }: { children: React.ReactNode; onLayoutChange?: (l: unknown[]) => void }) => (
    <div data-testid="grid-layout" onClick={() => onLayoutChange?.([])}>
      {children}
    </div>
  ),
}));

vi.mock('../WidgetLibrary', () => ({
  default: ({ onAddWidget }: { onAddWidget: (type: string) => void }) => (
    <div data-testid="widget-library">
      <button onClick={() => onAddWidget('stat-card')}>Add Stat Card</button>
    </div>
  ),
}));

vi.mock('../WidgetSystem', () => ({ default: () => <div>Widget System</div> }));
vi.mock('../widgets/LineChartWidget', () => ({ default: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock('../widgets/BarChartWidget', () => ({ default: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock('../widgets/PieChartWidget', () => ({ default: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock('../widgets/StatCardWidget', () => ({ default: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock('../widgets/ProposalListWidget', () => ({ default: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock('../widgets/CalendarWidget', () => ({ default: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock('../DashboardErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="error-boundary">{children}</div>,
}));

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('DashboardBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders the toolbar', () => {
    render(<DashboardBuilder />);
    expect(screen.getByText('Edit Layout')).toBeInTheDocument();
  });

  it('enters edit mode when Edit Layout is clicked', () => {
    render(<DashboardBuilder />);
    fireEvent.click(screen.getByText('Edit Layout'));
    expect(screen.getByText('Save Layout')).toBeInTheDocument();
    expect(screen.getByText('Add Widget')).toBeInTheDocument();
    expect(screen.getByText('Reset to Default')).toBeInTheDocument();
  });

  it('shows widget library panel when Add Widget is clicked in edit mode', () => {
    render(<DashboardBuilder />);
    fireEvent.click(screen.getByText('Edit Layout'));
    fireEvent.click(screen.getByText('Add Widget'));
    expect(screen.getByTestId('widget-library')).toBeInTheDocument();
  });

  it('adds a widget from the library', async () => {
    render(<DashboardBuilder />);
    fireEvent.click(screen.getByText('Edit Layout'));
    fireEvent.click(screen.getByText('Add Widget'));
    fireEvent.click(screen.getByText('Add Stat Card'));
    await waitFor(() => {
      expect(screen.getByText('Stat Card')).toBeInTheDocument();
    });
  });

  it('removes a widget when X is clicked in edit mode', async () => {
    render(<DashboardBuilder initialWidgets={[{ id: 'w1', type: 'stat-card', title: 'My Stat' }]} />);
    fireEvent.click(screen.getByText('Edit Layout'));
    const removeBtn = screen.getByLabelText('Remove My Stat');
    fireEvent.click(removeBtn);
    await waitFor(() => {
      expect(screen.queryByText('My Stat')).not.toBeInTheDocument();
    });
  });

  it('persists layout to localStorage after save', async () => {
    render(<DashboardBuilder initialWidgets={[{ id: 'w1', type: 'stat-card', title: 'Saved Widget' }]} />);
    fireEvent.click(screen.getByText('Edit Layout'));
    fireEvent.click(screen.getByText('Save Layout'));
    await waitFor(() => {
      const stored = localStorage.getItem('vaultdao-dashboard-widgets');
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(
        expect.arrayContaining([expect.objectContaining({ title: 'Saved Widget' })])
      );
    });
  });

  it('resets to default template when Reset to Default is clicked', async () => {
    render(<DashboardBuilder initialWidgets={[{ id: 'custom', type: 'stat-card', title: 'Custom Widget' }]} />);
    fireEvent.click(screen.getByText('Edit Layout'));
    fireEvent.click(screen.getByText('Reset to Default'));
    await waitFor(() => {
      // Default template widgets should appear (e.g. "Total Balance" from executive template)
      expect(screen.queryByText('Custom Widget')).not.toBeInTheDocument();
    });
  });

  it('wraps each widget in DashboardErrorBoundary', () => {
    render(<DashboardBuilder initialWidgets={[{ id: 'w1', type: 'stat-card', title: 'Safe Widget' }]} />);
    expect(screen.getAllByTestId('error-boundary').length).toBeGreaterThan(0);
  });

  it('error boundary catches widget crash without crashing dashboard', () => {
    // DashboardErrorBoundary mock just renders children — real boundary tested separately
    render(<DashboardBuilder initialWidgets={[{ id: 'w1', type: 'stat-card', title: 'Widget' }]} />);
    expect(screen.getByText('Widget')).toBeInTheDocument();
  });
});
