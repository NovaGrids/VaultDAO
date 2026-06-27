/**
 * Tests for diff highlighting utilities (backed by diff-match-patch)
 */

import { describe, it, expect } from 'vitest';
import { getDiffSegments, calculateDiff, mergeSegments } from '../diffHighlighting';

describe('getDiffSegments (diff-match-patch backed)', () => {
  it('returns a single equal segment for identical strings', () => {
    const segments = getDiffSegments('hello', 'hello');
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe('equal');
    expect(segments[0].value).toBe('hello');
  });

  it('returns empty string as a single equal segment', () => {
    const segments = getDiffSegments('', '');
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe('equal');
  });

  it('detects word-level insertions', () => {
    const segments = getDiffSegments('hello', 'hello world');
    const hasInsert = segments.some((s) => s.type === 'insert');
    expect(hasInsert).toBe(true);
    // No delete: we only added a word
    const hasDelete = segments.some((s) => s.type === 'delete');
    expect(hasDelete).toBe(false);
  });

  it('detects word-level deletions', () => {
    const segments = getDiffSegments('hello world', 'hello');
    const hasDelete = segments.some((s) => s.type === 'delete');
    expect(hasDelete).toBe(true);
    const hasInsert = segments.some((s) => s.type === 'insert');
    expect(hasInsert).toBe(false);
  });

  it('handles mixed word substitution', () => {
    const segments = getDiffSegments('hello world', 'hello earth');
    const types = segments.map((s) => s.type);
    expect(types).toContain('equal'); // "hello" is equal
    expect(types).toContain('delete'); // "world" removed
    expect(types).toContain('insert'); // "earth" added
  });

  it('reconstructed left text equals original (equal + delete segments)', () => {
    const text1 = 'the quick brown fox';
    const text2 = 'the slow red fox';
    const segments = getDiffSegments(text1, text2);
    const leftText = segments
      .filter((s) => s.type !== 'insert')
      .map((s) => s.value)
      .join('');
    expect(leftText).toBe(text1);
  });

  it('reconstructed right text equals original (equal + insert segments)', () => {
    const text1 = 'the quick brown fox';
    const text2 = 'the slow red fox';
    const segments = getDiffSegments(text1, text2);
    const rightText = segments
      .filter((s) => s.type !== 'delete')
      .map((s) => s.value)
      .join('');
    expect(rightText).toBe(text2);
  });

  it('handles large description without error', () => {
    const long = 'word '.repeat(1000);
    expect(() => getDiffSegments(long, long + ' extra')).not.toThrow();
  });
});

describe('calculateDiff (legacy alias)', () => {
  it('is exported and returns same shape as getDiffSegments', () => {
    const a = getDiffSegments('foo bar', 'foo baz');
    const b = calculateDiff('foo bar', 'foo baz');
    // Both should produce segments with the same types (order/values may differ marginally)
    expect(a.map((s) => s.type)).toEqual(b.map((s) => s.type));
  });
});

describe('mergeSegments', () => {
  it('merges consecutive segments of same type', () => {
    const segments = [
      { type: 'equal' as const, value: 'hello' },
      { type: 'equal' as const, value: ' ' },
      { type: 'equal' as const, value: 'world' },
    ];
    const merged = mergeSegments(segments);
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe('hello world');
  });

  it('does not merge segments of different types', () => {
    const segments = [
      { type: 'equal' as const, value: 'hello' },
      { type: 'insert' as const, value: ' new' },
      { type: 'equal' as const, value: ' world' },
    ];
    const merged = mergeSegments(segments);
    expect(merged).toHaveLength(3);
  });

  it('returns empty array for empty input', () => {
    expect(mergeSegments([])).toEqual([]);
  });
});

