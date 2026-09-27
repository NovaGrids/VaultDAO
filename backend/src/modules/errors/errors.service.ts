/**
 * In-memory client error collection.
 *
 * Stores errors reported by the frontend ErrorBoundary, deduplicating
 * repeated occurrences of the same (code, message) pair within a short
 * window so a single crashing component doesn't flood storage.
 */

import type { ClientErrorPayload, StoredClientError } from "./errors.types.js";

const MAX_STORED = 500;
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

function generateId(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function fingerprint(payload: Pick<ClientErrorPayload, "code" | "message">): string {
  return `${payload.code}|${payload.message}`;
}

export class ErrorsService {
  private events: (StoredClientError & { seq: number })[] = [];
  private seqCounter = 0;

  /** Record a client error, deduplicating recent repeats. Returns the (possibly existing) id. */
  record(payload: ClientErrorPayload): { id: string; deduped: boolean } {
    const now = Date.now();
    const fp = fingerprint(payload);

    const existing = this.events.find(
      (e) => fingerprint(e) === fp && now - new Date(e.lastSeen).getTime() < DEDUP_WINDOW_MS,
    );

    if (existing) {
      existing.occurrences += 1;
      existing.lastSeen = new Date(now).toISOString();
      existing.seq = ++this.seqCounter;
      return { id: existing.id, deduped: true };
    }

    const id = generateId();
    const stored: StoredClientError & { seq: number } = {
      ...payload,
      id,
      firstSeen: new Date(now).toISOString(),
      lastSeen: new Date(now).toISOString(),
      occurrences: 1,
      seq: ++this.seqCounter,
    };

    this.events.push(stored);
    if (this.events.length > MAX_STORED) {
      this.events = this.events.slice(-MAX_STORED);
    }

    return { id, deduped: false };
  }

  getRecent(limit = 50): StoredClientError[] {
    return [...this.events]
      .sort((a, b) => b.seq - a.seq)
      .slice(0, limit)
      .map(({ seq: _seq, ...rest }) => rest);
  }

  count(): number {
    return this.events.length;
  }

  clear(): void {
    this.events = [];
  }
}
