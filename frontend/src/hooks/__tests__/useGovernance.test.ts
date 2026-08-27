/**
 * Tests for useGovernance hook.
 *
 * useGovernance derives a signer leaderboard (vote tallies, participation
 * rate, and a weighted reputation score) from on-chain contract events, plus
 * per-signer activity history. Covers:
 *  - Fallback to mock leaderboard data when the RPC has no events, or fails
 *  - Vote tallying and reputation-score ("vote weight") computation from
 *    aggregated approve/abstain/create events
 *  - Threshold-style branches: recognized vs. unrecognized event symbols,
 *    decode failures, and the "no signer stats" fallback
 *  - Leaderboard sorting across every filter field and order
 *  - Signer activity fetching, its own mock fallback, and loading flag
 *  - refetch(), the 60s polling interval, and the websocket-driven refresh
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest';
import { useGovernance, roleFromNumber } from '../useGovernance';
import { useWallet } from '../useWallet';
import { useRealtime } from '../../contexts/RealtimeContext';

vi.mock('../useWallet', () => ({
  useWallet: vi.fn(),
}));

vi.mock('../../contexts/RealtimeContext', () => ({
  useRealtime: vi.fn(),
}));

// `getEventSymbol`/`getActorFromValue` in the hook round-trip values through
// `xdr.ScVal.fromXDR` and `scValToNative`. Rather than construct real XDR, we
// mock both to a simple string convention so tests can drive every branch:
//   "sym:<name>"      -> decodes to the symbol string <name>
//   "actor:<addr>"    -> decodes to an array whose first element is <addr>
//   "actorobj:<addr>" -> decodes to an array whose first element is {address}
//   "throw"           -> decoding throws, exercising the catch branches
vi.mock('stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('stellar-sdk')>();
  return {
    ...actual,
    xdr: {
      ...actual.xdr,
      ScVal: {
        ...actual.xdr.ScVal,
        fromXDR: vi.fn((v: string) => v),
      },
    },
    scValToNative: vi.fn((raw: unknown) => {
      if (typeof raw !== 'string') return raw;
      if (raw === 'throw') throw new Error('decode failure');
      if (raw.startsWith('sym:')) return raw.slice(4);
      if (raw.startsWith('actor:')) return [raw.slice(6)];
      if (raw.startsWith('actorobj:')) return [{ address: raw.slice(9) }];
      if (raw.startsWith('actorstr:')) return raw.slice(9);
      return raw;
    }),
  };
});

type RpcEvent = {
  id: string;
  topic?: string[];
  value?: { xdr?: string };
  ledgerClosedAt?: string;
};

function mockRpcResponses(events: RpcEvent[]) {
  (global.fetch as Mock).mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { method: string };
    if (body.method === 'getLatestLedger') {
      return { json: async () => ({ result: { sequence: 1000 } }) };
    }
    return { json: async () => ({ result: { events } }) };
  });
}

function mockRpcFailure() {
  (global.fetch as Mock).mockRejectedValue(new Error('network down'));
}

const CONNECTED_ADDRESS = 'GSELF0000000000000000000000000000000000000000000000000000';

describe('useGovernance', () => {
  let mockSubscribe: Mock;
  let capturedHandlers: Record<string, (data: unknown) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();

    (useWallet as Mock).mockReturnValue({ address: CONNECTED_ADDRESS });

    capturedHandlers = {};
    mockSubscribe = vi.fn((type: string, handler: (data: unknown) => void) => {
      capturedHandlers[type] = handler;
      return vi.fn();
    });
    (useRealtime as Mock).mockReturnValue({ subscribe: mockSubscribe });

    global.fetch = vi.fn();
    mockRpcResponses([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('roleFromNumber', () => {
    it('maps 2 to Admin, 1 to Treasurer, and anything else to Member', () => {
      expect(roleFromNumber(2)).toBe('Admin');
      expect(roleFromNumber(1)).toBe('Treasurer');
      expect(roleFromNumber(0)).toBe('Member');
      expect(roleFromNumber(99)).toBe('Member');
    });
  });

  describe('mock data fallback', () => {
    it('falls back to mock leaderboard when no events are returned', async () => {
      mockRpcResponses([]);

      const { result } = renderHook(() => useGovernance());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.leaderboard).toHaveLength(5);
      expect(result.current.leaderboard[0].address).toBeDefined();
      expect(result.current.error).toBeNull();
    });

    it('uses the connected wallet address for the first mock record', async () => {
      mockRpcResponses([]);

      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(
        result.current.leaderboard.some((r) => r.address === CONNECTED_ADDRESS),
      ).toBe(true);
    });

    it('falls back to mock leaderboard when the RPC call throws', async () => {
      mockRpcFailure();

      const { result } = renderHook(() => useGovernance());

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.leaderboard).toHaveLength(5);
      // The hook swallows the error into a console.error + mock fallback;
      // it never actually populates `error`.
      expect(result.current.error).toBeNull();
    });

    it('falls back to mock leaderboard when events exist but none are recognized signer events', async () => {
      mockRpcResponses([
        { id: '1', topic: ['sym:unknown_event'], value: { xdr: 'actor:GXXX' }, ledgerClosedAt: '2026-01-01T00:00:00Z' },
        { id: '2', topic: undefined },
      ]);

      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.leaderboard).toHaveLength(5);
    });
  });

  describe('vote tallying and reputation scoring', () => {
    it('aggregates approvals, abstentions, and proposals-created per signer', async () => {
      mockRpcResponses([
        { id: '1', topic: ['sym:proposal_approved'], value: { xdr: 'actor:GALICE' }, ledgerClosedAt: '2026-01-01T00:00:00Z' },
        { id: '2', topic: ['sym:proposal_approved'], value: { xdr: 'actor:GALICE' }, ledgerClosedAt: '2026-01-02T00:00:00Z' },
        { id: '3', topic: ['sym:proposal_approved'], value: { xdr: 'actor:GALICE' }, ledgerClosedAt: '2026-01-03T00:00:00Z' },
        { id: '4', topic: ['sym:proposal_abstained'], value: { xdr: 'actor:GALICE' }, ledgerClosedAt: '2026-01-04T00:00:00Z' },
        { id: '5', topic: ['sym:proposal_created'], value: { xdr: 'actor:GALICE' }, ledgerClosedAt: '2026-01-05T00:00:00Z' },
        { id: '6', topic: ['sym:proposal_created'], value: { xdr: 'actor:GALICE' }, ledgerClosedAt: '2026-01-06T00:00:00Z' },
        { id: '7', topic: ['sym:proposal_approved'], value: { xdr: 'actor:GBOB' }, ledgerClosedAt: '2026-01-07T00:00:00Z' },
      ]);

      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const alice = result.current.leaderboard.find((r) => r.address === 'GALICE');
      const bob = result.current.leaderboard.find((r) => r.address === 'GBOB');

      expect(alice).toBeDefined();
      expect(alice!.approvalsGiven).toBe(3);
      expect(alice!.abstentions).toBe(1);
      expect(alice!.proposalsCreated).toBe(2);
      expect(alice!.participationRate).toBe(0.75); // 3 approvals / 4 total votes
      // score = round(3*6 + 0.75*300 + 2*10) = round(18 + 225 + 20) = 263
      expect(alice!.reputationScore).toBe(263);
      expect(alice!.lastActive).toBe('2026-01-06T00:00:00Z');

      expect(bob).toBeDefined();
      expect(bob!.approvalsGiven).toBe(1);
      expect(bob!.participationRate).toBe(1);
      // score = round(1*6 + 1*300 + 0) = 306
      expect(bob!.reputationScore).toBe(306);
    });

    it('caps the reputation score at 1000', async () => {
      const events: RpcEvent[] = Array.from({ length: 200 }, (_, i) => ({
        id: String(i),
        topic: ['sym:proposal_approved'],
        value: { xdr: 'actor:GWHALE' },
        ledgerClosedAt: '2026-01-01T00:00:00Z',
      }));
      mockRpcResponses(events);

      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const whale = result.current.leaderboard.find((r) => r.address === 'GWHALE');
      expect(whale!.reputationScore).toBe(1000);
    });

    it('registers signers from signer_added and role_assigned events with zero stats', async () => {
      mockRpcResponses([
        { id: '1', topic: ['sym:signer_added'], value: { xdr: 'actor:GNEW' }, ledgerClosedAt: '2026-01-01T00:00:00Z' },
        { id: '2', topic: ['sym:role_assigned'], value: { xdr: 'actor:GNEW2' }, ledgerClosedAt: '2026-01-01T00:00:00Z' },
      ]);

      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const newSigner = result.current.leaderboard.find((r) => r.address === 'GNEW');
      expect(newSigner).toBeDefined();
      expect(newSigner!.approvalsGiven).toBe(0);
      expect(newSigner!.reputationScore).toBe(0);
    });

    it('ignores events with a recognized symbol but no resolvable actor', async () => {
      mockRpcResponses([
        { id: '1', topic: ['sym:proposal_approved'], value: undefined, ledgerClosedAt: '2026-01-01T00:00:00Z' },
      ]);

      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      // No signer stats produced -> falls back to mock leaderboard.
      expect(result.current.leaderboard).toHaveLength(5);
    });

    it('resolves an actor represented as an object with an address field', async () => {
      mockRpcResponses([
        { id: '1', topic: ['sym:proposal_approved'], value: { xdr: 'actorobj:GOBJ' }, ledgerClosedAt: '2026-01-01T00:00:00Z' },
      ]);

      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.leaderboard.find((r) => r.address === 'GOBJ')).toBeDefined();
    });

    it('resolves an actor represented as a bare (non-array) string', async () => {
      mockRpcResponses([
        { id: '1', topic: ['sym:proposal_approved'], value: { xdr: 'actorstr:GPLAIN' }, ledgerClosedAt: '2026-01-01T00:00:00Z' },
      ]);

      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.leaderboard.find((r) => r.address === 'GPLAIN')).toBeDefined();
    });

    it('skips events whose topic or value fails to decode', async () => {
      mockRpcResponses([
        { id: '1', topic: ['throw'], value: { xdr: 'actor:GALICE' }, ledgerClosedAt: '2026-01-01T00:00:00Z' },
        { id: '2', topic: ['sym:proposal_approved'], value: { xdr: 'throw' }, ledgerClosedAt: '2026-01-01T00:00:00Z' },
      ]);

      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      // Both events fail to yield a usable signer -> mock fallback.
      expect(result.current.leaderboard).toHaveLength(5);
    });
  });

  describe('leaderboard sorting', () => {
    async function setup() {
      mockRpcResponses([
        { id: '1', topic: ['sym:proposal_approved'], value: { xdr: 'actor:GALICE' }, ledgerClosedAt: '2026-01-01T00:00:00Z' },
        { id: '2', topic: ['sym:proposal_approved'], value: { xdr: 'actor:GALICE' }, ledgerClosedAt: '2026-01-05T00:00:00Z' },
        { id: '3', topic: ['sym:proposal_created'], value: { xdr: 'actor:GALICE' }, ledgerClosedAt: '2026-01-05T00:00:00Z' },
        { id: '4', topic: ['sym:proposal_approved'], value: { xdr: 'actor:GBOB' }, ledgerClosedAt: '2026-01-03T00:00:00Z' },
        { id: '5', topic: ['sym:proposal_created'], value: { xdr: 'actor:GCARL' }, ledgerClosedAt: '2026-01-02T00:00:00Z' },
      ]);
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));
      return result;
    }

    it('sorts by reputationScore descending by default', async () => {
      const result = await setup();
      const scores = result.current.leaderboard.map((r) => r.reputationScore);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    });

    it('sorts by approvalsGiven ascending when requested', async () => {
      const result = await setup();

      act(() => {
        result.current.setFilters({ sortBy: 'approvalsGiven', order: 'asc' });
      });

      const approvals = result.current.leaderboard.map((r) => r.approvalsGiven);
      expect(approvals).toEqual([...approvals].sort((a, b) => a - b));
    });

    it('sorts by participationRate descending', async () => {
      const result = await setup();

      act(() => {
        result.current.setFilters({ sortBy: 'participationRate', order: 'desc' });
      });

      const rates = result.current.leaderboard.map((r) => r.participationRate);
      expect(rates).toEqual([...rates].sort((a, b) => b - a));
    });

    it('sorts by proposalsCreated ascending', async () => {
      const result = await setup();

      act(() => {
        result.current.setFilters({ sortBy: 'proposalsCreated', order: 'asc' });
      });

      const created = result.current.leaderboard.map((r) => r.proposalsCreated);
      expect(created).toEqual([...created].sort((a, b) => a - b));
    });

    it('sorts by lastActive using timestamp comparison, both orders', async () => {
      const result = await setup();

      act(() => {
        result.current.setFilters({ sortBy: 'lastActive', order: 'asc' });
      });
      const asc = result.current.leaderboard.map((r) => r.lastActive);
      expect(asc).toEqual([...asc].sort());

      act(() => {
        result.current.setFilters({ sortBy: 'lastActive', order: 'desc' });
      });
      const desc = result.current.leaderboard.map((r) => r.lastActive);
      expect(desc).toEqual([...asc].reverse());
    });
  });

  describe('fetchSignerActivity', () => {
    it('returns matching activity events for the requested signer', async () => {
      mockRpcResponses([]);
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      mockRpcResponses([
        { id: 'a1', topic: ['sym:proposal_approved'], value: { xdr: 'actor:GALICE' }, ledgerClosedAt: '2026-01-01T00:00:00Z' },
        { id: 'a2', topic: ['sym:proposal_approved'], value: { xdr: 'actor:GBOB' }, ledgerClosedAt: '2026-01-02T00:00:00Z' },
      ]);

      let activity;
      await act(async () => {
        activity = await result.current.fetchSignerActivity('GALICE');
      });

      expect(activity).toHaveLength(1);
      expect(activity![0].id).toBe('a1');
      expect(activity![0].type).toBe('proposal_approved');
    });

    it('caps activity results at 20 entries', async () => {
      mockRpcResponses([]);
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const many: RpcEvent[] = Array.from({ length: 30 }, (_, i) => ({
        id: `e${i}`,
        topic: ['sym:proposal_approved'],
        value: { xdr: 'actor:GALICE' },
        ledgerClosedAt: '2026-01-01T00:00:00Z',
      }));
      mockRpcResponses(many);

      let activity;
      await act(async () => {
        activity = await result.current.fetchSignerActivity('GALICE');
      });

      expect(activity).toHaveLength(20);
    });

    it('falls back to mock activity when no events match the signer', async () => {
      mockRpcResponses([]);
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      mockRpcResponses([
        { id: 'a1', topic: ['sym:proposal_approved'], value: { xdr: 'actor:GBOB' }, ledgerClosedAt: '2026-01-01T00:00:00Z' },
      ]);

      let activity;
      await act(async () => {
        activity = await result.current.fetchSignerActivity('GALICE');
      });

      expect(activity!.length).toBeGreaterThan(0);
      expect(activity![0].id).toBe('1'); // buildMockActivity's fixed id
    });

    it('falls back to mock activity when the RPC call throws', async () => {
      mockRpcResponses([]);
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      mockRpcFailure();

      let activity;
      await act(async () => {
        activity = await result.current.fetchSignerActivity('GALICE');
      });

      expect(activity!.length).toBeGreaterThan(0);
      expect(result.current.activityLoading).toBe(false);
    });

    it('toggles activityLoading around the fetch', async () => {
      mockRpcResponses([]);
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.activityLoading).toBe(false);

      let promise: Promise<unknown>;
      act(() => {
        promise = result.current.fetchSignerActivity('GALICE');
      });
      expect(result.current.activityLoading).toBe(true);

      await act(async () => {
        await promise;
      });
      expect(result.current.activityLoading).toBe(false);
    });
  });

  describe('refresh triggers', () => {
    it('refetch() re-runs the leaderboard fetch', async () => {
      mockRpcResponses([]);
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const callsBefore = (global.fetch as Mock).mock.calls.length;

      await act(async () => {
        await result.current.refetch();
      });

      expect((global.fetch as Mock).mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('refreshes automatically every 60 seconds', async () => {
      vi.useFakeTimers();
      mockRpcResponses([]);

      const { result } = renderHook(() => useGovernance());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.loading).toBe(false);

      const callsBefore = (global.fetch as Mock).mock.calls.length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect((global.fetch as Mock).mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('subscribes to proposal_approved and refetches when the event fires', async () => {
      mockRpcResponses([]);
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(mockSubscribe).toHaveBeenCalledWith('proposal_approved', expect.any(Function));

      const callsBefore = (global.fetch as Mock).mock.calls.length;

      await act(async () => {
        capturedHandlers['proposal_approved']({});
      });

      await waitFor(() =>
        expect((global.fetch as Mock).mock.calls.length).toBeGreaterThan(callsBefore),
      );
    });

    it('clears the refresh interval on unmount', async () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      mockRpcResponses([]);

      const { unmount } = renderHook(() => useGovernance());
      await waitFor(() => expect(clearIntervalSpy).not.toHaveBeenCalled());

      unmount();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });
});
