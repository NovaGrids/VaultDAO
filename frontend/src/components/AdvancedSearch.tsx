import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Search, Mic, MicOff, Download } from 'lucide-react';
import {
  getSearchHistory,
  addToSearchHistory,
  getSavedSearches,
  getSearchSuggestions,
  saveSearch,
  exportSearchResultsToCsv,
} from '../utils/search';
import SearchFilters, {
  type FilterFieldConfig,
  type FilterValue,
} from './SearchFilters';
import SavedSearches from './SavedSearches';

export interface AdvancedSearchProps<T extends Record<string, unknown>> {
  /** Current query (controlled) */
  value: string;
  /** Query change handler */
  onChange: (query: string) => void;
  /** Filter field configs for the filter builder */
  filterFields: FilterFieldConfig[];
  /** Current filter values */
  filterValues: FilterValue[];
  /** Filter change handler */
  onFilterChange: (values: FilterValue[]) => void;
  /** Search submit (e.g. on Enter or suggestion select). Optional. */
  onSearch?: (query: string) => void;
  /** Current result set for export and count */
  results: T[];
  /** CSV filename for export */
  exportFilename?: string;
  /** Placeholder for search input */
  placeholder?: string;
  /** Show saved searches button */
  showSavedSearches?: boolean;
  /** Show export button */
  showExport?: boolean;
  /** Enable voice search (default true; often only works on mobile over HTTPS) */
  voiceSearchEnabled?: boolean;
  className?: string;
}

