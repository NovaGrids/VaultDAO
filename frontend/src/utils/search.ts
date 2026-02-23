/**
 * Search utilities: fuzzy search (Fuse.js), highlight, export, localStorage for history/saved searches.
 */
import Fuse from 'fuse.js';

const SEARCH_HISTORY_KEY = 'vaultdao_search_history';
const SAVED_SEARCHES_KEY = 'vaultdao_saved_searches';
const MAX_HISTORY = 20;
const MAX_SAVED = 50;

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  filters: Record<string, unknown>;
  createdAt: string;
}

export interface FilterCondition {
  field: string;
  type: 'text' | 'number_range' | 'date_range' | 'select' | 'multi_select';
  value: unknown;
  label?: string;
}

/** Get search history from localStorage */
export function getSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? arr.slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

/** Add query to history (prepend, dedupe, trim) */
export function addToSearchHistory(query: string): void {
  if (!query?.trim()) return;
  const trimmed = query.trim();
  const prev = getSearchHistory().filter((q) => q !== trimmed);
  const next = [trimmed, ...prev].slice(0, MAX_HISTORY);
  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // ignore quota
  }
}

/** Get saved searches from localStorage */
export function getSavedSearches(): SavedSearch[] {
  try {
    const raw = localStorage.getItem(SAVED_SEARCHES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as SavedSearch[];
    return Array.isArray(arr) ? arr.slice(0, MAX_SAVED) : [];
  } catch {
    return [];
  }
}

/** Save a new saved search */
export function saveSearch(name: string, query: string, filters: Record<string, unknown>): SavedSearch {
  const list = getSavedSearches();
  const item: SavedSearch = {
    id: `saved-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: name.trim() || 'Unnamed search',
    query: query.trim(),
    filters: { ...filters },
    createdAt: new Date().toISOString(),
  };
  list.unshift(item);
  const next = list.slice(0, MAX_SAVED);
  try {
    localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return item;
}

/** Delete a saved search by id */
export function deleteSavedSearch(id: string): void {
  const list = getSavedSearches().filter((s) => s.id !== id);
  try {
    localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

/** Fuzzy search over a list of objects with given keys */
export function fuzzySearch<T>(
  items: T[],
  query: string,
  keys: (keyof T)[],
  options?: { threshold?: number; limit?: number }
): T[] {
  if (!items.length) return [];
  const q = (query || '').trim();
  if (!q) return items;

  const fuse = new Fuse(items, {
    keys: keys as string[],
    threshold: options?.threshold ?? 0.4,
    includeScore: true,
  });
  const results = fuse.search(q);
  const limit = options?.limit ?? 100;
  return results.slice(0, limit).map((r: { item: T }) => r.item);
}

/** Highlight search terms in text (case-insensitive, escape HTML) */
export function highlightMatch(text: string, query: string, highlightClass = 'bg-amber-500/40 text-amber-100 rounded px-0.5'): string {
  if (!query?.trim() || !text) return escapeHtml(String(text));
  const escaped = escapeHtml(String(text));
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return escaped;

  let out = escaped;
  for (const term of terms) {
    const re = new RegExp(`(${escapeRegex(term)})`, 'gi');
    out = out.replace(re, `<mark class="${highlightClass}">$1</mark>`);
  }
  return out;
}

function escapeHtml(s: string): string {
  const el = document.createElement('div');
  el.textContent = s;
  return el.innerHTML;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Export search results to CSV (array of objects) */
export function exportSearchResultsToCsv<T extends Record<string, unknown>>(
  rows: T[],
  filename = 'search-results.csv'
): void {
  if (rows.length === 0) {
    return;
  }
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const header = keys.map((k) => `"${String(k).replace(/"/g, '""')}"`).join(',');
  const lines = [header];
  for (const row of rows) {
    const cells = keys.map((k) => {
      const v = row[k];
      const str = v == null ? '' : String(v);
      return `"${str.replace(/"/g, '""')}"`;
    });
    lines.push(cells.join(','));
  }
  const csv = lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Apply filter values to a list of objects. Item must have the field keys. */
export function applyFilters<T extends Record<string, unknown>>(
  items: T[],
  filterValues: Array<{
    field: string;
    type: string;
    text?: string;
    numberMin?: number;
    numberMax?: number;
    dateFrom?: string;
    dateTo?: string;
    select?: string;
    multiSelect?: string[];
  }>,
  fieldKeys: Set<string>
): T[] {
  if (!filterValues.length) return items;
  return items.filter((item) => {
    for (const f of filterValues) {
      if (!fieldKeys.has(f.field)) continue;
      const raw = item[f.field];
      if (f.type === 'text' && f.text != null && f.text.trim() !== '') {
        const str = raw == null ? '' : String(raw).toLowerCase();
        if (!str.includes(f.text.trim().toLowerCase())) return false;
      }
      if (f.type === 'number_range') {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (Number.isFinite(f.numberMin) && n < f.numberMin!) return false;
        if (Number.isFinite(f.numberMax) && n > f.numberMax!) return false;
      }
      if (f.type === 'date_range') {
        const d = raw == null ? '' : String(raw).slice(0, 10);
        if (f.dateFrom && d < f.dateFrom) return false;
        if (f.dateTo && d > f.dateTo) return false;
      }
      if (f.type === 'select' && f.select != null) {
        if (String(raw) !== f.select) return false;
      }
      if (f.type === 'multi_select' && f.multiSelect?.length) {
        const v = String(raw);
        if (!f.multiSelect.includes(v)) return false;
      }
    }
    return true;
  });
}

/** Build suggestions: recent history + saved search names/queries, filtered by current input */
export function getSearchSuggestions(
  input: string,
  history: string[],
  saved: SavedSearch[],
  maxSuggestions = 8
): { type: 'history' | 'saved'; text: string; name?: string }[] {
  const q = (input || '').trim().toLowerCase();
  const out: { type: 'history' | 'saved'; text: string; name?: string }[] = [];

  for (const h of history) {
    if (h.toLowerCase().includes(q) && h !== q) {
      out.push({ type: 'history', text: h });
      if (out.length >= maxSuggestions) return out;
    }
  }
  for (const s of saved) {
    const matchName = s.name.toLowerCase().includes(q);
    const matchQuery = s.query.toLowerCase().includes(q);
    if ((matchName || matchQuery) && out.every((o) => o.text !== s.query)) {
      out.push({ type: 'saved', text: s.query, name: s.name });
      if (out.length >= maxSuggestions) return out;
    }
  }
  return out;
}
