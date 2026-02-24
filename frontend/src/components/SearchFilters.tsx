import React, { useState } from 'react';
import { Filter, X } from 'lucide-react';

export type FilterType = 'text' | 'number_range' | 'date_range' | 'select' | 'multi_select';

export interface FilterFieldConfig {
  key: string;
  label: string;
  type: FilterType;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

export interface FilterValue {
  field: string;
  type: FilterType;
  text?: string;
  numberMin?: number;
  numberMax?: number;
  dateFrom?: string;
  dateTo?: string;
  select?: string;
  multiSelect?: string[];
}

export interface SearchFiltersProps {
  fields: FilterFieldConfig[];
  values: FilterValue[];
  onChange: (values: FilterValue[]) => void;
  className?: string;
}

const SearchFilters: React.FC<SearchFiltersProps> = ({ fields, values, onChange, className = '' }) => {
  const [open, setOpen] = useState(false);

  const getValue = (fieldKey: string): FilterValue | undefined =>
    values.find((v) => v.field === fieldKey);

  const updateValue = (fieldKey: string, type: FilterType, patch: Partial<FilterValue>) => {
    const existing = values.find((v) => v.field === fieldKey);
    const next: FilterValue = existing
      ? { ...existing, ...patch, field: fieldKey, type }
      : { field: fieldKey, type, ...patch };
    onChange(
      existing
        ? values.map((v) => (v.field === fieldKey ? next : v))
        : [...values, next]
    );
  };

  const removeFilter = (fieldKey: string) => {
    onChange(values.filter((v) => v.field !== fieldKey));
  };

  const clearAll = () => onChange([]);

  const activeCount = values.filter((v) => {
    if (v.type === 'text') return !!v.text?.trim();
    if (v.type === 'number_range') return v.numberMin != null || v.numberMax != null;
    if (v.type === 'date_range') return !!v.dateFrom || !!v.dateTo;
    if (v.type === 'select') return !!v.select;
    if (v.type === 'multi_select') return (v.multiSelect?.length ?? 0) > 0;
    return false;
  }).length;

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-white border border-gray-600 min-h-[44px] sm:min-h-[36px]"
        aria-expanded={open}
      >
        <Filter size={18} />
        <span>Filters</span>
        {activeCount > 0 && (
          <span className="bg-purple-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 mt-2 w-full min-w-[280px] max-w-[90vw] sm:max-w-md bg-gray-800 border border-gray-600 rounded-xl shadow-xl z-20 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-white">Filters</h3>
              {values.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-xs text-gray-400 hover:text-white"
                >
                  Clear all
                </button>
              )}
            </div>

            {fields.map((field) => {
              const val = getValue(field.key);
              const isActive =
                val &&
                ((val.type === 'text' && val.text?.trim()) ||
                  (val.type === 'number_range' && (val.numberMin != null || val.numberMax != null)) ||
                  (val.type === 'date_range' && (val.dateFrom || val.dateTo)) ||
                  (val.type === 'select' && val.select) ||
                  (val.type === 'multi_select' && (val.multiSelect?.length ?? 0) > 0));

              return (
                <div key={field.key} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-gray-400">{field.label}</label>
                    {isActive && (
                      <button
                        type="button"
                        onClick={() => removeFilter(field.key)}
                        className="text-gray-500 hover:text-white p-0.5"
                        aria-label={`Remove ${field.label}`}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  {field.type === 'text' && (
                    <input
                      type="text"
                      placeholder={field.placeholder ?? `Search ${field.label}`}
                      value={val?.text ?? ''}
                      onChange={(e) =>
                        updateValue(field.key, 'text', { text: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  )}

                  {field.type === 'number_range' && (
                    <div className="flex gap-2">
                      <input
                        type="number"
                        placeholder="Min"
                        value={val?.numberMin ?? ''}
                        onChange={(e) =>
                          updateValue(field.key, 'number_range', {
                            numberMin: e.target.value === '' ? undefined : Number(e.target.value),
                            numberMax: val?.numberMax,
                          })
                        }
                        className="flex-1 px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-purple-500"
                      />
                      <input
                        type="number"
                        placeholder="Max"
                        value={val?.numberMax ?? ''}
                        onChange={(e) =>
                          updateValue(field.key, 'number_range', {
                            numberMin: val?.numberMin,
                            numberMax: e.target.value === '' ? undefined : Number(e.target.value),
                          })
                        }
                        className="flex-1 px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-white text-sm placeholder-gray-500 focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                  )}

                  {field.type === 'date_range' && (
                    <div className="flex gap-2">
                      <input
                        type="date"
                        value={val?.dateFrom ?? ''}
                        onChange={(e) =>
                          updateValue(field.key, 'date_range', {
                            dateFrom: e.target.value || undefined,
                            dateTo: val?.dateTo,
                          })
                        }
                        className="flex-1 px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-white text-sm focus:ring-2 focus:ring-purple-500"
                      />
                      <input
                        type="date"
                        value={val?.dateTo ?? ''}
                        onChange={(e) =>
                          updateValue(field.key, 'date_range', {
                            dateFrom: val?.dateFrom,
                            dateTo: e.target.value || undefined,
                          })
                        }
                        className="flex-1 px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-white text-sm focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                  )}

                  {field.type === 'select' && field.options && (
                    <select
                      value={val?.select ?? ''}
                      onChange={(e) =>
                        updateValue(field.key, 'select', { select: e.target.value || undefined })
                      }
                      className="w-full px-3 py-2 rounded-lg bg-gray-700 border border-gray-600 text-white text-sm focus:ring-2 focus:ring-purple-500"
                    >
                      <option value="">Any</option>
                      {field.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  )}

                  {field.type === 'multi_select' && field.options && (
                    <div className="flex flex-wrap gap-2">
                      {field.options.map((opt) => {
                        const selected = (val?.multiSelect ?? []).includes(opt.value);
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              const next = selected
                                ? (val?.multiSelect ?? []).filter((v) => v !== opt.value)
                                : [...(val?.multiSelect ?? []), opt.value];
                              updateValue(field.key, 'multi_select', { multiSelect: next });
                            }}
                            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                              selected
                                ? 'bg-purple-600 border-purple-500 text-white'
                                : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default SearchFilters;
