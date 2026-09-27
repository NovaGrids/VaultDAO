/**
 * useGovernance — hook for fetching signer leaderboard and activity data.
 *
 * Reads each signer's on-chain state directly from the contract
 * (`get_signers_with_roles`, `get_reputation`, `get_participation_score`) so
 * scores reflect the vault's full history rather than a recent event window.
 * Signer activity is built from fully paginated contract events.
 * Mock data is only served when `env.demoMode` is enabled.
 * Refreshes every 60 seconds and on WebSocket proposal_approved events.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { xdr, scValToNative, Address } from 'stellar-sdk';
import { useWallet } from './useWallet';
import { useRealtime } from '../contexts/RealtimeContext';
import { env } from '../config/env';
import { readContract, fetchAllContractEvents, fetchLatestLedger } from '../utils/contractRead';
import { fetchContractEvents, isAbortError } from '../utils/sorobanEvents';
import type {
  SignerRecord,
  SignerActivity,
  LeaderboardFilters,
  SignerRole,
} from '../types/governance';

const LOOKBACK_LEDGERS = 100_000;

// ─── helpers ─────────────────────────────────────────────────────────────────

export function roleFromNumber(n: number): SignerRole {
  if (n === 2) return 'Admin';
  if (n === 1) return 'Treasurer';
  return 'Member';
}

/** Map the contract's `Role` enum (Observer=0 … Admin=3) to a UI role. */
export function roleFromContract(n: number): SignerRole {
  if (n === 3) return 'Admin';
  if (n === 2) return 'Treasurer';
  return 'Member';
}

/** Approximate seconds per ledger on Stellar, used to date ledger numbers. */
const SECONDS_PER_LEDGER = 5;
/** Ledger window scanned for signer activity (matches default RPC retention). */
const ACTIVITY_LEDGER_WINDOW = 120_960;
const ACTIVITY_PAGE_SIZE = 20;

interface ContractReputation {
  score?: number | bigint;
  proposals_created?: number | bigint;
  approvals_given?: number | bigint;
  abstentions_given?: number | bigint;
  last_participation_ledger?: number | bigint;
}

interface ContractParticipationScore {
  proposals_voted?: number | bigint;
  proposals_missed?: number | bigint;
  last_active_ledger?: number | bigint;
  history?: boolean[];
  history_cursor?: number | bigint;
}

const HISTORY_CAPACITY = 100;

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return 0;
}

/** Estimate the wall-clock time a ledger closed, relative to the latest ledger. */
export function ledgerToIso(ledger: number, latestLedger: number, nowMs = Date.now()): string {
  if (!ledger || !latestLedger) return new Date(0).toISOString();
  const ageSeconds = Math.max(0, latestLedger - ledger) * SECONDS_PER_LEDGER;
  return new Date(nowMs - ageSeconds * 1000).toISOString();
}

/**
 * Return the last `n` outcomes from the contract's participation circular
 * buffer in chronological order (oldest first).
 */
export function recentHistory(history: boolean[], cursor: number, n = 10): boolean[] {
  const ordered =
    history.length >= HISTORY_CAPACITY
      ? [...history.slice(cursor), ...history.slice(0, cursor)]
      : history;
  return ordered.slice(-n);
}

