/**
 * Error reporting: send to backend and offline error queue.
 * Queues errors when offline and flushes when back online.
 */

import { recordError } from '../utils/errorAnalytics';
import type { VaultError } from '../utils/errorParser';

const REPORT_ENDPOINT = import.meta.env.VITE_ERROR_REPORT_ENDPOINT || '';
const OFFLINE_QUEUE_KEY = 'vaultdao_error_report_queue';
const MAX_QUEUE = 100;

export interface ReportPayload {
  code: string;
  message: string;
  stack?: string;
  context?: string;
  retryCount?: number;
}

function getQueue(): ReportPayload[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ReportPayload[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setQueue(items: ReportPayload[]) {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items.slice(-MAX_QUEUE)));
  } catch {
    // ignore
  }
}

function isOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine;
}

/**
 * Send a single error report to the backend.
 */
async function sendToBackend(payload: ReportPayload): Promise<boolean> {
  if (!REPORT_ENDPOINT) return false;
  try {
    const res = await fetch(REPORT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        timestamp: new Date().toISOString(),
        url: typeof window !== 'undefined' ? window.location.href : '',
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Report an error: record for analytics, queue if offline, send to backend if online.
 */
export function reportError(error: VaultError | ReportPayload): void {
  const payload: ReportPayload = {
    code: 'code' in error ? error.code : 'UNKNOWN',
    message: 'message' in error ? error.message : String(error),
    stack: 'stack' in error ? (error as { stack?: string }).stack : undefined,
    context: 'context' in error ? error.context : undefined,
    retryCount: 'retryCount' in error ? (error as ReportPayload).retryCount : undefined,
  };

  recordError({
    code: payload.code,
    message: payload.message,
    stack: payload.stack,
    context: payload.context,
    retryCount: payload.retryCount,
  });

  if (isOnline()) {
    sendToBackend(payload).then((ok) => {
      if (!ok) {
        const q = getQueue();
        q.push(payload);
        setQueue(q);
      }
    });
  } else {
    const q = getQueue();
    q.push(payload);
    setQueue(q);
  }
}

/**
 * Flush offline queue to backend (call when app comes online).
 */
export async function flushOfflineErrorQueue(): Promise<number> {
  const queue = getQueue();
  if (queue.length === 0 || !isOnline()) return 0;

  const sent: ReportPayload[] = [];
  for (const payload of queue) {
    const ok = await sendToBackend(payload);
    if (ok) sent.push(payload);
  }
  const remaining = queue.filter((p) => !sent.includes(p));
  setQueue(remaining);
  return sent.length;
}

/**
 * Get current queue length (for dashboard or debug).
 */
export function getOfflineQueueLength(): number {
  return getQueue().length;
}
