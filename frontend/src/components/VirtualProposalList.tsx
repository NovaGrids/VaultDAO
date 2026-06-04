import React, { useMemo } from 'react';
import ProposalCard from './ProposalCard';
import type { Proposal } from './type';

interface VirtualProposalListProps {
  proposals: Proposal[];
  loading?: boolean;
  onProposalClick?: (proposal: Proposal) => void;
  containerHeight?: number;
  isSmallScreen?: boolean;
}

const VirtualProposalList: React.FC<VirtualProposalListProps> = ({
  proposals,
  loading = false,
  onProposalClick,
  containerHeight = 600,
  isSmallScreen = false,
}) => {
  const gridClass = useMemo(() => {
    if (isSmallScreen) return 'grid-cols-1';
    return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
  }, [isSmallScreen]);

  if (proposals.length === 0 && !loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
        No proposals found
      </div>
    );
  }

  return (
    <div
      role="grid"
      aria-label="Proposals list"
      className={`grid ${gridClass} gap-4 w-full overflow-y-auto`}
      style={{ maxHeight: containerHeight }}
    >
      {proposals.map((proposal) => (
        <div
          key={proposal.id}
          role="gridcell"
          onClick={() => onProposalClick?.(proposal)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onProposalClick?.(proposal);
            }
          }}
          className="cursor-pointer"
          tabIndex={0}
        >
          <ProposalCard proposal={proposal} />
        </div>
      ))}
    </div>
  );
};

export default React.memo(VirtualProposalList);
