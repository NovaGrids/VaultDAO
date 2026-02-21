import React, { useState, useEffect } from 'react';
import { Search, X, SlidersHorizontal, Calendar, DollarSign, ListFilter } from 'lucide-react';

export interface FilterState {
  search: string;
  statuses: string[];
  dateRange: { from: string; to: string };
  amountRange: { min: string; max: string };
  sortBy: string;
}

interface ProposalFiltersProps {
  onFilterChange: (filters: FilterState) => void;
  proposalCount: number;
}

const STATUS_OPTIONS = ['Pending', 'Approved', 'Executed', 'Rejected', 'Expired'];

const ProposalFilters: React.FC<ProposalFiltersProps> = ({ onFilterChange, proposalCount }) => {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    statuses: [],
    dateRange: { from: '', to: '' },
    amountRange: { min: '', max: '' },
    sortBy: 'newest'
  });

  // Debounce search input to avoid lag
  useEffect(() => {
    const timer = setTimeout(() => onFilterChange(filters), 300);
    return () => clearTimeout(timer);
  }, [filters, onFilterChange]);

  const activeFilterCount = [
    filters.statuses.length > 0,
    filters.dateRange.from || filters.dateRange.to,
    filters.amountRange.min || filters.amountRange.max
  ].filter(Boolean).length;

  const clearFilters = () => {
    setFilters({
      search: '',
      statuses: [],
      dateRange: { from: '', to: '' },
      amountRange: { min: '', max: '' },
      sortBy: 'newest'
    });
  };

  const toggleStatus = (status: string) => {
    setFilters(prev => ({
      ...prev,
      statuses: prev.statuses.includes(status)
        ? prev.statuses.filter(s => s !== status)
        : [...prev.statuses, status]
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
            placeholder="Search proposer, recipient, or memo..."
            className="w-full bg-gray-900/50 border border-gray-700 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white focus:ring-2 focus:ring-purple-500 outline-none transition-all"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
        </div>

        <div className="flex gap-2">
          {/* Mobile Filter Toggle */}
          <button
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
            {STATUS_OPTIONS.map(status => (
              <button
                key={status}
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