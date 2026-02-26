import type { DiffSegment } from '../types/comparison';

/**
 * Simple diff algorithm for highlighting differences between two strings
 * Returns segments marked as equal, insert, or delete
 */
export function calculateDiff(text1: string, text2: string): DiffSegment[] {
  const segments: DiffSegment[] = [];
  
  if (text1 === text2) {
    return [{ type: 'equal', value: text1 }];
  }

  const words1 = text1.split(/(\s+)/);
  const words2 = text2.split(/(\s+)/);

  const maxLen = Math.max(words1.length, words2.length);
  
  for (let i = 0; i < maxLen; i++) {
    const word1 = words1[i] || '';
    const word2 = words2[i] || '';

    if (word1 === word2) {
      segments.push({ type: 'equal', value: word1 });
    } else {
      if (word1) {
        segments.push({ type: 'delete', value: word1 });
      }
      if (word2) {
        segments.push({ type: 'insert', value: word2 });
      }
    }
  }

  return segments;
}

/**
 * Calculate character-level diff for more precise highlighting
 */
export function calculateCharDiff(text1: string, text2: string): DiffSegment[] {
  if (text1 === text2) {
    return [{ type: 'equal', value: text1 }];
  }

  const segments: DiffSegment[] = [];
  const len1 = text1.length;
  const len2 = text2.length;

  let i = 0;
  let j = 0;
  let equalBuffer = '';

  while (i < len1 || j < len2) {
    if (i < len1 && j < len2 && text1[i] === text2[j]) {
      equalBuffer += text1[i];
      i++;
      j++;
    } else {
      if (equalBuffer) {
        segments.push({ type: 'equal', value: equalBuffer });
        equalBuffer = '';
      }

      if (i < len1) {
        segments.push({ type: 'delete', value: text1[i] });
        i++;
      }
      if (j < len2) {
        segments.push({ type: 'insert', value: text2[j] });
        j++;
      }
    }
  }

  if (equalBuffer) {
    segments.push({ type: 'equal', value: equalBuffer });
  }

  return segments;
}

/**
 * Merge consecutive segments of the same type
 */
export function mergeSegments(segments: DiffSegment[]): DiffSegment[] {
  if (segments.length === 0) return [];

  const merged: DiffSegment[] = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    if (segments[i].type === current.type) {
      current.value += segments[i].value;
    } else {
      merged.push(current);
      current = { ...segments[i] };
    }
  }

  merged.push(current);
  return merged;
}

/**
 * Get diff segments with merged consecutive segments
 */
export function getDiffSegments(text1: string, text2: string, useCharLevel = false): DiffSegment[] {
  const segments = useCharLevel 
    ? calculateCharDiff(text1, text2)
    : calculateDiff(text1, text2);
  
  return mergeSegments(segments);
}
