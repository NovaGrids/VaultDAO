// frontend/src/hooks/useProposals.ts

import { useState, useEffect, useCallback, useRef } from 'react';
import { withRetry } from '../utils/retryUtils';
import { useVaultContract } from './useVaultContract';
import { useRealtime } from '../contexts/RealtimeContext';
import { useToast } from './useToast';
import type { Proposal } from '../app/dashboard/Proposals';

type ProposalStatus = Proposal['status'];

interface UseProposalsReturn {
  proposals: Proposal[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  filterByStatus: (status: ProposalStatus | 'all') => Proposal[];
}

/**
 * useProposals — fetches proposals from the vault contract and keeps them
 * up-to-date via RealtimeContext WebSocket events.
 *
 * Subscribed events:
 *  - proposal_approved  → increments approvals, updates status if threshold met
 *  - proposal_abstained → increments abstentions (future use)
 *  - proposal_ready     → marks proposal as Approved
 *
 * Toast fires when a proposal the connected wallet created reaches threshold.
 */
export const useProposals = (walletAddress?: string | null): UseProposalsReturn => {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { getProposals } = useVaultContract();
  const { subscribe, trackEvent } = useRealtime();
  const { notify } = useToast();

  // Track which proposals have already triggered the threshold toast so we
  // don't fire it multiple times across reconnects.
  const thresholdToastedRef = useRef<Set<string>>(new Set());

  const fetchProposals = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      await withRetry(async () => {
        const data = await getProposals();
        setProposals(data);
      }, { maxAttempts: 3, initialDelayMs: 1000 });
    } catch (err) {
      console.error('Error fetching proposals:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to load proposals. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }, [getProposals]);

  const filterByStatus = (status: ProposalStatus | 'all'): Proposal[] => {
    if (status === 'all') return proposals;
    return proposals.filter((p) => p.status === status);
  };

  // Initial fetch
  useEffect(() => {
    void fetchProposals();
  }, [fetchProposals]);

  // ── Realtime subscriptions ──────────────────────────────────────────────────
  useEffect(() => {
    const unsubApproved = subscribe<{
      id: string;
      approver: string;
      eventId?: string;
    }>('proposal_approved', (data) => {
      const eventId = data.eventId ?? `approved-${data.id}-${data.approver}`;
      if (!trackEvent(eventId)) return;

      setProposals((prev) =>
        prev.map((p) => {
          if (p.id !== data.id) return p;
          if (p.approvedBy.includes(data.approver)) return p;

          const newApprovals = p.approvals + 1;
          const newApprovedBy = [...p.approvedBy, data.approver];
          const thresholdMet = newApprovals >= p.threshold;
          const updatedProposal: Proposal = {
            ...p,
            approvals: newApprovals,
            approvedBy: newApprovedBy,
            status: thresholdMet ? 'Approved' : p.status,
          };

          // Fire threshold toast if this wallet created the proposal
          if (
            thresholdMet &&
            walletAddress &&
            p.proposer === walletAddress &&
            !thresholdToastedRef.current.has(p.id)
          ) {
            thresholdToastedRef.current.add(p.id);
            notify(
              'proposal_approved',
              `Your proposal #${p.id} has reached the approval threshold and is ready to execute!`,
              'success',
            );
          }

          return updatedProposal;
        })
      );
    });

    const unsubAbstained = subscribe<{
      id: string;
      abstainer: string;
      eventId?: string;
    }>('proposal_abstained', (data) => {
      const eventId = data.eventId ?? `abstained-${data.id}-${data.abstainer}`;
      if (!trackEvent(eventId)) return;
      // Abstentions don't change approval count but we track them for future UI
      // No state update needed for current Proposal shape
    });

    const unsubReady = subscribe<{
      id: string;
      eventId?: string;
    }>('proposal_ready', (data) => {
      const eventId = data.eventId ?? `ready-${data.id}`;
      if (!trackEvent(eventId)) return;

      setProposals((prev) =>
        prev.map((p) =>
          p.id === data.id ? { ...p, status: 'Approved' as ProposalStatus } : p
        )
      );
    });

    return () => {
      unsubApproved();
      unsubAbstained();
      unsubReady();
    };
  }, [subscribe, trackEvent, notify, walletAddress]);

  return { proposals, loading, error, refetch: fetchProposals, filterByStatus };
};
