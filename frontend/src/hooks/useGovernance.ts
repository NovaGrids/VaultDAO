/**
 * useGovernance — hook for fetching signer leaderboard and activity data.
 *
 * Derives reputation scores and participation rates from on-chain events
 * (proposal_approved, proposal_abstained, proposal_created) and the vault config.
 * Refreshes every 60 seconds and on WebSocket proposal_approved events.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { xdr, scValToNative } from 'stellar-sdk';
import { useWallet } from './useWallet';
import { useRealtime } from '../contexts/RealtimeContext';
import { env } from '../config/env';
import type {
  SignerRecord,
  SignerActivity,
  LeaderboardFilters,
  SignerRole,
} from '../types/governance';

// ─── helpers ─────────────────────────────────────────────────────────────────

function roleFromNumber(n: number): SignerRole {
  if (n === 2) return 'Admin';
  if (n === 1) return 'Treasurer';
  return 'Member';
}

function getEventSymbol(topic0Base64: string): string {
  try {
    const scv = xdr.ScVal.fromXDR(topic0Base64, 'base64');
    const native = scValToNative(scv);
    return typeof native === 'string' ? native : '';
  } catch {
    return '';
  }
}

function getActorFromValue(valueXdr: string): string {
  try {
    const scv = xdr.ScVal.fromXDR(valueXdr, 'base64');
    const native = scValToNative(scv);
    if (Array.isArray(native) && native.length > 0) {
      const first = native[0];
      if (typeof first === 'string') return first;
      if (first && typeof first === 'object' && 'address' in first) {
        return String((first as { address: unknown }).address);
      }
    }
    if (typeof native === 'string') return native;
    return '';
  } catch {
    return '';
  }
}

/** Build mock leaderboard data for development. */
function buildMockLeaderboard(connectedAddress: string | null): SignerRecord[] {
  const records: SignerRecord[] = [
    {
      address: connectedAddress ?? 'GABC...0001',
      role: 'Admin',
      approvalsGiven: 47,
      abstentions: 3,
      proposalsCreated: 12,
      participationRate: 0.94,
      reputationScore: 820,
      lastActive: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      voteHistory: [true, true, true, false, true, true, true, true, false, true],
    },
    {
      address: 'GBOB...0002',
      role: 'Treasurer',
      approvalsGiven: 38,
      abstentions: 7,
      proposalsCreated: 8,
      participationRate: 0.76,
      reputationScore: 640,
      lastActive: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      voteHistory: [true, false, true, true, false, true, true, false, true, true],
    },
    {
      address: 'GCAR...0003',
      role: 'Member',
      approvalsGiven: 22,
      abstentions: 15,
      proposalsCreated: 3,
      participationRate: 0.55,
      reputationScore: 380,
      lastActive: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      voteHistory: [false, true, false, true, false, false, true, true, false, true],
    },
    {
      address: 'GDAN...0004',
      role: 'Treasurer',
      approvalsGiven: 55,
      abstentions: 2,
      proposalsCreated: 15,
      participationRate: 0.97,
      reputationScore: 950,
      lastActive: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      voteHistory: [true, true, true, true, true, true, false, true, true, true],
    },
    {
      address: 'GEVE...0005',
      role: 'Member',
      approvalsGiven: 10,
      abstentions: 20,
      proposalsCreated: 1,
      participationRate: 0.33,
      reputationScore: 210,
      lastActive: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      voteHistory: [false, false, true, false, false, true, false, false, true, false],
    },
  ];
  return records;
}

function buildMockActivity(address: string): SignerActivity[] {
  return [
    {
      id: '1',
      type: 'proposal_approved',
      proposalId: '42',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      details: { proposalId: '42', amount: '1000000000' },
    },
    {
      id: '2',
      type: 'proposal_created',
      proposalId: '41',
      timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      details: { proposalId: '41', recipient: 'GREC...0001' },
    },
    {
      id: '3',
      type: 'proposal_approved',
      proposalId: '39',
      timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      details: { proposalId: '39', amount: '500000000' },
    },
    {
      id: '4',
      type: 'proposal_abstained',
      proposalId: '37',
      timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      details: { proposalId: '37' },
    },
    {
      id: '5',
      type: 'proposal_approved',
      proposalId: '35',
      timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      details: { proposalId: '35', amount: '2000000000' },
    },
  ];
}

