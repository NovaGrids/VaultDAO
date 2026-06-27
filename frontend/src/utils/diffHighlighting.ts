/**
 * diffHighlighting.ts — word-level diff using diff-match-patch
 *
 * diff-match-patch ships as a CJS module whose default export IS the
 * constructor function.  We use a robust import pattern that works in
 * both Vite/ESM (browser builds) and the Vitest/Node test runner.
 */

// CJS interop: the package exports the constructor as module.exports,
// so in ESM the default import is the constructor.
import DiffMatchPatch from 'diff-match-patch';
import type { DiffSegment } from '../types/comparison';

// Numeric operation codes — declared as literals so we never rely on
// prototype properties that may be undefined in certain ESM interop modes.
const DIFF_EQUAL = 0;
const DIFF_INSERT = 1;
const DIFF_DELETE = -1;

// Resolve the constructor whether we get a default or named export
type DmpCtor = new () => {
  diff_main(a: string, b: string, lineMode?: boolean): Array<[number, string]>;
  diff_cleanupSemantic(diffs: Array<[number, string]>): void;
};

// Handle both `import DiffMatchPatch from 'diff-match-patch'` patterns:
//   • default export IS the ctor  (Vite ESM interop)
//   • default export has .diff_match_patch property  (some bundlers)
const Ctor = (
  typeof DiffMatchPatch === 'function'
    ? DiffMatchPatch
    : (DiffMatchPatch as unknown as Record<string, unknown>).diff_match_patch
) as DmpCtor;

const dmpInstance = new Ctor();

/**
 * Compute word-level diff segments between two strings using diff-match-patch.
 *
 * Words (and whitespace tokens) are each mapped to a private-use Unicode
 * character so diff_main can operate on them at "character" granularity,
 * giving true LCS-based word diffs.  Results are decoded back to readable
 * text and merged into DiffSegment[].
 */
export function getDiffSegments(text1: string, text2: string): DiffSegment[] {
  if (text1 === text2) {
    return [{ type: 'equal', value: text1 }];
  }

  // --- word-to-char encoding ---
  const wordToChar = new Map<string, string>();
  let charCode = 0xe000; // start of Unicode private-use area (E000–F8FF)

  function encodeWords(text: string): string {
    // Split on whitespace, preserving whitespace tokens
    const tokens = text.split(/(\s+)/);
    return tokens
      .map((token) => {
        if (!wordToChar.has(token)) {
          wordToChar.set(token, String.fromCodePoint(charCode++));
        }
        return wordToChar.get(token)!;
      })
      .join('');
  }

  const enc1 = encodeWords(text1);
  const enc2 = encodeWords(text2);

  // Build reverse map AFTER both strings are encoded
  const charToWord = new Map<string, string>();
  wordToChar.forEach((ch, word) => charToWord.set(ch, word));

  // --- diff on encoded character strings ---
  const rawDiffs = dmpInstance.diff_main(enc1, enc2, false);
  dmpInstance.diff_cleanupSemantic(rawDiffs);

  // --- decode back to words and build DiffSegment[] ---
  const segments: DiffSegment[] = [];

  for (const [op, encodedText] of rawDiffs) {
    // Decode: split encoded string into individual code-points (handles > U+FFFF)
    const value = [...encodedText]
      .map((ch) => charToWord.get(ch) ?? ch)
      .join('');

    if (op === DIFF_EQUAL) {
      segments.push({ type: 'equal', value });
    } else if (op === DIFF_INSERT) {
      segments.push({ type: 'insert', value });
    } else if (op === DIFF_DELETE) {
      segments.push({ type: 'delete', value });
    }
  }

  return mergeSegments(segments);
}

/**
 * Merge consecutive segments of the same type (reduces React node count).
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
 * Legacy aliases kept for backward-compatibility with any existing callers.
 */
export function calculateDiff(text1: string, text2: string): DiffSegment[] {
  return getDiffSegments(text1, text2);
}

export function calculateCharDiff(text1: string, text2: string): DiffSegment[] {
  return getDiffSegments(text1, text2);
}
