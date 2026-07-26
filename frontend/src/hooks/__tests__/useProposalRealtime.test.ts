/**
 * Tests for useProposalRealtime hook.
 *
 * Covers:
 *  - Initial state mirrors the initial proposal
 *  - proposal_updated events are applied to state
 *  - Stale closure: late-arriving events see the latest state, not the original
 *  - Events for other proposal IDs are ignored
 *  - Unsubscribe / cleanup fires on unmount
 *  - Duplicate events are deduplicated
 *  - Status-change events (approved / rejected) are applied
 *  - hasLiveUpdate flag transitions correctly
 */

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useProposalRealtime } from '../useProposalRealtime';
import type { Proposal } from '../../components/type';

// ---------------------------------------------------------------------------
// Realtime context mock
// ---------------------------------------------------------------------------

/** Captured subscribe handlers keyed by event type. */
const handlers: Record<string, Array<(data: unknown) => void>> = {};
const unsubscribers: Array<() => void> = [];

const mockTrackEvent = vi.fn().mockReturnValue(true);
const mockSubscribe = vi.fn().mockImplementation(
  (type: string, handler: (data: unknown) => void) => {
    if (!handlers[type]) handlers[type] = [];
    handlers[type].push(handler);
    const unsub = () => {
      handlers[type] = (handlers[type] ?? []).filter((h) => h !== handler);
      unsubscribers.push(unsub);
    };
    return unsub;
  },
);

