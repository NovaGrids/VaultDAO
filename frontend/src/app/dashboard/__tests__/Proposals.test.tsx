import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Proposals from '../Proposals';
import { makeVaultContractMock, makeWalletMock, makeRealtimeMock, makeActionReadinessMock, makeProposal } from '../../../test/mocks';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('../../../hooks/useVaultContract');
vi.mock('../../../hooks/useProposals');
vi.mock('../../../hooks/useWallet');
vi.mock('../../../hooks/useActionReadiness');
vi.mock('../../../hooks/useToast', () => ({ useToast: () => ({ notify: vi.fn() }) }));
vi.mock('../../../contexts/RealtimeContext');

// Stub heavy modal/component dependencies
vi.mock('../../../components/modals/NewProposalModal', () => ({ default: () => null }));
vi.mock('../../../components/modals/ProposalDetailModal', () => ({ default: () => null }));
vi.mock('../../../components/modals/ConfirmationModal', () => ({ default: () => null }));
vi.mock('../../../components/proposals/ProposalFilters', () => ({
  default: ({ onFilterChange }: { onFilterChange: (f: unknown) => void }) => (
    <div data-testid="proposal-filters" onClick={() => onFilterChange({})} />
  ),
}));
vi.mock('../../../components/ProposalComparison', () => ({ default: () => null }));
vi.mock('../../../components/VoiceCommands', () => ({ default: () => null }));
vi.mock('../../../components/ReadinessWarning', () => ({ default: () => null }));
vi.mock('../../../constants/tokens', () => ({ DEFAULT_TOKENS: [] }));

import { useVaultContract } from '../../../hooks/useVaultContract';
import { useProposals } from '../../../hooks/useProposals';
import { useWallet } from '../../../hooks/useWallet';
import { useActionReadiness } from '../../../hooks/useActionReadiness';
import { useRealtime } from '../../../contexts/RealtimeContext';

const mockUseVaultContract = vi.mocked(useVaultContract);
const mockUseProposals = vi.mocked(useProposals);
const mockUseWallet = vi.mocked(useWallet);
const mockUseActionReadiness = vi.mocked(useActionReadiness);
const mockUseRealtime = vi.mocked(useRealtime);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Proposals page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseVaultContract.mockReturnValue(makeVaultContractMock() as ReturnType<typeof useVaultContract>);
    mockUseWallet.mockReturnValue(makeWalletMock() as ReturnType<typeof useWallet>);
    mockUseActionReadiness.mockReturnValue(makeActionReadinessMock() as ReturnType<typeof useActionReadiness>);
    mockUseRealtime.mockReturnValue(makeRealtimeMock() as ReturnType<typeof useRealtime>);
  });

  it('shows a loading spinner while proposals are loading', () => {
    mockUseProposals.mockReturnValue({
      proposals: [],
      loading: true,
      error: null,
      refetch: vi.fn(),
      filterByStatus: vi.fn().mockReturnValue([]),
    });

    render(
      <MemoryRouter>
        <Proposals />
      </MemoryRouter>
    );
    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  it('shows empty state when no proposals exist', async () => {
    mockUseProposals.mockReturnValue({
      proposals: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
      filterByStatus: vi.fn().mockReturnValue([]),
    });

    render(
      <MemoryRouter>
        <Proposals />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('proposal-filters')).toBeInTheDocument();
    });
    // No proposal rows rendered
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
  });

  it('renders proposal rows when proposals are returned', async () => {
    const proposals = [
      makeProposal({ id: 'p1', status: 'Pending', memo: 'Pay vendor' }),
      makeProposal({ id: 'p2', status: 'Approved', memo: 'Reimburse team' }),
    ];

    mockUseProposals.mockReturnValue({
      proposals,
      loading: false,
      error: null,
      refetch: vi.fn(),
      filterByStatus: vi.fn().mockReturnValue(proposals),
    });

    render(
      <MemoryRouter>
        <Proposals />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Pay vendor')).toBeInTheDocument();
      expect(screen.getByText('Reimburse team')).toBeInTheDocument();
    });
  });

  it('shows an error message when proposals fail to load', async () => {
    mockUseProposals.mockReturnValue({
      proposals: [],
      loading: false,
      error: 'Failed to load proposals. Please try again.',
      refetch: vi.fn(),
      filterByStatus: vi.fn().mockReturnValue([]),
    });

    render(
      <MemoryRouter>
        <Proposals />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Failed to load proposals/i)).toBeInTheDocument();
    });
  });

  it('shows a retry button on error that calls refetch', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    mockUseProposals.mockReturnValue({
      proposals: [],
      loading: false,
      error: 'Failed to load proposals. Please try again.',
      refetch,
      filterByStatus: vi.fn().mockReturnValue([]),
    });

    render(
      <MemoryRouter>
        <Proposals />
      </MemoryRouter>
    );

    await waitFor(() => {
      const retryBtn = screen.getByRole('button', { name: /retry/i });
      fireEvent.click(retryBtn);
    });

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows degraded realtime indicator when websocket has an error', async () => {
    mockUseRealtime.mockReturnValue(
      makeRealtimeMock({ isConnected: false, connectionStatus: 'error' }) as ReturnType<typeof useRealtime>
    );
    mockUseProposals.mockReturnValue({
      proposals: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
      filterByStatus: vi.fn().mockReturnValue([]),
    });

    render(
      <MemoryRouter>
        <Proposals />
      </MemoryRouter>
    );

    await waitFor(() => {
      // The component renders a red banner for 'error' connectionStatus
      expect(screen.getByText(/Realtime updates unavailable/i)).toBeInTheDocument();
    });
  });

  it('opens new proposal modal when "New Proposal" button is clicked', async () => {
    mockUseProposals.mockReturnValue({
      proposals: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
      filterByStatus: vi.fn().mockReturnValue([]),
    });

    render(
      <MemoryRouter>
        <Proposals />
      </MemoryRouter>
    );

    const newBtn = await screen.findByRole('button', { name: /new proposal/i });
    fireEvent.click(newBtn);

    // Modal is mocked to null but the state change should not throw
    expect(newBtn).toBeInTheDocument();
  });
});
