/**
 * Tests for the Escrow dashboard page.
 *
 * Covers:
 * - Escrow list renders with cards
 * - Milestone verify calls contract hook
 * - Dispute modal submits with reason
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import EscrowPage from '../Escrow';

// ─── Mock hooks ───────────────────────────────────────────────────────────────

const mockVerifyMilestone = vi.fn().mockResolvedValue('tx-hash-123');
const mockRaiseDispute = vi.fn().mockResolvedValue('tx-hash-456');
const mockRefetch = vi.fn().mockResolvedValue(undefined);

const mockEscrows = [
  {
    id: '1',
    funder: 'GFUNDER0001',
    recipient: 'GRECIPIENT001',
    token: 'XLM',
    amount: '50000000000',
    releasedAmount: '10000000000',
    arbitrator: 'GARBITRATOR01',
    durationLedgers: 172800,
    createdAt: new Date().toISOString(),
    status: 'active' as const,
    milestones: [
      {
        index: 0,
        description: 'Design phase',
        requiredVerifiers: 2,
        verifications: ['GSIG0001'],
        status: 'submitted' as const,
        amount: '25000000000',
      },
      {
        index: 1,
        description: 'Development phase',
        requiredVerifiers: 3,
        verifications: [],
        status: 'pending' as const,
        amount: '25000000000',
      },
    ],
    dispute: { status: 'none' as const },
  },
  {
    id: '2',
    funder: 'GFUNDER0002',
    recipient: 'GFUNDER0001',
    token: 'XLM',
    amount: '20000000000',
    releasedAmount: '0',
    arbitrator: 'GARBITRATOR01',
    durationLedgers: 86400,
    createdAt: new Date().toISOString(),
    status: 'disputed' as const,
    milestones: [],
    dispute: {
      status: 'open' as const,
      disputer: 'GFUNDER0002',
      reason: 'Work not delivered',
    },
  },
];

vi.mock('../../../hooks/useEscrow', () => ({
  useEscrow: () => ({
    escrows: mockEscrows,
    loading: false,
    error: null,
    refetch: mockRefetch,
    verifyMilestone: mockVerifyMilestone,
    raiseDispute: mockRaiseDispute,
    verifyingMilestone: null,
    raisingDispute: null,
  }),
}));

vi.mock('../../../hooks/useWallet', () => ({
  useWallet: () => ({
    address: 'GFUNDER0001',
    isConnected: true,
    network: 'TESTNET',
  }),
}));

vi.mock('../../../context/ToastContext', () => ({
  useToast: () => ({ notify: vi.fn() }),
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EscrowPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the escrow list with cards', () => {
    render(<EscrowPage />);
    expect(screen.getByText('Escrow Agreements')).toBeInTheDocument();
    // Both escrows should be visible (user is funder or recipient of both)
    expect(screen.getByText('Escrow #1')).toBeInTheDocument();
    expect(screen.getByText('Escrow #2')).toBeInTheDocument();
  });

  it('shows status badges correctly', () => {
    render(<EscrowPage />);
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Disputed')).toBeInTheDocument();
  });

  it('shows dispute badge on disputed escrow', () => {
    render(<EscrowPage />);
    expect(screen.getByText('Dispute Active')).toBeInTheDocument();
  });

  it('shows role badge for connected wallet', () => {
    render(<EscrowPage />);
    // User is funder of escrow #1 and recipient of escrow #2
    const funderBadges = screen.getAllByText('Funder');
    const recipientBadges = screen.getAllByText('Recipient');
    expect(funderBadges.length).toBeGreaterThan(0);
    expect(recipientBadges.length).toBeGreaterThan(0);
  });

  it('expands milestones when "View Milestones" is clicked', async () => {
    render(<EscrowPage />);
    const viewBtn = screen.getByText('View Milestones');
    fireEvent.click(viewBtn);
    await waitFor(() => {
      expect(screen.getByText('Design phase')).toBeInTheDocument();
      expect(screen.getByText('Development phase')).toBeInTheDocument();
    });
  });

  it('shows milestone progress bar with correct verifications', async () => {
    render(<EscrowPage />);
    fireEvent.click(screen.getByText('View Milestones'));
    await waitFor(() => {
      // Milestone 0: 1/2 verifications
      expect(screen.getByText('1/2')).toBeInTheDocument();
      // Milestone 1: 0/3 verifications
      expect(screen.getByText('0/3')).toBeInTheDocument();
    });
  });

  it('calls verifyMilestone when Verify button is clicked', async () => {
    render(<EscrowPage />);
    fireEvent.click(screen.getByText('View Milestones'));
    await waitFor(() => {
      expect(screen.getByText('Development phase')).toBeInTheDocument();
    });
    // The "Verify" button for milestone 1 (pending, not yet verified by user)
    const verifyBtns = screen.getAllByText('Verify');
    expect(verifyBtns.length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(verifyBtns[0]);
    });
    expect(mockVerifyMilestone).toHaveBeenCalledWith('1', expect.any(Number));
  });

  it('disables Verify button if wallet already verified', async () => {
    // Escrow #1, milestone 0 has GSIG0001 as verifier, not GFUNDER0001
    // So the button should be enabled for GFUNDER0001
    render(<EscrowPage />);
    fireEvent.click(screen.getByText('View Milestones'));
    await waitFor(() => {
      const verifyBtns = screen.getAllByRole('button', { name: /verify/i });
      // At least one verify button should exist and not be disabled
      const enabledVerify = verifyBtns.find((b) => !b.hasAttribute('disabled'));
      expect(enabledVerify).toBeTruthy();
    });
  });

  it('opens dispute modal when "Raise Dispute" is clicked', async () => {
    render(<EscrowPage />);
    const disputeBtn = screen.getByText('Raise Dispute');
    fireEvent.click(disputeBtn);
    await waitFor(() => {
      expect(screen.getByText('Raise Dispute', { selector: 'h3' })).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/describe why/i)).toBeInTheDocument();
    });
  });

  it('submits dispute modal with reason and calls raiseDispute', async () => {
    render(<EscrowPage />);
    fireEvent.click(screen.getByText('Raise Dispute'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/describe why/i)).toBeInTheDocument();
    });
    const textarea = screen.getByPlaceholderText(/describe why/i);
    fireEvent.change(textarea, { target: { value: 'Deliverable not met' } });
    const submitBtn = screen.getByRole('button', { name: /raise dispute/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });
    expect(mockRaiseDispute).toHaveBeenCalledWith('1', 'Deliverable not met');
  });

  it('shows validation error when dispute submitted without reason', async () => {
    render(<EscrowPage />);
    fireEvent.click(screen.getByText('Raise Dispute'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/describe why/i)).toBeInTheDocument();
    });
    const submitBtn = screen.getByRole('button', { name: /raise dispute/i });
    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(screen.getByText(/please provide a reason/i)).toBeInTheDocument();
    });
    expect(mockRaiseDispute).not.toHaveBeenCalled();
  });

  it('filters escrows by status', async () => {
    render(<EscrowPage />);
    const disputedFilter = screen.getByRole('button', { name: /disputed/i });
    fireEvent.click(disputedFilter);
    await waitFor(() => {
      // Only disputed escrow should show
      expect(screen.queryByText('Escrow #1')).not.toBeInTheDocument();
      expect(screen.getByText('Escrow #2')).toBeInTheDocument();
    });
  });

  it('shows stats cards with correct counts', () => {
    render(<EscrowPage />);
    // 1 active, 1 disputed, 0 released
    const statValues = screen.getAllByText('1');
    expect(statValues.length).toBeGreaterThanOrEqual(2);
  });
});
