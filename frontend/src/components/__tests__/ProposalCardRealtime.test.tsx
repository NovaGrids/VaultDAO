/**
 * Tests for realtime vote updates in ProposalCard and useProposals.
 *
 * Covers:
 *  - WebSocket event updates vote count without full re-render
 *  - Toast fires when proposal creator's proposal reaches threshold
 *  - Vote progress bar renders correctly
 *  - Pulsing dot shown when vote is in progress
 */

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import ProposalCard from '../ProposalCard';
import type { LiveVoteData } from '../ProposalCard';
import type { Proposal as ProposalType } from '../type';
import { useProposals } from '../../hooks/useProposals';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockSubscribeHandlers: Record<string, ((data: unknown) => void)[]> = {};
const mockTrackEvent = vi.fn().mockReturnValue(true);
const mockNotify = vi.fn();

vi.mock('../../contexts/RealtimeContext', () => ({
  useRealtime: () => ({
    isConnected: true,
    connectionStatus: 'connected',
    subscribe: vi.fn((type: string, handler: (data: unknown) => void) => {
      if (!mockSubscribeHandlers[type]) mockSubscribeHandlers[type] = [];
      mockSubscribeHandlers[type].push(handler);
      return () => {
        mockSubscribeHandlers[type] = mockSubscribeHandlers[type].filter((h) => h !== handler);
      };
    }),
    trackEvent: mockTrackEvent,
    sendUpdate: vi.fn(),
    updatePresence: vi.fn(),
    onlineUsers: [],
  }),
}));

vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({
    showToast: vi.fn(),
    notify: mockNotify,
    sendTestNotification: vi.fn(),
  }),
}));

const mockGetProposals = vi.fn();