/** Build a leaderboard record from a signer's on-chain reputation and participation data. */
export function buildSignerRecord(
  address: string,
  roleNum: number,
  reputation: ContractReputation | null,
  participation: ContractParticipationScore | null,
  latestLedger: number,
): SignerRecord {
  const voted = toNum(participation?.proposals_voted);
  const missed = toNum(participation?.proposals_missed);
  const eligible = voted + missed;
  const lastLedger = Math.max(
    toNum(participation?.last_active_ledger),
    toNum(reputation?.last_participation_ledger),
  );
  return {
    address,
    role: roleFromContract(roleNum),
    approvalsGiven: toNum(reputation?.approvals_given),
    abstentions: toNum(reputation?.abstentions_given),
    proposalsCreated: toNum(reputation?.proposals_created),
    participationRate: eligible > 0 ? voted / eligible : 0,
    reputationScore: Math.min(1000, Math.max(0, toNum(reputation?.score))),
    lastActive: ledgerToIso(lastLedger, latestLedger),
    voteHistory: recentHistory(
      participation?.history ?? [],
      toNum(participation?.history_cursor),
    ),
  };
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

/** Build mock leaderboard data (demo mode only). */
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
   * Build the leaderboard from each signer's on-chain reputation and
   * participation score. Outside demo mode an empty vault yields an empty
   * leaderboard, and failures surface through `error`.
   */
  const leaderboardAbortRef = useRef<AbortController | null>(null);
  const activityAbortRef = useRef<AbortController | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    leaderboardAbortRef.current?.abort();
    const controller = new AbortController();
    leaderboardAbortRef.current = controller;

    setLoading(true);
    setError(null);
    if (env.demoMode) {
      setLeaderboard(buildMockLeaderboard(address));
      setLoading(false);
      return;
    }
    try {
      const [signersRaw, latestLedger] = await Promise.all([
        readContract('get_signers_with_roles', [], address),
        fetchLatestLedger().catch(() => 0),
      ]);
      const signers = (Array.isArray(signersRaw) ? signersRaw : [])
        .filter((entry): entry is [unknown, unknown] => Array.isArray(entry) && entry.length >= 2)
        .map(([addr, role]) => ({ address: String(addr), role: toNum(role) }));

      const records = await Promise.all(
        signers.map(async (signer) => {
          const arg = [new Address(signer.address).toScVal()];
          const [reputation, participation] = await Promise.all([
            readContract('get_reputation', arg, address).catch(() => null),
            readContract('get_participation_score', arg, address).catch(() => null),
          ]);
          return buildSignerRecord(
            signer.address,
            signer.role,
            reputation as ContractReputation | null,
            participation as ContractParticipationScore | null,
            latestLedger,
      // Fetch all contract events (paginated)
      const { events } = await fetchContractEvents({
        lookbackLedgers: LOOKBACK_LEDGERS,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

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
        }),
      );

      setLeaderboard(records);
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) return;
      console.error('useGovernance: fetchLeaderboard failed', err);
      setLeaderboard([]);
      setError(err instanceof Error ? err.message : 'Failed to load governance data');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [address]);

  // Cancel in-flight event fetches on unmount
  useEffect(
    () => () => {
      leaderboardAbortRef.current?.abort();
      activityAbortRef.current?.abort();
    },
    []
  );

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
   * Fetch paginated activity (newest first, 20 per page) for a signer.
   * Events are paged through fully via the RPC cursor.
   */
  const fetchSignerActivity = useCallback(
    async (signerAddress: string, page = 1): Promise<SignerActivity[]> => {
      if (env.demoMode) return buildMockActivity(signerAddress);
      setActivityLoading(true);
      try {
        const latestLedger = await fetchLatestLedger();
        const events = await fetchAllContractEvents({
          startLedger: latestLedger - ACTIVITY_LEDGER_WINDOW,
    async (signerAddress: string, _page = 1): Promise<SignerActivity[]> => {
      activityAbortRef.current?.abort();
      const controller = new AbortController();
      activityAbortRef.current = controller;

      setActivityLoading(true);
      try {
        const { events } = await fetchContractEvents({
          lookbackLedgers: LOOKBACK_LEDGERS,
          signal: controller.signal,
        });
        const activities: SignerActivity[] = [];

        for (const ev of events) {
          const topic0 = ev.topic?.[0];
          if (!topic0) continue;
          const symbol = getEventSymbol(topic0);
          const valueXdr = typeof ev.value === 'string' ? ev.value : ev.value?.xdr;
          const actor = valueXdr ? getActorFromValue(valueXdr) : '';
          if (actor !== signerAddress) continue;

          activities.push({
            id: ev.id,
            type: symbol,
            timestamp: ev.ledgerClosedAt ?? new Date().toISOString(),
            details: {},
          });
        }

        activities.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        const offset = Math.max(0, page - 1) * ACTIVITY_PAGE_SIZE;
        return activities.slice(offset, offset + ACTIVITY_PAGE_SIZE);
      } catch (err) {
        console.error('useGovernance: fetchSignerActivity failed', err);
        return [];
        if (activities.length === 0) {
          return buildMockActivity(signerAddress);
        }

        return activities.slice(0, 20);
      } catch (err) {
        if (isAbortError(err) || controller.signal.aborted) return [];
        return buildMockActivity(signerAddress);
      } finally {
        if (!controller.signal.aborted) setActivityLoading(false);
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