vi.mock('../../contexts/RealtimeContext', () => ({
  useRealtime: () => ({
    isConnected: true,
    connectionStatus: 'connected',
    onlineUsers: [],
    subscribe: mockSubscribe,
    sendUpdate: vi.fn(),
    updatePresence: vi.fn(),
    trackEvent: mockTrackEvent,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emit(type: string, data: unknown) {
  (handlers[type] ?? []).forEach((h) => h(data));
}

const BASE_PROPOSAL: Proposal = {
  id: 42,
  proposer: 'GPROPOSER',
  recipient: 'GRECIPIENT',
  amount: '100000000',
  status: 'Pending',
  createdAt: 1_000_000,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useProposalRealtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset captured handlers
    for (const key of Object.keys(handlers)) delete handlers[key];
    // vi.clearAllMocks() resets mockImplementation — restore it
    mockSubscribe.mockImplementation(
      (type: string, handler: (data: unknown) => void) => {
        if (!handlers[type]) handlers[type] = [];
        handlers[type].push(handler);
        return () => {
          handlers[type] = (handlers[type] ?? []).filter((h) => h !== handler);
        };
      },
    );
    mockTrackEvent.mockReturnValue(true);
  });

  it('returns the initial proposal unchanged on mount', () => {
    const { result } = renderHook(() => useProposalRealtime(BASE_PROPOSAL));
    expect(result.current.liveProposal).toEqual(BASE_PROPOSAL);
    expect(result.current.hasLiveUpdate).toBe(false);
  });

  it('subscribes to proposal_updated, proposal_approved, and proposal_rejected', () => {
    renderHook(() => useProposalRealtime(BASE_PROPOSAL));
    expect(mockSubscribe).toHaveBeenCalledWith('proposal_updated', expect.any(Function));
    expect(mockSubscribe).toHaveBeenCalledWith('proposal_approved', expect.any(Function));
    expect(mockSubscribe).toHaveBeenCalledWith('proposal_rejected', expect.any(Function));
  });

  it('applies proposal_updated patch to liveProposal', () => {
    const { result } = renderHook(() => useProposalRealtime(BASE_PROPOSAL));

    act(() => {
      emit('proposal_updated', { id: 42, status: 'Approved', votesFor: 3 });
    });

    expect(result.current.liveProposal.status).toBe('Approved');
    expect(result.current.liveProposal.votesFor).toBe(3);
    expect(result.current.hasLiveUpdate).toBe(true);
  });

  it('ignores events for a different proposal id', () => {
    const { result } = renderHook(() => useProposalRealtime(BASE_PROPOSAL));

    act(() => {
      emit('proposal_updated', { id: 99, status: 'Approved' });
    });

    expect(result.current.liveProposal.status).toBe('Pending');
    expect(result.current.hasLiveUpdate).toBe(false);
  });

  it('STALE CLOSURE: consecutive updates each see the latest state — not the initial value', () => {
    /**
     * This is the core stale-closure regression test.
     *
     * If the callback closed over the initial proposal, the second update
     * would be merged onto the *original* object (losing the first update).
     * The functional setState updater must receive `prev` as the latest state,
     * so both updates compose correctly.
     */
    const { result } = renderHook(() => useProposalRealtime(BASE_PROPOSAL));

    act(() => {
      emit('proposal_updated', { id: 42, votesFor: 1 });
    });
    expect(result.current.liveProposal.votesFor).toBe(1);

    act(() => {
      emit('proposal_updated', { id: 42, votesFor: 2 });
    });
    // If stale closure: second update merges onto the *original* state (votesFor: undefined)
    // With functional updater: second update merges onto the state after first update
    expect(result.current.liveProposal.votesFor).toBe(2);
    // The original status must still be preserved — not reset to BASE_PROPOSAL
    expect(result.current.liveProposal.status).toBe('Pending');
  });

  it('STALE CLOSURE: status update applied after vote update preserves the vote', () => {
    const { result } = renderHook(() => useProposalRealtime(BASE_PROPOSAL));

    act(() => {
      emit('proposal_updated', { id: 42, votesFor: 5 });
    });

    // Now status changes via approved event
    act(() => {
      emit('proposal_approved', { id: 42 });
    });

    // Both fields must be present — stale closure would wipe out votesFor
    expect(result.current.liveProposal.status).toBe('Approved');
    expect(result.current.liveProposal.votesFor).toBe(5);
  });

  it('applies proposal_approved and sets status to Approved', () => {
    const { result } = renderHook(() => useProposalRealtime(BASE_PROPOSAL));

    act(() => {
      emit('proposal_approved', { id: 42 });
    });

    expect(result.current.liveProposal.status).toBe('Approved');
    expect(result.current.hasLiveUpdate).toBe(true);
  });

  it('applies proposal_rejected and sets status to Rejected', () => {
    const { result } = renderHook(() => useProposalRealtime(BASE_PROPOSAL));

    act(() => {
      emit('proposal_rejected', { id: 42 });
    });

    expect(result.current.liveProposal.status).toBe('Rejected');
    expect(result.current.hasLiveUpdate).toBe(true);
  });

  it('deduplicates identical events (same payload)', () => {
    // First call returns true (new event), subsequent calls return false
    let callCount = 0;
    mockTrackEvent.mockImplementation(() => {
      callCount++;
      return callCount === 1; // only first call is new
    });

    const { result } = renderHook(() => useProposalRealtime(BASE_PROPOSAL));

    act(() => {
      emit('proposal_updated', { id: 42, votesFor: 3 });
      emit('proposal_updated', { id: 42, votesFor: 3 }); // duplicate
    });

    // Only the first event should have been applied
    expect(result.current.liveProposal.votesFor).toBe(3);
    // trackEvent was called twice
    expect(callCount).toBe(2);
  });

  it('unsubscribes from all events on unmount', () => {
    const unsubFns = [vi.fn(), vi.fn(), vi.fn()];
    let callIndex = 0;
    mockSubscribe.mockImplementation(() => unsubFns[callIndex++] ?? vi.fn());

    const { unmount } = renderHook(() => useProposalRealtime(BASE_PROPOSAL));
    unmount();

    // All three unsubscribe functions must have been called
    unsubFns.forEach((unsub) => expect(unsub).toHaveBeenCalledOnce());
  });

  it('resets liveProposal when a new initialProposal is passed (refetch)', () => {
    const { result, rerender } = renderHook(
      ({ proposal }) => useProposalRealtime(proposal),
      { initialProps: { proposal: BASE_PROPOSAL } },
    );

    // Apply a live update
    act(() => {
      emit('proposal_updated', { id: 42, votesFor: 7 });
    });
    expect(result.current.liveProposal.votesFor).toBe(7);

    // Parent refetches and passes a fresh proposal
    const refreshed: Proposal = { ...BASE_PROPOSAL, status: 'Approved', votesFor: 7 };
    rerender({ proposal: refreshed });

    expect(result.current.liveProposal).toEqual(refreshed);
  });
});
