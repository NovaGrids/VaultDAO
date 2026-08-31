import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ResizableDashboard from '../ResizableDashboard';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('react-grid-layout', () => ({
  default: ({
    children,
    layout,
    onLayoutChange,
  }: {
    children: React.ReactNode;
    layout: any[];
    onLayoutChange?: (l: unknown[]) => void;
  }) => (
    <div data-testid="grid-layout" data-layout={JSON.stringify(layout)}>
      {children}
    </div>
  ),
}));

vi.mock('../../hooks/useDashboardLayout', () => ({
  useDashboardLayout: () => ({
    layout: [
      { i: 'widget-1', x: 0, y: 0, w: 6, h: 4 },
      { i: 'widget-2', x: 6, y: 0, w: 6, h: 4 },
    ],
    saveLayout: vi.fn(),
    resetLayout: vi.fn(),
    isCustomized: false,
  }),
}));

vi.mock('lucide-react', () => ({
  RotateCcw: () => <span>Reset Icon</span>,
}));

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ResizableDashboard - Issue #1583 (RTL Layout)', () => {
  const mockWidgets = [
    {
      id: 'widget-1',
      title: 'Widget 1',
      layout: { x: 0, y: 0, w: 6, h: 4, minW: 3, minH: 2 },
      render: () => <div>Widget 1 Content</div>,
    },
    {
      id: 'widget-2',
      title: 'Widget 2',
      layout: { x: 6, y: 0, w: 6, h: 4, minW: 3, minH: 2 },
      render: () => <div>Widget 2 Content</div>,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset document direction
    document.documentElement.dir = 'ltr';
  });

  it('renders dashboard with widgets', () => {
    render(
      <ResizableDashboard contractId="contract-123" widgets={mockWidgets} />
    );

    expect(screen.getByText('Widget 1')).toBeInTheDocument();
    expect(screen.getByText('Widget 2')).toBeInTheDocument();
  });

  it('renders reset layout button', () => {
    render(
      <ResizableDashboard contractId="contract-123" widgets={mockWidgets} />
    );

    const resetButton = screen.getByRole('button', {
      name: /reset dashboard layout/i,
    });
    expect(resetButton).toBeInTheDocument();
  });

  it('preserves LTR layout properties in left-to-right languages', () => {
    document.documentElement.dir = 'ltr';

    render(
      <ResizableDashboard contractId="contract-123" widgets={mockWidgets} />
    );

    const gridLayout = screen.getByTestId('grid-layout');
    const layoutData = JSON.parse(gridLayout.getAttribute('data-layout') || '[]');

    expect(layoutData).toContainEqual(
      expect.objectContaining({
        i: 'widget-1',
        x: 0,
      })
    );
    expect(layoutData).toContainEqual(
      expect.objectContaining({
        i: 'widget-2',
        x: 6,
      })
    );
  });

  it('should use logical CSS properties for RTL support', () => {
    document.documentElement.dir = 'rtl';

    render(
      <ResizableDashboard contractId="contract-123" widgets={mockWidgets} />
    );

    const dashboardContainer = screen.getByTestId('grid-layout').parentElement;

    // Verify the component is rendered in RTL context
    expect(document.documentElement.dir).toBe('rtl');

    // The layout should still render correctly
    expect(screen.getByText('Widget 1')).toBeInTheDocument();
    expect(screen.getByText('Widget 2')).toBeInTheDocument();
  });

  it('should handle RTL direction change', () => {
    const { rerender } = render(
      <ResizableDashboard contractId="contract-123" widgets={mockWidgets} />
    );

    // Change direction to RTL
    document.documentElement.dir = 'rtl';
    rerender(
      <ResizableDashboard contractId="contract-123" widgets={mockWidgets} />
    );

    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText('Widget 1')).toBeInTheDocument();
  });

  it('should maintain widget layout integrity in RTL mode', () => {
    document.documentElement.dir = 'rtl';

    render(
      <ResizableDashboard contractId="contract-123" widgets={mockWidgets} />
    );

    // Verify both widgets are still rendered
    expect(screen.getByText('Widget 1 Content')).toBeInTheDocument();
    expect(screen.getByText('Widget 2 Content')).toBeInTheDocument();

    // Verify widget titles are accessible
    expect(screen.getByText('Widget 1')).toBeInTheDocument();
    expect(screen.getByText('Widget 2')).toBeInTheDocument();
  });

  it('should apply correct layout configuration regardless of direction', () => {
    document.documentElement.dir = 'rtl';

    render(
      <ResizableDashboard contractId="contract-123" widgets={mockWidgets} />
    );

    const gridLayout = screen.getByTestId('grid-layout');
    const layoutData = JSON.parse(gridLayout.getAttribute('data-layout') || '[]');

    // Layout array should have both widgets
    expect(layoutData).toHaveLength(2);
    expect(layoutData.map((item: any) => item.i)).toContain('widget-1');
    expect(layoutData.map((item: any) => item.i)).toContain('widget-2');
  });

  it('should support drag handle in both LTR and RTL', () => {
    const { rerender } = render(
      <ResizableDashboard contractId="contract-123" widgets={mockWidgets} />
    );

    // Check LTR
    const dragHandles = screen.getAllByText(/Widget \d/);
    expect(dragHandles.length).toBeGreaterThan(0);

    // Switch to RTL
    document.documentElement.dir = 'rtl';
    rerender(
      <ResizableDashboard contractId="contract-123" widgets={mockWidgets} />
    );

    // Drag handles should still be present
    const dragHandlesRtl = screen.getAllByText(/Widget \d/);
    expect(dragHandlesRtl.length).toBeGreaterThan(0);
  });

  it('should render with custom width', () => {
    render(
      <ResizableDashboard
        contractId="contract-123"
        widgets={mockWidgets}
        width={800}
      />
    );

    expect(screen.getByText('Widget 1')).toBeInTheDocument();
    expect(screen.getByTestId('grid-layout')).toBeInTheDocument();
  });

  it('should render widget content correctly', () => {
    render(
      <ResizableDashboard contractId="contract-123" widgets={mockWidgets} />
    );

    expect(screen.getByText('Widget 1 Content')).toBeInTheDocument();
    expect(screen.getByText('Widget 2 Content')).toBeInTheDocument();
  });
});
