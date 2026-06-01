import React, { useMemo, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import ProposalCardSkeleton from './ProposalCardSkeleton';
import type { Proposal } from './type';

interface ProposalListContainerProps {
  proposals: Proposal[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelectProposal: (proposal: Proposal) => void;
  selectedForComparison: Set<string>;
  onToggleComparison: (proposalId: string) => void;
  maxComparison?: number;
  renderProposalCard: (proposal: Proposal, isLoading?: boolean) => React.ReactNode;
}

/**
 * ProposalListContainer handles the display of proposal lists with proper
 * loading states, error handling, and responsive layout
 */
const ProposalListContainer: React.FC<ProposalListContainerProps> = ({
  proposals,
  loading,
  error,
  onRetry,
  renderProposalCard,
  selectedForComparison,
}) => {
  const containerClasses = useMemo(() => {
    return 'mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 auto-rows-max';
  }, []);

  // Show loading skeleton for initial load
  if (loading && proposals.length === 0) {
    return (
      <div className={containerClasses}>
        <ProposalCardSkeleton count={6} />
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 bg-red-50 dark:bg-red-900/20 rounded-3xl border border-dashed border-red-200 dark:border-red-900/50">
        <p className="text-red-600 dark:text-red-400 text-lg font-medium mb-3">{error}</p>
        <button
          onClick={onRetry}
          className="bg-purple-600 hover:bg-purple-700 dark:hover:bg-purple-600 px-4 py-2 rounded-lg text-sm text-white transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // Show empty state
  if (proposals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 bg-gray-50 dark:bg-gray-800/50 rounded-3xl border border-dashed border-gray-300 dark:border-gray-600">
        <p className="text-gray-600 dark:text-gray-400 text-lg font-medium">No proposals found</p>
        <p className="text-gray-500 dark:text-gray-500 text-sm mt-2">Try adjusting your filters or create a new proposal</p>
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      {proposals.map((proposal) => (
        <div key={`proposal-${proposal.id}`} className="min-w-0">
          {renderProposalCard(proposal, false)}
        </div>
      ))}
      {/* Show loading indicator for appended items */}
      {loading && proposals.length > 0 && (
        <div className="col-span-full flex justify-center py-8">
          <Loader2 size={32} className="text-purple-600 dark:text-purple-400 animate-spin" />
        </div>
      )}
    </div>
  );
};

export default React.memo(ProposalListContainer);
