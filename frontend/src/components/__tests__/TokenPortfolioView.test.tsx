import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenPortfolioView } from '../TokenPortfolioView';
import { useTokenPrices } from '../../hooks/useTokenPrices';

// Mock useTokenPrices hook
vi.mock('../../hooks/useTokenPrices', () => ({
  useTokenPrices: vi.fn(),
}));

// Mock recharts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Cell: () => null,
  Tooltip: () => null,
}));

const mockUseTokenPrices = vi.mocked(useTokenPrices);

describe('TokenPortfolioView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleBalances = [
    {
      token: {
        address: 'NATIVE',
        symbol: 'XLM',
        name: 'Stellar Lumens',
        decimals: 7,
        isNative: true,
      },
      balance: '1000',
    },
    {
      token: {
        address: 'CCW67TSZV3SUUJZYHWVPQWJ7B5BODJHYKJRC5QK7L5HHQFJGVY7H3LRL',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 7,
        isNative: false,
      },
      balance: '200',
    },
  ];

  it('renders empty portfolio state when no balances are provided', () => {
    mockUseTokenPrices.mockReturnValue({
      prices: {},
      loading: false,
      lastUpdated: null,
      refresh: vi.fn(),
    });

    render(<TokenPortfolioView tokenBalances={[]} />);
    expect(screen.getByText('No assets found in this vault portfolio.')).toBeInTheDocument();
  });

  it('renders multi-token portfolio with correct balances and calculates USD values correctly', () => {
    // XLM price: $0.10, USDC price: $1.00
    // Total value: 1000 * 0.10 + 200 * 1.00 = $100 + $200 = $300
    mockUseTokenPrices.mockReturnValue({
      prices: {
        NATIVE: { usd: 0.10, change24h: 5.2 },
        CCW67TSZV3SUUJZYHWVPQWJ7B5BODJHYKJRC5QK7L5HHQFJGVY7H3LRL: { usd: 1.00, change24h: -0.1 },
      },
      loading: false,
      lastUpdated: Date.now(),
      refresh: vi.fn(),
    });

    render(<TokenPortfolioView tokenBalances={sampleBalances} />);

    // Total Portfolio Balance should show $300.00
    expect(screen.getByText('$300.00')).toBeInTheDocument();

    // Check balances rendering
    expect(screen.getByText('1,000')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();

    // Check individual USD values
    expect(screen.getByText('$100.00')).toBeInTheDocument();
    expect(screen.getByText('$200.00')).toBeInTheDocument();

    // Check allocations: XLM is 33.3%, USDC is 66.7%
    expect(screen.getByText('33.3%')).toBeInTheDocument();
    expect(screen.getByText('66.7%')).toBeInTheDocument();
  });

  it('applies correct color classes for positive and negative 24h change', () => {
    mockUseTokenPrices.mockReturnValue({
      prices: {
        NATIVE: { usd: 0.10, change24h: 5.2 }, // positive
        CCW67TSZV3SUUJZYHWVPQWJ7B5BODJHYKJRC5QK7L5HHQFJGVY7H3LRL: { usd: 1.00, change24h: -0.1 }, // negative
      },
      loading: false,
      lastUpdated: Date.now(),
      refresh: vi.fn(),
    });

    render(<TokenPortfolioView tokenBalances={sampleBalances} />);

    // Positive change should have text-green-400 class
    const positiveChange = screen.getByText('+5.20%');
    expect(positiveChange.closest('td')).toHaveClass('text-green-400');

    // Negative change should have text-red-400 class
    const negativeChange = screen.getByText('-0.10%');
    expect(negativeChange.closest('td')).toHaveClass('text-red-400');
  });

  it('falls back gracefully showing N/A when prices are unavailable', () => {
    mockUseTokenPrices.mockReturnValue({
      prices: {}, // Empty prices
      loading: false,
      lastUpdated: null,
      refresh: vi.fn(),
    });

    render(<TokenPortfolioView tokenBalances={sampleBalances} />);

    // Total portfolio should show N/A
    const naElements = screen.getAllByText('N/A');
    expect(naElements.length).toBeGreaterThanOrEqual(3);
  });

  it('triggers refresh and onRefresh callback when refresh button is clicked', () => {
    const mockRefresh = vi.fn();
    const mockOnRefresh = vi.fn();
    mockUseTokenPrices.mockReturnValue({
      prices: {},
      loading: false,
      lastUpdated: Date.now(),
      refresh: mockRefresh,
    });

    render(<TokenPortfolioView tokenBalances={sampleBalances} onRefresh={mockOnRefresh} />);

    const refreshBtn = screen.getByLabelText('Refresh portfolio data');
    fireEvent.click(refreshBtn);

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockOnRefresh).toHaveBeenCalledTimes(1);
  });
});
