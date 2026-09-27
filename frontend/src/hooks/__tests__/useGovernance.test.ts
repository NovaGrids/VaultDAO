/**
 * Tests for useGovernance hook.
 *
 * useGovernance builds the signer leaderboard from on-chain contract reads
 * (get_signers_with_roles, get_reputation, get_participation_score) and
 * per-signer activity from fully paginated contract events. Covers:
 *  - Mapping contract reputation/participation data to leaderboard records
 *  - Empty state (no mock data) outside demo mode, and error surfacing
 *  - Mock data served only when env.demoMode is enabled
 *  - Leaderboard sorting across filter fields and orders
 *  - Signer activity filtering, ordering and paging
 *  - refetch(), the 60s polling interval, and the websocket-driven refresh
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest';
import {
  useGovernance,
  roleFromNumber,
  roleFromContract,
  recentHistory,
  ledgerToIso,
  buildSignerRecord,
} from '../useGovernance';
import { useWallet } from '../useWallet';
import { useRealtime } from '../../contexts/RealtimeContext';
import { readContract, fetchAllContractEvents, fetchLatestLedger } from '../../utils/contractRead';
import { env } from '../../config/env';

vi.mock('../useWallet', () => ({
  useWallet: vi.fn(),
}));

vi.mock('../../contexts/RealtimeContext', () => ({
  useRealtime: vi.fn(),
}));

vi.mock('../../utils/contractRead', () => ({
  readContract: vi.fn(),
  fetchAllContractEvents: vi.fn(),
  fetchLatestLedger: vi.fn(),
}));

// Decode helpers use a simple string convention instead of real XDR:
//   "sym:<name>"   -> the symbol string <name>
//   "actor:<addr>" -> an array whose first element is <addr>
// Address is stubbed so tests can use short fake account IDs.
vi.mock('stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('stellar-sdk')>();
  return {
    ...actual,
    Address: class {
      constructor(public addr: string) {}
      toScVal() {
        return this.addr;
      }
    },
    xdr: {
      ...actual.xdr,
      ScVal: {
        ...actual.xdr.ScVal,
        fromXDR: vi.fn((v: string) => v),
      },
    },
    scValToNative: vi.fn((raw: unknown) => {
      if (typeof raw !== 'string') return raw;
      if (raw.startsWith('sym:')) return raw.slice(4);
      if (raw.startsWith('actor:')) return [raw.slice(6)];
      return raw;
    }),
  };
});

const CONNECTED_ADDRESS = 'GSELF';
const LATEST_LEDGER = 1_000_000;

type SignerFixture = {
  role: number;
  reputation?: Record<string, unknown> | null;
  participation?: Record<string, unknown> | null;
};

function mockVault(signers: Record<string, SignerFixture>) {
  (readContract as Mock).mockImplementation(async (fn: string, args: unknown[] = []) => {
    if (fn === 'get_signers_with_roles') {
      return Object.entries(signers).map(([addr, s]) => [addr, s.role]);
    }
    const addr = String(args[0]);
    const signer = signers[addr];
    if (fn === 'get_reputation') return signer?.reputation ?? null;
    if (fn === 'get_participation_score') return signer?.participation ?? null;
    throw new Error(`unexpected call ${fn}`);
function mockRpcResponses(events: RpcEvent[]) {
  (global.fetch as Mock).mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { method: string };
    if (body.method === 'getLatestLedger') {
      return { ok: true, status: 200, json: async () => ({ result: { sequence: 1000 } }) };
    }
    return { ok: true, status: 200, json: async () => ({ result: { events } }) };
  });
}

describe('useGovernance', () => {
  let mockSubscribe: Mock;
  let capturedHandlers: Record<string, (data: unknown) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    (env as { demoMode?: boolean }).demoMode = false;

    (useWallet as Mock).mockReturnValue({ address: CONNECTED_ADDRESS });

    capturedHandlers = {};
    mockSubscribe = vi.fn((type: string, handler: (data: unknown) => void) => {
      capturedHandlers[type] = handler;
      return vi.fn();
    });
    (useRealtime as Mock).mockReturnValue({ subscribe: mockSubscribe });

    (fetchLatestLedger as Mock).mockResolvedValue(LATEST_LEDGER);
    (fetchAllContractEvents as Mock).mockResolvedValue([]);
    mockVault({});
  });

  afterEach(() => {
    vi.useRealTimers();
    (env as { demoMode?: boolean }).demoMode = false;
  });

  describe('helpers', () => {
    it('roleFromNumber keeps its legacy mapping', () => {
      expect(roleFromNumber(2)).toBe('Admin');
      expect(roleFromNumber(1)).toBe('Treasurer');
      expect(roleFromNumber(0)).toBe('Member');
    });

    it('roleFromContract maps the contract Role enum', () => {
      expect(roleFromContract(3)).toBe('Admin');
      expect(roleFromContract(2)).toBe('Treasurer');
      expect(roleFromContract(1)).toBe('Member');
      expect(roleFromContract(0)).toBe('Member');
      expect(roleFromContract(4)).toBe('Member');
    });

    it('recentHistory returns the tail of a partial buffer', () => {
      const h = [true, false, true, true];
      expect(recentHistory(h, 0, 3)).toEqual([false, true, true]);
    });

    it('recentHistory unrolls a full circular buffer from the cursor', () => {
      // 100 entries; newest write went to index 4, so oldest is at cursor 5.
      const h = Array.from({ length: 100 }, (_, i) => i < 5);
      const tail = recentHistory(h, 5, 10);
      expect(tail).toEqual([false, false, false, false, false, true, true, true, true, true]);
    });

    it('ledgerToIso estimates time from ledger distance', () => {
      const now = Date.UTC(2026, 0, 1);
      expect(ledgerToIso(990, 1000, now)).toBe(new Date(now - 50_000).toISOString());
      expect(ledgerToIso(0, 1000, now)).toBe(new Date(0).toISOString());
    });

    it('buildSignerRecord handles missing contract data', () => {
      const r = buildSignerRecord('GX', 1, null, null, 100);
      expect(r).toMatchObject({
        approvalsGiven: 0,
        abstentions: 0,
        proposalsCreated: 0,
        participationRate: 0,
        reputationScore: 0,
        voteHistory: [],
      });
    });
  });

  describe('leaderboard from contract state', () => {
    it('maps reputation and participation per signer', async () => {
      mockVault({
        GALICE: {
          role: 3,
          reputation: {
            score: 720,
            approvals_given: 40,
            abstentions_given: 5,
            proposals_created: 12n,
            last_participation_ledger: 999_000n,
          },
          participation: {
            proposals_voted: 45,
            proposals_missed: 5,
            last_active_ledger: 999_990,
            history: [true, false, true],
            history_cursor: 0,
          },
        },
        GBOB: {
          role: 2,
          reputation: { score: 5000, approvals_given: 1 },
          participation: { proposals_voted: 0, proposals_missed: 0, history: [] },
        },
      });

      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      // Transient failures are retried with backoff before falling back
      await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 5000 });

      const alice = result.current.leaderboard.find((r) => r.address === 'GALICE')!;
      expect(alice.role).toBe('Admin');
      expect(alice.approvalsGiven).toBe(40);
      expect(alice.abstentions).toBe(5);
      expect(alice.proposalsCreated).toBe(12);
      expect(alice.participationRate).toBeCloseTo(0.9);
      expect(alice.reputationScore).toBe(720);
      expect(alice.voteHistory).toEqual([true, false, true]);
      // lastActive derived from the more recent of the two ledgers (10 ledgers ago)
      const ageMs = Date.now() - new Date(alice.lastActive).getTime();
      expect(ageMs).toBeGreaterThanOrEqual(49_000);
      expect(ageMs).toBeLessThan(60_000);

      const bob = result.current.leaderboard.find((r) => r.address === 'GBOB')!;
      expect(bob.role).toBe('Treasurer');
      expect(bob.reputationScore).toBe(1000); // clamped
      expect(bob.participationRate).toBe(0);

      expect(result.current.error).toBeNull();
    });

    it('queries reputation and participation for every signer', async () => {
      mockVault({ GA: { role: 1 }, GB: { role: 1 }, GC: { role: 1 } });

      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      const calls = (readContract as Mock).mock.calls.map((c) => `${c[0]}:${String(c[1]?.[0] ?? '')}`);
      for (const addr of ['GA', 'GB', 'GC']) {
        expect(calls).toContain(`get_reputation:${addr}`);
        expect(calls).toContain(`get_participation_score:${addr}`);
      }
      expect(fetchAllContractEvents).not.toHaveBeenCalled();
    });

    it('still lists a signer when one of its per-signer reads fails', async () => {
      mockVault({ GA: { role: 1, reputation: { score: 600 } } });
      const base = (readContract as Mock).getMockImplementation()!;
      (readContract as Mock).mockImplementation(async (fn: string, args: unknown[]) => {
        if (fn === 'get_participation_score') throw new Error('boom');
        return base(fn, args);
      });

      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.leaderboard).toHaveLength(1);
      expect(result.current.leaderboard[0].reputationScore).toBe(600);
    });
  });

  describe('empty state and demo mode', () => {
    it('returns an empty leaderboard (no mock data) when the vault has no signers', async () => {
      mockVault({});
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.leaderboard).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('surfaces an error and an empty leaderboard when the contract read fails', async () => {
      (readContract as Mock).mockRejectedValue(new Error('rpc down'));
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.leaderboard).toEqual([]);
      expect(result.current.error).toBe('rpc down');
    });

    it('serves mock leaderboard data only in demo mode', async () => {
      (env as { demoMode?: boolean }).demoMode = true;
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.leaderboard).toHaveLength(5);
      expect(result.current.leaderboard.some((r) => r.address === CONNECTED_ADDRESS)).toBe(true);
      expect(readContract).not.toHaveBeenCalled();
    });
  });

  describe('leaderboard sorting', () => {
    beforeEach(() => {
      mockVault({
        GA: { role: 1, reputation: { score: 300, approvals_given: 9, proposals_created: 1 }, participation: { proposals_voted: 1, proposals_missed: 1, last_active_ledger: LATEST_LEDGER - 100 } },
        GB: { role: 1, reputation: { score: 900, approvals_given: 2, proposals_created: 5 }, participation: { proposals_voted: 1, proposals_missed: 0, last_active_ledger: LATEST_LEDGER - 10 } },
        GC: { role: 1, reputation: { score: 600, approvals_given: 5, proposals_created: 3 }, participation: { proposals_voted: 1, proposals_missed: 3, last_active_ledger: LATEST_LEDGER - 1000 } },
      });
    });

    it('sorts by reputationScore descending by default', async () => {
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.leaderboard.map((r) => r.address)).toEqual(['GB', 'GC', 'GA']);
    });

    it('sorts by approvalsGiven ascending', async () => {
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));
      act(() => result.current.setFilters({ sortBy: 'approvalsGiven', order: 'asc' }));
      expect(result.current.leaderboard.map((r) => r.address)).toEqual(['GB', 'GC', 'GA']);
    });

    it('sorts by participationRate descending', async () => {
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));
      act(() => result.current.setFilters({ sortBy: 'participationRate', order: 'desc' }));
      expect(result.current.leaderboard.map((r) => r.address)).toEqual(['GB', 'GA', 'GC']);
    });

    it('sorts by lastActive in both orders', async () => {
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));
      act(() => result.current.setFilters({ sortBy: 'lastActive', order: 'desc' }));
      expect(result.current.leaderboard.map((r) => r.address)).toEqual(['GB', 'GA', 'GC']);
      act(() => result.current.setFilters({ sortBy: 'lastActive', order: 'asc' }));
      expect(result.current.leaderboard.map((r) => r.address)).toEqual(['GC', 'GA', 'GB']);
    });
  });

  describe('fetchSignerActivity', () => {
    it('returns the signer events newest first from the paginated event feed', async () => {
      (fetchAllContractEvents as Mock).mockResolvedValue([
        { id: 'a', topic: ['sym:proposal_approved'], value: { xdr: 'actor:GALICE' }, ledgerClosedAt: '2026-01-01T00:00:00Z' },
        { id: 'b', topic: ['sym:proposal_approved'], value: { xdr: 'actor:GBOB' }, ledgerClosedAt: '2026-01-02T00:00:00Z' },
        { id: 'c', topic: ['sym:proposal_created'], value: 'actor:GALICE', ledgerClosedAt: '2026-01-03T00:00:00Z' },
        { id: 'd', topic: undefined },
      ]);

      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let activity: Awaited<ReturnType<typeof result.current.fetchSignerActivity>> = [];
      await act(async () => {
        activity = await result.current.fetchSignerActivity('GALICE');
      });

      expect(activity.map((a) => a.id)).toEqual(['c', 'a']);
      expect(activity[0].type).toBe('proposal_created');
      expect(fetchAllContractEvents).toHaveBeenCalledWith({ startLedger: LATEST_LEDGER - 120_960 });
    });

    it('pages results 20 at a time', async () => {
      (fetchAllContractEvents as Mock).mockResolvedValue(
        Array.from({ length: 25 }, (_, i) => ({
          id: `e${i}`,
          topic: ['sym:proposal_approved'],
          value: { xdr: 'actor:GALICE' },
          ledgerClosedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
        })),
      );
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let p1: unknown[] = [];
      let p2: unknown[] = [];
      await act(async () => {
        p1 = await result.current.fetchSignerActivity('GALICE', 1);
        p2 = await result.current.fetchSignerActivity('GALICE', 2);
      });
      expect(p1).toHaveLength(20);
      expect(p2).toHaveLength(5);
    });

    it('returns an empty list (no mock data) when nothing matches or the RPC fails', async () => {
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let empty: unknown[] = ['x'];
      await act(async () => {
        empty = await result.current.fetchSignerActivity('GNOBODY');
      });
      expect(empty).toEqual([]);

      (fetchAllContractEvents as Mock).mockRejectedValue(new Error('down'));
      let failed: unknown[] = ['x'];
      await act(async () => {
        failed = await result.current.fetchSignerActivity('GALICE');
      });
      expect(failed).toEqual([]);
      expect(result.current.activityLoading).toBe(false);
    });

    it('serves mock activity in demo mode', async () => {
      (env as { demoMode?: boolean }).demoMode = true;
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));

      let activity: unknown[] = [];
      await act(async () => {
        activity = await result.current.fetchSignerActivity('GALICE');
      });
      expect(activity.length).toBeGreaterThan(0);
      expect(fetchAllContractEvents).not.toHaveBeenCalled();
    });
  });

  describe('refresh triggers', () => {
    it('refetch() re-reads the signer list', async () => {
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));
      const before = (readContract as Mock).mock.calls.length;

      await act(async () => {
        await result.current.refetch();
      });

      expect((readContract as Mock).mock.calls.length).toBeGreaterThan(before);
    });

    it('refreshes automatically every 60 seconds', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() => useGovernance());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.loading).toBe(false);
      const before = (readContract as Mock).mock.calls.length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect((readContract as Mock).mock.calls.length).toBeGreaterThan(before);
    });

    it('refetches when a proposal_approved websocket event fires', async () => {
      const { result } = renderHook(() => useGovernance());
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mockSubscribe).toHaveBeenCalledWith('proposal_approved', expect.any(Function));
      const before = (readContract as Mock).mock.calls.length;

      await act(async () => {
        capturedHandlers['proposal_approved']({});
      });

      await waitFor(() =>
        expect((readContract as Mock).mock.calls.length).toBeGreaterThan(before),
      );
    });

    it('clears the refresh interval on unmount', async () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      const { unmount } = renderHook(() => useGovernance());
      unmount();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });
});
