import React, { useState, useEffect, useMemo } from 'react';
import { Search, X, SlidersHorizontal, Calendar, DollarSign, ListFilter, Tag } from 'lucide-react';

export interface FilterState {
  search: string;
  statuses: string[];
  dateRange: { from: string; to: string };
  amountRange: { min: string; max: string };
  sortBy: string;
  tags: string[];
}

export interface ProposalWithTags {
  id?: string | number;
  tags?: string[];
}

export interface ProposalFiltersProps {
  onFilterChange: (filters: FilterState) => void;
  proposalCount: number;
  availableTags?: string[];
  proposals?: ProposalWithTags[];
  tagCounts?: Record<string, number>;
  fetchTagCounts?: () => Promise<Record<string, number>>;
}

const STATUS_OPTIONS = ['Pending', 'Approved', 'Executed', 'Rejected', 'Expired'];

const ProposalFilters: React.FC<ProposalFiltersProps> = ({
  onFilterChange,
  proposalCount,
  availableTags,
  proposals,
  tagCounts: tagCountsProp,
  fetchTagCounts,
}) => {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    statuses: [],
    dateRange: { from: '', to: '' },
    amountRange: { min: '', max: '' },
    sortBy: 'newest',
    tags: [],
  });
  const [fetchedCounts, setFetchedCounts] = useState<Record<string, number> | null>(null);

  // Fetch tag counts asynchronously from backend if provided
  useEffect(() => {
    if (!fetchTagCounts) return;
    let isSubscribed = true;
    fetchTagCounts()
      .then((counts) => {
        if (isSubscribed) setFetchedCounts(counts);
      })
      .catch((err: unknown) => {
        console.error('Failed to fetch tag counts:', err);
      });
    return () => {
      isSubscribed = false;
    };
  }, [fetchTagCounts]);

  // Compute tag counts client-side from loaded proposals in real-time
  const clientCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (proposals && proposals.length > 0) {
      for (const p of proposals) {
        if (Array.isArray(p.tags)) {
          for (const t of p.tags) {
            if (typeof t === 'string' && t.trim()) {
              const normalized = t.trim();
              counts[normalized] = (counts[normalized] || 0) + 1;
            }
          }
        }
      }
    }
    return counts;
  }, [proposals]);

  // Determine effective tag counts: explicit prop takes precedence, then backend fetch, then client-side computation
  const effectiveTagCounts = useMemo(() => {
    if (tagCountsProp) return tagCountsProp;
    if (fetchedCounts) return fetchedCounts;
    return clientCounts;
  }, [tagCountsProp, fetchedCounts, clientCounts]);

  // Determine which tags to display: use availableTags if provided, otherwise discovered tags
  const displayTags = useMemo(() => {
    if (availableTags && availableTags.length > 0) {
      return availableTags;
    }
    const discovered = Object.keys(effectiveTagCounts);
    if (discovered.length > 0) {
      return discovered;
    }
    return [];
  }, [availableTags, effectiveTagCounts]);

  // Debounce filter input to avoid lag
  useEffect(() => {
    const timer = setTimeout(() => onFilterChange(filters), 300);
    return () => clearTimeout(timer);
  }, [filters, onFilterChange]);

  const activeFilterCount = [
    filters.statuses.length > 0,
    filters.tags.length > 0,
    filters.dateRange.from || filters.dateRange.to,
    filters.amountRange.min || filters.amountRange.max,
  ].filter(Boolean).length;

  const clearFilters = () => {
    setFilters({
      search: '',
      statuses: [],
      dateRange: { from: '', to: '' },
      amountRange: { min: '', max: '' },
      sortBy: 'newest',
      tags: [],
    });
  };

  const toggleStatus = (status: string) => {
    setFilters((prev) => ({
      ...prev,
      statuses: prev.statuses.includes(status)
        ? prev.statuses.filter((s) => s !== status)
        : [...prev.statuses, status],
    }));
  };

  const toggleTag = (tag: string) => {
    setFilters((prev) => ({
      ...prev,
      tags: prev.tags.includes(tag)
        ? prev.tags.filter((t) => t !== tag)
        : [...prev.tags, tag],
    }));
  };

  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-col md:flex-row gap-3">
        {/* Search Bar */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
          <input
            type="text"
            placeholder='Search proposals… try "recipient:alice amount:>1000"'
            className="w-full bg-gray-900/50 border border-gray-700 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white focus:ring-2 focus:ring-purple-500 outline-none transition-all"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
        </div>

        <div className="flex gap-2">
          {/* Mobile Filter Toggle */}
          <button
            type="button"
            data-testid="mobile-filter-toggle"
            aria-label="Toggle filters"
            onClick={() => setIsMobileOpen(!isMobileOpen)}
            className="md:hidden flex items-center justify-center gap-2 bg-gray-800 border border-gray-700 px-4 py-2.5 rounded-xl text-sm text-white flex-1"
          >
            <SlidersHorizontal size={18} />
            Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
          </button>

          {/* Sort Dropdown */}
          <div className="relative flex-1 md:w-48">
            <ListFilter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
            <select
              className="w-full bg-gray-800 border border-gray-700 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white outline-none focus:ring-2 focus:ring-purple-500 appearance-none"
              value={filters.sortBy}
              onChange={(e) => setFilters({ ...filters, sortBy: e.target.value })}
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="highest">Highest Amount</option>
              <option value="lowest">Lowest Amount</option>
            </select>
          </div>
        </div>
      </div>

      {/* Expanded Filter Panel */}
      <div className={`${isMobileOpen ? 'block' : 'hidden'} md:grid grid-cols-1 md:grid-cols-3 gap-6 p-5 bg-gray-800/40 border border-gray-700 rounded-2xl`}>
        {/* Status Multi-select */}
        <div className="space-y-3">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">Status</label>
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => toggleStatus(status)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  filters.statuses.includes(status)
                    ? 'bg-purple-600 text-white border-purple-500'
                    : 'bg-gray-900 text-gray-400 border border-gray-700 hover:border-gray-500'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Date Range */}
        <div className="space-y-3">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <Calendar size={14} /> Created Date
          </label>
          <div className="flex gap-2">
            <input
              type="date"
              className="bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs text-white w-full outline-none focus:ring-1 focus:ring-purple-500"
              value={filters.dateRange.from}
              onChange={(e) => setFilters({ ...filters, dateRange: { ...filters.dateRange, from: e.target.value } })}
            />
            <input
              type="date"
              className="bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs text-white w-full outline-none focus:ring-1 focus:ring-purple-500"
              value={filters.dateRange.to}
              onChange={(e) => setFilters({ ...filters, dateRange: { ...filters.dateRange, to: e.target.value } })}
            />
          </div>
        </div>

        {/* Amount Range */}
        <div className="space-y-3">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <DollarSign size={14} /> Amount Range
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Min"
              className="bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs text-white w-full outline-none focus:ring-1 focus:ring-purple-500"
              value={filters.amountRange.min}
              onChange={(e) => setFilters({ ...filters, amountRange: { ...filters.amountRange, min: e.target.value } })}
            />
            <input
              type="number"
              placeholder="Max"
              className="bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs text-white w-full outline-none focus:ring-1 focus:ring-purple-500"
              value={filters.amountRange.max}
              onChange={(e) => setFilters({ ...filters, amountRange: { ...filters.amountRange, max: e.target.value } })}
            />
          </div>
        </div>

        {/* Tags Multi-select */}
        {displayTags.length > 0 && (
          <div className="md:col-span-3 space-y-3 pt-4 border-t border-gray-700/60">
            <div className="flex items-center gap-2">
              <Tag size={14} className="text-gray-400" />
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                Tags
              </label>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by tag">
              {displayTags.map((tag) => {
                const count = effectiveTagCounts[tag] ?? 0;
                const isSelected = filters.tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    aria-pressed={isSelected}
                    aria-label={`Tag ${tag}, ${count} proposals`}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isSelected
                        ? 'bg-purple-600 text-white border-purple-500'
                        : 'bg-gray-900 text-gray-400 border border-gray-700 hover:border-gray-500'
                    }`}
                  >
                    <span>{tag}</span>
                    <span
                      data-testid={`tag-badge-${tag}`}
                      className={`inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-semibold rounded-full min-w-[18px] transition-colors ${
                        isSelected
                          ? 'bg-purple-700 text-white'
                          : count === 0
                          ? 'bg-gray-800 text-gray-500 border border-gray-700/60'
                          : 'bg-gray-800 text-gray-300'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Results Info & Clear Button */}
        <div className="md:col-span-3 flex items-center justify-between pt-4 border-t border-gray-700">
          <span className="text-sm text-gray-400">
            Showing <b>{proposalCount}</b> results
          </span>
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 font-medium transition-colors"
          >
            <X size={14} /> Clear all filters
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProposalFilters;