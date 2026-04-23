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
  timestamp: number;
  userAgent: string;
  url: string;
  retryCount?: number;
}

const STORAGE_KEY = 'vaultdao_error_analytics';
const MAX_IN_MEMORY = 200;

const events: ErrorEvent[] = [];

function getStored(): ErrorEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ErrorEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(items: ErrorEvent[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-500)));
  } catch {
    // ignore quota or disabled localStorage
  }
}

/**
 * Record an error for analytics (in-memory + optional localStorage backup).
 * @param payload - Error details including code, message, stack, and optional context (e.g., component stack)
 */
export function recordError(payload: Omit<ErrorEvent, 'id' | 'timestamp' | 'userAgent' | 'url'>): void {
  try {
    const event: ErrorEvent = {
      ...payload,
      id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      url: typeof window !== 'undefined' ? window.location.href : '',
    };
    events.push(event);
    if (events.length > MAX_IN_MEMORY) events.splice(0, events.length - MAX_IN_MEMORY);
    
    const stored = getStored();
    stored.push(event);
    persist(stored);
    
    // Log to console in development for debugging
    if (import.meta.env.DEV) {
      console.warn('[ErrorAnalytics] Recorded error:', {
        code: event.code,
        message: event.message,
        context: event.context,
      });
    }
  } catch (error) {
    // Fail silently to prevent cascading errors
    console.error('[ErrorAnalytics] Failed to record error:', error);
  }
}

/**
 * Get recent errors for dashboard (in-memory only for current session).
 */
export function getErrorEvents(): ErrorEvent[] {
  return [...events].reverse();
}

/**
 * Get aggregated counts by code for the current session.
 */
export function getErrorCountsByCode(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.code] = (counts[e.code] ?? 0) + 1;
  }
  return counts;
}

/**
 * Get total count for current session.
 */
export function getTotalErrorCount(): number {
  return events.length;
}

/**
 * Clear in-memory analytics (optional; persisted queue is separate).
 */
export function clearErrorAnalytics(): void {
  events.length = 0;
}