function AdvancedSearch<T extends Record<string, unknown>>({
  value,
  onChange,
  filterFields,
  filterValues,
  onFilterChange,
  onSearch,
  results,
  exportFilename = 'search-results.csv',
  placeholder = 'Search…',
  showSavedSearches = true,
  showExport = true,
  voiceSearchEnabled = true,
  className = '',
}: AdvancedSearchProps<T>) {
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const history = getSearchHistory();
  const saved = getSavedSearches();
  const suggestions = getSearchSuggestions(value, history, saved, 8);

  const handleSubmit = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (trimmed) addToSearchHistory(trimmed);
      onSearch?.(trimmed);
      setSuggestionsOpen(false);
    },
    [onSearch]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSubmit(value);
    }
    if (e.key === 'Escape') {
      setSuggestionsOpen(false);
      inputRef.current?.blur();
    }
  };

  useEffect(() => {
    function handleClickOutside(ev: MouseEvent) {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(ev.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(ev.target as Node)
      ) {
        setSuggestionsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const startVoiceSearch = () => {
    type SpeechRecognitionCtor = new () => {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      start: () => void;
      onresult: (event: { results: unknown }) => void;
      onerror: () => void;
      onend: () => void;
    };
    const Win = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const SR = Win.SpeechRecognition ?? Win.webkitSpeechRecognition;
    if (!SR) {
      setVoiceError('Voice search not supported in this browser.');
      return;
    }
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    setVoiceError(null);
    setIsListening(true);
    recognition.onresult = (event: { results: unknown }) => {
      const results = event.results as { [i: number]: { [j: number]: { transcript: string } } };
      const transcript = results[0]?.[0]?.transcript ?? '';
      onChange(transcript);
      handleSubmit(transcript);
      setIsListening(false);
    };
    recognition.onerror = () => {
      setVoiceError('Voice input failed. Try again.');
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const handleExport = () => {
    exportSearchResultsToCsv(results, exportFilename);
  };

  const handleSaveCurrentSearch = () => {
    const name = window.prompt('Name this search', value.slice(0, 30) || 'My search');
    if (name != null && name.trim()) {
      const filtersObj: Record<string, unknown> = {};
      filterValues.forEach((f) => {
        if (f.type === 'text' && f.text != null) filtersObj[f.field] = f.text;
        if (f.type === 'number_range') {
          if (f.numberMin != null) filtersObj[`${f.field}_min`] = f.numberMin;
          if (f.numberMax != null) filtersObj[`${f.field}_max`] = f.numberMax;
        }
        if (f.type === 'date_range') {
          if (f.dateFrom) filtersObj[`${f.field}_from`] = f.dateFrom;
          if (f.dateTo) filtersObj[`${f.field}_to`] = f.dateTo;
        }
        if (f.type === 'select' && f.select != null) filtersObj[f.field] = f.select;
        if (f.type === 'multi_select' && f.multiSelect?.length)
          filtersObj[f.field] = f.multiSelect;
      });
      saveSearch(name.trim(), value, filtersObj);
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1" ref={suggestionsRef}>
          <div className="flex rounded-lg overflow-hidden border border-gray-600 bg-gray-800 focus-within:ring-2 focus-within:ring-purple-500 focus-within:border-transparent">
            <span className="flex items-center pl-3 text-gray-500" aria-hidden>
              <Search size={20} />
            </span>
            <input
              ref={inputRef}
              type="search"
              value={value}
              onChange={(e) => {
                onChange(e.target.value);
                setSuggestionsOpen(true);
              }}
              onFocus={() => setSuggestionsOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="flex-1 min-w-0 py-3 sm:py-2.5 pl-2 pr-2 bg-transparent text-white placeholder-gray-500 border-0 focus:ring-0 text-base sm:text-sm min-h-[48px] sm:min-h-[40px]"
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={suggestionsOpen && suggestions.length > 0}
              aria-controls="search-suggestions"
              id="advanced-search-input"
            />
            {voiceSearchEnabled && (
              <button
                type="button"
                onClick={startVoiceSearch}
                disabled={isListening}
                className={`flex items-center justify-center w-12 sm:w-10 shrink-0 border-l border-gray-600 ${
                  isListening
                    ? 'bg-red-600/20 text-red-400'
                    : 'text-gray-400 hover:bg-gray-700 hover:text-white'
                } min-h-[48px] sm:min-h-[40px]`}
                title="Voice search"
                aria-label={isListening ? 'Listening…' : 'Start voice search'}
              >
                {isListening ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
            )}
          </div>

          {voiceError && (
            <p className="mt-1 text-xs text-amber-400" role="alert">
              {voiceError}
            </p>
          )}

          {suggestionsOpen && suggestions.length > 0 && (
            <ul
              id="search-suggestions"
              className="absolute left-0 right-0 mt-1 py-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-30 max-h-[240px] overflow-y-auto"
              role="listbox"
            >
              {suggestions.map((s, i) => (
                <li key={`${s.type}-${s.text}-${i}`} role="option">
                  <button
                    type="button"
                    onClick={() => {
                      onChange(s.text);
                      handleSubmit(s.text);
                    }}
                    className="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-gray-700 flex items-center gap-2"
                  >
                    {s.name ? (
                      <>
                        <span className="text-gray-400 truncate">{s.name}</span>
                        <span className="truncate">&quot;{s.text}&quot;</span>
                      </>
                    ) : (
                      <span className="truncate">{s.text}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SearchFilters
            fields={filterFields}
            values={filterValues}
            onChange={onFilterChange}
          />
          {showSavedSearches && (
            <SavedSearches
              onSelect={(query, filters) => {
                onChange(query);
                handleSubmit(query);
                if (Object.keys(filters).length && filterFields.length) {
                  const next: FilterValue[] = filterFields
                    .filter((f) => f.key in filters || `${f.key}_min` in filters || `${f.key}_from` in filters)
                    .map((f) => {
                      const v = filters[f.key];
                      const min = filters[`${f.key}_min`];
                      const max = filters[`${f.key}_max`];
                      const from = filters[`${f.key}_from`];
                      const to = filters[`${f.key}_to`];
                      if (f.type === 'text') return { field: f.key, type: 'text', text: v as string };
                      if (f.type === 'number_range')
                        return {
                          field: f.key,
                          type: 'number_range',
                          numberMin: min as number | undefined,
                          numberMax: max as number | undefined,
                        };
                      if (f.type === 'date_range')
                        return {
                          field: f.key,
                          type: 'date_range',
                          dateFrom: from as string | undefined,
                          dateTo: to as string | undefined,
                        };
                      if (f.type === 'select')
                        return { field: f.key, type: 'select', select: v as string };
                      if (f.type === 'multi_select')
                        return { field: f.key, type: 'multi_select', multiSelect: (v as string[]) ?? [] };
                      return { field: f.key, type: f.type };
                    });
                  if (next.length) onFilterChange(next);
                }
              }}
            />
          )}
          {showExport && (
            <button
              type="button"
              onClick={handleExport}
              disabled={results.length === 0}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-white border border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] sm:min-h-[36px]"
            >
              <Download size={18} />
              <span>Export ({results.length})</span>
            </button>
          )}
        </div>
      </div>

      {value.trim() && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span>{results.length} result{results.length !== 1 ? 's' : ''}</span>
          <button
            type="button"
            onClick={handleSaveCurrentSearch}
            className="text-purple-400 hover:text-purple-300"
          >
            Save this search
          </button>
        </div>
      )}
    </div>
  );
}

export default AdvancedSearch;
