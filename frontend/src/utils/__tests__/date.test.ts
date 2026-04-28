import { describe, it, expect, vi, afterEach } from 'vitest';
import { ledgerToDate, formatDate, formatRelativeTime } from '../date';

// Stellar genesis: July 8, 2015 16:43:20 UTC
const GENESIS_MS = 1436387400000;
const LEDGER_MS = 5000; // 5 s per ledger

describe('ledgerToDate', () => {
  it('returns a Date offset from genesis by ledger × 5 s', () => {
    const ledger = 1;
    const expected = new Date(GENESIS_MS + ledger * LEDGER_MS);
    expect(ledgerToDate(ledger).getTime()).toBe(expected.getTime());
  });

  it('handles ledger 0 by returning a new Date (current time, approximately)', () => {
    // ledger 0 is falsy — implementation returns new Date()
    const before = Date.now();
    const result = ledgerToDate(0).getTime();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it('handles negative ledger the same as falsy (returns current Date)', () => {
    const before = Date.now();
    const result = ledgerToDate(-1).getTime();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it('converts a known large ledger number correctly', () => {
    const ledger = 10_000_000;
    const expected = new Date(GENESIS_MS + ledger * LEDGER_MS);
    expect(ledgerToDate(ledger).getTime()).toBe(expected.getTime());
  });

  it('returns a Date instance', () => {
    expect(ledgerToDate(1000) instanceof Date).toBe(true);
  });
});

describe('formatDate', () => {
  it('returns an empty string for falsy input', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate(0)).toBe('');
    expect(formatDate(null as unknown as Date)).toBe('');
  });

  it('returns empty string for an invalid date string', () => {
    expect(formatDate('not-a-date')).toBe('');
  });

  it('accepts a Date object and returns a non-empty string', () => {
    const d = new Date('2024-01-15T10:30:00Z');
    const result = formatDate(d);
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('accepts a numeric timestamp', () => {
    const ts = new Date('2024-06-01T00:00:00Z').getTime();
    const result = formatDate(ts);
    expect(result).toBeTruthy();
  });

  it('accepts a date string', () => {
    const result = formatDate('2024-01-15T10:30:00Z');
    expect(result).toBeTruthy();
    expect(result).toContain('2024');
  });

  it('includes the year in the output', () => {
    const d = new Date('2024-03-22T08:00:00Z');
    expect(formatDate(d)).toContain('2024');
  });
});

describe('formatRelativeTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const freeze = (nowMs: number) => {
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);
  };

  it('returns empty string for falsy input', () => {
    expect(formatRelativeTime('')).toBe('');
    expect(formatRelativeTime(0)).toBe('');
    expect(formatRelativeTime(null as unknown as Date)).toBe('');
  });

  it('returns empty string for an invalid date', () => {
    expect(formatRelativeTime('not-a-date')).toBe('');
  });

  it('returns "just now" for a date less than 60 s ago', () => {
    const now = Date.now();
    freeze(now);
    expect(formatRelativeTime(new Date(now - 30_000))).toBe('just now');
  });

  it('returns singular "minute ago" for exactly 1 minute ago', () => {
    const now = Date.now();
    freeze(now);
    expect(formatRelativeTime(new Date(now - 60_000))).toBe('1 minute ago');
  });

  it('returns plural "minutes ago" for > 1 minute', () => {
    const now = Date.now();
    freeze(now);
    expect(formatRelativeTime(new Date(now - 5 * 60_000))).toBe('5 minutes ago');
  });

  it('returns singular "hour ago" for exactly 1 hour ago', () => {
    const now = Date.now();
    freeze(now);
    expect(formatRelativeTime(new Date(now - 3_600_000))).toBe('1 hour ago');
  });

  it('returns plural "hours ago" for > 1 hour', () => {
    const now = Date.now();
    freeze(now);
    expect(formatRelativeTime(new Date(now - 3 * 3_600_000))).toBe('3 hours ago');
  });

  it('returns singular "day ago" for exactly 1 day ago', () => {
    const now = Date.now();
    freeze(now);
    expect(formatRelativeTime(new Date(now - 86_400_000))).toBe('1 day ago');
  });

  it('returns plural "days ago" for > 1 day', () => {
    const now = Date.now();
    freeze(now);
    expect(formatRelativeTime(new Date(now - 3 * 86_400_000))).toBe('3 days ago');
  });

  it('returns "week/weeks ago" for 7–27 days', () => {
    const now = Date.now();
    freeze(now);
    expect(formatRelativeTime(new Date(now - 7 * 86_400_000))).toBe('1 week ago');
    expect(formatRelativeTime(new Date(now - 14 * 86_400_000))).toBe('2 weeks ago');
  });

  it('returns "month/months ago" for 30–364 days', () => {
    const now = Date.now();
    freeze(now);
    expect(formatRelativeTime(new Date(now - 60 * 86_400_000))).toBe('2 months ago');
  });

  it('returns "year/years ago" for >= 365 days', () => {
    const now = Date.now();
    freeze(now);
    expect(formatRelativeTime(new Date(now - 365 * 86_400_000))).toBe('1 year ago');
    expect(formatRelativeTime(new Date(now - 730 * 86_400_000))).toBe('2 years ago');
  });

  it('accepts a numeric timestamp', () => {
    const now = Date.now();
    freeze(now);
    const result = formatRelativeTime(now - 90_000); // 90 s ago → 1 minute ago
    expect(result).toBe('1 minute ago');
  });
});
