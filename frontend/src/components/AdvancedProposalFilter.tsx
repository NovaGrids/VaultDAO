/**
 * AdvancedProposalFilter — full-featured filter panel for the Proposals page.
 * - Filters: status (multi-select), proposer, recipient, token, amount range,
 *   date range, tags (multi-select), priority
 * - Syncs state to URL query params (shareable / survives refresh)
 * - Wires SavedSearches to save/load filter state by name
 * - Debounces text inputs 300 ms
 * - Shows active filter count badge on the toggle button
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SlidersHorizontal, X, Bookmark, ChevronDown, ChevronUp } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import SavedSearches from './SavedSearches';
import { saveSearch, filtersToSearchParams, searchParamsToFilters } from '../utils/search';

export interface AdvancedFilterState {
  search: string;
  statuses: string[];
  proposer: string;
  recipient: string;
  token: string;
  amountRange: { min: string; max: string };
  dateRange: { from: string; to: string };
  tags: string[];
  priority: string;
  sortBy: string;
}

const DEFAULTS: AdvancedFilterState = {
  search: '',
  statuses: [],
  proposer: '',
  recipient: '',
  token: '',
  amountRange: { min: '', max: '' },
  dateRange: { from: '', to: '' },
  tags: [],
  priority: '',
  sortBy: 'newest',
};

const STATUS_OPTIONS = ['Pending', 'Approved', 'Executed', 'Rejected', 'Expired'];
const PRIORITY_OPTIONS = ['', 'Low', 'Medium', 'High', 'Critical'];
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'amount_desc', label: 'Amount ↓' },
  { value: 'amount_asc', label: 'Amount ↑' },
];

interface AdvancedProposalFilterProps {
  onFilterChange: (filters: AdvancedFilterState) => void;
  availableTags?: string[];
  proposalCount?: number;
}

const AdvancedProposalFilter: React.FC<AdvancedProposalFilterProps> = ({
  onFilterChange,
  availableTags = [],
  proposalCount,
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState('');
  const [showSaveName, setShowSaveName] = useState(false);

  const [filters, setFilters] = useState<AdvancedFilterState>(() =>
    searchParamsToFilters(searchParams, DEFAULTS)
  );

  // Debounce text fields before emitting
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emitFilters = useCallback(
    (next: AdvancedFilterState) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onFilterChange(next);
        setSearchParams(filtersToSearchParams(next as unknown as Record<string, unknown>), { replace: true });
      }, 300);
    },
    [onFilterChange, setSearchParams]
  );

  useEffect(() => {
    emitFilters(filters);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [filters, emitFilters]);

  const update = <K extends keyof AdvancedFilterState>(key: K, value: AdvancedFilterState[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const toggleStatus = (s: string) =>
    update('statuses', filters.statuses.includes(s)
      ? filters.statuses.filter((x) => x !== s)
      : [...filters.statuses, s]);

  const toggleTag = (t: string) =>
    update('tags', filters.tags.includes(t)
      ? filters.tags.filter((x) => x !== t)
      : [...filters.tags, t]);

  const clearAll = () => {
    setFilters(DEFAULTS);
    setSearchParams(new URLSearchParams(), { replace: true });
    onFilterChange(DEFAULTS);
  };

  const activeCount = [
    filters.search,
    filters.statuses.length > 0,
    filters.proposer,
    filters.recipient,
    filters.token,
    filters.amountRange.min || filters.amountRange.max,
    filters.dateRange.from || filters.dateRange.to,
    filters.tags.length > 0,
    filters.priority,
  ].filter(Boolean).length;

  const handleSaveSearch = () => {
    if (!saveNameInput.trim()) return;
    saveSearch(saveNameInput.trim(), filters.search, filters as unknown as Record<string, unknown>);
    setSaveNameInput('');
    setShowSaveName(false);
  };

  const handleLoadSaved = (_query: string, savedFilters: Record<string, unknown>) => {
    const loaded = { ...DEFAULTS, ...(savedFilters as Partial<AdvancedFilterState>) };
    setFilters(loaded);
  };

  return (
    <div className="w-full">
      {/* Toggle bar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="advanced-filter-panel"
          className="relative flex items-center gap-2 rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white hover:bg-gray-700 min-h-[44px]"
        >
          <SlidersHorizontal size={16} />
          <span>Filters</span>
          {activeCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">
              {activeCount}
            </span>
          )}
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {/* Saved searches */}
        <SavedSearches onSelect={handleLoadSaved} />

        {/* Save current search */}
        {activeCount > 0 && (
          <div className="flex items-center gap-1">
            {showSaveName ? (
              <>
                <input
                  type="text"
                  value={saveNameInput}
                  onChange={(e) => setSaveNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveSearch()}
                  placeholder="Search name…"
                  aria-label="Name for saved search"
                  className="rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[44px] w-40"
                />
                <button
                  type="button"
                  onClick={handleSaveSearch}
                  className="rounded-lg bg-purple-600 px-3 py-2 text-sm text-white hover:bg-purple-700 min-h-[44px]"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setShowSaveName(false)}
                  className="p-2 text-gray-400 hover:text-white"
                  aria-label="Cancel save"
                >
                  <X size={16} />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowSaveName(true)}
                className="flex items-center gap-1 rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white hover:bg-gray-700 min-h-[44px]"
              >
                <Bookmark size={14} />
                <span>Save search</span>
              </button>
            )}
          </div>
        )}

        {/* Active filter chips */}
        {filters.statuses.map((s) => (
          <span key={s} className="flex items-center gap-1 rounded-full bg-purple-600/20 px-2 py-1 text-xs text-purple-300">
            {s}
            <button
              type="button"
              onClick={() => toggleStatus(s)}
              aria-label={`Remove ${s} filter`}
              className="hover:text-white"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        {filters.tags.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-full bg-blue-600/20 px-2 py-1 text-xs text-blue-300">
            {t}
            <button
              type="button"
              onClick={() => toggleTag(t)}
              aria-label={`Remove tag ${t}`}
              className="hover:text-white"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-gray-400 hover:text-white underline"
          >
            Clear all
          </button>
        )}

        {proposalCount !== undefined && (
          <span className="ml-auto text-sm text-gray-400">{proposalCount} proposals</span>
        )}
      </div>

      {/* Expanded panel */}
      {open && (
        <div
          id="advanced-filter-panel"
          className="mt-3 rounded-xl border border-gray-700 bg-gray-800/80 p-4 backdrop-blur-sm"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Search */}
            <div>
              <label htmlFor="af-search" className="mb-1 block text-xs font-medium text-gray-400">
                Search
              </label>
              <input
                id="af-search"
                type="text"
                value={filters.search}
                onChange={(e) => update('search', e.target.value)}
                placeholder="Keyword…"
                className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* Proposer */}
            <div>
              <label htmlFor="af-proposer" className="mb-1 block text-xs font-medium text-gray-400">
                Proposer address
              </label>
              <input
                id="af-proposer"
                type="text"
                value={filters.proposer}
                onChange={(e) => update('proposer', e.target.value)}
                placeholder="G…"
                className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm font-mono text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* Recipient */}
            <div>
              <label htmlFor="af-recipient" className="mb-1 block text-xs font-medium text-gray-400">
                Recipient address
              </label>
              <input
                id="af-recipient"
                type="text"
                value={filters.recipient}
                onChange={(e) => update('recipient', e.target.value)}
                placeholder="G…"
                className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm font-mono text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* Token */}
            <div>
              <label htmlFor="af-token" className="mb-1 block text-xs font-medium text-gray-400">
                Token
              </label>
              <input
                id="af-token"
                type="text"
                value={filters.token}
                onChange={(e) => update('token', e.target.value)}
                placeholder="XLM, USDC…"
                className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* Amount range */}
            <div>
              <p className="mb-1 text-xs font-medium text-gray-400">Amount range</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={filters.amountRange.min}
                  onChange={(e) => update('amountRange', { ...filters.amountRange, min: e.target.value })}
                  placeholder="Min"
                  aria-label="Minimum amount"
                  className="w-1/2 rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <input
                  type="number"
                  value={filters.amountRange.max}
                  onChange={(e) => update('amountRange', { ...filters.amountRange, max: e.target.value })}
                  placeholder="Max"
                  aria-label="Maximum amount"
                  className="w-1/2 rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>

            {/* Date range */}
            <div>
              <p className="mb-1 text-xs font-medium text-gray-400">Date range</p>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={filters.dateRange.from}
                  onChange={(e) => update('dateRange', { ...filters.dateRange, from: e.target.value })}
                  aria-label="Date from"
                  className="w-1/2 rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <input
                  type="date"
                  value={filters.dateRange.to}
                  onChange={(e) => update('dateRange', { ...filters.dateRange, to: e.target.value })}
                  aria-label="Date to"
                  className="w-1/2 rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>

            {/* Priority */}
            <div>
              <label htmlFor="af-priority" className="mb-1 block text-xs font-medium text-gray-400">
                Priority
              </label>
              <select
                id="af-priority"
                value={filters.priority}
                onChange={(e) => update('priority', e.target.value)}
                className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p || 'Any priority'}</option>
                ))}
              </select>
            </div>

            {/* Sort */}
            <div>
              <label htmlFor="af-sort" className="mb-1 block text-xs font-medium text-gray-400">
                Sort by
              </label>
              <select
                id="af-sort"
                value={filters.sortBy}
                onChange={(e) => update('sortBy', e.target.value)}
                className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Status multi-select */}
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-gray-400">Status</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStatus(s)}
                  aria-pressed={filters.statuses.includes(s)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    filters.statuses.includes(s)
                      ? 'bg-purple-600 text-white'
                      : 'border border-gray-600 bg-gray-900 text-gray-300 hover:border-purple-500'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Tags multi-select */}
          {availableTags.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-gray-400">Tags</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by tag">
                {availableTags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
                    aria-pressed={filters.tags.includes(t)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      filters.tags.includes(t)
                        ? 'bg-blue-600 text-white'
                        : 'border border-gray-600 bg-gray-900 text-gray-300 hover:border-blue-500'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdvancedProposalFilter;
