import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SpendingAnalytics from '../SpendingAnalytics';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ showToast: vi.fn(), notify: vi.fn() }),
}));

// Mock recharts to avoid SVG rendering issues in jsdom
vi.mock('recharts', () => {
  const MockChart = ({ children, 'data-testid': testId }: { children?: React.ReactNode; 'data-testid'?: string }) => (
    <div data-testid={testId ?? 'recharts-mock'}>{children}</div>
  );
  return {
    AreaChart: MockChart,
    ComposedChart: MockChart,
    PieChart: MockChart,
    Area: () => null,
    Line: () => null,
    Pie: () => null,
    Cell: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ReferenceLine: () => null,
  };
});

// ---------------------------------------------------------------------------
// Mock data factories
// ---------------------------------------------------------------------------

function makeMockData(overrides: Partial<{
  dailyUsed: number;
  weeklyUsed: number;
  dailyLimit: number;
  weeklyLimit: number;
  history: { date: string; amount: number; dailyLimit: number }[];
  byToken: { token: string; amount: number }[];
}> = {}) {
  const now = Date.now();
  const day = 86_400_000;
  const history = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(now - (29 - i) * day).toISOString().slice(0, 10),
    amount: 100 + i * 10,
    dailyLimit: 5000,
  }));

  return {
    dailyUsed: 1000,
    weeklyUsed: 3000,
    dailyLimit: 5000,
    weeklyLimit: 20000,
    history,
    byToken: [
      { token: 'XLM', amount: 2000 },
      { token: 'USDC', amount: 1000 },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SpendingAnalytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders utilization gauges with mock data', () => {
    render(<SpendingAnalytics mockData={makeMockData()} />);

    expect(screen.getByText('Daily Limit')).toBeInTheDocument();
    expect(screen.getByText('Weekly Limit')).toBeInTheDocument();
  });

  it('shows correct utilization percentage for daily limit', () => {
    // 1000 / 5000 = 20%
    render(<SpendingAnalytics mockData={makeMockData({ dailyUsed: 1000, dailyLimit: 5000 })} />);

    expect(screen.getByText('20.0%')).toBeInTheDocument();
  });

  it('renders area chart when sufficient history data exists', () => {
    render(<SpendingAnalytics mockData={makeMockData()} />);

    expect(screen.getByTestId('spending-area-chart')).toBeInTheDocument();
  });

  it('renders forecast line label in chart section', () => {
    render(<SpendingAnalytics mockData={makeMockData()} />);

    // The legend shows "Forecast"
    expect(screen.getByText('Forecast')).toBeInTheDocument();
  });

  it('renders pie chart when by-token data exists', () => {
    render(<SpendingAnalytics mockData={makeMockData()} />);

    expect(screen.getByTestId('spending-pie-chart')).toBeInTheDocument();
    expect(screen.getByText('Spending by Token')).toBeInTheDocument();
  });

  it('does not render pie chart when by-token data is empty', () => {
    render(<SpendingAnalytics mockData={makeMockData({ byToken: [] })} />);

    expect(screen.queryByTestId('spending-pie-chart')).not.toBeInTheDocument();
  });

  it('shows insufficient data message when history has fewer than 3 points', () => {
    render(<SpendingAnalytics mockData={makeMockData({ history: [
      { date: '2026-01-01', amount: 100, dailyLimit: 5000 },
      { date: '2026-01-02', amount: 200, dailyLimit: 5000 },
    ] })} />);

    expect(screen.getByText(/insufficient data/i)).toBeInTheDocument();
  });

  it('shows warning toast when daily utilization exceeds 80%', async () => {
    const showToast = vi.fn();
    vi.mocked(await import('../../hooks/useToast')).useToast = () => ({ showToast, notify: vi.fn() });

    render(<SpendingAnalytics mockData={makeMockData({ dailyUsed: 4500, dailyLimit: 5000 })} />);

    // 4500/5000 = 90% — should trigger warning
    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('90.0%'),
        'warning'
      );
    });
  });

  it('shows green color class for utilization below 60%', () => {
    render(<SpendingAnalytics mockData={makeMockData({ dailyUsed: 1000, dailyLimit: 5000 })} />);

    // 20% — should use green progress bar
    const progressBar = screen.getAllByRole('progressbar')[0];
    expect(progressBar.className).toContain('bg-green-500');
  });

  it('shows amber color class for utilization between 60-80%', () => {
    render(<SpendingAnalytics mockData={makeMockData({ dailyUsed: 3500, dailyLimit: 5000 })} />);

    // 70% — should use amber progress bar
    const progressBar = screen.getAllByRole('progressbar')[0];
    expect(progressBar.className).toContain('bg-amber-500');
  });

  it('shows red color class for utilization above 80%', () => {
    render(<SpendingAnalytics mockData={makeMockData({ dailyUsed: 4500, dailyLimit: 5000 })} />);

    // 90% — should use red progress bar
    const progressBar = screen.getAllByRole('progressbar')[0];
    expect(progressBar.className).toContain('bg-red-500');
  });

  it('renders loading skeletons when no mock data provided and fetch is pending', () => {
    // Without mockData, component starts in loading state
    // We don't mock fetch here so it will be in loading state initially
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;

    render(<SpendingAnalytics />);

    // Loading skeletons have animate-pulse class
    expect(document.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('shows used and limit values in gauge', () => {
    render(<SpendingAnalytics mockData={makeMockData({ dailyUsed: 1000, dailyLimit: 5000 })} />);

    expect(screen.getByText('1,000 used')).toBeInTheDocument();
    expect(screen.getByText('5,000 limit')).toBeInTheDocument();
  });
});