vi.mock('../../hooks/useVaultContract', () => ({
  useVaultContract: () => ({
    getProposals: mockGetProposals,
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WALLET = 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';

const makeProposal = (overrides = {}): ProposalType => ({
  id: 1,
  proposer: WALLET,
  recipient: 'GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
  amount: '1000000000',
  status: 'Pending',
  description: 'Test proposal',
  createdAt: 1234567890,
  ...overrides,
});

function emitEvent(type: string, data: unknown) {
  const handlers = mockSubscribeHandlers[type] ?? [];
  handlers.forEach((h) => h(data));
}

// ─── ProposalCard tests ───────────────────────────────────────────────────────

describe('ProposalCard', () => {
  it('renders basic proposal info', () => {
    render(<ProposalCard proposal={makeProposal()} />);
    expect(screen.getByText('Proposal #1')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('does not show vote bar when liveVote is not provided', () => {
    render(<ProposalCard proposal={makeProposal()} />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('does not show vote bar when isVoteInProgress is false', () => {
    const liveVote: LiveVoteData = { approvals: 1, threshold: 3, isVoteInProgress: false };
    render(<ProposalCard proposal={makeProposal()} liveVote={liveVote} />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows vote progress bar when vote is in progress', () => {
    const liveVote: LiveVoteData = { approvals: 1, threshold: 3, isVoteInProgress: true };
    render(<ProposalCard proposal={makeProposal()} liveVote={liveVote} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '3');
  });

  it('shows "X of Y approvals" counter', () => {
    const liveVote: LiveVoteData = { approvals: 2, threshold: 3, isVoteInProgress: true };
    render(<ProposalCard proposal={makeProposal()} liveVote={liveVote} />);
    expect(screen.getByLabelText(/2 of 3 approvals/i)).toBeInTheDocument();
  });

  it('shows pulsing green dot when vote is in progress and threshold not met', () => {
    const liveVote: LiveVoteData = { approvals: 1, threshold: 3, isVoteInProgress: true };
    const { container } = render(<ProposalCard proposal={makeProposal()} liveVote={liveVote} />);
    // The pulsing dot has animate-pulse class
    const dot = container.querySelector('.animate-pulse');
    expect(dot).toBeInTheDocument();
  });

  it('does not show pulsing dot when threshold is met', () => {
    const liveVote: LiveVoteData = { approvals: 3, threshold: 3, isVoteInProgress: true };
    const { container } = render(<ProposalCard proposal={makeProposal()} liveVote={liveVote} />);
    const dot = container.querySelector('.animate-pulse');
    expect(dot).not.toBeInTheDocument();
  });

  it('shows "Ready to execute" when threshold is met', () => {
    const liveVote: LiveVoteData = { approvals: 3, threshold: 3, isVoteInProgress: true };
    render(<ProposalCard proposal={makeProposal()} liveVote={liveVote} />);
    expect(screen.getByText(/ready to execute/i)).toBeInTheDocument();
  });

  it('has accessible aria-label with proposal ID and status', () => {
    render(<ProposalCard proposal={makeProposal()} />);
    const article = screen.getByRole('article');
    expect(article).toHaveAttribute('aria-label', 'Proposal #1, status: Pending');
  });

  it('is keyboard accessible with tabIndex=0', () => {
    render(<ProposalCard proposal={makeProposal()} />);
    expect(screen.getByRole('article')).toHaveAttribute('tabIndex', '0');
  });
});

// ─── useProposals realtime tests ──────────────────────────────────────────────

describe('useProposals — realtime vote updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockSubscribeHandlers).forEach((k) => {
      mockSubscribeHandlers[k] = [];
    });
    mockTrackEvent.mockReturnValue(true);
  });

  const initialProposals = [
    {
      id: 'prop-1',
      proposer: WALLET,
      recipient: 'GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
      amount: '100',
      token: 'NATIVE',
      tokenSymbol: 'XLM',
      memo: 'Test',
      status: 'Pending',
      approvals: 1,
      threshold: 2,
      approvedBy: ['GSIG1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB'],
      createdAt: new Date().toISOString(),
    },
  ];

  it('updates vote count on proposal_approved event', async () => {
    mockGetProposals.mockResolvedValue(initialProposals);

    const { result } = renderHook(() => useProposals(WALLET));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.proposals[0].approvals).toBe(1);

    act(() => {
      emitEvent('proposal_approved', {
        id: 'prop-1',
        approver: 'GNEW1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
        eventId: 'evt-approved-1',
      });
    });

    await waitFor(() => {
      expect(result.current.proposals[0].approvals).toBe(2);
    });
  });

  it('updates status to Approved when threshold is reached', async () => {
    mockGetProposals.mockResolvedValue(initialProposals);

    const { result } = renderHook(() => useProposals(WALLET));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      emitEvent('proposal_approved', {
        id: 'prop-1',
        approver: 'GNEW1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
        eventId: 'evt-approved-2',
      });
    });

    await waitFor(() => {
      expect(result.current.proposals[0].status).toBe('Approved');
    });
  });

  it('fires toast when the connected wallet created the proposal and threshold is reached', async () => {
    mockGetProposals.mockResolvedValue(initialProposals);

    renderHook(() => useProposals(WALLET));

    await waitFor(() => {
      // Wait for subscriptions to be set up
      expect(mockSubscribeHandlers['proposal_approved']).toBeDefined();
    });

    act(() => {
      emitEvent('proposal_approved', {
        id: 'prop-1',
        approver: 'GNEW1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
        eventId: 'evt-approved-3',
      });
    });

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith(
        'proposal_approved',
        expect.stringContaining('prop-1'),
        'success',
      );
    });
  });

  it('does not fire threshold toast for proposals created by other wallets', async () => {
    const otherWallet = 'GOTHER234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890A';
    const proposalByOther = [{ ...initialProposals[0], proposer: otherWallet }];
    mockGetProposals.mockResolvedValue(proposalByOther);

    renderHook(() => useProposals(WALLET));

    await waitFor(() => {
      expect(mockSubscribeHandlers['proposal_approved']).toBeDefined();
    });

    act(() => {
      emitEvent('proposal_approved', {
        id: 'prop-1',
        approver: 'GNEW1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
        eventId: 'evt-approved-4',
      });
    });

    // Give time for any async effects
    await new Promise((r) => setTimeout(r, 50));

    // Toast should NOT have been called with threshold message
    const thresholdCalls = mockNotify.mock.calls.filter(
      (call) => call[0] === 'proposal_approved' && call[2] === 'success'
    );
    expect(thresholdCalls).toHaveLength(0);
  });

  it('deduplicates events using trackEvent', async () => {
    mockGetProposals.mockResolvedValue(initialProposals);

    const { result } = renderHook(() => useProposals(WALLET));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // First event: trackEvent returns true (new)
    mockTrackEvent.mockReturnValueOnce(true);
    act(() => {
      emitEvent('proposal_approved', {
        id: 'prop-1',
        approver: 'GNEW1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
        eventId: 'evt-dup-1',
      });
    });

    await waitFor(() => expect(result.current.proposals[0].approvals).toBe(2));

    // Second event with same ID: trackEvent returns false (duplicate)
    mockTrackEvent.mockReturnValueOnce(false);
    act(() => {
      emitEvent('proposal_approved', {
        id: 'prop-1',
        approver: 'GNEW1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB',
        eventId: 'evt-dup-1',
      });
    });

    // Count should not increase again
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.proposals[0].approvals).toBe(2);
  });

  it('updates status to Approved on proposal_ready event', async () => {
    mockGetProposals.mockResolvedValue(initialProposals);

    const { result } = renderHook(() => useProposals(WALLET));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      emitEvent('proposal_ready', { id: 'prop-1', eventId: 'evt-ready-1' });
    });

    await waitFor(() => {
      expect(result.current.proposals[0].status).toBe('Approved');
    });
  });
});