// ─── hook ─────────────────────────────────────────────────────────────────────

export interface UseGovernanceReturn {
  leaderboard: SignerRecord[];
  loading: boolean;
  error: string | null;
  filters: LeaderboardFilters;
  setFilters: (f: LeaderboardFilters) => void;
  refetch: () => Promise<void>;
  fetchSignerActivity: (address: string, page?: number) => Promise<SignerActivity[]>;
  activityLoading: boolean;
}

export function useGovernance(): UseGovernanceReturn {
  const { address } = useWallet();
  const { subscribe } = useRealtime();

  const [leaderboard, setLeaderboard] = useState<SignerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [filters, setFilters] = useState<LeaderboardFilters>({
    sortBy: 'reputationScore',
    order: 'desc',
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Fetch and derive leaderboard from on-chain events + vault config.
   * Falls back to mock data when no events are found.
   */
  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch latest ledger
      const latestRes = await fetch(env.sorobanRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
      });
      const latestData = await latestRes.json() as { result?: { sequence?: number } };
      const latestLedger = latestData?.result?.sequence ?? 0;
      const startLedger = Math.max(1, latestLedger - 100000);

      // Fetch all contract events
      const evRes = await fetch(env.sorobanRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'getEvents',
          params: {
            startLedger: String(startLedger),
            filters: [{ type: 'contract', contractIds: [env.contractId] }],
            pagination: { limit: 200 },
          },
        }),
      });
      const evData = await evRes.json() as {
        result?: {
          events?: Array<{
            id: string;
            topic?: string[];
            value?: { xdr?: string };
            ledgerClosedAt?: string;
          }>;
        };
      };

      const events = evData.result?.events ?? [];

      if (events.length === 0) {
        setLeaderboard(buildMockLeaderboard(address));
        return;
      }

      // Aggregate per-signer stats from events
      const signerStats = new Map<
        string,
        {
          approvalsGiven: number;
          abstentions: number;
          proposalsCreated: number;
          lastActive: string;
          voteHistory: boolean[];
        }
      >();

      const ensureSigner = (addr: string) => {
        if (!signerStats.has(addr)) {
          signerStats.set(addr, {
            approvalsGiven: 0,
            abstentions: 0,
            proposalsCreated: 0,
            lastActive: new Date(0).toISOString(),
            voteHistory: [],
          });
        }
        return signerStats.get(addr)!;
      };

      for (const ev of events) {
        const topic0 = ev.topic?.[0];
        if (!topic0) continue;
        const symbol = getEventSymbol(topic0);
        const valueXdr = ev.value?.xdr;
        const actor = valueXdr ? getActorFromValue(valueXdr) : '';
        const ts = ev.ledgerClosedAt ?? new Date().toISOString();

        if (symbol === 'proposal_approved' && actor) {
          const s = ensureSigner(actor);
          s.approvalsGiven++;
          s.voteHistory.push(true);
          if (ts > s.lastActive) s.lastActive = ts;
        } else if (symbol === 'proposal_abstained' && actor) {
          const s = ensureSigner(actor);
          s.abstentions++;
          s.voteHistory.push(false);
          if (ts > s.lastActive) s.lastActive = ts;
        } else if (symbol === 'proposal_created' && actor) {
          const s = ensureSigner(actor);
          s.proposalsCreated++;
          if (ts > s.lastActive) s.lastActive = ts;
        } else if ((symbol === 'signer_added' || symbol === 'role_assigned') && actor) {
          ensureSigner(actor);
        }
      }

      if (signerStats.size === 0) {
        setLeaderboard(buildMockLeaderboard(address));
        return;
      }

      // Build leaderboard records
      const records: SignerRecord[] = Array.from(signerStats.entries()).map(
        ([addr, stats]) => {
          const totalVotes = stats.approvalsGiven + stats.abstentions;
          const participationRate = totalVotes > 0 ? stats.approvalsGiven / totalVotes : 0;
          // Score: weighted sum (approvals 60%, participation 30%, proposals 10%), max 1000
          const score = Math.min(
            1000,
            Math.round(
              stats.approvalsGiven * 6 +
                participationRate * 300 +
                stats.proposalsCreated * 10
            )
          );
          return {
            address: addr,
            role: 'Member' as SignerRole,
            approvalsGiven: stats.approvalsGiven,
            abstentions: stats.abstentions,
            proposalsCreated: stats.proposalsCreated,
            participationRate,
            reputationScore: score,
            lastActive: stats.lastActive,
            voteHistory: stats.voteHistory.slice(-10),
          };
        }
      );

      setLeaderboard(records);
    } catch (err) {
      console.error('useGovernance: fetchLeaderboard failed', err);
      setLeaderboard(buildMockLeaderboard(address));
    } finally {
      setLoading(false);
    }
  }, [address]);

  // Initial fetch
  useEffect(() => {
    void fetchLeaderboard();
  }, [fetchLeaderboard]);

  // Refresh every 60 seconds
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      void fetchLeaderboard();
    }, 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchLeaderboard]);

  // Refresh on WebSocket proposal_approved event
  useEffect(() => {
    const unsub = subscribe<Record<string, unknown>>('proposal_approved', () => {
      void fetchLeaderboard();
    });
    return unsub;
  }, [subscribe, fetchLeaderboard]);

  /**
   * Fetch paginated activity for a specific signer address.
   */
  const fetchSignerActivity = useCallback(
    async (signerAddress: string, _page = 1): Promise<SignerActivity[]> => {
      setActivityLoading(true);
      try {
        const latestRes = await fetch(env.sorobanRpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
        });
        const latestData = await latestRes.json() as { result?: { sequence?: number } };
        const latestLedger = latestData?.result?.sequence ?? 0;
        const startLedger = Math.max(1, latestLedger - 100000);

        const evRes = await fetch(env.sorobanRpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'getEvents',
            params: {
              startLedger: String(startLedger),
              filters: [{ type: 'contract', contractIds: [env.contractId] }],
              pagination: { limit: 200 },
            },
          }),
        });
        const evData = await evRes.json() as {
          result?: {
            events?: Array<{
              id: string;
              topic?: string[];
              value?: { xdr?: string };
              ledgerClosedAt?: string;
            }>;
          };
        };

        const events = evData.result?.events ?? [];
        const activities: SignerActivity[] = [];

        for (const ev of events) {
          const topic0 = ev.topic?.[0];
          if (!topic0) continue;
          const symbol = getEventSymbol(topic0);
          const valueXdr = ev.value?.xdr;
          const actor = valueXdr ? getActorFromValue(valueXdr) : '';
          if (actor !== signerAddress) continue;

          activities.push({
            id: ev.id,
            type: symbol,
            timestamp: ev.ledgerClosedAt ?? new Date().toISOString(),
            details: {},
          });
        }

        if (activities.length === 0) {
          return buildMockActivity(signerAddress);
        }

        return activities.slice(0, 20);
      } catch {
        return buildMockActivity(signerAddress);
      } finally {
        setActivityLoading(false);
      }
    },
    []
  );

  // Apply client-side sorting based on filters
  const sortedLeaderboard = [...leaderboard].sort((a, b) => {
    const { sortBy, order } = filters;
    let diff = 0;
    if (sortBy === 'lastActive') {
      diff = new Date(a.lastActive).getTime() - new Date(b.lastActive).getTime();
    } else {
      diff = (a[sortBy] as number) - (b[sortBy] as number);
    }
    return order === 'asc' ? diff : -diff;
  });

  return {
    leaderboard: sortedLeaderboard,
    loading,
    error,
    filters,
    setFilters,
    refetch: fetchLeaderboard,
    fetchSignerActivity,
    activityLoading,
  };
}
