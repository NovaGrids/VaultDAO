/**
 * Tests for diff highlighting utilities
 * 
 * Note: These are example tests showing expected behavior.
 * In a real project, you would use Jest or Vitest.
 */

import { getDiffSegments, calculateDiff, mergeSegments } from '../diffHighlighting';

describe('Diff Highlighting', () => {
  describe('getDiffSegments', () => {
    it('should return equal segment for identical strings', () => {
      const segments = getDiffSegments('hello', 'hello');
      expect(segments.length).toBe(1);
      expect(segments[0].type).toBe('equal');
      expect(segments[0].value).toBe('hello');
    });

    it('should detect insertions', () => {
      const segments = getDiffSegments('hello', 'hello world');
      const hasInsert = segments.some((s) => s.type === 'insert');
      expect(hasInsert).toBe(true);
    });

    it('should detect deletions', () => {
      const segments = getDiffSegments('hello world', 'hello');
      const hasDelete = segments.some((s) => s.type === 'delete');
      expect(hasDelete).toBe(true);
    });

    it('should handle mixed changes', () => {
      const segments = getDiffSegments('hello world', 'hello earth');
      expect(segments.length).toBeGreaterThan(1);
      const types = segments.map((s) => s.type);
      expect(types).toContain('equal');
    });
  });

  describe('mergeSegments', () => {
    it('should merge consecutive segments of same type', () => {
      const segments = [
        { type: 'equal' as const, value: 'hello' },
        { type: 'equal' as const, value: ' ' },
        { type: 'equal' as const, value: 'world' },
      ];

      const merged = mergeSegments(segments);
      expect(merged.length).toBe(1);
      expect(merged[0].value).toBe('hello world');
    });

    it('should not merge different types', () => {
      const segments = [
        { type: 'equal' as const, value: 'hello' },
        { type: 'insert' as const, value: ' new' },
        { type: 'equal' as const, value: ' world' },
      ];

      const merged = mergeSegments(segments);
      expect(merged.length).toBe(3);
    });
  });
});
