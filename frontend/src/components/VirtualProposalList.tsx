import React, { useMemo } from 'react';
import ProposalCard from './ProposalCard';
import { useVirtualScroll } from '../hooks/useVirtualScroll';
import type { Proposal } from './type';

/** Height in px reserved for one row of proposal cards, including the gap. */
export const DEFAULT_ROW_HEIGHT = 220;

/** Columns rendered per row on a wide viewport. */
export const DEFAULT_COLUMN_COUNT = 3;

interface VirtualProposalListProps {
  /**
   * Proposals to render.
   *
   * These are expected to be **already filtered**. This component performs no
   * searching or filtering of its own: doing that here forced a full re-render
   * of the list on every keystroke. Filtering now lives in the container above
   * the scroll boundary — see `ProposalSearchList`.
   */
  proposals: Proposal[];
  loading?: boolean;
  onProposalClick?: (proposal: Proposal) => void;
  containerHeight?: number;
  isSmallScreen?: boolean;
  /** Columns per row on a wide viewport. Ignored when `isSmallScreen`. */
  columnCount?: number;
  /** Height of one row in px. Must match the rendered card height. */
  rowHeight?: number;
  /** Message shown when there is nothing to render. */
  emptyMessage?: string;
}

const VirtualProposalList: React.FC<VirtualProposalListProps> = ({
  proposals,
  loading = false,
  onProposalClick,
  containerHeight = 600,
  isSmallScreen = false,
  columnCount = DEFAULT_COLUMN_COUNT,
  rowHeight = DEFAULT_ROW_HEIGHT,
  emptyMessage = 'No proposals found',
}) => {
  // Virtualization needs a known column count, so the responsive Tailwind
  // breakpoints are resolved to a single number here instead.
  const columns = isSmallScreen ? 1 : Math.max(1, columnCount);
  const rowCount = Math.ceil(proposals.length / columns);

  const { handleScroll, range, offscreenStartSize, offscreenEndSize } =
    useVirtualScroll({
      itemCount: rowCount,
      itemHeight: rowHeight,
      containerHeight,
      // Each overscanned row costs a full row of cards. Two rows of headroom
      // is enough to cover a fast scroll without tripling the mounted card
      // count the way the default does.
      overscanCount: 2,
    });

  // Only the rows inside the scroll window (plus overscan) are materialised,
  // so render cost is bounded by viewport size rather than list length.
  const visibleRows = useMemo(() => {
    const rows: Proposal[][] = [];
    for (let rowIndex = range.startIndex; rowIndex < range.endIndex; rowIndex++) {
      rows.push(proposals.slice(rowIndex * columns, rowIndex * columns + columns));
    }
    return rows;
  }, [proposals, columns, range.startIndex, range.endIndex]);

  const gridClass = useMemo(() => {
    if (columns === 1) return 'grid-cols-1';
    if (columns === 2) return 'grid-cols-2';
    return 'grid-cols-3';
  }, [columns]);

  if (proposals.length === 0 && !loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      role="grid"
      aria-label="Proposals list"
      aria-rowcount={rowCount}
      className="w-full overflow-y-auto"
      style={{ maxHeight: containerHeight }}
      onScroll={handleScroll}
    >
      {/* Spacers stand in for the rows above and below the window so the
          scrollbar reflects the full list rather than just what is rendered. */}
      <div style={{ height: offscreenStartSize }} aria-hidden="true" />

      {visibleRows.map((row, offset) => (
        <div
          key={range.startIndex + offset}
          role="row"
          aria-rowindex={range.startIndex + offset + 1}
          className={`grid ${gridClass} gap-4 w-full`}
          style={{ height: rowHeight }}
        >
          {row.map((proposal) => (
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
      ))}

      <div style={{ height: offscreenEndSize }} aria-hidden="true" />
    </div>
  );
};

export default React.memo(VirtualProposalList);
