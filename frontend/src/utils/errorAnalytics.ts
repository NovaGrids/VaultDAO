/**
 * Error analytics: in-memory store and optional backend reporting.
 * Used by ErrorDashboard and ErrorReporting.
 */

export interface ErrorEvent {
  id: string;
  code: string;
  message: string;
  stack?: string;
  context?: string;
  /** Wallet address of the signed-in user when the error occurred, if known. */
  user?: string;
  /** Route/pathname the error occurred on. */
  page?: string;
  timestamp: number;
  userAgent: string;
  url: string;
  retryCount?: number;
  /** Number of times this same (code, message) pair has recurred within the dedup window. */
  occurrences: number;
}

const STORAGE_KEY = 'vaultdao_error_events';
const MAX_STORED = 100;
// Repeated errors with the same code+message within this window are folded
// into a single event (occurrences incremented) instead of creating noise.
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

// Initialize from localStorage
const loadEvents = (): ErrorEvent[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    console.warn('Failed to load error events from localStorage:', e);
    return [];
  }
};

let events: ErrorEvent[] = loadEvents();

const persistEvents = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_STORED)));
  } catch (e) {
    console.warn('Failed to persist error events:', e);
  }
};

/**
 * Record an error for analytics. Repeated errors (same code + message) within
 * DEDUP_WINDOW_MS are folded into the existing event rather than creating a
 * new entry, so a crash loop doesn't flood the store or the dashboard.
 */
export function recordError(payload: {
  code: string;
  message: string;
  stack?: string;
  context?: string;
  user?: string;
  page?: string;
  retryCount?: number;
}): string {
  const now = Date.now();
  const existing = events.find(
    (e) => e.code === payload.code && e.message === payload.message && now - e.timestamp < DEDUP_WINDOW_MS,
  );

  if (existing) {
    existing.occurrences += 1;
    existing.timestamp = now;
    if (payload.user) existing.user = payload.user;
    if (payload.page) existing.page = payload.page;
    persistEvents();
    return existing.id;
  }

  // 8-character uppercase UUID for support reference
  const id = Math.random().toString(36).substring(2, 10).toUpperCase();
  const event: ErrorEvent = {
    ...payload,
    id,
    timestamp: now,
    occurrences: 1,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    url: typeof window !== 'undefined' ? window.location.href : 'unknown',
  };

  events.push(event);
  if (events.length > MAX_STORED) {
    events = events.slice(-MAX_STORED);
  }

  persistEvents();

  if ((import.meta as any).env?.DEV) {
    console.warn(`[ErrorAnalytics] Recorded error ${id}:`, payload);
  }

  return id;
}

export function getErrorEvents(): ErrorEvent[] {
  return [...events].sort((a, b) => b.timestamp - a.timestamp);
}

export function getRecentErrors(count = 20): ErrorEvent[] {
  return getErrorEvents().slice(0, count);
}

export function clearErrorAnalytics(): void {
  events = [];
  localStorage.removeItem(STORAGE_KEY);
}

export function exportErrorsAsJson(): string {
  return JSON.stringify(events, null, 2);
}

export function getTotalErrorCount(): number {
  return events.length;
}

export function getErrorCountsByCode(): Record<string, number> {
  return events.reduce((acc, event) => {
    acc[event.code] = (acc[event.code] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}
