import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Overview from '../Overview';
import { makeVaultContractMock } from '../../../test/mocks';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('../../../hooks/useVaultContract');
vi.mock('../../../utils/templates', () => ({
  getAllTemplates: () => [],
  getMostUsedTemplates: () => [],
}));
vi.mock('../../../utils/dashboardTemplates', () => ({
  loadDashboardLayout: () => null,
}));
vi.mock('../../../utils/localeFormatter', () => ({
  formatCurrency: (v: number) => `$${v}`,
}));
vi.mock('../../../utils/formatters', () => ({
  formatTokenAmount: (v: string) => v,
}));
vi.mock('../../../constants/tokens', () => ({
  isValidStellarAddress: (addr: string) => /^[CG][A-Z0-9]{55}$/.test(addr),
}));
vi.mock('../../../components/DashboardBuilder', () => ({
  default: () => <div data-testid="dashboard-builder" />,
}));
vi.mock('../../../components/Layout/StatCard', () => ({
  default: ({ title, value, subtitle }: { title: string; value: string | number; subtitle?: string }) => (
    <div data-testid="stat-card">
      <span>{title}</span>
      <span>{value}</span>
      {subtitle && <span>{subtitle}</span>}
    </div>
  ),
}));
vi.mock('../../../components/TokenBalanceCard', () => ({
  default: () => <div data-testid="token-balance-card" />,
}));

import { useVaultContract } from '../../../hooks/useVaultContract';
const mockUseVaultContract = vi.mocked(useVaultContract);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Overview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseVaultContract.mockReturnValue(makeVaultContractMock() as ReturnType<typeof useVaultContract>);
  });

  it('shows a loading spinner while stats are being fetched', () => {
    // Make getDashboardStats never resolve so loading stays true
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: true,
        getDashboardStats: vi.fn(() => new Promise(() => {})),
        getVaultBalance: vi.fn(() => new Promise(() => {})),
        getTokenBalances: vi.fn(() => new Promise(() => {})),
        getPortfolioValue: vi.fn(() => new Promise(() => {})),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<Overview />);
    // The component renders a Loader2 with animate-spin when loading && !stats && statsLoading
    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  it('renders stat cards after successful data load', async () => {
    render(<Overview />);

    await waitFor(() => {
      expect(screen.getAllByTestId('stat-card').length).toBeGreaterThan(0);
    });
  });

  it('shows an error retry link when stats fail to load', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getDashboardStats: vi.fn().mockRejectedValue(new Error('Network error')),
        getVaultBalance: vi.fn().mockResolvedValue('0'),
        getTokenBalances: vi.fn().mockResolvedValue([]),
        getPortfolioValue: vi.fn().mockResolvedValue('0'),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<Overview />);

    await waitFor(() => {
      // The stats error surfaces as a retry hint in the StatCard subtitle
      expect(screen.getByText('common.retry')).toBeInTheDocument();
    });
  });

  it('shows balance error and retry button when vault balance fails', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        loading: false,
        getDashboardStats: vi.fn().mockResolvedValue({
          totalBalance: '0', totalProposals: 0, pendingApprovals: 0,
          readyToExecute: 0, activeSigners: 0, threshold: '0/0',
        }),
        getVaultBalance: vi.fn().mockRejectedValue(new Error('RPC error')),
        getTokenBalances: vi.fn().mockResolvedValue([]),
        getPortfolioValue: vi.fn().mockResolvedValue('0'),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<Overview />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load balance')).toBeInTheDocument();
    });
    expect(screen.getByText('common.retry')).toBeInTheDocument();
  });

  it('renders empty token balances state when no tokens returned', async () => {
    render(<Overview />);

    await waitFor(() => {
      expect(screen.getByText('dashboard.noTokensFound')).toBeInTheDocument();
    });
  });

  it('renders token balance cards when tokens are returned', async () => {
    mockUseVaultContract.mockReturnValue(
      makeVaultContractMock({
        getTokenBalances: vi.fn().mockResolvedValue([
          {
            token: { address: 'CNATIVE', symbol: 'XLM', name: 'Stellar Lumens', decimals: 7 },
            balance: '1000000000',
            usdValue: 100,
            isLoading: false,
          },
        ]),
        getPortfolioValue: vi.fn().mockResolvedValue('100'),
      }) as ReturnType<typeof useVaultContract>
    );

    render(<Overview />);

    await waitFor(() => {
      expect(screen.getAllByTestId('token-balance-card').length).toBe(1);
    });
  });
});
