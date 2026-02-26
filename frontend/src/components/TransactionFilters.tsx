import React, { useMemo, useState } from 'react';
import { Calendar, DollarSign, Filter, Tags, User, X } from 'lucide-react';
import {
  DEFAULT_TRANSACTION_FILTERS,
  TYPE_OPTIONS,
  STATUS_OPTIONS,
  type TransactionStatusFilter,
  type TransactionFilterState,
  type TransactionFiltersProps,
} from './constants/transactionFilterOptions';

export type { TransactionStatusFilter, TransactionFilterState, TransactionFiltersProps };
export { DEFAULT_TRANSACTION_FILTERS };

function toggleArrayValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

const TransactionFilters: React.FC<TransactionFiltersProps> = ({
  filters,
  onChange,
  resultCount,
  className = '',
}) => {
  const [isOpenMobile, setIsOpenMobile] = useState(false);

  const activeFilterCount = useMemo(() => {
    return [
      filters.dateFrom || filters.dateTo,
      filters.types.length > 0,
      filters.amountMin || filters.amountMax,
      filters.statuses.length > 0,
      filters.address.trim().length > 0,
    ].filter(Boolean).length;
  }, [filters]);

  const setField = <K extends keyof TransactionFilterState>(
    key: K,
    value: TransactionFilterState[K]
  ): void => {
    onChange({ ...filters, [key]: value });
  };

  const clearAll = (): void => {
    onChange(DEFAULT_TRANSACTION_FILTERS);
  };

  return (
    <section className={`space-y-3 ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-gray-300">
          <button
            type="button"
            onClick={() => setIsOpenMobile((prev) => !prev)}
            className="md:hidden inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 min-h-[44px]"
          >
            <Filter size={16} />
            Filters
            {activeFilterCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-purple-600 text-white text-xs">
                {activeFilterCount}
              </span>
            )}
          </button>
          <span className="hidden md:inline text-xs text-gray-500 uppercase tracking-wide">
            Advanced Filters
          </span>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3">
          {typeof resultCount === 'number' && (
            <span className="text-xs text-gray-400">Results: {resultCount}</span>
          )}
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <X size={14} />
            Clear all
          </button>
        </div>
      </div>

      <div
        className={`${isOpenMobile ? 'grid' : 'hidden'} md:grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 rounded-xl border border-gray-700 bg-gray-800/40`}
      >
        <div className="space-y-2">
          <label className="text-xs text-gray-400 uppercase tracking-wide flex items-center gap-2">
            <Calendar size={13} />
            Date range
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="date"
              value={filters.dateFrom}
              max={filters.dateTo || undefined}
              onChange={(event) => setField('dateFrom', event.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-purple-500"
            />
            <input
              type="date"
              value={filters.dateTo}
              min={filters.dateFrom || undefined}
              onChange={(event) => setField('dateTo', event.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-gray-400 uppercase tracking-wide flex items-center gap-2">
            <DollarSign size={13} />
            Amount range
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="number"
              inputMode="decimal"
              placeholder="Min"
              value={filters.amountMin}
              onChange={(event) => setField('amountMin', event.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-purple-500"
            />
            <input
              type="number"
              inputMode="decimal"
              placeholder="Max"
              value={filters.amountMax}
              onChange={(event) => setField('amountMax', event.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>
        </div>

        <div className="space-y-2 lg:col-span-2">
          <label className="text-xs text-gray-400 uppercase tracking-wide flex items-center gap-2">
            <Tags size={13} />
            Transaction type
          </label>
          <div className="flex flex-wrap gap-2">
            {TYPE_OPTIONS.map((option) => {
              const selected = filters.types.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setField('types', toggleArrayValue(filters.types, option.value))}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                    selected
                      ? 'bg-purple-600 border-purple-500 text-white'
                      : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-gray-500'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-gray-400 uppercase tracking-wide">Status</label>
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((option) => {
              const selected = filters.statuses.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setField('statuses', toggleArrayValue(filters.statuses, option.value))}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                    selected
                      ? 'bg-purple-600 border-purple-500 text-white'
                      : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-gray-500'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-gray-400 uppercase tracking-wide flex items-center gap-2">
            <User size={13} />
            Address
          </label>
          <input
            type="text"
            value={filters.address}
            placeholder="Filter by actor or counterparty address..."
            onChange={(event) => setField('address', event.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2.5 text-sm text-white outline-none focus:ring-1 focus:ring-purple-500"
          />
        </div>
      </div>
    </section>
  );
};

export default TransactionFilters;
