import React, { useMemo, useState } from 'react';
import VirtualProposalList from './VirtualProposalList';
import { useDebouncedValue, SEARCH_DEBOUNCE_MS } from '../hooks/useDebouncedValue';
import { filterProposals } from '../utils/filterProposals';
import type { Proposal } from './type';

interface ProposalSearchListProps {
  proposals: Proposal[];
  loading?: boolean;
  onProposalClick?: (proposal: Proposal) => void;
  containerHeight?: number;
  isSmallScreen?: boolean;
  /** Debounce applied to the search input, in ms. */
  debounceMs?: number;
  placeholder?: string;
}

/**
 * Search + virtualized proposal list.
 *
 * The search input and the filtering both live here, *above* the virtual
 * scroll container. `VirtualProposalList` receives an already-filtered array
 * and re-renders only when that array's identity changes, so a keystroke that
 * does not change the result set costs nothing downstream.
 *
 * Three things keep typing smooth on large lists:
 *  1. The input is controlled by the raw query, so keystrokes are never
 *     delayed by filtering.
 *  2. Filtering is keyed off a debounced query, so it runs once the user
 *     pauses rather than once per character.
 *  3. The result is memoized, so unrelated re-renders do not refilter.
 */
const ProposalSearchList: React.FC<ProposalSearchListProps> = ({
  proposals,
  loading = false,
  onProposalClick,
  containerHeight = 600,
  isSmallScreen = false,
  debounceMs = SEARCH_DEBOUNCE_MS,
  placeholder = 'Search proposals...',
}) => {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, debounceMs);

  const filteredProposals = useMemo(
    () => filterProposals(proposals, debouncedQuery),
    [proposals, debouncedQuery],
  );

  const isSearching = query.trim() !== debouncedQuery.trim();

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center gap-3">
        <input
          type="search"
          role="searchbox"
          aria-label="Search proposals"
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <p
        className="text-xs text-gray-500 dark:text-gray-400"
        aria-live="polite"
      >
        {filteredProposals.length} of {proposals.length} proposals
        {isSearching ? ' (searching...)' : ''}
      </p>

      <VirtualProposalList
        proposals={filteredProposals}
        loading={loading}
        onProposalClick={onProposalClick}
        containerHeight={containerHeight}
        isSmallScreen={isSmallScreen}
        emptyMessage={
          debouncedQuery.trim()
            ? `No proposals match "${debouncedQuery.trim()}"`
            : 'No proposals found'
        }
      />
    </div>
  );
};

export default React.memo(ProposalSearchList);
