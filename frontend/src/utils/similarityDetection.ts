import type { SimilarityScore } from '../types/comparison';

/**
 * Calculate Levenshtein distance between two strings
 * Used for measuring string similarity
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  if (len1 === 0) return len2;
  if (len2 === 0) return len1;

  // Initialize matrix
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[len1][len2];
}

/**
 * Calculate similarity score between two strings (0-1)
 * 1 = identical, 0 = completely different
 */
export function calculateStringSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1;
  if (!str1 || !str2) return 0;

  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1;

  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1;

  const distance = levenshteinDistance(s1, s2);
  return 1 - distance / maxLen;
}

/**
 * Calculate similarity between two proposals
 */
export function calculateProposalSimilarity(
  proposal1: any,
  proposal2: any,
  fields: string[] = ['recipient', 'amount', 'memo', 'token']
): SimilarityScore {
  const fieldScores: Record<string, number> = {};
  let totalScore = 0;

  for (const field of fields) {
    const val1 = String(proposal1[field] || '');
    const val2 = String(proposal2[field] || '');
    const score = calculateStringSimilarity(val1, val2);
    fieldScores[field] = score;
    totalScore += score;
  }

  const overall = totalScore / fields.length;
  const isDuplicate = overall >= 0.85; // 85% similarity threshold

  return {
    overall,
    fields: fieldScores,
    isDuplicate,
  };
}

/**
 * Detect duplicate proposals in a list
 */
export function detectDuplicates(
  proposals: any[],
  threshold: number = 0.85
): Array<[string, string, number]> {
  const duplicates: Array<[string, string, number]> = [];

  for (let i = 0; i < proposals.length; i++) {
    for (let j = i + 1; j < proposals.length; j++) {
      const similarity = calculateProposalSimilarity(proposals[i], proposals[j]);
      if (similarity.overall >= threshold) {
        duplicates.push([proposals[i].id, proposals[j].id, similarity.overall]);
      }
    }
  }

  return duplicates;
}

/**
 * Calculate similarity matrix for multiple proposals
 */
export function calculateSimilarityMatrix(
  proposals: any[]
): Map<string, SimilarityScore> {
  const matrix = new Map<string, SimilarityScore>();

  for (let i = 0; i < proposals.length; i++) {
    for (let j = i + 1; j < proposals.length; j++) {
      const key = `${proposals[i].id}-${proposals[j].id}`;
      const similarity = calculateProposalSimilarity(proposals[i], proposals[j]);
      matrix.set(key, similarity);
    }
  }

  return matrix;
}
