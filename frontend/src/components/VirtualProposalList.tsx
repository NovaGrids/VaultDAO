import React, { useMemo, useCallback } from 'react';
import { FixedSizeGrid as Grid } from 'react-window';
import ProposalCard from './ProposalCard';
import type { Proposal } from './type';

interface VirtualProposalListProps {
  proposals: Proposal[];
  loading?: boolean;
  onProposalClick?: (proposal: Proposal) => void;
  containerHeight?: number;
  isSmallScreen?: boolean;
}

const CARD_HEIGHT = 280; // Height of a proposal card
const CARD_WIDTH_DESKTOP = 384; // 1/3 of typical desktop width (1152px / 3)
const CARD_WIDTH_MOBILE = '100%';
const COLUMN_GAP = 16; // Tailwind gap-4
const ROW_GAP = 16;

const VirtualProposalList: React.FC<VirtualProposalListProps> = ({
  proposals,
  loading = false,
  onProposalClick,
  containerHeight = 600,
  isSmallScreen = false,
}) => {
  // Calculate grid dimensions
  const columnCount = useMemo(() => {
    if (isSmallScreen) return 1;
    if (window.innerWidth < 1024) return 2;
    return 3;
  }, [isSmallScreen]);

  const rowCount = Math.ceil(proposals.length / columnCount);
  const columnWidth = useMemo(() => {
    return Math.floor((window.innerWidth - 32 - (columnCount - 1) * COLUMN_GAP) / columnCount);
  }, [columnCount]);

  const itemData = useMemo(
    () => ({
      proposals,
      columnCount,
      columnWidth,
      onProposalClick,
    }),
    [proposals, columnCount, columnWidth, onProposalClick]
  );

  const Cell = useCallback(
    ({ columnIndex, rowIndex, style }: { columnIndex: number; rowIndex: number; style: React.CSSProperties }) => {
      const index = rowIndex * columnCount + columnIndex;
      const proposal = proposals[index];

      if (!proposal) return null;

      return (
        <div
          style={{
            ...style,
            padding: `0 ${COLUMN_GAP / 2}px ${ROW_GAP}px ${COLUMN_GAP / 2}px`,
            boxSizing: 'border-box',
          }}
          role="gridcell"
          aria-colindex={columnIndex + 1}
          aria-rowindex={rowIndex + 1}
        >
          <div
            onClick={() => onProposalClick?.(proposal)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onProposalClick?.(proposal);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <ProposalCard proposal={proposal} />
          </div>
        </div>
      );
    },
    [proposals, columnCount, onProposalClick]
  );

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
      aria-rowcount={rowCount}
      aria-colcount={columnCount}
      className="w-full"
    >
      <Grid
        columnCount={columnCount}
        columnWidth={columnWidth}
        height={containerHeight}
        rowCount={rowCount}
        rowHeight={CARD_HEIGHT + ROW_GAP}
        width={typeof window !== 'undefined' ? window.innerWidth - 32 : 600}
        itemData={itemData}
      >
        {Cell}
      </Grid>
    </div>
  );
};

export default React.memo(VirtualProposalList);
