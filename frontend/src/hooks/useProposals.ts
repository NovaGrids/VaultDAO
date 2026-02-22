// frontend/src/hooks/useProposals.ts

import { useState, useEffect, useCallback } from 'react';
// import { useVaultContract } from './useVaultContract';
import type { Proposal, ProposalStatus } from '../components/type';

interface UseProposalsReturn {
  proposals: Proposal[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  filterByStatus: (status: ProposalStatus | 'all') => Proposal[];
}

export const useProposals = (): UseProposalsReturn => {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // const { getProposals } = useVaultContract();
  // TODO: Implement getProposals in useVaultContract

  /**
   * Fetch proposals from contract
   */
  const fetchProposals = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // TODO: Replace with actual contract call when getProposals is implemented
      // const data = await getProposals();
      // setProposals(data);
      
      // For now, return empty array
      setProposals([]);

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
  }, []);

  /**
   * Filter proposals by status
   */
  const filterByStatus = (status: ProposalStatus | 'all'): Proposal[] => {
    if (status === 'all') {
      return proposals;
    }
    return proposals.filter(p => p.status === status);
  };

  /**
   * Fetch on mount
   */
  useEffect(() => {
    void fetchProposals();
  }, [fetchProposals]);

  return {
    proposals,
    loading,
    error,
    refetch: fetchProposals,
    filterByStatus
  };
};
